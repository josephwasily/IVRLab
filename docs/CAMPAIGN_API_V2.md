# Campaign Executions API — v2

Region-neutral version of the external campaign API, so the same integration
works for every water company. The v1 webhook API
(`/api/webhooks/...`, see [WEBHOOK_INTEGRATION.md](WEBHOOK_INTEGRATION.md))
is **unchanged** and keeps working for existing integrations.

| | v1 (unchanged) | v2 |
|---|---|---|
| Trigger | `POST /api/webhooks/campaigns/{campaign_id}/trigger` | `POST /api/v2/campaigns/executions` |
| List | `GET /api/webhooks/runs` | `GET /api/v2/campaigns/executions` |
| Status / results | `GET /api/webhooks/campaigns/{campaign_id}/runs/{run_id}/results` | `GET /api/v2/campaigns/executions/{execution_id}` |
| Campaign chosen by | id in the URL (e.g. `assuit-complaint-resolution-campaign`) | `campaign_type` (+ `region`) in the body / query |

An **execution** is a campaign run; `execution_id` is the same value as v1's
`run_id`, so both APIs can read the same execution.

## Authentication

Header `X-API-Key: <key>` — the webhook API key of **any** campaign in the
tenant (generated in the admin portal, or `POST /api/campaigns/{id}/generate-api-key`).
All v2 calls are scoped to that tenant.

## Campaign types and regions

Each campaign carries two lookup keys:

| Field | Examples |
|---|---|
| `api_campaign_type` | `complaint_resolution`, `service_satisfaction` |
| `region` | `assiut`, `menia` |

Values are case-insensitive. `assuit` / `asyut` are accepted as `assiut`.
The Assuit and Menia survey campaigns are filled in automatically by
`migrate.js` on container start. For any other campaign set them with:

```bash
curl -X PUT http://<host>:3001/api/campaigns/<campaign_id> \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"api_campaign_type":"complaint_resolution","region":"sohag"}'
```

## POST /api/v2/campaigns/executions — trigger

`region` may be sent in the body or as `?region=`. It is only required when the
same `campaign_type` exists in more than one region on that server.

```json
{
  "campaign_type": "complaint_resolution",
  "region": "assiut",
  "survey_id": "SRV-2026-10-001",
  "contacts": [
    { "phone_number": "01012345678", "cms_id": "case-1", "name": "…", "variables": {} }
  ]
}
```

`201 Created`

```json
{
  "success": true,
  "execution_id": "f0e776ec-fecb-40cb-8031-0fc060830965",
  "campaign_type": "complaint_resolution",
  "region": "assiut",
  "campaign_id": "assuit-complaint-resolution-campaign",
  "campaign_name": "Assuit - Complaint Resolution Survey",
  "run_number": 1,
  "survey_id": "SRV-2026-10-001",
  "status": "running",
  "total_contacts": 1,
  "duplicates": 0,
  "skipped": 0,
  "...": "plus the counters/dates listed under GET"
}
```

| Status | When |
|---|---|
| 400 | `campaign_type` missing, `contacts` empty / missing `phone_number`, or type exists in several regions and no `region` given (response lists `regions`) |
| 401 | Missing or invalid `X-API-Key` |
| 404 | No campaign for that type/region (response lists `available` type/region pairs) |
| 409 | That campaign already has a running execution, or two campaigns share the same type+region |

## GET /api/v2/campaigns/executions — list

Query parameters (all optional): `campaign_type`, `region`, `survey_id`,
`status` (`running`, `paused`, `completed`, `cancelled`, `failed`),
`limit` (default 50, max 500), `offset`.

```json
{
  "total": 2, "limit": 50, "offset": 0,
  "filters": { "campaign_type": null, "region": "assiut", "survey_id": null, "status": null },
  "executions": [
    {
      "execution_id": "…", "campaign_type": "complaint_resolution", "region": "assiut",
      "campaign_id": "…", "campaign_name": "…", "run_number": 1, "survey_id": "…",
      "status": "running", "total_contacts": 1, "contacts_completed": 0,
      "contacts_failed": 0, "contacts_answered": 0, "contacts_no_answer": 0,
      "contacts_busy": 0, "started_at": "…", "completed_at": null
    }
  ]
}
```

## GET /api/v2/campaigns/executions/{execution_id} — status

```json
{
  "execution": { "execution_id": "…", "campaign_type": "…", "region": "…", "status": "completed", "...": "same fields as the list" },
  "results": [ { "phone_number": "…", "cms_id": "…", "flag": true, "status": "completed", "variables": {}, "...": "same as v1 results[]" } ]
}
```

`results[]` has exactly the same fields as v1 — see
[WEBHOOK_INTEGRATION.md § results fields](WEBHOOK_INTEGRATION.md). `404` if the execution
doesn't exist in the caller's tenant.
