# Campaign Survey Report — Design Spec

**Date:** 2026-05-03
**Status:** Approved (brainstorming complete; awaiting implementation plan)
**Owner:** Joseph Botros
**Reference template:** `تقرير دمياط.xlsx` (repo root)

## Summary

Add a "Survey Report" Excel export to the campaign details page. The report
aggregates single-digit DTMF captures (e.g., satisfaction ratings 1‑5) across
all calls of a campaign within a date range, producing one block per calendar
month. Each block lists the selected questions as rows and per-digit
count + percentage as paired columns, plus a totals row. The file is
multilingual: Arabic (RTL) or English depending on the dashboard user's
language.

## Goals

- Reproduce the look of the reference template (`تقرير دمياط.xlsx`).
- Let a reporter pick which single-digit captures count as "questions" for
  this report, set a date range, and download.
- Support Arabic (RTL) and English with no per-export language toggle —
  follow the dashboard user's language.

## Non-goals

- Saving / scheduling / emailing reports.
- Cross-campaign reports.
- Reports for multi-digit captures (account numbers, phone, etc.).
- Sub-grouping by trunk, caller_id, or agent.
- Custom column layouts beyond `count` + `percentage`.

---

## Reference template (decoded)

The reference Excel (`تقرير دمياط.xlsx`) has this structure:

```
Row 1 (header, RTL):  | # | الشهر | الاسئلة | عدد الاستبيانات | 1 (merged) | 2 (merged) | 3 (merged) | 4 (merged) | 5 (merged) |
Row 2 (sub-header):   |   |       |          |                  | عدد | نسبة | عدد | نسبة | … (×5)
Rows 3–7:             one row per question (5 questions in the sample)
Row 8:                الاجمالي  — SUM formulas down each column
```

- Column B (`الشهر` / Month) is merged across all question rows of a block.
- Column D (`عدد الاستبيانات` / Number of surveys) uses formula
  `=E3+G3+I3+K3+M3` (sum of count cells).
- Each percentage cell uses `=count_cell / D_cell`.
- Sheet view has `rightToLeft="1"`.

The implementation reproduces this layout exactly for the Arabic case and
mirrors it (LTR) for the English case.

---

## User flow

1. User opens `/campaigns/:id` (CampaignEdit page).
2. User clicks **Export Report** (new button next to "Start Instance"; only
   visible when the campaign has at least one run).
3. A modal opens with three sections:
   - **Captures**: checkbox list of eligible captures from the campaign's
     IVR flow. Label shown in dashboard language (fallback to other lang
     if only one is set). All pre-checked.
   - **Date range**: from / to pickers. Default = first day of current
     month → today.
   - **Digit range**: dropdown (`1‑5` default, `1‑6`, `1‑9`).
4. User clicks **Export**. Browser downloads the `.xlsx`.
5. Modal closes.

---

## Data model changes

### New optional fields on `collect` flow nodes

Two new optional string fields on `collect` nodes inside `ivr_flows.flow_data`:

- `reportLabelAr` — Arabic question text shown in column C of Arabic reports.
- `reportLabelEn` — English question text shown in column C of English reports.

`flow_data` is already free-form JSON, so **no SQL migration is required**.

### Eligibility rule

A capture node appears in the export modal iff:

```
node.type === 'collect'
  && node.maxDigits === 1
  && (node.reportLabelAr || node.reportLabelEn) is non-empty
```

Single-digit constraint is mandatory because the report's column-per-digit
layout only makes sense for one-digit responses. Captures without report
labels are hidden — IVR designers must label them first.

---

## Backend — `platform-api/src/routes/campaigns.js`

Two new authenticated routes (existing `authMiddleware` covers JWT + tenant).
Roles: `admin`, `editor`, `viewer` — consistent with existing analytics export.

### `GET /api/campaigns/:id/report/captures`

Returns the eligible captures for the IVR attached to this campaign.

**Response:**
```json
[
  { "nodeId": "q1_response_speed",
    "variable": "response_speed",
    "labelAr": "مدى سرعة الاستجابة",
    "labelEn": "Response speed" },
  ...
]
```

**Logic:**
1. Load `campaigns` row (verify tenant ownership; 404 otherwise).
2. Load `ivr_flows.flow_data` by `campaigns.ivr_id`.
3. Walk nodes; filter per the eligibility rule above.
4. Return array preserving flow-builder order.

### `GET /api/campaigns/:id/report/export`

Generates and streams the `.xlsx`.

**Query params:**
- `from` (ISO date, required) — inclusive start of range.
- `to` (ISO date, required) — inclusive end of range.
- `captures` (comma-separated `nodeId`s, required) — at least one.
- `digitMin` (integer, default `1`).
- `digitMax` (integer, default `5`).
- `language` (`ar` | `en`, default = caller's `users.language`).

**Validation:**
- `from <= to`, both within reasonable bounds (e.g., not more than 5 years).
- `captures` must all be eligible nodes for this campaign's IVR (re-run
  the eligibility filter; reject any unknown / ineligible ids).
- `digitMin <= digitMax`, both in `[0..9]`.

**Aggregation (per selected capture, per month):**

```sql
SELECT
  strftime('%Y-%m', oc.dial_start_time) AS month_key,
  json_extract(oc.variables, '$.<variable>') AS digit
FROM outbound_calls oc
WHERE oc.campaign_id = ?
  AND oc.dial_start_time >= ?              -- monthStart clamped to `from`
  AND oc.dial_start_time <  ?              -- monthEnd clamped to `to + 1 day`
```

In application code:

1. Coerce `digit` to a string. Keep rows where it is an integer string in
   `[digitMin..digitMax]`. Drop everything else (null, out-of-range,
   multi-digit) — per the design decision that percentages are computed
   over **valid** responses only.
2. `surveys_count[capture][month] = count of kept rows`.
3. For each digit `d`: `digit_count[capture][month][d] = count where digit == d`.
4. Months in range are enumerated explicitly so months with zero data still
   produce a (zeroed) block.

**Workbook construction (using `xlsx@0.18.5`, already a dependency):**

For each month in `from`..`to`:

1. Compute `monthLabel`:
   - Full month inside range → `"<MonthName> <YYYY>"` (e.g. `"يناير 2026"`,
     `"January 2026"`).
   - Partial month → append ` (DD‑DD)` showing covered day range
     (e.g. `"يناير 2026 (15-31)"`).
2. Emit one block:
   ```
   Row 1:  # | <monthLabel> | الاسئلة / Questions | عدد الاستبيانات / Number of surveys | 1 (merged) | … | N (merged)
   Row 2:                                                                                  | عدد / Count | نسبة / Percentage | × N
   Rows:   one per selected capture, in flow-builder order
   Last:   الاجمالي / Total — SUM formulas down each numeric column
   ```
3. Cell formulas:
   - Column D: `=E{row}+G{row}+I{row}+...` (sum of count cells in that row).
   - Percentage cells: `=IFERROR(<count_cell>/$D{row}, 0)` formatted as
     percentage with 2 decimals.
   - Total row count cells: `=SUM(<col>{firstRow}:<col>{lastRow})`.
   - Total row percentage cells: `=SUM(<col>{firstRow}:<col>{lastRow})` —
     intentionally matches the reference template even though percentage
     sums aren't mathematically meaningful.
4. Merges: month cell merged across all rows of the block; each digit
   header merged across its 2 sub-columns.
5. Column B (month) merged across the question rows + total row of that
   block, value = `monthLabel`.
6. If `language === 'ar'`, set `worksheet['!views'] = [{ RTL: true }]`.
7. Blank row separator between consecutive month blocks.

**Output:**
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="<sanitized-campaign-name>-report-<from>-to-<to>.xlsx"`
- Sanitize the campaign name to ASCII-safe characters for the `filename=`
  parameter, and provide the original (UTF-8) name via `filename*=UTF-8''…`
  per RFC 5987 so Arabic campaign names survive the download.

---

## Frontend changes

### `admin-portal-v2/src/components/flow/NodeProperties.jsx`

Inside the existing `formData.type === 'collect'` block, add two text inputs:

- Label (AR): `تسمية التقرير (عربي)` / `Report label (Arabic)` →
  `formData.reportLabelAr`
- Label (EN): `Report label (English)` →
  `formData.reportLabelEn`
- Help text: *"Captures with a report label and `Max Digits = 1` appear in
  campaign survey reports."*

These fields persist into `flow_data` automatically via the existing
`handleChange` mechanism.

### `admin-portal-v2/src/pages/CampaignEdit.jsx`

Add an **Export Report** button in the page header next to **Start Instance**.

- Visible iff `!isNew && instances?.length > 0`.
- Click handler opens `<CampaignReportExportModal />`.

### `admin-portal-v2/src/components/CampaignReportExportModal.jsx` (new)

Self-contained modal component, ~150 lines.

**Props:** `campaignId`, `campaignName`, `open`, `onClose`.

**Behavior:**
- On open, `GET /api/campaigns/:id/report/captures`. Render checkbox list
  (all checked). Show empty-state if none returned: *"No labeled
  single-digit captures in this IVR. Add report labels in the flow editor."*
- From / to date pickers — default = first day of current month → today.
- Digit range select — `1-5` (default), `1-6`, `1-9`.
- Footer: **Cancel** + **Export** (disabled when zero captures selected,
  or `from > to`).
- **Export** opens the export URL in the same window via a programmatic
  `<a href={…} download />` click. Browser handles the download. Modal
  closes after triggering.

### `admin-portal-v2/src/lib/api.js`

Add helpers:
- `getCampaignReportCaptures(campaignId)` — `GET …/report/captures`.
- `buildCampaignReportExportUrl(campaignId, params)` — returns the
  authenticated URL string for the export endpoint (since downloads use a
  direct link, the JWT must be carried via the existing query-token /
  cookie mechanism — see Open Questions below).

---

## i18n

All new UI strings live under new keys in `I18nContext.jsx`:

- `campaignReport.exportButton` = "تصدير التقرير" / "Export Report"
- `campaignReport.modalTitle` = "تصدير تقرير الاستبيان" / "Export Survey Report"
- `campaignReport.captures` = "الأسئلة" / "Questions"
- `campaignReport.dateRange` = "النطاق الزمني" / "Date range"
- `campaignReport.from` = "من" / "From"
- `campaignReport.to` = "إلى" / "To"
- `campaignReport.digitRange` = "نطاق الأرقام" / "Digit range"
- `campaignReport.export` = "تصدير" / "Export"
- `campaignReport.cancel` = "إلغاء" / "Cancel"
- `campaignReport.empty` = "لا توجد أسئلة معرّفة في هذا المسار…" /
  "No labeled single-digit captures in this IVR…"
- `nodeProperties.reportLabelAr` = "تسمية التقرير (عربي)" /
  "Report label (Arabic)"
- `nodeProperties.reportLabelEn` = "Report label (English)" / same
- `nodeProperties.reportHelp` (the help line above)

Server-side header strings are emitted from a small lookup table in the
report route — duplicated, but small enough to live with the report
generator rather than shipping the frontend `translations` object to the
backend.

Server header table:

| key                | ar                  | en                   |
|--------------------|---------------------|----------------------|
| `header.number`    | رقم                 | #                    |
| `header.month`     | الشهر               | Month                |
| `header.questions` | الاسئلة             | Questions            |
| `header.surveys`   | عدد الاستبيانات     | Number of surveys    |
| `header.count`     | عدد                 | Count                |
| `header.percent`   | نسبة                | Percentage           |
| `header.total`     | الاجمالي            | Total                |

Month names: use `Intl.DateTimeFormat(locale, { month: 'long' })` with
locale `ar-EG` or `en-US` to match the existing `useI18n()` locale.

---

## Edge cases

| Scenario | Behavior |
|---|---|
| Capture selected but never reached in the period | Row appears with zeros. Percentages render `0%` via `IFERROR(...,0)`. |
| Month with zero qualifying calls | Block still emitted, all rows zeroed. |
| Date range entirely outside data | Workbook with all enumerated months at zero. No error. |
| Out-of-range digit (e.g. `7` in range 1-5) | Excluded from `surveys_count`. |
| Multi-digit value that somehow leaked into a 1-digit capture | Excluded. |
| `null` / missing variable | Excluded. |
| IVR was edited after some calls happened (capture renamed/removed) | Aggregation reads `outbound_calls.variables` by the *current* `variable` name; if the variable was renamed, historical values are lost. Acceptable — flagged as a known limitation. |
| Campaign has zero runs | Export Report button hidden. |
| Capture exists but has no report labels | Hidden from the modal. |

---

## Testing

No automated test suite exists for this layer. Manual verification
checklist (run after implementation):

1. Two-month range, one capture, mixed digits → values match a hand-pivoted
   spreadsheet of `outbound_calls.variables`.
2. Single-month range with partial start/end days → month cell shows
   `"<MonthName> <Year> (DD-DD)"`.
3. Capture with no responses in range → row of zeros, file opens cleanly
   in Excel.
4. Arabic dashboard → file opens RTL in Excel; column order reads right
   to left; merged month cell renders correctly.
5. English dashboard → file opens LTR with English headers / month names.
6. Out-of-range digit (force a `7` with digit range 1-5) → excluded from
   `surveys_count`; doesn't appear in any column.
7. `editor` and `viewer` accounts can both download successfully.
8. Capture without report labels does not appear in the modal.
9. IVR with no eligible captures → modal shows the empty-state message.
10. Filename: Arabic campaign name survives via the `filename*=UTF-8''…`
    parameter; ASCII fallback is sane.

---

## Open questions / known limitations

- **Authenticated downloads**: existing `/calls/export` is a `GET` that
  goes through the React Query / fetch path. For a direct browser download
  triggered by an `<a>` link, JWT-in-Authorization-header doesn't work —
  the implementation plan needs to confirm how the existing analytics
  CSV export handles this (likely a short-lived signed URL or a
  same-origin cookie). The implementer should match that pattern rather
  than introducing a new auth mechanism.
- **Capture rename in IVR after data exists**: aggregation keys on the
  `variable` name. If a designer renames a variable mid-campaign,
  historical responses under the old name are lost from the report. Not
  fixed in this spec.
- **Percentages in the Total row**: literal `SUM` of percentage cells —
  matches the reference template; not mathematically meaningful. Documented
  here so future readers don't "fix" it without a product decision.

---

## Out of scope (re-stated)

- Saving / scheduling / emailing reports.
- Cross-campaign reports.
- Multi-digit captures.
- Sub-grouping (trunk / caller_id / agent).
- Charts / pivot views inside the workbook.
