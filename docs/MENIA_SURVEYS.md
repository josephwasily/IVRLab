# Menia Surveys — Deployment & Operations Guide

This document describes the two IVR surveys built for **Menia Water &
Sanitation Company**: their content, where the files live, how to deploy
them on the Menia client server, how to edit the questions or labels
afterwards, and how to pull the Excel survey report.

---

## 1. Overview

Two surveys were authored from the audio dropped into `new sounds 5/`:

| ID                 | Name                         | Extension | Questions | Question types          |
|--------------------|------------------------------|-----------|-----------|--------------------------|
| `menia-survey-1`   | استطلاع حل الشكاوى - المنيا     | **2030**  | 1         | yes/no                   |
| `menia-survey-2`   | استطلاع رضا الخدمة - المنيا     | **2031**  | 4         | 2 × rating (1-5) + 2 × yes/no |

A single migration script imports the audio, creates the IVR flows, and
sets the report labels on every question. Each question's `collect` node
in the flow carries `reportLabelAr` and `reportLabelEn`, which is what the
Excel survey report (built by `platform-api/src/services/survey-report.js`)
reads when generating column headers.

---

## 2. Survey 1 — Complaint Resolution (extension 2030)

A short single-question survey about whether the caller's complaint to
Menia Water & Sanitation has been resolved.

### Call flow

```
welcome  →  ask "هل تم حل الشكوى الخاصة بكم؟" (1=yes, 2=no)  →  thanks  →  hangup
```

### Prompts

| Prompt name (DB)                  | Source file                  | Role     |
|-----------------------------------|------------------------------|----------|
| `menia_s1_welcome`                | `1_Welcome.mp3`              | welcome  |
| `menia_s1_complaint_resolved`     | `1_Are you satisfied .mp3`   | question |
| `menia_s1_thanks`                 | `1_Thanks.mp3`               | thanks   |

> ⚠️ The source file is called `1_Are you satisfied .mp3` but the audio
> actually asks **"هل تم حل الشكوى الخاصة بكم؟"** (was the complaint
> resolved?). The prompt name and report label reflect what callers
> actually hear, not the source filename.

### Question metadata (in the flow's `collect` node)

| Field            | Value                                  |
|------------------|----------------------------------------|
| `variable`       | `complaint_resolved`                   |
| `validDigits`    | `12` (yes = 1, no = 2)                 |
| `reportLabelAr`  | `هل تم حل الشكوى الخاصة بكم؟`            |
| `reportLabelEn`  | `Was your complaint resolved?`         |

---

## 3. Survey 2 — Service Satisfaction (extension 2031)

A four-question survey covering overall service satisfaction, rep
professionalism, response time, and contact frequency.

### Call flow

```
welcome  →  Q1 (1-5)  →  Q2 (1-5)  →  Q3 (yes/no)  →  Q4 (yes/no)  →  thanks  →  hangup
```

### Prompts

| Prompt name (DB)                       | Source file              | Role     | Type      |
|----------------------------------------|--------------------------|----------|-----------|
| `menia_s2_welcome`                     | `2_ Welcome .mp3`        | welcome  | —         |
| `menia_s2_q1_service_satisfaction`     | `2_ Question1.mp3`       | question | 1-5 rating |
| `menia_s2_q2_rep_professionalism`      | `2_ Question2.mp3`       | question | 1-5 rating |
| `menia_s2_q3_service_time`             | `2_ Question3.mp3`       | question | yes/no    |
| `menia_s2_q4_multiple_contacts`        | `2_ Question4.mp3`       | question | yes/no    |
| `menia_s2_thanks`                      | `2_ Thanks.mp3`          | thanks   | —         |

### Question metadata

| Variable                    | `validDigits` | `reportLabelAr`                                          | `reportLabelEn`                                    |
|-----------------------------|---------------|-----------------------------------------------------------|----------------------------------------------------|
| `service_satisfaction`      | `12345`       | `ما مدى رضاك عن الخدمة المقدمة؟ (1-5)`                       | `Service satisfaction (1-5)`                       |
| `rep_professionalism`       | `12345`       | `ما مدى تقييمكم لاحترافية ممثل خدمة العملاء؟ (1-5)`            | `Customer-service rep professionalism (1-5)`       |
| `service_time_appropriate`  | `12`          | `هل استغرقت الخدمة وقتاً مناسباً؟`                              | `Did the service take an appropriate time?`        |
| `multiple_contacts_needed`  | `12`          | `هل احتجت إلى التواصل أكثر من مرة لحل المشكلة؟`                  | `Did you need to contact more than once?`          |

---

## 4. Architecture — where each piece lives

| Path                                                | Purpose                                                                                  |
|-----------------------------------------------------|------------------------------------------------------------------------------------------|
| `new sounds 5/*.mp3`                                | Source audio. Committed to git for reproducibility.                                       |
| `new sounds 5/manifest.json`                        | Single source of truth for prompt names, variables, `validDigits`, and report labels.    |
| `platform-api/src/db/migrate-menia-surveys.js`      | Node migration: mp3 → ulaw conversion, `prompts` table insert, `ivr_flows` row upsert.   |
| `scripts/migrate-menia-surveys.sh`                  | Bash wrapper run on the Menia client. Copies audio into the container and runs the Node migration. |
| `scripts/build-on-client.sh`                        | Build-on-client also stages `new sounds 5/` into the prompts image — so a fresh deploy bakes the audio in. |

The migration writes to two existing tables:

- **`prompts`** — one row per audio file, with `category = 'menia'`,
  `language = 'ar'`, and `is_system = 0` (so an admin can delete them from
  the UI if needed).
- **`ivr_flows`** — one row per survey, with `flow_data` JSON that
  describes the node graph. Every question node carries
  `reportLabelAr` + `reportLabelEn` directly inside the node JSON.

No schema changes.

---

## 5. Deploying on the Menia client

Run on the client server (Ubuntu 20.04). The platform-api container must
already be running — start the stack with `docker compose up -d` first if
not.

```bash
# 1. pull the latest source
cd /opt/ivr-lab-src
sudo git fetch --all && sudo git reset --hard origin/main

# 2. (optional) review the manifest one more time
less "/opt/ivr-lab-src/new sounds 5/manifest.json"

# 3. run the migration
sudo /opt/ivr-lab-src/scripts/migrate-menia-surveys.sh
```

### What the script does

1. Copies the host folder `new sounds 5/` into the `platform-api`
   container at `/app/prompts/menia-surveys/` (this is inside the
   `prompts-custom` volume, so the audio is also visible to `asterisk` at
   `/var/lib/asterisk/sounds/custom/menia-surveys/`).
2. Runs `node src/db/migrate-menia-surveys.js` inside the container. That
   script:
    - converts every `.mp3` to `.ulaw` via `sox` (with `ffmpeg` fallback);
    - inserts a `prompts` row per audio file (idempotent — re-runs skip
      prompts that already exist by name);
    - builds the flow graph for each survey from the manifest;
    - upserts the `ivr_flows` row in place (so re-running updates an
      existing flow without breaking campaigns that reference it).

### Expected output (abridged)

```
==> Preparing /app/prompts/menia-surveys/ inside platform-api
[OK] Copied 10 files into /app/prompts/menia-surveys/
==> Running migration (audio → ulaw + DB prompts + IVR flows)
--- استطلاع حل الشكاوى - المنيا (menia-survey-1) ---
  converting: 1_Welcome.mp3 → menia_s1_welcome.ulaw
  ✓ imported: menia_s1_welcome  (12000B, ~1s)
  converting: 1_Are you satisfied .mp3 → menia_s1_complaint_resolved.ulaw
  ✓ imported: menia_s1_complaint_resolved ...
  ... (and so on for all 9 audio files)
  + created flow: menia-survey-1  (ext 2030, 1 questions)
  + created flow: menia-survey-2  (ext 2031, 4 questions)
prompts: imported=9 skipped=0 failed=0
flows:   created=2  updated=0
```

### Verification

```bash
# 1. prompts visible to Asterisk
sudo docker compose exec asterisk ls /var/lib/asterisk/sounds/custom/menia-surveys/

# 2. DB records present
sudo docker compose exec platform-api node -e "
const db = require('./src/db');
console.log(db.prepare('SELECT name, filename, language, category FROM prompts WHERE category = ?').all('menia'));
console.log('---');
console.log(db.prepare('SELECT id, name, extension, status FROM ivr_flows WHERE id LIKE ?').all('menia-%'));
"

# 3. Admin portal: open Prompts → filter category = menia → expect 9 rows
# 4. Admin portal: open IVR Flows → expect both menia flows listed
# 5. Dial 2030 from the SIP trunk → survey 1 should play
# 6. Dial 2031 → survey 2 should play
```

---

## 6. Editing the questions or labels later

The manifest is the single source of truth. To change a question's report
label, the digits it accepts, or to add a new question:

1. Edit `/opt/ivr-lab-src/new sounds 5/manifest.json` on the client (or
   edit in the repo, commit, and `git pull` on the client).
2. Re-run the migration:
   ```bash
   sudo /opt/ivr-lab-src/scripts/migrate-menia-surveys.sh
   ```
3. Already-imported prompts are skipped by name. The flow is rebuilt from
   the current manifest and the existing `ivr_flows` row is **updated in
   place** — campaigns referencing the flow keep working.

> Renaming a prompt does **not** delete the old prompt row from the DB.
> If you rename `menia_s2_q1_service_satisfaction` to something else, the
> old row sticks around until you delete it via the Prompts tab.

### Replacing the audio for an existing prompt

The migration only imports the audio if the prompt name is new in the DB.
To replace audio for an existing prompt:

1. Delete the prompt row from the admin UI (or `DELETE FROM prompts WHERE
   name = ?`).
2. Replace the source file in `new sounds 5/`.
3. Re-run the migration — it will re-convert and re-insert.

---

## 7. Generating the Excel survey report

Once you have a campaign that uses one of these flows and at least a few
calls have completed, pull the survey report:

```
GET /api/campaigns/{campaignId}/survey-report?from=2026-01-01&to=2026-12-31&language=ar
Authorization: Bearer {jwt}
```

The Excel file contains one block per calendar month in the range, with
one row per question and digit columns 1–5. Each row pulls its label from
the `reportLabelAr` (or `reportLabelEn` if `language=en` was passed) that
the migration wrote into the question's `collect` node.

For yes/no questions (`validDigits = "12"`) the digit columns 3, 4, 5 will
always be zero — the report doesn't suppress empty columns, but the
"Total" row will sum only the valid responses.

---

## 8. Troubleshooting

### "Conversion failed" during migration

The platform-api image installs both `sox` and `ffmpeg` (see
[platform-api/Dockerfile](../platform-api/Dockerfile) line 6). If both
are somehow missing inside the container:

```bash
sudo docker compose exec -u root platform-api apk add --no-cache sox ffmpeg
sudo /opt/ivr-lab-src/scripts/migrate-menia-surveys.sh
```

The `apk add` is a stopgap; on container recreate it's lost. The fix is
to rebuild the platform-api image — the Dockerfile already installs both.

### Dialing the extension plays nothing

Two likely causes:

1. **Asterisk hasn't picked up the new prompts.** The `prompts-custom`
   volume is shared with Asterisk, so files appear immediately, but
   Asterisk's sound cache can occasionally lag. Force a refresh:
   ```bash
   sudo docker compose restart asterisk
   ```

2. **The prompt name in the flow doesn't match what's on disk.** Verify:
   ```bash
   sudo docker compose exec asterisk ls /var/lib/asterisk/sounds/custom/menia-surveys/
   ```
   Each `<name>.ulaw` listed there must match the `prompt` field in the
   flow's node JSON.

### Report shows zero counts even though calls happened

The Excel report reads from `outbound_calls.result` JSON (not
`outbound_calls.variables`). The dynamic IVR engine writes captured DTMF
into `result.<variable>` and `result.<variable>_raw`. If the column is
missing from `result`, the digit wasn't captured — verify the call
actually progressed through the collect node by looking at the call's
log entry in the admin portal.

### Re-running the migration leaves stale flow data

The migration `UPDATE`s the row by `id`, replacing `flow_data` wholesale.
So a re-run with an edited manifest fully refreshes the flow. There is no
flag to keep the old flow; the manifest wins.

---

## 9. File reference

| File                                              | Lines | Purpose                                            |
|---------------------------------------------------|-------|----------------------------------------------------|
| [new sounds 5/manifest.json](../new%20sounds%205/manifest.json)                                  | 95    | Source of truth for prompt + survey metadata       |
| [platform-api/src/db/migrate-menia-surveys.js](../platform-api/src/db/migrate-menia-surveys.js) | 245   | Migration logic                                    |
| [scripts/migrate-menia-surveys.sh](../scripts/migrate-menia-surveys.sh)                          | 73    | Bash wrapper for the Menia client                  |
| [platform-api/src/services/survey-report.js](../platform-api/src/services/survey-report.js)     | 425   | Report builder — reads `reportLabelAr/En` from flow nodes |

---

## 10. Provenance

The Arabic question text in the manifest was produced by transcribing
each source `.mp3` with [OpenAI Whisper](https://github.com/openai/whisper)
(`medium` model, `language='ar'`) and reviewing the output. If any label
sounds off when callers hear the audio, the manifest is what to edit —
not the audio or the flow JSON directly.
