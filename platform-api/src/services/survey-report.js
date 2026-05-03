'use strict';

/**
 * Walk an IVR flow_data graph and return the captures eligible for the
 * single-digit survey report.
 *
 * Eligibility:
 *   - node.type === 'collect'
 *   - node.maxDigits === 1
 *   - At least one of node.reportLabelAr / node.reportLabelEn is non-empty.
 *
 * `flowData` is whatever was stored in `ivr_flows.flow_data`. It is normally
 * `{ nodes: { [id]: nodeObj } }` or `{ nodes: [ ... ] }`. Both shapes are
 * tolerated.
 *
 * Returns an array preserving discovery order:
 *   [{ nodeId, variable, labelAr, labelEn }, ...]
 */
function extractEligibleCaptures(flowData) {
  if (!flowData || typeof flowData !== 'object') return [];

  const rawNodes = flowData.nodes;
  let iterable;
  if (Array.isArray(rawNodes)) {
    iterable = rawNodes.filter((n) => n && n.id);
  } else if (rawNodes && typeof rawNodes === 'object') {
    iterable = Object.entries(rawNodes).map(([id, node]) => ({
      ...node,
      id
    }));
  } else {
    return [];
  }

  const eligible = [];
  for (const node of iterable) {
    if (!node || node.type !== 'collect') continue;
    if (Number(node.maxDigits) !== 1) continue;
    const labelAr = (node.reportLabelAr || '').trim();
    const labelEn = (node.reportLabelEn || '').trim();
    if (!labelAr && !labelEn) continue;

    eligible.push({
      nodeId: node.id,
      variable: node.variable || node.id,
      labelAr,
      labelEn
    });
  }
  return eligible;
}

/**
 * Enumerate calendar months covered by the inclusive date range [from, to].
 * Returns [{ year, month, monthKey, startDate, endDate }] in ascending order.
 *
 * `from` and `to` are 'YYYY-MM-DD' strings. `startDate` and `endDate` clamp
 * to the user's range so partial months know their covered day span.
 */
function enumerateMonths(from, to) {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error('Invalid date range');
  }
  if (fromDate > toDate) {
    throw new Error('"from" must be on or before "to"');
  }

  const months = [];
  let cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), 1));

  while (cursor <= lastMonthStart) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth(); // 0-based
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)); // last day of month

    const startDate = firstOfMonth < fromDate ? fromDate : firstOfMonth;
    const endDate = lastOfMonth > toDate ? toDate : lastOfMonth;

    months.push({
      year,
      month,
      monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
      startDate,
      endDate
    });

    cursor = new Date(Date.UTC(year, month + 1, 1));
  }
  return months;
}

/**
 * Aggregate `outbound_calls.variables[<capture.variable>]` per month, per
 * digit, for every selected capture. Filters to valid digits only (per spec
 * decision Q3 = B): out-of-range / null / multi-digit values are excluded
 * from both the digit counts AND the surveys-count denominator.
 *
 * Args:
 *   db          - better-sqlite3 instance.
 *   campaignId  - string.
 *   captures    - [{ nodeId, variable, labelAr, labelEn }, ...]
 *   from, to    - 'YYYY-MM-DD' inclusive range.
 *   digitMin    - integer.
 *   digitMax    - integer.
 *
 * Returns:
 *   {
 *     months: [{ year, month, monthKey, startDate, endDate }, ...],
 *     // For every month and every capture:
 *     //   counts[monthKey][nodeId][digit] = number
 *     //   surveys[monthKey][nodeId]       = number   (sum of valid digits)
 *     counts: { [monthKey]: { [nodeId]: { [digit]: number } } },
 *     surveys: { [monthKey]: { [nodeId]: number } }
 *   }
 */
function aggregateSurveyData({ db, campaignId, captures, from, to, digitMin, digitMax }) {
  const months = enumerateMonths(from, to);

  const counts = {};
  const surveys = {};
  for (const m of months) {
    counts[m.monthKey] = {};
    surveys[m.monthKey] = {};
    for (const c of captures) {
      if (!c || !c.nodeId || !c.variable) continue;
      counts[m.monthKey][c.nodeId] = {};
      for (let d = digitMin; d <= digitMax; d++) {
        counts[m.monthKey][c.nodeId][String(d)] = 0;
      }
      surveys[m.monthKey][c.nodeId] = 0;
    }
  }

  // `outbound_calls.dial_start_time` is set via SQLite's CURRENT_TIMESTAMP,
  // which stores `YYYY-MM-DD HH:MM:SS` in UTC. We compare with julianday()
  // to match the format-agnostic pattern used in analytics.js, and extract
  // YYYY-MM directly from the string so we don't have to parse it.
  const rangeStart = `${from} 00:00:00`;
  // Inclusive end-of-day: cover up to (and including) `to` 23:59:59 by
  // bounding strictly less than the next day's midnight.
  const toDate = new Date(`${to}T00:00:00Z`);
  const dayAfterTo = (() => {
    const next = new Date(Date.UTC(
      toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate() + 1
    ));
    const y = next.getUTCFullYear();
    const m = String(next.getUTCMonth() + 1).padStart(2, '0');
    const d = String(next.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d} 00:00:00`;
  })();

  const rows = db.prepare(`
    SELECT dial_start_time, variables
    FROM outbound_calls
    WHERE campaign_id = ?
      AND julianday(dial_start_time) >= julianday(?)
      AND julianday(dial_start_time) <  julianday(?)
  `).all(campaignId, rangeStart, dayAfterTo);

  for (const row of rows) {
    if (!row.dial_start_time) continue;
    // Both 'YYYY-MM-DD HH:MM:SS' and 'YYYY-MM-DDTHH:MM:SS.sssZ' start with
    // YYYY-MM. Avoid Date parsing here — for non-Z strings, Node would
    // interpret as local time and shift the month.
    const monthKey = String(row.dial_start_time).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
    if (!counts[monthKey]) continue; // outside enumerated months

    let vars = {};
    try {
      vars = row.variables ? JSON.parse(row.variables) : {};
    } catch (_e) {
      continue;
    }

    for (const cap of captures) {
      if (!cap || !cap.nodeId || !cap.variable) continue;
      const raw = vars[cap.variable];
      // Variables can be stored as { value: '3' } or '3'.
      const val = (raw && typeof raw === 'object' && 'value' in raw) ? raw.value : raw;
      if (val === null || val === undefined) continue;

      const str = String(val).trim();
      if (str.length !== 1) continue;
      if (!/^[0-9]$/.test(str)) continue;
      const digit = Number(str);
      if (digit < digitMin || digit > digitMax) continue;

      counts[monthKey][cap.nodeId][str] = (counts[monthKey][cap.nodeId][str] || 0) + 1;
      surveys[monthKey][cap.nodeId] = (surveys[monthKey][cap.nodeId] || 0) + 1;
    }
  }

  return { months, counts, surveys };
}

const XLSX = require('xlsx');

const HEADER_TRANSLATIONS = {
  ar: {
    number: 'رقم',
    month: 'الشهر',
    questions: 'الاسئلة',
    surveys: 'عدد الاستبيانات',
    count: 'عدد',
    percent: 'نسبة',
    total: 'الاجمالي'
  },
  en: {
    number: '#',
    month: 'Month',
    questions: 'Questions',
    surveys: 'Number of surveys',
    count: 'Count',
    percent: 'Percentage',
    total: 'Total'
  }
};

function colLetter(zeroIdx) {
  // Supports up to ZZ; we never go past column ~30 for digitMax<=9.
  let n = zeroIdx;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function formatMonthLabel(language, monthBlock) {
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long' }).format(
    new Date(Date.UTC(monthBlock.year, monthBlock.month, 1))
  );
  const base = `${monthName} ${monthBlock.year}`;

  const fullStart = new Date(Date.UTC(monthBlock.year, monthBlock.month, 1));
  const fullEnd = new Date(Date.UTC(monthBlock.year, monthBlock.month + 1, 0));
  const isPartial = monthBlock.startDate > fullStart || monthBlock.endDate < fullEnd;
  if (!isPartial) return base;

  const startDay = monthBlock.startDate.getUTCDate();
  const endDay = monthBlock.endDate.getUTCDate();
  return `${base} (${startDay}-${endDay})`;
}

function sanitizeFilenamePart(value) {
  return String(value || 'campaign')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'campaign';
}

/**
 * Build a workbook buffer matching the reference template.
 * One block per calendar month, separated by a blank row.
 *
 * Args:
 *   language         - 'ar' | 'en'
 *   captures         - [{ nodeId, variable, labelAr, labelEn }, ...]
 *   digitMin/Max     - integers
 *   aggregation      - return value of aggregateSurveyData()
 *
 * Returns: Buffer (xlsx).
 */
function buildSurveyWorkbook({ language, captures, digitMin, digitMax, aggregation }) {
  const tr = HEADER_TRANSLATIONS[language] || HEADER_TRANSLATIONS.en;
  const digitColumns = [];
  for (let d = digitMin; d <= digitMax; d++) digitColumns.push(d);

  // Column layout: A=#, B=Month, C=Questions, D=Surveys, then 2 cols per digit.
  const baseCols = 4;
  const totalCols = baseCols + digitColumns.length * 2;

  // Build cells in AOA form, then post-process formulas/merges.
  const aoa = [];
  const merges = [];

  for (const monthBlock of aggregation.months) {
    const blockStartRow = aoa.length; // 0-based
    const headerRow1 = new Array(totalCols).fill('');
    headerRow1[0] = tr.number;
    headerRow1[1] = tr.month;
    headerRow1[2] = tr.questions;
    headerRow1[3] = tr.surveys;
    digitColumns.forEach((d, i) => {
      headerRow1[baseCols + i * 2] = d;
    });
    aoa.push(headerRow1);

    const headerRow2 = new Array(totalCols).fill('');
    digitColumns.forEach((_d, i) => {
      headerRow2[baseCols + i * 2] = tr.count;
      headerRow2[baseCols + i * 2 + 1] = tr.percent;
    });
    aoa.push(headerRow2);

    // Merge digit headers across their 2 sub-cols on row 1.
    digitColumns.forEach((_d, i) => {
      const c = baseCols + i * 2;
      merges.push({
        s: { r: blockStartRow, c },
        e: { r: blockStartRow, c: c + 1 }
      });
    });

    // Merge headers vertically (col A, B, C, D rows 1-2).
    for (const c of [0, 1, 2, 3]) {
      merges.push({
        s: { r: blockStartRow, c },
        e: { r: blockStartRow + 1, c }
      });
    }

    // Question rows.
    const firstQuestionRow = aoa.length; // 0-based
    captures.forEach((cap, idx) => {
      const rowIdx = aoa.length;
      const excelRow = rowIdx + 1; // 1-based for formulas
      const row = new Array(totalCols).fill('');
      row[0] = idx + 1;
      // col B (month) is filled only on the first question row; rest are '' so the merge doesn't show duplicate text.
      row[1] = idx === 0 ? formatMonthLabel(language, monthBlock) : '';
      row[2] = (language === 'ar' ? (cap.labelAr || cap.labelEn) : (cap.labelEn || cap.labelAr));

      // Surveys formula: sum of all count cells in this row.
      const countCells = digitColumns.map((_d, i) => `${colLetter(baseCols + i * 2)}${excelRow}`);
      row[3] = { f: countCells.join('+') };

      digitColumns.forEach((d, i) => {
        const c = baseCols + i * 2;
        row[c] = aggregation.counts[monthBlock.monthKey][cap.nodeId][String(d)] || 0;
        const countCell = `${colLetter(c)}${excelRow}`;
        const surveysCell = `D${excelRow}`;
        row[c + 1] = { f: `IFERROR(${countCell}/${surveysCell},0)`, z: '0.00%' };
      });
      aoa.push(row);
    });
    const lastQuestionRow = aoa.length - 1;

    // Total row.
    const totalRowIdx = aoa.length;
    const totalRow = new Array(totalCols).fill('');
    totalRow[0] = tr.total;
    // Sum each numeric column (D onward).
    for (let c = 3; c < totalCols; c++) {
      const colL = colLetter(c);
      const isPercentCol = c >= baseCols && ((c - baseCols) % 2 === 1);
      const cell = {
        f: `SUM(${colL}${firstQuestionRow + 1}:${colL}${lastQuestionRow + 1})`
      };
      if (isPercentCol) cell.z = '0.00%';
      totalRow[c] = cell;
    }
    aoa.push(totalRow);

    // Merge "Total" label across A..C.
    merges.push({
      s: { r: totalRowIdx, c: 0 },
      e: { r: totalRowIdx, c: 2 }
    });

    // Merge column B across all question rows + total row of this block.
    merges.push({
      s: { r: firstQuestionRow, c: 1 },
      e: { r: lastQuestionRow, c: 1 }
    });

    // Blank row separator between blocks.
    aoa.push(new Array(totalCols).fill(''));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  if (language === 'ar') {
    ws['!views'] = [{ RTL: true }];
  }

  // Column widths: a sensible default so question text isn't cropped.
  ws['!cols'] = [
    { wch: 5 },   // #
    { wch: 22 },  // Month
    { wch: 28 },  // Questions
    { wch: 16 },  // Surveys
    ...digitColumns.flatMap(() => [{ wch: 8 }, { wch: 12 }])
  ];

  // Promote { f, z } objects to proper cell objects with numFmt.
  for (const cellAddr of Object.keys(ws)) {
    if (cellAddr.startsWith('!')) continue;
    const cell = ws[cellAddr];
    if (cell && typeof cell === 'object' && cell.f && cell.z && !cell.t) {
      cell.t = 'n';
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  extractEligibleCaptures,
  enumerateMonths,
  aggregateSurveyData,
  buildSurveyWorkbook,
  sanitizeFilenamePart
};
