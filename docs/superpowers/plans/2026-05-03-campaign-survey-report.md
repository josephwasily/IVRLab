# Campaign Survey Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Excel survey report (count + percentage per DTMF digit, RTL/LTR per dashboard language, monthly blocks) downloadable from the campaign details page.

**Architecture:** Backend `xlsx` generation in a new service module called from two new routes on the existing campaigns router. Frontend modal in `admin-portal-v2` posts capture selection + date range + digit range, downloads the resulting blob via the existing axios + JWT pattern. Two optional fields (`reportLabelAr`, `reportLabelEn`) are added to `collect` flow-node JSON — no SQL migration.

**Tech Stack:** Node.js (Express) + `better-sqlite3` + `xlsx@0.18.5` (already a dependency); React 18 + Vite + axios + Tailwind; i18n via existing `useI18n()` context.

**Spec:** [`docs/superpowers/specs/2026-05-03-campaign-survey-report-design.md`](../specs/2026-05-03-campaign-survey-report-design.md)

**Testing approach:** The project has no automated test framework. Each task ends in a manual verification step (curl for backend, browser smoke check for frontend) followed by a commit.

---

## File map

**Backend (`platform-api/`)**

| Path | Action | Responsibility |
|---|---|---|
| `src/services/survey-report.js` | **CREATE** | Pure functions: walk flow nodes → eligible captures; aggregate `outbound_calls` rows; build xlsx workbook buffer. No HTTP, no auth. |
| `src/routes/campaigns.js` | MODIFY | Add two new routes (`/:id/report/captures`, `/:id/report/export`) that load campaign + IVR, delegate to the service, stream the result. |

**Frontend (`admin-portal-v2/`)**

| Path | Action | Responsibility |
|---|---|---|
| `src/contexts/I18nContext.jsx` | MODIFY | Add new translation keys under `campaignReport.*` and `nodeProperties.*`. |
| `src/components/flow/NodeProperties.jsx` | MODIFY | Add two text inputs (Arabic/English report labels) inside the existing `collect` block. |
| `src/lib/api.js` | MODIFY | Add `getCampaignReportCaptures` and `downloadCampaignReportXlsx` helpers. |
| `src/components/CampaignReportExportModal.jsx` | **CREATE** | Modal: capture checklist + from/to dates + digit range + Export. |
| `src/pages/CampaignEdit.jsx` | MODIFY | Add **Export Report** header button that opens the modal. |

---

## Task 1: Backend — `extractEligibleCaptures(flowData)` in survey-report service

**Files:**
- Create: `platform-api/src/services/survey-report.js`

- [ ] **Step 1: Create the file with the eligibility extractor**

Create `platform-api/src/services/survey-report.js` with this exact content:

```javascript
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
    iterable = rawNodes;
  } else if (rawNodes && typeof rawNodes === 'object') {
    iterable = Object.entries(rawNodes).map(([id, node]) => ({
      id,
      ...node
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

module.exports = {
  extractEligibleCaptures
};
```

- [ ] **Step 2: Verify by running the function in a node REPL**

```bash
docker compose exec platform-api node -e "
const svc = require('./src/services/survey-report');
const flow = { nodes: {
  q1: { type: 'collect', maxDigits: 1, variable: 'response_speed', reportLabelAr: 'مدى سرعة الاستجابة', reportLabelEn: 'Response speed' },
  q2: { type: 'collect', maxDigits: 1, variable: 'service_perf', reportLabelEn: 'Service performance' },
  acc: { type: 'collect', maxDigits: 10, variable: 'account_number', reportLabelAr: 'رقم الحساب' },
  greet: { type: 'play', prompt: 'welcome' },
  unlabeled: { type: 'collect', maxDigits: 1, variable: 'foo' }
}};
console.log(JSON.stringify(svc.extractEligibleCaptures(flow), null, 2));
"
```

Expected: an array of exactly 2 entries — `q1` (both labels) and `q2` (English-only label). `acc` (multi-digit), `greet` (wrong type), `unlabeled` (no labels) must be absent.

- [ ] **Step 3: Commit**

```bash
git add platform-api/src/services/survey-report.js
git commit -m "Add eligible-capture extractor for survey reports"
```

---

## Task 2: Backend — `aggregateSurveyData()` in survey-report service

**Files:**
- Modify: `platform-api/src/services/survey-report.js`

- [ ] **Step 1: Append the aggregation function and helpers**

Append to `platform-api/src/services/survey-report.js` (before `module.exports`):

```javascript
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
      counts[m.monthKey][c.nodeId] = {};
      for (let d = digitMin; d <= digitMax; d++) {
        counts[m.monthKey][c.nodeId][String(d)] = 0;
      }
      surveys[m.monthKey][c.nodeId] = 0;
    }
  }

  // Pull all rows once. The dataset is small (single campaign, bounded date
  // range) and json_extract per-capture would mean N queries.
  const rangeStart = `${from}T00:00:00.000Z`;
  // Inclusive end-of-day: add 1 day to `to` and use strict less-than.
  const toDate = new Date(`${to}T00:00:00Z`);
  const dayAfterTo = new Date(Date.UTC(
    toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate() + 1
  )).toISOString();

  const rows = db.prepare(`
    SELECT dial_start_time, variables
    FROM outbound_calls
    WHERE campaign_id = ?
      AND dial_start_time >= ?
      AND dial_start_time <  ?
  `).all(campaignId, rangeStart, dayAfterTo);

  for (const row of rows) {
    if (!row.dial_start_time) continue;
    const ts = new Date(row.dial_start_time);
    if (Number.isNaN(ts.getTime())) continue;

    const monthKey = `${ts.getUTCFullYear()}-${String(ts.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!counts[monthKey]) continue; // outside enumerated months

    let vars = {};
    try {
      vars = row.variables ? JSON.parse(row.variables) : {};
    } catch (_e) {
      continue;
    }

    for (const cap of captures) {
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
```

Update the existing `module.exports` line to:

```javascript
module.exports = {
  extractEligibleCaptures,
  enumerateMonths,
  aggregateSurveyData
};
```

- [ ] **Step 2: Verify with a quick smoke check using real data**

```bash
docker compose exec platform-api node -e "
const db = require('./src/db');
const svc = require('./src/services/survey-report');
const c = db.prepare('SELECT id FROM campaigns LIMIT 1').get();
if (!c) { console.log('No campaign rows; smoke check skipped'); process.exit(0); }
const result = svc.aggregateSurveyData({
  db, campaignId: c.id,
  captures: [{ nodeId: 'q1', variable: 'response_speed', labelAr:'', labelEn:'' }],
  from: '2024-01-01', to: '2026-12-31',
  digitMin: 1, digitMax: 5
});
console.log('months:', result.months.map(m => m.monthKey).slice(0, 3), '...');
console.log('first month surveys count:', result.surveys[result.months[0].monthKey]);
"
```

Expected: prints a list of month keys covering the range and a `surveys` object — values may be `0` if no matching variable. Must not throw.

- [ ] **Step 3: Commit**

```bash
git add platform-api/src/services/survey-report.js
git commit -m "Aggregate outbound-call DTMF responses per month/capture/digit"
```

---

## Task 3: Backend — `buildSurveyWorkbook()` in survey-report service

**Files:**
- Modify: `platform-api/src/services/survey-report.js`

- [ ] **Step 1: Append the workbook builder**

Append to `platform-api/src/services/survey-report.js` (before `module.exports`):

```javascript
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

function formatMonthLabel(language, monthBlock, fromDate, toDate) {
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
      row[1] = idx === 0 ? formatMonthLabel(language, monthBlock, null, null) : '';
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
    const totalExcelRow = totalRowIdx + 1;
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
```

Update the existing `module.exports` line to:

```javascript
module.exports = {
  extractEligibleCaptures,
  enumerateMonths,
  aggregateSurveyData,
  buildSurveyWorkbook,
  sanitizeFilenamePart
};
```

- [ ] **Step 2: Verify by writing a workbook to disk and opening it**

```bash
docker compose exec platform-api node -e "
const fs = require('fs');
const svc = require('./src/services/survey-report');
const captures = [
  { nodeId: 'q1', variable: 'speed', labelAr: 'مدى سرعة الاستجابة', labelEn: 'Response speed' },
  { nodeId: 'q2', variable: 'perf',  labelAr: 'اداء الموظفين',     labelEn: 'Staff performance' }
];
const months = svc.enumerateMonths('2026-01-15', '2026-03-10');
const aggregation = {
  months,
  counts:  Object.fromEntries(months.map(m => [m.monthKey, { q1:{1:15,2:150,3:20,4:20,5:20}, q2:{1:5,2:30,3:40,4:50,5:60} }])),
  surveys: Object.fromEntries(months.map(m => [m.monthKey, { q1:225, q2:185 }]))
};
const buf = svc.buildSurveyWorkbook({ language: 'ar', captures, digitMin:1, digitMax:5, aggregation });
fs.writeFileSync('/tmp/survey-test.xlsx', buf);
console.log('wrote', buf.length, 'bytes');
"

docker compose cp platform-api:/tmp/survey-test.xlsx ./survey-test.xlsx
```

Open `survey-test.xlsx` locally. Expected:
- 3 monthly blocks (Jan, Feb, Mar 2026), separated by blank rows.
- Jan block month cell shows `يناير 2026 (15-31)`. Feb shows full month. Mar shows `مارس 2026 (1-10)`.
- Sheet opens RTL.
- Each block has 2 question rows + a "الاجمالي" total row.
- Column D in question rows is `=E?+G?+I?+K?+M?` (formula); percentage cells display as `66.67%` etc.
- Delete `./survey-test.xlsx` after verifying.

- [ ] **Step 3: Commit**

```bash
rm -f ./survey-test.xlsx
git add platform-api/src/services/survey-report.js
git commit -m "Build localized RTL/LTR survey workbook with monthly blocks"
```

---

## Task 4: Backend route — `GET /campaigns/:id/report/captures`

**Files:**
- Modify: `platform-api/src/routes/campaigns.js`

- [ ] **Step 1: Add the require at the top of the file**

In `platform-api/src/routes/campaigns.js`, find the existing block of requires near the top (around lines 1-11) and add this line after the existing `const XLSX = require('xlsx');`:

```javascript
const surveyReport = require('../services/survey-report');
```

- [ ] **Step 2: Add the route**

Add this route inside `platform-api/src/routes/campaigns.js`, immediately after the existing `router.get('/:id', ...)` handler ends (around line 521, after the closing `});`):

```javascript
// Report — list eligible single-digit captures for the survey report.
router.get('/:id/report/captures', (req, res) => {
    try {
        const campaign = db.prepare(
            'SELECT id, ivr_id FROM campaigns WHERE id = ? AND tenant_id = ?'
        ).get(req.params.id, req.user.tenantId);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        if (!campaign.ivr_id) {
            return res.json([]);
        }

        const flow = db.prepare(
            'SELECT flow_data FROM ivr_flows WHERE id = ? AND tenant_id = ?'
        ).get(campaign.ivr_id, req.user.tenantId);

        if (!flow || !flow.flow_data) {
            return res.json([]);
        }

        let parsed = {};
        try {
            parsed = JSON.parse(flow.flow_data);
        } catch (_e) {
            return res.json([]);
        }

        return res.json(surveyReport.extractEligibleCaptures(parsed));
    } catch (error) {
        console.error('Error listing report captures:', error);
        res.status(500).json({ error: 'Failed to list captures' });
    }
});
```

- [ ] **Step 3: Restart the API and smoke-test the route**

```bash
docker compose restart platform-api
docker compose logs --tail=20 platform-api
```

Then (replace `<TOKEN>` with a valid JWT and `<CAMPAIGN_ID>` with a real campaign id):

```bash
curl -s -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3001/api/campaigns/<CAMPAIGN_ID>/report/captures | head
```

Expected: `[]` (empty array — no labels exist yet) or an array of capture objects, returning HTTP 200. With a bogus campaign id you should get HTTP 404.

- [ ] **Step 4: Commit**

```bash
git add platform-api/src/routes/campaigns.js
git commit -m "Add GET /campaigns/:id/report/captures"
```

---

## Task 5: Backend route — `GET /campaigns/:id/report/export`

**Files:**
- Modify: `platform-api/src/routes/campaigns.js`

- [ ] **Step 1: Add the export route**

Add this route in `platform-api/src/routes/campaigns.js`, immediately after the new `/report/captures` route from Task 4:

```javascript
// Report — generate and stream the .xlsx survey report.
router.get('/:id/report/export', (req, res) => {
    try {
        const campaign = db.prepare(
            'SELECT id, name, ivr_id FROM campaigns WHERE id = ? AND tenant_id = ?'
        ).get(req.params.id, req.user.tenantId);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const { from, to, captures: capturesParam } = req.query;
        const digitMin = parseInt(req.query.digitMin || '1', 10);
        const digitMax = parseInt(req.query.digitMax || '5', 10);
        const language = ['ar', 'en'].includes(req.query.language)
            ? req.query.language
            : (req.user.language || 'ar');

        if (!from || !to) {
            return res.status(400).json({ error: '"from" and "to" are required' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            return res.status(400).json({ error: '"from" / "to" must be YYYY-MM-DD' });
        }
        if (from > to) {
            return res.status(400).json({ error: '"from" must be on or before "to"' });
        }
        // Range cap: 5 years.
        if ((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24) > 5 * 366) {
            return res.status(400).json({ error: 'Date range cannot exceed 5 years' });
        }
        if (!Number.isInteger(digitMin) || !Number.isInteger(digitMax) ||
            digitMin < 0 || digitMax > 9 || digitMin > digitMax) {
            return res.status(400).json({ error: 'Invalid digit range' });
        }

        const requestedNodeIds = String(capturesParam || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (requestedNodeIds.length === 0) {
            return res.status(400).json({ error: 'At least one capture must be selected' });
        }

        // Re-derive eligible captures from the current flow and intersect.
        let eligible = [];
        if (campaign.ivr_id) {
            const flow = db.prepare(
                'SELECT flow_data FROM ivr_flows WHERE id = ? AND tenant_id = ?'
            ).get(campaign.ivr_id, req.user.tenantId);
            if (flow && flow.flow_data) {
                try {
                    eligible = surveyReport.extractEligibleCaptures(JSON.parse(flow.flow_data));
                } catch (_e) {
                    eligible = [];
                }
            }
        }

        const eligibleById = new Map(eligible.map((c) => [c.nodeId, c]));
        const selected = requestedNodeIds
            .map((id) => eligibleById.get(id))
            .filter(Boolean);
        if (selected.length === 0) {
            return res.status(400).json({ error: 'No selected captures are eligible for this report' });
        }

        const aggregation = surveyReport.aggregateSurveyData({
            db,
            campaignId: campaign.id,
            captures: selected,
            from,
            to,
            digitMin,
            digitMax
        });

        const buffer = surveyReport.buildSurveyWorkbook({
            language,
            captures: selected,
            digitMin,
            digitMax,
            aggregation
        });

        const safeName = surveyReport.sanitizeFilenamePart(campaign.name);
        const fallback = `${safeName}-report-${from}-to-${to}.xlsx`;
        const utf8Name = encodeURIComponent(`${campaign.name || 'campaign'}-report-${from}-to-${to}.xlsx`);

        res.setHeader('Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition',
            `attachment; filename="${fallback}"; filename*=UTF-8''${utf8Name}`);
        res.send(buffer);
    } catch (error) {
        console.error('Error exporting survey report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
});
```

- [ ] **Step 2: Restart and smoke-test with curl**

```bash
docker compose restart platform-api
```

(Replace `<TOKEN>` and `<CAMPAIGN_ID>`; pick a single eligible `<NODE_ID>` from the captures endpoint response, or skip this step if no labeled captures exist yet — Task 7 will create one.)

```bash
curl -s -o /tmp/report.xlsx -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3001/api/campaigns/<CAMPAIGN_ID>/report/export?from=2026-01-01&to=2026-05-31&captures=<NODE_ID>&digitMin=1&digitMax=5"
file /tmp/report.xlsx
```

Expected: `HTTP 200`, file is reported as a Microsoft Excel 2007+ document. Validation errors should return HTTP 400 with a JSON `{error}`.

- [ ] **Step 3: Commit**

```bash
git add platform-api/src/routes/campaigns.js
git commit -m "Add GET /campaigns/:id/report/export"
```

---

## Task 6: Frontend i18n — add report keys

**Files:**
- Modify: `admin-portal-v2/src/contexts/I18nContext.jsx`

- [ ] **Step 1: Add keys to the Arabic translations block**

In `admin-portal-v2/src/contexts/I18nContext.jsx`, find the Arabic `campaigns: { ... }` block (it ends around line 130 just before `templates: {`). Add a new top-level Arabic section after `campaigns: { ... },` (before `templates: { ... }`):

```javascript
    campaignReport: {
      exportButton: 'تصدير التقرير',
      modalTitle: 'تصدير تقرير الاستبيان',
      captures: 'الأسئلة',
      dateRange: 'النطاق الزمني',
      from: 'من',
      to: 'إلى',
      digitRange: 'نطاق الأرقام',
      export: 'تصدير',
      exporting: 'جار التصدير...',
      cancel: 'إلغاء',
      empty: 'لا توجد أسئلة معرّفة في هذا المسار. أضف "تسمية التقرير" لأي عقدة جمع رقم واحد لتظهر هنا.',
      noSelection: 'يجب اختيار سؤال واحد على الأقل.'
    },
    nodeProperties: {
      reportLabelAr: 'تسمية التقرير (عربي)',
      reportLabelEn: 'تسمية التقرير (إنجليزي)',
      reportHelp: 'العقدات بحد أقصى رقم واحد ولها تسمية تقرير تظهر في تقرير الاستبيان.'
    },
```

- [ ] **Step 2: Add keys to the English translations block**

Find the English `campaigns: { ... }` block (around lines 238-270). Add the following new top-level English section after `campaigns: { ... },` (before `templates: { ... }`):

```javascript
    campaignReport: {
      exportButton: 'Export Report',
      modalTitle: 'Export Survey Report',
      captures: 'Questions',
      dateRange: 'Date range',
      from: 'From',
      to: 'To',
      digitRange: 'Digit range',
      export: 'Export',
      exporting: 'Exporting...',
      cancel: 'Cancel',
      empty: 'No labeled single-digit captures in this IVR. Add a "Report label" to any 1-digit collect node for it to appear here.',
      noSelection: 'Select at least one question.'
    },
    nodeProperties: {
      reportLabelAr: 'Report label (Arabic)',
      reportLabelEn: 'Report label (English)',
      reportHelp: 'Collect nodes with Max Digits = 1 and a report label appear in the campaign survey report.'
    },
```

- [ ] **Step 3: Verify the JS still parses**

```bash
docker compose restart admin-portal-v2
docker compose logs --tail=30 admin-portal-v2
```

Expected: no syntax error in logs. Open `http://localhost:8082` in a browser; the existing UI text should still render correctly in both languages (use the language toggle).

- [ ] **Step 4: Commit**

```bash
git add admin-portal-v2/src/contexts/I18nContext.jsx
git commit -m "Add i18n keys for campaign survey report and report labels"
```

---

## Task 7: Frontend — `collect` node label inputs

**Files:**
- Modify: `admin-portal-v2/src/components/flow/NodeProperties.jsx`

- [ ] **Step 1: Import `useI18n`**

Open `admin-portal-v2/src/components/flow/NodeProperties.jsx`. Find the existing imports at the top of the file. Add (or extend) an import:

```javascript
import { useI18n } from '../../contexts/I18nContext'
```

If `useI18n` is already imported, skip this step.

- [ ] **Step 2: Wire `t` inside the component**

Inside the `NodeProperties` function component (look for `function NodeProperties` or `export default function`), add at the top of the body:

```javascript
const { t } = useI18n()
```

If `t` is already destructured from `useI18n()`, skip.

- [ ] **Step 3: Add the two label inputs and the help line**

Find the `formData.type === 'collect'` block in the file (around line 358). It currently ends after the `Terminators` `<div>` (around line 397) with `</>` and `)}`. Replace the **closing `</>` of that block** with the additional inputs *immediately before* the closing fragment:

Find this exact section:

```jsx
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terminators</label>
              <input
                type="text"
                value={formData.terminators || '#'}
                onChange={(e) => handleChange('terminators', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="#"
              />
            </div>
          </>
        )}
```

Replace with:

```jsx
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terminators</label>
              <input
                type="text"
                value={formData.terminators || '#'}
                onChange={(e) => handleChange('terminators', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="#"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('nodeProperties.reportLabelAr')}</label>
              <input
                type="text"
                value={formData.reportLabelAr || ''}
                onChange={(e) => handleChange('reportLabelAr', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                dir="rtl"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('nodeProperties.reportLabelEn')}</label>
              <input
                type="text"
                value={formData.reportLabelEn || ''}
                onChange={(e) => handleChange('reportLabelEn', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <p className="text-xs text-gray-400">{t('nodeProperties.reportHelp')}</p>
          </>
        )}
```

- [ ] **Step 4: Verify in the browser**

```bash
docker compose restart admin-portal-v2
```

In the browser:
1. Open `http://localhost:8082` → IVR Flows → open any flow → click a `collect` node.
2. Confirm the two new inputs appear under Terminators and accept text in Arabic / English.
3. Save the flow. Reload the page; the values must persist.
4. Set Max Digits to 1 and add labels; verify the labels persist after reload.

Then sanity-check the data via the API:

```bash
curl -s -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3001/api/ivr/<IVR_ID> | grep -o '"reportLabelAr":"[^"]*"' | head -3
```

Expected: at least one match showing the Arabic label you typed.

- [ ] **Step 5: Commit**

```bash
git add admin-portal-v2/src/components/flow/NodeProperties.jsx
git commit -m "Add Arabic/English report label inputs on collect nodes"
```

---

## Task 8: Frontend — `lib/api.js` helpers

**Files:**
- Modify: `admin-portal-v2/src/lib/api.js`

- [ ] **Step 1: Append the two helpers**

Open `admin-portal-v2/src/lib/api.js`. Append at the end of the file:

```javascript
// Campaign survey report
export const getCampaignReportCaptures = async (campaignId) => {
  const response = await api.get(`/campaigns/${campaignId}/report/captures`)
  return response.data
}

export const downloadCampaignReportXlsx = async (campaignId, params) => {
  const response = await api.get(`/campaigns/${campaignId}/report/export`, {
    params,
    responseType: 'blob'
  })
  return response.data
}
```

- [ ] **Step 2: Verify by importing in a node REPL via the browser console**

Reload `http://localhost:8082` in your browser. In the dev tools console:

```javascript
const { getCampaignReportCaptures } = await import('/src/lib/api.js')
console.log(await getCampaignReportCaptures('<CAMPAIGN_ID>'))
```

Expected: array (possibly empty). Must not throw a 404 about the helper or a CORS error.

- [ ] **Step 3: Commit**

```bash
git add admin-portal-v2/src/lib/api.js
git commit -m "Add API helpers for survey report captures and export"
```

---

## Task 9: Frontend — `CampaignReportExportModal.jsx`

**Files:**
- Create: `admin-portal-v2/src/components/CampaignReportExportModal.jsx`

- [ ] **Step 1: Create the file**

Create `admin-portal-v2/src/components/CampaignReportExportModal.jsx` with this exact content:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Download, X } from 'lucide-react'
import {
  getCampaignReportCaptures,
  downloadCampaignReportXlsx
} from '../lib/api'
import { useI18n } from '../contexts/I18nContext'

function firstOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1)
  return d
}

function toIsoDate(date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export default function CampaignReportExportModal({
  campaignId,
  campaignName,
  open,
  onClose
}) {
  const { t, language } = useI18n()
  const [selected, setSelected] = useState(new Set())
  const [from, setFrom] = useState(toIsoDate(firstOfMonth()))
  const [to, setTo] = useState(toIsoDate(new Date()))
  const [digitRange, setDigitRange] = useState('1-5')
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState(null)

  const { data: captures, isLoading, isError } = useQuery({
    queryKey: ['campaign-report-captures', campaignId],
    queryFn: () => getCampaignReportCaptures(campaignId),
    enabled: open
  })

  useEffect(() => {
    if (captures) {
      setSelected(new Set(captures.map((c) => c.nodeId)))
    }
  }, [captures])

  const [digitMin, digitMax] = useMemo(() => {
    const [a, b] = digitRange.split('-').map((n) => parseInt(n, 10))
    return [a, b]
  }, [digitRange])

  if (!open) return null

  const labelFor = (cap) =>
    (language === 'ar' ? cap.labelAr || cap.labelEn : cap.labelEn || cap.labelAr) || cap.variable

  const toggle = (nodeId) => {
    const next = new Set(selected)
    if (next.has(nodeId)) next.delete(nodeId)
    else next.add(nodeId)
    setSelected(next)
  }

  const canExport =
    !isLoading && !isError && selected.size > 0 && from && to && from <= to && !isDownloading

  const handleExport = async () => {
    setError(null)
    if (selected.size === 0) {
      setError(t('campaignReport.noSelection'))
      return
    }
    try {
      setIsDownloading(true)
      const blob = await downloadCampaignReportXlsx(campaignId, {
        from,
        to,
        captures: Array.from(selected).join(','),
        digitMin,
        digitMax,
        language
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const safeName = (campaignName || 'campaign').replace(/[^A-Za-z0-9._-]+/g, '_')
      link.download = `${safeName}-report-${from}-to-${to}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      onClose()
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Export failed')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{t('campaignReport.modalTitle')}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <section>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t('campaignReport.captures')}
            </label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
              </div>
            ) : !captures?.length ? (
              <p className="rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-500">
                {t('campaignReport.empty')}
              </p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                {captures.map((cap) => (
                  <label key={cap.nodeId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selected.has(cap.nodeId)}
                      onChange={() => toggle(cap.nodeId)}
                    />
                    <span className="flex-1">{labelFor(cap)}</span>
                    <span className="text-xs text-gray-400">{cap.variable}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignReport.from')}</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-md border-gray-300 text-sm shadow-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignReport.to')}</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border-gray-300 text-sm shadow-sm"
              />
            </div>
          </section>

          <section>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignReport.digitRange')}</label>
            <select
              value={digitRange}
              onChange={(e) => setDigitRange(e.target.value)}
              className="w-full rounded-md border-gray-300 text-sm shadow-sm"
            >
              <option value="1-5">1-5</option>
              <option value="1-6">1-6</option>
              <option value="1-9">1-9</option>
            </select>
          </section>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('campaignReport.cancel')}
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isDownloading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('campaignReport.exporting')}</>
              : <><Download className="mr-2 h-4 w-4" />{t('campaignReport.export')}</>}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
docker compose logs --tail=30 admin-portal-v2
```

Expected: no Vite syntax error. The modal isn't wired in yet, so nothing to click — that comes in Task 10.

- [ ] **Step 3: Commit**

```bash
git add admin-portal-v2/src/components/CampaignReportExportModal.jsx
git commit -m "Add CampaignReportExportModal component"
```

---

## Task 10: Frontend — wire the **Export Report** button into `CampaignEdit`

**Files:**
- Modify: `admin-portal-v2/src/pages/CampaignEdit.jsx`

- [ ] **Step 1: Add imports**

In `admin-portal-v2/src/pages/CampaignEdit.jsx`, find the existing imports near the top. Add:

```javascript
import { Download } from 'lucide-react'
import CampaignReportExportModal from '../components/CampaignReportExportModal'
import { useI18n } from '../contexts/I18nContext'
```

The existing `lucide-react` import already lists icons; you can extend that line instead of adding a new one — pick whichever style matches the file (around line 17). Verify `Download` is added once.

- [ ] **Step 2: Add modal state and `t` inside the component**

Inside the `CampaignEdit` function, immediately after the existing `const [selectedInstanceId, setSelectedInstanceId] = useState(null)` (around line 64), add:

```javascript
const [reportModalOpen, setReportModalOpen] = useState(false)
const { t } = useI18n()
```

- [ ] **Step 3: Add the **Export Report** button**

Find the page header where **Start Instance** is rendered (around line 172, inside the `{!isNew && (` block). Add a new button immediately before the **Start Instance** `<Link>`:

```jsx
{!isNew && instances?.length > 0 && (
  <button
    onClick={() => setReportModalOpen(true)}
    className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
  >
    <Download className="mr-2 h-4 w-4" />
    {t('campaignReport.exportButton')}
  </button>
)}
```

- [ ] **Step 4: Mount the modal**

Find the closing `</div>` at the very end of the component's JSX (around line 414). Insert immediately before that closing `</div>`:

```jsx
<CampaignReportExportModal
  campaignId={id}
  campaignName={campaign?.name || ''}
  open={reportModalOpen}
  onClose={() => setReportModalOpen(false)}
/>
```

- [ ] **Step 5: Browser smoke test**

```bash
docker compose restart admin-portal-v2
```

In the browser:
1. Open a campaign that has at least one run (`/campaigns/<id>`).
2. Confirm the **Export Report** button appears in the page header.
3. Click it — the modal opens.
4. If the campaign's IVR has at least one labeled `maxDigits=1` collect node, it appears in the captures list pre-checked.
5. Pick a date range that contains real `outbound_calls` rows; click **Export**.
6. The browser downloads `<campaign>-report-<from>-to-<to>.xlsx`. Open it in Excel.
7. Sheet renders RTL when dashboard is Arabic, LTR when English. Headers, month label, and totals match the spec.
8. Click **Cancel** with no captures selected → button is disabled.

- [ ] **Step 6: Commit**

```bash
git add admin-portal-v2/src/pages/CampaignEdit.jsx
git commit -m "Wire Export Report button on campaign details page"
```

---

## Task 11: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the spec's manual checklist**

For each item below, perform the action and confirm the expected outcome. If any item fails, open a bug fix task before considering the feature complete.

1. **Two-month range, one capture, mixed digits**: pick a single labeled capture and a date range crossing exactly two calendar months that have real call data. Hand-pivot a few expected values from the database and confirm they appear in the workbook.
2. **Partial-month boundaries**: pick a from/to that starts mid-month and ends mid-month. Confirm Jan block month cell shows `<MonthName> <Year> (DD-DD)`; full middle months show no day-range suffix.
3. **Capture with no responses in range**: include a capture that has no actual `outbound_calls.variables` data. Row appears with all zeros; percentages display as `0.00%`; file opens cleanly.
4. **Arabic dashboard**: switch language to Arabic. Re-export. File opens RTL in Excel; columns read right-to-left; headers and month names are Arabic.
5. **English dashboard**: switch to English. Re-export. File opens LTR with English headers / month names.
6. **Out-of-range digit**: pick a digit range of `1-5` for a capture where some calls answered `7`. Confirm those `7` responses are excluded from `surveys_count` and don't appear in any digit column.
7. **Editor and viewer roles**: log in as both an `editor` and a `viewer` user; confirm both can open the modal and download a file.
8. **Capture without report labels does not appear**: temporarily remove the labels from one collect node in the IVR editor and save; reopen the modal — the capture is gone. Restore the labels.
9. **Empty state**: pick a campaign whose IVR has no labeled captures. Modal shows the empty-state message.
10. **Filename**: use a campaign with an Arabic name. Confirm the downloaded file's name preserves Arabic characters in the browser's download UI (or the ASCII fallback if the browser strips them).

- [ ] **Step 2: Update the spec's "known limitations" if any new ones surface**

If verification surfaces a behaviour gap that isn't already listed in the spec under "Open questions / known limitations", append it. Commit with:

```bash
git add docs/superpowers/specs/2026-05-03-campaign-survey-report-design.md
git commit -m "Document discovered limitation in survey-report spec"
```

(Skip this step if no new limitations surfaced.)

---

## Self-review notes

- **Spec coverage**: every requirement in `docs/superpowers/specs/2026-05-03-campaign-survey-report-design.md` maps to a task above (eligibility filter → Task 1; aggregation → Task 2; workbook layout incl. RTL/LTR/merges/formulas → Task 3; backend routes → Tasks 4 & 5; node label fields → Tasks 6 & 7; modal/UI/wiring → Tasks 8-10; testing checklist → Task 11). The "Open questions" auth concern from the spec is resolved in Tasks 8 & 10 by reusing the existing axios + JWT + blob-download pattern from `getCallLogsCsv`.
- **No placeholders**: every code step contains the full code; commands include exact paths and expected output.
- **Type/name consistency**: `nodeId`, `variable`, `labelAr`, `labelEn` are used identically in the backend service, the API response, and the frontend modal. `digitMin` / `digitMax` and `from` / `to` likewise match across boundaries.
- **Frequent commits**: every task ends in a `git commit`; tasks 4–5 each commit independently so each route is reviewable in isolation.
