# Assuit survey fixes — 21 Sep 2026

Two defects reported against the Assuit outbound survey campaigns:

1. Calls marked **"Aborted After Answer"** even though the respondent answered every question.
2. Respondents receiving **3 questions instead of 4**, seemingly at random.

Defect 2 was **already fixed upstream** in `2f9a027` (27 Jul 2026) — the deployed host was
running an image built before it. Defect 1 is fixed here.

---

## Defect 2 — dropped questions (already fixed upstream)

### Cause

`collectDigits` armed the digit timeout *before* starting the prompt, so the node's
`timeout` covered playback plus reaction time rather than reaction time alone. The Assuit
migration hardcodes `timeout: 10` for every question (`migrate-assuit-surveys.js:189`):

| Question | Prompt length | Time left to answer |
|---|---:|---:|
| Q1 service satisfaction | 8.20 s | 1.8 s |
| **Q2 rep professionalism** | **11.65 s** | **none — cut off mid-sentence** |
| Q3 service time | 9.20 s | 0.8 s |
| Q4 multiple contacts | 8.67 s | 1.3 s |

On expiry the prompt was stopped and the collect returned empty; `handleCollect` saw
`isEmpty` and followed `onEmpty`, wired straight to the **next question**
(`migrate-assuit-surveys.js:195`) — no retry, no re-prompt, silently skipped.

It was never random: a respondent who barged in early got all 4 questions; one who listened
to the question lost it.

### Evidence

`asterisk/log/messages.log` logs every prompt cut short (one that plays to completion logs
nothing). Across **21 survey-2 calls between 16 Jun and 20 Sep, 9 lost at least one
question**. The signature is a cut at exactly 10 s — from 20 Sep, channel `C-0000009c`:

```
09:28:03  stopped  q1_service_satisfaction      ← respondent answered
09:28:13  stopped  q2_rep_professionalism       ← exactly 10s later: the timer, not a keypress
09:28:14  stopped  q3_service_time              ← 1s later
```

Q2 (11.65 s) was cut at 10.0 s with no answer; Q3 was then cut 1 s later — the respondent
pressing their Q2 answer a moment too late, landing it on Q3.

The stored data confirms the scale. Of connected calls with duration > 15 s:

| Campaign | Questions | All answered | Partial | Zero |
|---|---:|---:|---:|---:|
| `assuit-service-satisfaction-campaign` | 4 | 8 | 10 | 2 |
| `assuit-complaint-resolution-campaign` | 1 | 23 | — | 8 |

**Only 8 of 20 connected 4-question calls captured a complete set.**

### Fix

Upstream `2f9a027` arms the timer when playback finishes (or immediately when nothing
plays), re-arms per digit, arms on a play error, and caps the wait with
`COLLECT_PLAYBACK_SAFETY_MS` (60 s) against a lost `PlaybackFinished`. Covered by
`ivr-node/test-collect-timeout.js` (8 cases).

**The Assuit remedy is therefore to deploy current `main`** — no code change needed.

> **Pacing note.** `timeout: 10` now means 10 s of silence *after* the question, so a
> respondent who says nothing takes ~10 s longer per question. 6–8 s is a more realistic
> reaction budget for a 4-question survey.

---

## Defect 1 — false "Aborted After Answer"

### Cause

The Assuit flows are linear (`platform-api/src/db/migrate-assuit-surveys.js:172-202`):

```
welcome → Q1 → Q2 … Qn (collect) → thanks (play) → hangup
```

Respondents hang up the instant they press the last digit rather than sitting through the
thank-you. `channel.play` then fails, `playSound` raises `Channel gone`, and the handler
classified the call without looking at what had been collected:

| Stage | Before |
|---|---|
| `dynamic-ivr.js` `executeNode` catch | `finalStatus = 'caller_hangup_early'` |
| outbound status mapping | status `failed`, outcome `abrupt_end` |
| `OutboundCalls.jsx` | **"Aborted After Answer"** |

It looked at *where* the call ended, never at *what had been captured*.

### What was never affected

- **The Excel survey report was always correct.** `survey-report.js:162` has no status
  filter and `result` JSON is written regardless of outcome. No answers were lost.
- **These calls were never re-dialled.** Retry covers only `no_answer` / `busy`
  (`campaigns.js:475`).

The damage was confined to per-call status and the completed/aborted counters.

### Fix

On `Channel gone`, `resolveHangupStatus` walks the flow forward from the node the caller
died on — through `next`, branch targets and the `onTimeout` / `onEmpty` / `onInvalid` /
`onError` / `onMaxRetries` handlers — looking for any `collect` node with no value.

- Nothing pending **and** at least one answer captured → `captured_then_hangup`, mapped to
  `completed` / `finished`.
- Anything still pending → `caller_hangup_early`, unchanged.
- Unknown position in the flow → conservative fallback to the old behaviour.

Only questions on paths the caller could still have reached count, so a branching flow is
not penalised for an unanswered question on an untaken branch. The walk carries a visited
set, so a collect node that retries itself terminates.

The portal shows these as **"Completed (Hung Up At Thanks)"** — counted as completed, but
still distinguishable.

Covered by `ivr-node/test-hangup-classification.js` (9 assertions).

---

## Running the tests

Both suites run inside the `ivr-node` image, which carries the `node_modules`:

```bash
cd /opt/ivr-lab-src
for t in test-collect-timeout test-hangup-classification; do
  docker run --rm --entrypoint node \
    -v "$PWD/ivr-node/dynamic-ivr.js:/app/dynamic-ivr.js:ro" \
    -v "$PWD/ivr-node/$t.js:/app/$t.js:ro" \
    ivr-lab-ivr-node "/app/$t.js"
done
```

---

## Deploying

The live compose project is **`ivr-lab`**, built from `/opt/ivr-lab-src/docker-compose.yml`.
The project name does not match the directory, so `-p ivr-lab` is required — without it
compose builds `ivr-lab-src-*` images and tries to create a second, conflicting stack.

```bash
cd /opt/ivr-lab-src
docker compose -p ivr-lab build ivr-node admin-portal-v2
docker compose -p ivr-lab up -d ivr-node admin-portal-v2
docker compose -p ivr-lab logs --tail=20 ivr-node    # expect "Dynamic IVR Engine started"
```

Check for active calls first — the rebuild drops them:

```bash
docker exec asterisk asterisk -rx 'core show channels'
```

### Verify with a test call

Dial extension **2041** (survey 2). Listen through Q2 (11.65 s) without pressing anything
and confirm it is no longer cut at 10 s. Hang up immediately after the last answer and
confirm the portal shows **Completed (Hung Up At Thanks)**, not "Aborted After Answer".

```bash
docker compose -p ivr-lab logs --tail=200 ivr-node \
  | grep -E "DTMF received|all data was captured|questions still pending"
```

---

## Backfill of historical calls

`platform-api/src/db/backfill-captured-hangups.js` re-classifies calls already recorded as
aborted where every question was in fact answered. Dry run by default:

```bash
docker exec platform-api node src/db/backfill-captured-hangups.js
docker exec platform-api node src/db/backfill-captured-hangups.js --apply
```

Flags: `--campaign <id>`, `--since YYYY-MM-DD`.

**As of 21 Sep 2026 this is a no-op.** All 4 abrupt-end calls in the database captured zero
answers, so none qualify:

```
candidates: 4
re-classified as completed: 0
left as aborted (answers missing): 4
```

The script is kept for future occurrences. A call is promoted only when **every** collect
node in its flow has a value — deliberately stricter than the runtime rule.

### Backing up before `--apply`

`--apply` is the only irreversible step: it rewrites `outbound_calls.status`,
`hangup_cause` and `result`, plus `call_logs.status`, in place with no audit trail.

```bash
docker exec platform-api sh -c 'cd /app/data && tar czf - platform.db*' \
  > ~/ivr-fix/platform-db-$(date +%F-%H%M).tgz
```

The tar picks up `platform.db` plus any `-wal` / `-shm`. Code changes need no backup — git
covers them.

### What the backfill cannot repair

Where a respondent's Q2 answer landed on Q3, the stored value is wrong and the intent is
unrecoverable. Those calls need excluding from the report or re-running.

---

## Input validation and the timeout model

Two follow-ups from the work above, applied 21 Sep.

### `validDigits` is now enforced

Every survey question declares the keys it accepts (`"12"` for yes/no, `"12345"`
for a 1-5 rating), but nothing read the field: a caller pressing 7 on a yes/no
question had "7" stored as their answer.

`handleCollect` now rejects input outside `validDigits` and re-asks the
question. A mis-press is not silence, so it does not follow `onEmpty` — but the
retry is capped (`COLLECT_INVALID_RETRIES`, default 2) so a caller leaning on a
wrong key cannot loop the node forever when the flow declares no `maxRetries`.
A node with no `validDigits` accepts anything, exactly as before.

### One wait per digit-count, not one wait for everything

Every generated flow baked `timeout: 10` into each collect node. That is one
size for everything: a single-digit yes/no waited as long as a 9-digit account
number, and a 9-digit entry allowed 10 seconds *between each digit*.

The engine now uses the two waits every VoiceXML platform defines:

| | Property | Default here | Platform defaults |
|---|---|---:|---|
| Wait for the caller to start | `timeout` / no-input | **5 s** | 5 s (Nuance Voice Platform, Genesys) |
| Wait between digits | `interdigittimeout` | **3 s** | 3 s Nuance, 5 s common, 10 s Cisco |

Overridable per node (`timeout`, `interDigitTimeout`) and per deployment
(`COLLECT_FIRST_DIGIT_TIMEOUT`, `COLLECT_INTER_DIGIT_TIMEOUT`). The budget
scales as `first + (maxDigits - 1) x inter`:

| Collect | Old | New | Between digits |
|---|---:|---:|---:|
| 1-digit question | 10 s | **5 s** | — |
| 6-digit account (ext 2001) | 10 s | **20 s** | 3 s |
| 9-digit account (ext 2010) | 10 s | **29 s** | 3 s |

`node.timeout` still means the first-digit wait, so any flow that sets it
explicitly keeps working. The flow generators no longer bake in a flat value;
`platform-api/src/db/retune-collect-timeouts.js` strips it from flows already in
the database (dry run by default, `--keep <nodeId>` to preserve one).

Covered by `ivr-node/test-collect-validation.js` (10 assertions).

---

## Automatic updates

`scripts/auto-update.sh`, run daily by `scripts/auto-update.timer` at 03:30,
exists because this host sat ten commits behind `main` from June to September —
which is the only reason a bug already fixed upstream was still live.

It is deliberately cautious, because this is a PBX:

- does nothing when the remote has no new commits;
- **skips** if the working tree has local changes or unpushed commits, rather
  than clobbering them;
- **skips** while any call is up, and retries on the next run;
- rebuilds only the services whose files changed;
- leaves `asterisk/` alone — rebuilding it drops SIP registration, so trunk and
  dialplan changes stay a deliberate manual step, logged for review;
- **rolls back** to the previous commit if the build fails or `ivr-node` does
  not report ready.

```bash
sudo cp /opt/ivr-lab-src/scripts/auto-update.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now auto-update.timer
systemctl list-timers auto-update.timer
tail -f /var/log/ivr-auto-update.log
```

Run it by hand any time with `sudo /opt/ivr-lab-src/scripts/auto-update.sh`.

---

## Known limitations / follow-ups

- **A hangup mid-survey burns the first-digit timeout per remaining question.** `collectDigits` does not detect
  a dead channel, so it waits out the full timeout on each subsequent node. Cosmetic, but it
  inflates recorded duration on aborted calls.
- **Seed and template scripts still bake in `timeout: 10`** (`seed.js`,
  `seed-ivr-flows.js`, `seed-new-sounds-2-template.js`, `update-billing-flow*.js`). They
  only affect demo and template data, and `retune-collect-timeouts.js` corrects whatever
  reaches the database, but they are worth cleaning up when next touched.
- **`asterisk/pjsip.conf` carries a site-specific IP** as a local modification, so the
  auto-update job will skip if upstream ever edits that file. Generating it from `.env`
  (as `update-ip.sh` does) would remove the conflict.
