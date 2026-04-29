# IVR-Lab External API — Integration Guide

This guide is for **external systems** (Zapier, n8n, Make, custom backends) that need to
trigger IVR campaigns and collect results. You do **not** need a user account or a JWT —
authentication is a per-campaign **API key** passed in the `X-API-Key` header.

- **Base URL:** `https://<your-ivr-lab-host>` (use `http://localhost:3001` for local testing)
- **Auth:** `X-API-Key: <webhook_api_key>` on every webhook call
- **Content type:** `application/json`
- **Scope of a key:** one key authorizes exactly **one campaign**. Rotate or revoke by regenerating.

---

## 1. One-time setup (done by the tenant admin inside IVR-Lab)

The admin of the IVR-Lab account must do this **once per campaign** before handing anything to you:

1. Create a campaign (choose the IVR flow, SIP trunk, caller ID, pacing).
2. Generate an API key for that campaign:
   ```
   POST /api/campaigns/{campaign_id}/generate-api-key
   Authorization: Bearer <admin-jwt>
   ```
   Response:
   ```json
   {
     "success": true,
     "webhook_api_key": "68a313d89fd44a35ff1cbac13560cb56ffb2fc8e6f29b0100e7fd903f1655156",
     "webhook_trigger_url": "/api/webhooks/campaigns/28454b33-9e7f-4043-9499-2060121558d2/trigger",
     "webhook_results_url": "/api/webhooks/campaigns/28454b33-9e7f-4043-9499-2060121558d2/runs/{run_id}/results"
   }
   ```
3. Share **`campaign_id`** and **`webhook_api_key`** with the external party over a secure channel. That's all they need.

Regenerating the key **invalidates the previous one immediately**.

---

## 2. Trigger a campaign run

Kick off a new run (campaign instance) with a list of contacts. Each run is independent — you can trigger many per day.

### Endpoint
```
POST /api/webhooks/campaigns/{campaign_id}/trigger
```

### Headers
```
X-API-Key: <webhook_api_key>
Content-Type: application/json
```

### Request body
```json
{
  "contacts": [
    {
      "phone_number": "1001",
      "name": "Jane Doe",
      "variables": {
        "customer_id": "C-42",
        "amount_due": "250.00"
      }
    },
    {
      "phone_number": "5551234567"
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `contacts` | yes | Non-empty array. |
| `contacts[].phone_number` | yes | Dialable string. The trunk decides how it is routed. |
| `contacts[].name` | no | Free text, echoed back in results. |
| `contacts[].variables` | no | Object of strings. These are injected into the IVR flow at runtime so prompts/branches can reference them. |

### Response — 201
```json
{
  "success": true,
  "run_id": "dc8e88ea-dc48-4a94-89cc-11451b582f98",
  "run_number": 1,
  "total_contacts": 1,
  "duplicates": 0,
  "skipped": 0
}
```
**Save `run_id`** — you need it to read results.

### Error responses
| HTTP | When | Body |
|---|---|---|
| `401` | Header missing | `{"error":"API key required. Pass it in the X-API-Key header."}` |
| `401` | Wrong key or wrong campaign | `{"error":"Invalid API key or campaign not found"}` |
| `400` | Empty `contacts` | `{"error":"contacts array is required and must not be empty"}` |
| `400` | A contact is missing `phone_number` | `{"error":"Some contacts are missing phone_number","invalid_count":N}` |
| `409` | Campaign already has an active run (single-run-at-a-time constraint) | `{"error":"Campaign already has an active run"}` |
| `500` | Server error | `{"error":"..."}` |

---

## 3. Read run results

Poll this endpoint after triggering. It returns both a **run-level summary** and **per-contact results** (including the DTMF digits the caller pressed and any variables the IVR collected).

### Endpoint
```
GET /api/webhooks/campaigns/{campaign_id}/runs/{run_id}/results
```

### Headers
```
X-API-Key: <webhook_api_key>
```

### Response — 200
```json
{
  "summary": {
    "run_id": "dc8e88ea-dc48-4a94-89cc-11451b582f98",
    "run_number": 1,
    "status": "running",
    "total_contacts": 1,
    "contacts_completed": 0,
    "contacts_failed": 0,
    "contacts_answered": 1,
    "contacts_no_answer": 0,
    "contacts_busy": 0,
    "started_at": "2026-04-15 23:30:24",
    "completed_at": null
  },
  "results": [
    {
      "phone_number": "1001",
      "name": "Zoiper External",
      "flag": null,
      "status": "calling",
      "call_status": "answered",
      "attempts": 1,
      "max_attempts": 1,
      "variables": { "q1_satisfaction": "1", "q2_employees": "1" },
      "dtmf_inputs": ["1", "1", "1", "1", "1"],
      "duration": 34,
      "last_attempt_at": "2026-04-15 23:30:24"
    }
  ]
}
```

### Field reference

**`summary`** — run-level counters. Poll until `status` is terminal.

| `summary.status` | Meaning |
|---|---|
| `running` | Still dialing / IVRs in progress |
| `paused`  | Admin paused the run in the UI |
| `completed` | All contacts done (or max attempts exhausted) |
| `cancelled` | Admin cancelled the run |

**`results[]`** — one row per contact.

| Field | Meaning |
|---|---|
| `phone_number` | What you submitted |
| `name` | What you submitted (`null` if omitted) |
| `status` | Contact lifecycle: `pending` → `calling` → `completed` / `failed` / `no_answer` / `busy` |
| `call_status` | Last telephony outcome: `answered`, `no_answer`, `busy`, `failed`, `cancelled` |
| `attempts` | How many dial attempts were made |
| `max_attempts` | Campaign-configured cap |
| `variables` | Object of everything the IVR collected (DTMF values mapped to flow variable names, e.g. `q1_satisfaction: "1"`) |
| `dtmf_inputs` | Raw ordered list of DTMF digits pressed during the call |
| `duration` | Seconds the call was connected (`null` if never answered) |
| `last_attempt_at` | UTC timestamp of the most recent dial |
| `flag` | `true` / `false` / `null`. If the admin configured a **flag variable** on the campaign (e.g. "mark complete when `q1_satisfaction == 1`"), this field evaluates it for you. Use it as a one-shot "success?" flag. |

### Error responses
| HTTP | When |
|---|---|
| `401` | Missing/invalid `X-API-Key` |
| `404` | `run_id` does not belong to this `campaign_id` |
| `500` | Server error |

---

## 4. Polling pattern

IVR-Lab does not push results — you poll. Recommended cadence:

1. `POST /trigger` → store `run_id`.
2. Wait ~10 seconds.
3. `GET .../runs/{run_id}/results` every **15–30 seconds**.
4. Stop when `summary.status` is `completed` or `cancelled`, **or** after a hard timeout you define (e.g. 30 min × `max_attempts`).

Small runs (< 10 contacts, single attempt) typically finish in under a minute. Large runs scale with `calls_per_minute` and `max_concurrent_calls` configured on the campaign — ask the admin what they set.

---

## 5. Full example with `curl`

```bash
CAMPAIGN_ID="28454b33-9e7f-4043-9499-2060121558d2"
API_KEY="68a313d89fd44a35ff1cbac13560cb56ffb2fc8e6f29b0100e7fd903f1655156"
BASE="http://localhost:3001"

# 1. Trigger
RESP=$(curl -s -X POST "$BASE/api/webhooks/campaigns/$CAMPAIGN_ID/trigger" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contacts": [
      { "phone_number": "1001", "name": "Jane", "variables": { "customer_id": "C-42" } }
    ]
  }')
echo "$RESP"
RUN_ID=$(echo "$RESP" | jq -r .run_id)

# 2. Poll until done
while :; do
  OUT=$(curl -s "$BASE/api/webhooks/campaigns/$CAMPAIGN_ID/runs/$RUN_ID/results" \
    -H "X-API-Key: $API_KEY")
  STATUS=$(echo "$OUT" | jq -r .summary.status)
  echo "status=$STATUS"
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "cancelled" ] && break
  sleep 20
done

echo "$OUT" | jq .results
```

---

## 6. Zapier / n8n / Make recipes

**Trigger step** — use the "Webhooks" / "HTTP Request" action:
- Method: `POST`
- URL: `https://<host>/api/webhooks/campaigns/<campaign_id>/trigger`
- Headers: `X-API-Key: <webhook_api_key>`, `Content-Type: application/json`
- Body (JSON): `{"contacts":[{"phone_number":"{{phone}}","name":"{{name}}","variables":{"order_id":"{{order_id}}"}}]}`
- Capture `run_id` from the response.

**Results step** — scheduled every 30 seconds (n8n Cron / Zapier Schedule):
- Method: `GET`
- URL: `https://<host>/api/webhooks/campaigns/<campaign_id>/runs/{{run_id}}/results`
- Header: `X-API-Key: <webhook_api_key>`
- Filter: only continue when `summary.status == "completed"`.
- Downstream: read `results[].flag` (true/false) or `results[].variables.<your_var>`.

---

## 7. FAQ / gotchas

- **Is the key scoped to a tenant?** Implicitly — the key only works on its own campaign, and that campaign belongs to one tenant. You cannot read other campaigns with the same key.
- **Can I run two batches of the same campaign in parallel?** No. A campaign has at most one active run. Either wait for the current one to complete, or create a second campaign that points at the same IVR/trunk.
- **What happens to contacts on `no_answer` / `busy`?** If `max_attempts > 1`, IVR-Lab will re-queue them after `retry_delay_minutes`. Their `attempts` counter climbs on each retry; their `status` stays non-terminal until attempts are exhausted.
- **How do I send dynamic data into prompts?** Put it in `contacts[].variables`. The IVR flow references them as template variables (e.g. `{{customer_id}}` in a `say` node).
- **Does the results endpoint return historical runs?** Only for the `run_id` you pass. To list all runs you need admin/JWT access to `GET /api/campaigns/{id}/instances` — that endpoint is **not** exposed via webhook auth by design.
- **Rate limits?** Currently none at the HTTP layer, but the campaign's `calls_per_minute` / `max_concurrent_calls` govern how fast Asterisk actually dials. Triggering a 10,000-contact run with `calls_per_minute=5` will take ~33 hours.
- **HTTPS?** In production, always put the API behind TLS and use `https://`. API keys are credentials — never commit them, never log them, rotate if leaked.

---

## 8. Quick reference

| Purpose | Method & path | Auth |
|---|---|---|
| Start a run | `POST /api/webhooks/campaigns/{campaign_id}/trigger` | `X-API-Key` |
| Read a run's results | `GET /api/webhooks/campaigns/{campaign_id}/runs/{run_id}/results` | `X-API-Key` |
| (Admin) Generate / rotate key | `POST /api/campaigns/{campaign_id}/generate-api-key` | `Authorization: Bearer <jwt>` |
