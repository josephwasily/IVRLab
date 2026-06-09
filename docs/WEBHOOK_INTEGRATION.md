# Webhook Trigger Integration Guide

This guide explains how an external system integrates with IVR-Lab to **trigger
campaign calls via webhook** and **poll the results**. It covers authentication,
the request payload, the response shape, and how to view call status.

> A "webhook trigger" starts a new **campaign run**: IVR-Lab places outbound
> calls to the contacts you submit and walks each answered call through the
> campaign's IVR flow.

---

## 1. Overview

```
  External System                       IVR-Lab Platform API
  ───────────────                       ─────────────────────
  1. POST /trigger      ──────────────▶  Creates a campaign run,
     (X-API-Key + contacts)              queues outbound calls
                        ◀──────────────  201 { run_id, ... }

  2. Asterisk dials each contact and runs the campaign IVR flow

  3. GET  /runs/{runId}/results  ─────▶  Reads run + contact status
     (X-API-Key)
                        ◀──────────────  200 { summary, results }
```

Base URL (default deployment): `http://localhost:3001`
All webhook endpoints are mounted under `/api/webhooks/campaigns`.

---

## 2. Authentication

Webhook endpoints do **not** use the JWT login token. They use a per-campaign
**API key** passed in the `X-API-Key` header.

| Item            | Value                                                        |
|-----------------|--------------------------------------------------------------|
| Header name     | `X-API-Key`                                                  |
| Key format      | 64-character hex string (`crypto.randomBytes(32)`)           |
| Scope           | One key per campaign — it authorizes only that campaign      |
| Validation      | `campaigns WHERE id = :campaignId AND webhook_api_key = :key` |

If the header is missing or the key does not match the campaign, the request
fails with `401`.

```
401  { "error": "API key required. Pass it in the X-API-Key header." }
401  { "error": "Invalid API key or campaign not found" }
```

### Generating the API key

The key is created (or rotated) from an **authenticated admin session** — this
one call needs the normal JWT login token, not the API key:

```http
POST /api/campaigns/{campaign_id}/generate-api-key
Authorization: Bearer {user_jwt_token}
```

Response:

```json
{
  "success": true,
  "webhook_api_key": "a1b2c3d4e5f6...64hexchars",
  "webhook_trigger_url": "/api/webhooks/campaigns/{campaign_id}/trigger",
  "webhook_results_url": "/api/webhooks/campaigns/{campaign_id}/runs/{run_id}/results"
}
```

> Calling `generate-api-key` again **rotates** the key — the old key stops
> working immediately. Store the key securely; it is shown in full only in
> this response.

---

## 3. Trigger a Campaign Run

Starts a new run and queues an outbound call to every contact you submit.

```http
POST /api/webhooks/campaigns/{campaign_id}/trigger
X-API-Key: {webhook_api_key}
Content-Type: application/json
```

### Request payload

```json
{
  "survey_id": "external-survey-2026-q2",
  "contacts": [
    {
      "phone_number": "+201001234567",
      "cms_id": "case-001",
      "name": "Ahmed Hassan",
      "variables": {
        "account_id": "ACCT-123",
        "amount_due": "450.00",
        "service": "billing"
      }
    },
    {
      "phone_number": "+201009876543",
      "cms_id": "case-002",
      "name": "Fatima Ali",
      "variables": { "account_id": "ACCT-456" }
    }
  ]
}
```

| Field                       | Type   | Required | Description                                                                 |
|-----------------------------|--------|----------|-----------------------------------------------------------------------------|
| `survey_id`                 | string | No       | Per-run identifier from the calling CMS. Returned in results summary AND filterable via [`GET /api/webhooks/runs`](#5-query-runs-cross-campaign). |
| `contacts`                  | array  | **Yes**  | Non-empty list of contacts to call.                                         |
| `contacts[].phone_number`   | string | **Yes**  | Destination number. Must be non-empty after trimming.                       |
| `contacts[].cms_id`         | string | No       | Per-contact external identifier (e.g. case ID, ticket ID). Stored on the contact row and echoed back in `results[]`. |
| `contacts[].name`           | string | No       | Display name. Stored in the contact's variables as `name`.                  |
| `contacts[].variables`      | object | No       | Custom key/value data made available to the IVR flow for that call.         |

> **`cms_id` moved from per-run to per-contact.** The old top-level `cms_id` field is still accepted for backwards compatibility (it gets written to `campaign_runs.cms_id`), but new integrations should put `cms_id` inside each contact instead.

**How the payload maps to the call:** each contact becomes a row in
`campaign_contacts`. The `variables` object (plus `name`) is passed into the
IVR flow at runtime, so flow nodes can interpolate values like
`{{account_id}}` or `{{amount_due}}` into prompts and API calls.

**Duplicate handling:** within a single request, repeated `phone_number`
values are counted as `duplicates` and only the first is dialed. Contacts with
a blank `phone_number` are counted as `skipped`. (A request where *every*
contact is blank is rejected up front with `400`.)

### Success response — `201 Created`

```json
{
  "success": true,
  "run_id": "8f3c1a92-...",
  "run_number": 5,
  "survey_id": "external-survey-2026-q2",
  "total_contacts": 2,
  "duplicates": 0,
  "skipped": 0
}
```

| Field            | Description                                                    |
|------------------|----------------------------------------------------------------|
| `run_id`         | UUID of the new run — use it to poll results.                  |
| `run_number`     | Sequential run counter for this campaign (1, 2, 3, ...).       |
| `survey_id`      | Echo of the `survey_id` you sent (or `null`).                  |
| `total_contacts` | Contacts actually imported and queued for dialing.             |
| `duplicates`     | Contacts dropped as duplicate phone numbers in this request.   |
| `skipped`        | Contacts dropped for a blank phone number.                     |

### Error responses

| Status | Body                                                                          | Cause                                              |
|--------|-------------------------------------------------------------------------------|----------------------------------------------------|
| `400`  | `{ "error": "contacts array is required and must not be empty" }`             | Missing/empty `contacts`.                          |
| `400`  | `{ "error": "Some contacts are missing phone_number", "invalid_count": N }`   | One or more contacts have no `phone_number`.       |
| `401`  | `{ "error": "API key required..." }` / `{ "error": "Invalid API key..." }`    | Missing or wrong `X-API-Key`.                      |
| `409`  | `{ "error": "Campaign already has an active run in progress" }`               | A run for this campaign is still `running`.        |
| `500`  | `{ "error": "No valid contacts provided for this campaign instance" }`        | No contact survived validation/deduplication.      |
| `500`  | `{ "error": "<message>" }`                                                    | Internal failure.                                  |

> **One run at a time.** A campaign can only have one `running` run. Wait for
> the current run to reach `completed`/`cancelled`/`failed` before triggering
> the next, or you will get a `409`.

### Example

```bash
curl -X POST \
  http://localhost:3001/api/webhooks/campaigns/CAMPAIGN_ID/trigger \
  -H "X-API-Key: a1b2c3d4e5f6..." \
  -H "Content-Type: application/json" \
  -d '{
    "survey_id": "external-survey-2026-q2",
    "contacts": [
      { "phone_number": "+201001234567", "cms_id": "case-001", "name": "Ahmed",
        "variables": { "account_id": "ACCT-123" } }
    ]
  }'
```

---

## 4. View Status & Results

Poll this endpoint with the `run_id` returned by the trigger call.

```http
GET /api/webhooks/campaigns/{campaign_id}/runs/{run_id}/results
X-API-Key: {webhook_api_key}
```

### Response — `200 OK`

```json
{
  "summary": {
    "run_id": "8f3c1a92-...",
    "run_number": 5,
    "survey_id": "external-survey-2026-q2",
    "cms_id": null,
    "status": "completed",
    "total_contacts": 2,
    "contacts_completed": 2,
    "contacts_failed": 0,
    "contacts_answered": 2,
    "contacts_no_answer": 0,
    "contacts_busy": 0,
    "started_at": "2026-05-18T10:00:00Z",
    "completed_at": "2026-05-18T10:04:30Z"
  },
  "results": [
    {
      "phone_number": "+201001234567",
      "cms_id": "case-001",
      "name": "Ahmed Hassan",
      "flag": true,
      "status": "completed",
      "call_status": "completed",
      "attempts": 1,
      "max_attempts": 3,
      "variables": { "account_id": "ACCT-123", "confirm_payment": "1" },
      "dtmf_inputs": ["1"],
      "duration": 145,
      "last_attempt_at": "2026-05-18T10:01:12Z"
    }
  ]
}
```

### `summary` fields (run-level)

| Field                | Description                                          |
|----------------------|------------------------------------------------------|
| `run_id`             | UUID of this run.                                    |
| `run_number`         | Sequential run number for this campaign.             |
| `survey_id`          | Per-run external survey identifier, or `null`. Filterable in [`GET /api/webhooks/runs`](#5-query-runs-cross-campaign). |
| `cms_id`             | Legacy per-run identifier (kept for backwards compat). `null` for runs triggered with the new per-contact `cms_id` shape. |
| `status`             | Run status — see status table below.                 |
| `total_contacts`     | Contacts in the run.                                 |
| `contacts_completed` | Reached the end of the IVR flow successfully.        |
| `contacts_failed`    | Exhausted all attempts without completing.           |
| `contacts_answered`  | Calls the contact picked up.                         |
| `contacts_no_answer` | Calls that rang out with no answer.                  |
| `contacts_busy`      | Calls that hit a busy signal.                        |
| `started_at`         | When the run started.                                |
| `completed_at`       | When the run finished (`null` while still running).  |

### `results[]` fields (per contact)

| Field            | Description                                                                       |
|------------------|-----------------------------------------------------------------------------------|
| `phone_number`   | The dialed number.                                                                |
| `cms_id`         | Per-contact external identifier from the trigger payload, or `null`.              |
| `name`           | Contact name (from the trigger payload), or `null`.                               |
| `flag`           | Boolean outcome flag: `true` if flag_variable matched flag_value, `false` otherwise. Always boolean, never null. |
| `status`         | Contact processing status — see table below.                                     |
| `call_status`    | Telephony status of the latest call attempt — see table below. `null` if not yet dialed. |
| `attempts`       | Number of call attempts made for this contact.                                   |
| `max_attempts`   | Campaign retry ceiling (default `3`).                                             |
| `variables`      | Result data captured by the IVR flow (DTMF entries, API results, etc.).           |
| `dtmf_inputs`    | Array of digits the caller pressed during the latest call.                        |
| `duration`       | Talk duration of the latest call in seconds, or `null`.                           |
| `last_attempt_at`| Timestamp of the most recent attempt, or `null`.                                  |

### Status value reference

**Run status (`summary.status`)**

| Value       | Meaning                              |
|-------------|--------------------------------------|
| `running`   | Contacts are being called.           |
| `paused`    | Run paused by an operator.           |
| `completed` | All contacts processed.              |
| `cancelled` | Run cancelled by an operator.        |
| `failed`    | Run failed.                          |

**Contact status (`results[].status`)**

| Value       | Meaning                                          |
|-------------|--------------------------------------------------|
| `pending`   | Awaiting its first call attempt.                 |
| `calling`   | Currently being dialed / in an active call.      |
| `completed` | Completed the IVR flow successfully.             |
| `failed`    | All attempts exhausted without completion.       |
| `skipped`   | Not called (e.g. run cancelled before reaching it). |

**Call status (`results[].call_status`)**

| Value       | Meaning                                  |
|-------------|------------------------------------------|
| `queued`    | In the dial queue.                       |
| `dialing`   | Being dialed.                            |
| `ringing`   | Ringing at the destination.              |
| `answered`  | Contact picked up.                       |
| `completed` | Call finished after running the IVR flow.|
| `busy`      | Busy signal.                             |
| `no_answer` | Rang out, no answer.                     |
| `failed`    | Could not connect.                       |
| `cancelled` | Call cancelled.                          |

### Error responses

| Status | Body                                          | Cause                              |
|--------|-----------------------------------------------|------------------------------------|
| `401`  | `{ "error": "Invalid API key..." }`           | Missing or wrong `X-API-Key`.      |
| `404`  | `{ "error": "Campaign run not found" }`       | `run_id` does not belong to campaign. |
| `500`  | `{ "error": "Failed to retrieve campaign results" }` | Internal failure.           |

### Polling guidance

The run is asynchronous. Poll the results endpoint every **5–15 seconds**
until `summary.status` is no longer `running`. The `summary.status`,
`results[].status`, and `results[].call_status` fields update as Asterisk
progresses through the contacts.

---

## 5. Query Runs (cross-campaign) <a id="5-query-runs-cross-campaign"></a>

Returns every campaign run in your tenant, filterable by `survey_id` and/or
a list of `campaign_ids`. Useful when the calling CMS wants "all runs for
my survey X" across multiple campaigns without making one request per
campaign.

```http
GET /api/webhooks/runs?survey_id={survey_id}&campaign_ids={A,B,C}&status={status}&limit=50&offset=0
X-API-Key: {webhook_api_key}
```

### Authentication

Pass the `webhook_api_key` of **any campaign in your tenant**. The
platform looks it up, identifies the tenant, and scopes the result set to
that tenant's campaigns. You do not need a separate "master" key.

### Query parameters

| Param          | Type   | Description                                                                              |
|----------------|--------|------------------------------------------------------------------------------------------|
| `survey_id`    | string | Exact-match filter on `campaign_runs.survey_id`.                                         |
| `campaign_ids` | string | Comma-separated list of campaign UUIDs. Restrict results to runs of these campaigns.     |
| `status`       | string | Filter by run status (`running`, `paused`, `completed`, `cancelled`, `failed`).          |
| `limit`        | number | Max rows to return. Default `50`, capped at `500`.                                       |
| `offset`       | number | Pagination offset. Default `0`.                                                          |

If both `survey_id` and `campaign_ids` are passed, the filters are ANDed.
If neither is passed, all runs in the tenant are returned (subject to
`limit`/`offset`).

### Response — `200 OK`

```json
{
  "total": 12,
  "limit": 50,
  "offset": 0,
  "filters": {
    "survey_id": "external-survey-2026-q2",
    "campaign_ids": [],
    "status": null
  },
  "runs": [
    {
      "run_id": "8f3c1a92-...",
      "run_number": 5,
      "campaign_id": "menia-complaint-resolution-campaign",
      "campaign_name": "Menia - Complaint Resolution Survey",
      "survey_id": "external-survey-2026-q2",
      "cms_id": null,
      "status": "completed",
      "total_contacts": 120,
      "contacts_completed": 95,
      "contacts_failed": 18,
      "contacts_answered": 110,
      "contacts_no_answer": 8,
      "contacts_busy": 2,
      "started_at": "2026-05-18T10:00:00Z",
      "completed_at": "2026-05-18T10:30:00Z"
    },
    ...
  ]
}
```

`runs[]` is ordered by `started_at DESC` (newest first). To fetch a
specific run's per-contact results, follow up with
`GET /api/webhooks/campaigns/{campaign_id}/runs/{run_id}/results` using
that campaign's own api key (§4).

### Examples

All runs for a specific survey:

```bash
curl -G http://localhost:3001/api/webhooks/runs \
  --data-urlencode "survey_id=external-survey-2026-q2" \
  -H "X-API-Key: $ANY_CAMPAIGN_KEY"
```

All runs for two specific campaigns, only `completed`, latest 20:

```bash
curl -G http://localhost:3001/api/webhooks/runs \
  --data-urlencode "campaign_ids=CAMP_A,CAMP_B" \
  --data-urlencode "status=completed" \
  --data-urlencode "limit=20" \
  -H "X-API-Key: $ANY_CAMPAIGN_KEY"
```

Intersect — only completed runs for survey `S1` belonging to campaigns
`A` or `B`:

```bash
curl -G http://localhost:3001/api/webhooks/runs \
  --data-urlencode "survey_id=S1" \
  --data-urlencode "campaign_ids=A,B" \
  --data-urlencode "status=completed" \
  -H "X-API-Key: $ANY_CAMPAIGN_KEY"
```

### Error responses

| Status | Body                                          | Cause                              |
|--------|-----------------------------------------------|------------------------------------|
| `401`  | `{ "error": "API key required..." }`          | Missing `X-API-Key`.               |
| `401`  | `{ "error": "Invalid API key" }`              | Key doesn't match any campaign.    |
| `500`  | `{ "error": "Failed to query campaign runs" }`| Internal failure.                  |

---

## 6. The `flag` Field

`flag` is always a boolean (`true` or `false`) indicating whether the contact 
achieved the campaign's goal. 

**How it works:**
- If the campaign is configured with a `flag_variable` (e.g. `confirm_payment`) 
  and a `flag_value` (e.g. `"1"`), the platform checks if the IVR captured that 
  variable with that exact value. If yes, `flag = true`; otherwise `false`.
- If the campaign has **no** flag configured, `flag = false` for all contacts.

This gives a single boolean "did this contact accomplish the goal" answer per 
contact, without parsing the full `variables` object.

---

## 7. End-to-End Example

```bash
# 1. (Once) Generate the campaign's webhook API key — needs an admin JWT.
curl -X POST http://localhost:3001/api/campaigns/CAMPAIGN_ID/generate-api-key \
  -H "Authorization: Bearer $JWT"
# → { "webhook_api_key": "KEY", ... }

# 2. Trigger a run. survey_id is per-run; cms_id is per-contact.
RUN=$(curl -s -X POST \
  http://localhost:3001/api/webhooks/campaigns/CAMPAIGN_ID/trigger \
  -H "X-API-Key: KEY" -H "Content-Type: application/json" \
  -d '{"survey_id":"external-survey-2026-q2",
       "contacts":[{"phone_number":"+201001234567","cms_id":"case-001","name":"Ahmed",
        "variables":{"account_id":"ACCT-123"}}]}')
echo "$RUN"   # → { "run_id": "RUN_ID", "run_number": 5, "survey_id": "...", ... }

# 3. Poll results until status != "running".
curl -s http://localhost:3001/api/webhooks/campaigns/CAMPAIGN_ID/runs/RUN_ID/results \
  -H "X-API-Key: KEY"

# 4. Or list every run for that survey across all campaigns:
curl -sG http://localhost:3001/api/webhooks/runs \
  --data-urlencode "survey_id=external-survey-2026-q2" \
  -H "X-API-Key: KEY"
```

---

## 8. Related: Outbound API Calls From a Flow

The webhook trigger above is **inbound** (an external system calls IVR-Lab).
The reverse direction also exists: an IVR flow can call **out** to your HTTP
endpoints mid-call using an `api_call` node, so you can fetch live data
(account balance, eligibility) while the caller is on the line.

```json
{
  "id": "fetch_balance",
  "type": "api_call",
  "method": "GET",
  "url": "https://api.example.com/balance?account={{account_id}}",
  "headers": { "Authorization": "Bearer {{auth_token}}" },
  "body": { "action": "fetch" },
  "resultVariable": "api_result",
  "next": "play_balance",
  "onError": "error_handler"
}
```

- `{{variable}}` placeholders in `url`, `headers`, and `body` are interpolated
  from the flow's runtime variables before the request is sent.
- The response is stored under `resultVariable` (default `api_result`); nested
  fields are also flattened, e.g. `api_result.balance`.
- Requests time out after **10 seconds**; on failure the flow follows
  `onError` if set.

Your endpoint should accept the documented method, return JSON, and respond
within the timeout. The fields it returns become flow variables and can be
surfaced later in the webhook results `variables` object.

---

## Quick Reference

| Action                        | Method & Path                                                      | Auth                          |
|-------------------------------|--------------------------------------------------------------------|-------------------------------|
| Generate API key              | `POST /api/campaigns/{id}/generate-api-key`                        | `Authorization: Bearer` (JWT) |
| Trigger a run                 | `POST /api/webhooks/campaigns/{id}/trigger`                        | `X-API-Key` (campaign-scoped) |
| View run results (one run)    | `GET /api/webhooks/campaigns/{id}/runs/{run_id}/results`           | `X-API-Key` (campaign-scoped) |
| Query runs (cross-campaign)   | `GET /api/webhooks/runs?survey_id=...&campaign_ids=A,B,C`          | `X-API-Key` (any in tenant)   |
