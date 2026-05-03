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

module.exports = {
  extractEligibleCaptures,
  enumerateMonths,
  aggregateSurveyData
};
