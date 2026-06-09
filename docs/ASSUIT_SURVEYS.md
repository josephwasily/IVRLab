# Assuit Surveys — Deployment & Operations Guide

Companion to [MENIA_SURVEYS.md](MENIA_SURVEYS.md). The Assuit deployment
mirrors Menia's structure: two surveys (one yes/no, one four-question)
each wrapped in a draft outbound campaign.

The two **welcome** prompts are Assuit-specific (they mention
"Assuit Water & Sanitation"). The **question** and **thanks** audio is
identical to Menia's and is reused from `new sounds 5/` rather than
re-recorded.

---

## 1. Overview

| ID                  | Name                              | Extension | Questions | Question types               |
|---------------------|-----------------------------------|-----------|-----------|------------------------------|
| `assuit-survey-1`   | استطلاع حل الشكاوى - أسيوط          | **2040**  | 1         | yes/no                       |
| `assuit-survey-2`   | استطلاع رضا الخدمة - أسيوط          | **2041**  | 4         | 2 × rating (1-5) + 2 × yes/no |

Two outbound campaigns are created alongside the flows, in `draft` status:

| Campaign id                              | Name                                    | Wraps flow         |
|------------------------------------------|-----------------------------------------|--------------------|
| `assuit-complaint-resolution-campaign`   | Assuit - Complaint Resolution Survey    | `assuit-survey-1`  |
| `assuit-service-satisfaction-campaign`   | Assuit - Service Satisfaction Survey    | `assuit-survey-2`  |

Extensions 2040 / 2041 are reserved from the dynamic IVR pool (2000-2099,
see [CLAUDE.md](../CLAUDE.md)).

---

## 2. Audio sources

| Prompt name (DB)                          | Source file                                       | Folder           | Role     | Notes                                |
|-------------------------------------------|---------------------------------------------------|------------------|----------|--------------------------------------|
| `assuit_s1_welcome`                       | `assuit_welcome_survey_1.mpeg`                    | `new sounds 6/`  | welcome  | Mentions Assuit by name              |
| `assuit_s1_complaint_resolved`            | `1_Are you satisfied .mp3`                        | `new sounds 5/`  | question | Same audio as Menia survey 1's q     |
| `assuit_s1_thanks`                        | `1_Thanks.mp3`                                    | `new sounds 5/`  | thanks   | Shared                               |
| `assuit_s2_welcome`                       | `assuit_welcome_survey2.mpeg`                     | `new sounds 6/`  | welcome  | Mentions Assuit by name              |
| `assuit_s2_q1_service_satisfaction`       | `2_ Question1.mp3`                                | `new sounds 5/`  | question | Same audio as Menia survey 2's q1    |
| `assuit_s2_q2_rep_professionalism`        | `2_ Question2.mp3`                                | `new sounds 5/`  | question | Shared                               |
| `assuit_s2_q3_service_time`               | `2_ Question3.mp3`                                | `new sounds 5/`  | question | Shared                               |
| `assuit_s2_q4_multiple_contacts`          | `2_ Question4.mp3`                                | `new sounds 5/`  | question | Shared                               |
| `assuit_s2_thanks`                        | `2_ Thanks.mp3`                                   | `new sounds 5/`  | thanks   | Shared                               |

> The Assuit `.ulaw` files are **distinct files on disk** — the migration
> creates them under `assuit-surveys/`, separate from Menia's
> `menia-surveys/`. If the question audio later needs to diverge between
> Assuit and Menia, replace `2_ QuestionN.mp3` with an Assuit-specific
> recording before re-running and only Assuit's `.ulaw` files change.

---

## 3. Question metadata

### Survey 1 (ext 2040)

| Field            | Value                                  |
|------------------|----------------------------------------|
| `variable`       | `complaint_resolved`                   |
| `validDigits`    | `12` (yes = 1, no = 2)                 |
| `reportLabelAr`  | `هل تم حل الشكوى الخاصة بكم؟`            |
| `reportLabelEn`  | `Was your complaint resolved?`         |

### Survey 2 (ext 2041)

| Variable                    | `validDigits` | `reportLabelAr`                                          | `reportLabelEn`                                    |
|-----------------------------|---------------|-----------------------------------------------------------|----------------------------------------------------|
| `service_satisfaction`      | `12345`       | `ما مدى رضاك عن الخدمة المقدمة؟ (1-5)`                       | `Service satisfaction (1-5)`                       |
| `rep_professionalism`       | `12345`       | `ما مدى تقييمكم لاحترافية ممثل خدمة العملاء؟ (1-5)`            | `Customer-service rep professionalism (1-5)`       |
| `service_time_appropriate`  | `12`          | `هل استغرقت الخدمة وقتاً مناسباً؟`                              | `Did the service take an appropriate time?`        |
| `multiple_contacts_needed`  | `12`          | `هل احتجت إلى التواصل أكثر من مرة لحل المشكلة؟`                  | `Did you need to contact more than once?`          |

---

## 4. Architecture

| Path                                              | Purpose                                                                                  |
|---------------------------------------------------|------------------------------------------------------------------------------------------|
| `new sounds 6/*assuit*.mpeg`                      | Assuit welcome audio                                                                     |
| `new sounds 6/assuit-manifest.json`               | Single source of truth for Assuit prompt names, variables, `validDigits`, report labels, campaigns |
| `new sounds 5/*.mp3`                              | Question/thanks audio shared with Menia                                                  |
| `platform-api/src/db/migrate-assuit-surveys.js`   | Node migration: mp3 → ulaw, prompts insert, ivr_flows upsert, campaigns upsert           |
| `scripts/migrate-assuit-surveys.sh`               | Bash wrapper for the client. Stages both folders, runs the Node migration.               |

The migration writes to `prompts`, `ivr_flows`, `campaigns`, and
`extensions`. No schema changes.

---

## 5. Deploying on the client

```bash
# 1. fetch latest source
cd /opt/ivr-lab-src
sudo git fetch --all && sudo git reset --hard origin/main

# 2. run the migration
sudo /opt/ivr-lab-src/scripts/migrate-assuit-surveys.sh
```

The script stages `new sounds 6/` and `new sounds 5/` into
`/app/prompts/assuit-surveys/` inside the platform-api container, then
runs the Node migration. Expected output (abridged):

```
==> Preparing /app/prompts/assuit-surveys/ inside platform-api
[OK] Copied 3 files from new sounds 6
[OK] Copied 9 files from new sounds 5
==> Running migration (audio → ulaw + prompts + flows + campaigns)
--- استطلاع حل الشكاوى - أسيوط (assuit-survey-1) ---
  converting: assuit_welcome_survey_1.mpeg → assuit_s1_welcome.ulaw
  ✓ imported: assuit_s1_welcome ...
  ✓ imported: assuit_s1_complaint_resolved ...
  ✓ imported: assuit_s1_thanks ...

--- استطلاع رضا الخدمة - أسيوط (assuit-survey-2) ---
  ... (6 prompts)

  + created flow: assuit-survey-1  (ext 2040, 1 questions)
  + created flow: assuit-survey-2  (ext 2041, 4 questions)
  + created campaign: assuit-complaint-resolution-campaign  → flow assuit-survey-1  (status=draft)
  + created campaign: assuit-service-satisfaction-campaign  → flow assuit-survey-2  (status=draft)

prompts:   imported=9 skipped=0 failed=0
flows:     created=2  updated=0
campaigns: created=2  updated=0  skipped=0
```

### Verification

```bash
# 1. .ulaw files visible to Asterisk
sudo docker compose exec asterisk ls /var/lib/asterisk/sounds/custom/assuit-surveys/

# 2. DB records
sudo docker compose exec platform-api node -e "
const db = require('./src/db');
console.log('prompts:', db.prepare('SELECT COUNT(*) c FROM prompts WHERE category = ?').get('assuit'));
console.log('flows:',   db.prepare(\"SELECT id, extension, status FROM ivr_flows WHERE id LIKE 'assuit-%'\").all());
console.log('camps:',   db.prepare(\"SELECT id, name, status, ivr_id FROM campaigns WHERE id LIKE 'assuit-%'\").all());
"

# 3. dial 2040 → Assuit Survey 1
# 4. dial 2041 → Assuit Survey 2
```

---

## 6. Campaigns

Both campaigns start in `status='draft'`. The migration also assigns the
**first SIP trunk** in the tenant as the outbound trunk. If no trunk is
configured yet, the campaign is created with `trunk_id=NULL` and a
warning is printed — attach a trunk via the UI before activation.

### Activating an Assuit campaign

1. Open **Campaigns** in the admin UI.
2. Pick the campaign (`Assuit - Complaint Resolution Survey` or
   `Assuit - Service Satisfaction Survey`).
3. Confirm **Trunk**, **Caller ID**, **Calls per minute**, **Max
   attempts**, **Time windows**.
4. Upload contacts (CSV) or generate a webhook API key — see
   [WEBHOOK_INTEGRATION.md](WEBHOOK_INTEGRATION.md).
5. Change **Status** from `draft` → `active` and click **Start run**.

### Flag semantics

`assuit-complaint-resolution-campaign` has `flag_variable='complaint_resolved'`
and `flag_value='1'`. The webhook results endpoint returns `flag: true`
for any contact that pressed `1` (yes — complaint resolved). The
service-satisfaction campaign has no single boolean outcome and leaves
`flag` always `false`.

---

## 7. Generating the Excel survey report

```
GET /api/campaigns/{campaign_id}/survey-report?from=2026-01-01&to=2026-12-31&language=ar
Authorization: Bearer {jwt}
```

Same shape as Menia's report. Each question's column header is the
`reportLabelAr` (or `Label En`) written into the flow's collect node by
the migration. Yes/no questions show zeros under digit columns 3-5.

---

## 8. Editing later

Same workflow as Menia (see [MENIA_SURVEYS.md §6](MENIA_SURVEYS.md#6-editing-the-questions-or-labels-later)):

1. Edit `new sounds 6/assuit-manifest.json` (the source of truth).
2. `git pull` on the client.
3. Re-run `sudo /opt/ivr-lab-src/scripts/migrate-assuit-surveys.sh`.

The migration updates the flow JSON wholesale and updates campaign
metadata; campaign **status is preserved** on re-run so an active
campaign doesn't get flipped back to draft.

---

## 9. Troubleshooting

Same as Menia (see [MENIA_SURVEYS.md §8](MENIA_SURVEYS.md#8-troubleshooting)).
Additionally:

### `assuit-manifest.json missing`

The wrapper expects the manifest inside `new sounds 6/`. If you renamed
or moved it, point the wrapper at the right path:

```bash
sudo ./scripts/migrate-assuit-surveys.sh /opt/ivr-lab-src/"new sounds 6"
```

### Campaigns created but `trunk_id` is null

No SIP trunk existed in the tenant when the migration ran. Add a trunk
in the **Trunks** tab, then set it on each Assuit campaign manually, OR
re-run the migration after creating the trunk (the migration will *not*
overwrite a trunk you've already set on a campaign — only inserts a
fresh trunk_id on a campaign that has none).
