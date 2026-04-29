# IVR-Lab Platform API — Developer Guide

Base URL: `http://localhost:3001`
All `/api/*` endpoints (except `/health`, `/api/auth/login`, and `/api/webhooks/*`) require a Bearer JWT.
All data is scoped to the caller's `tenant_id` — the token carries it.

---

## 1. Authentication

### POST `/api/auth/login`
```json
{ "email": "admin@demo.com", "password": "admin123" }
```
**200**
```json
{ "token": "<jwt>", "user": { "id": "...", "email": "...", "tenantId": "...", "role": "admin" } }
```
Use the token on every subsequent call:
```
Authorization: Bearer <jwt>
```

Seeded users (from `platform-api/src/db/seed.js`):
| email | password | role |
|---|---|---|
| `admin@demo.com` | `admin123` | admin |
| `user@demo.com`  | `user123`  | user  |

---

## 2. Core Concepts

- **IVR flow** — JSON node graph (start → play/collect/branch/api_call/transfer/end), has an `extension` (2000–2099) and a `status` (`draft`, `active`, `inactive`). Only `active` flows are dispatched by the engine.
- **SIP trunk** — outbound route used to place calls. Must belong to the caller's tenant.
- **Campaign** — reusable template: IVR + trunk + caller ID + pacing settings. Does **not** own contacts.
- **Campaign instance / run** — a concrete execution of a campaign with a specific contact list. Each call belongs to exactly one run. This is the unit that is running/paused/cancelled.
- **Webhook API key** — per-campaign key that lets external systems (Zapier, n8n, etc.) trigger runs without a JWT.

---

## 3. Reference Data

Needed to create a campaign.

### GET `/api/ivr`
Returns IVR flows for the tenant. Pick `id` and note the `extension` and `status` (must be `active` for calls to actually run).

### GET `/api/trunks`
Returns SIP trunks. Pick `id`.

### GET `/api/extensions`
Returns the 2000–2099 extension pool and their assignments.

---

## 4. Campaign CRUD

### POST `/api/campaigns`
```json
{
  "name": "Zoiper 1001 - Survey",
  "description": "...",
  "campaign_type": "survey",        // survey | notification | collection | reminder | custom
  "ivr_id": "customer-survey-flow",  // must be an active IVR
  "trunk_id": "92572ea0-...",
  "caller_id": "3000",
  "max_concurrent_calls": 1,
  "calls_per_minute": 10,
  "max_attempts": 1,
  "retry_delay_minutes": 30,
  "flag_variable": null,             // optional: mark a contact "completed"
  "flag_value": null                 //          when this IVR var equals this
}
```
**201** → full campaign row. Only `name` and `ivr_id` are strictly required.

### GET `/api/campaigns` / `/api/campaigns/:id`
Returns campaigns enriched with `run_count`, `active_run`, `is_running`, `is_paused`, `trunk_name`, `ivr_name`.

### PUT `/api/campaigns/:id`
Partial update. **Rejected (400) if campaign has a running instance.**

### DELETE `/api/campaigns/:id`
Cascades outbound_calls, campaign_contacts, triggers. **Rejected (400) if an instance is running or paused.**

---

## 5. Running a Campaign (Instances)

> The legacy `POST /:id/contacts/manual` + `POST /:id/start` path is gone (returns 410). **Always create an instance.**

### POST `/api/campaigns/:id/instances/manual`
Create and immediately start a run from an inline JSON contact list.
```json
{
  "contacts": [
    { "phone_number": "1001", "name": "Zoiper", "variables": { "balance": "123" } },
    { "phone_number": "5551234" }
  ]
}
```
`variables` get injected into the IVR flow as template values.

**201**
```json
{
  "success": true,
  "message": "Campaign instance started - Run #1",
  "run_id": "0dc7aeec-...",
  "run_number": 1,
  "imported": 2,
  "duplicates": 0,
  "skipped": 0
}
```

### POST `/api/campaigns/:id/instances/upload`
`multipart/form-data` with `file=<csv>` and optional `phone_column=phone`. Same response shape. CSV header row must include the phone column. Extra columns become `variables`.

### GET `/api/campaigns/:id/instances`
Returns all runs for the campaign with counters (`contacts_called`, `contacts_completed`, `contacts_answered`, `contacts_failed`, `contacts_no_answer`, `contacts_busy`) and `status` (`running` | `paused` | `completed` | `cancelled`).

### GET `/api/campaigns/:id/instances/:runId/contacts`
Per-contact rows with `status`, `attempts`, parsed `variables`, and the final `result` object produced by the IVR (DTMF collected, branches taken, etc.).

---

## 6. Run Control

These operate on the campaign's **active** run (running or paused).

- `POST /api/campaigns/:id/start` — legacy shim, returns 400: start instances via `/instances/manual` or `/instances/upload` instead.
- `POST /api/campaigns/:id/pause` — pauses the active run. 400 if no active run.
- `POST /api/campaigns/:id/resume` — resumes a paused run.
- `POST /api/campaigns/:id/cancel` — cancels the active run.

All four return `{ success: true, ... }` on success.

---

## 7. Stats

### GET `/api/campaigns/:id/stats`
```json
{
  "campaign_id": "...",
  "status": "draft",
  "total_contacts": 0,
  "contacts_called": 0,
  "contacts_completed": 0,
  "contacts_failed": 0,
  "contact_breakdown": [ { "status": "pending", "count": 10 } ],
  "call_breakdown":    [ { "status": "answered", "count": 8  } ],
  "avg_duration_seconds": 23.4
}
```

---

## 8. Webhook (no-auth) Triggering

Use when an external service should kick off a run without holding a JWT.

### POST `/api/campaigns/:id/generate-api-key`  (JWT auth)
```json
{
  "success": true,
  "webhook_api_key": "<hex>",
  "webhook_trigger_url": "/api/webhooks/campaigns/<id>/trigger",
  "webhook_results_url": "/api/webhooks/campaigns/<id>/runs/{run_id}/results"
}
```

### POST `/api/webhooks/campaigns/:campaignId/trigger`
Headers: `X-API-Key: <webhook_api_key>`
Body:
```json
{ "contacts": [ { "phone_number": "1001", "name": "Zoiper", "variables": {} } ] }
```
**201** → same shape as `/instances/manual`.

### GET `/api/webhooks/campaigns/:campaignId/runs/:runId/results`
Header: `X-API-Key: ...`
Returns all contacts + their IVR results for that run. Ideal for pull-based Zapier/n8n polling.

---

## 9. Full End-to-End Example (curl)

Rings Zoiper on extension `1001` and runs the active "Customer Satisfaction Survey" IVR (ext 2020).

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.com","password":"admin123"}' \
  | jq -r .token)

# 2. Create campaign
CID=$(curl -s -X POST http://localhost:3001/api/campaigns \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Zoiper 1001 - Survey",
    "campaign_type": "survey",
    "ivr_id": "customer-survey-flow",
    "trunk_id": "92572ea0-432c-41ae-8b22-89b313f77f51",
    "caller_id": "3000",
    "max_concurrent_calls": 1,
    "calls_per_minute": 10,
    "max_attempts": 1
  }' | jq -r .id)

# 3. Launch an instance (dials 1001)
curl -s -X POST http://localhost:3001/api/campaigns/$CID/instances/manual \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"contacts":[{"phone_number":"1001","name":"Zoiper"}]}'

# 4. Watch results
curl -s http://localhost:3001/api/campaigns/$CID/instances \
  -H "Authorization: Bearer $TOKEN" | jq
```

Confirmed working against a registered Zoiper on endpoint `1001`: phone rings → answered → IVR plays prompts → DTMF collected → run completes with per-contact results.

---

## 10. Gotchas

- **IVR must be `status=active`** or the engine returns `ivr_not_found` even though Asterisk successfully answered the leg. Check with:
  `SELECT extension, name, status FROM ivr_flows;`
- **Extension is numeric** (2000–2099). The extension pool is pre-seeded; IVRs auto-claim one on creation.
- **Tenant isolation is strict.** Every lookup adds `AND tenant_id = ?` from the JWT — you cannot reach another tenant's IVR/trunk/campaign even if you know the UUID.
- **Only one active run per campaign.** `pause`/`resume`/`cancel` always target that single active run.
- **Legacy contact endpoints return 410.** If you see "Campaign-level contacts are no longer supported", you're on the old API shape — switch to `/instances/*`.
- **Pacing knobs** (`max_concurrent_calls`, `calls_per_minute`, `max_attempts`, `retry_delay_minutes`) live on the campaign, not the instance — edit the campaign, then launch a new instance.
