# Campaign Instance API Draft

This document captures the request shapes for the instance-based campaign model.

## Goal

- A campaign is designed once.
- Each execution is a campaign instance.
- Contact lists belong to an instance, not the campaign design itself.
- Historical instances remain queryable after future uploads.

## Implemented Backend Slice

### `GET /api/campaigns/:id/contacts/template.csv`

Downloads a simple CSV template for users to fill before upload.

Response:

```csv
phone_number,name
+201000000000,Example Contact
```

### `POST /api/campaigns/:id/instances/manual`

Creates and immediately starts a campaign instance from manual JSON contacts.

Request:

```json
{
  "contacts": [
    {
      "phone_number": "+201000000000",
      "name": "John Doe",
      "variables": {
        "customer_id": "C-100"
      }
    }
  ]
}
```

Response:

```json
{
  "success": true,
  "message": "Campaign instance started - Run #4",
  "run_id": "uuid",
  "run_number": 4,
  "imported": 1,
  "duplicates": 0,
  "skipped": 0
}
```

### `POST /api/campaigns/:id/instances/upload`

Creates and immediately starts a campaign instance from CSV upload.

Multipart form fields:

- `file`
- `phone_column`

### `GET /api/campaigns/:id/instances`

Returns all historical campaign instances for a campaign.

### `GET /api/campaigns/:id/instances/:runId/contacts`

Returns the contacts tied to a specific campaign instance.

## Analytics Backend Filter Draft

The analytics backend now accepts:

- `ivrId`
- `runId`
- `from`
- `to`

So the UI can eventually filter by flow and by campaign instance.

## Planned Next Requests

### Wizard Start From Upload

Frontend flow:

1. Choose campaign design.
2. Download template if needed.
3. Upload CSV/XLSX file.
4. Review column mapping.
5. Start instance.
6. Land on instance history/details.

### Webhook: Create Campaign Instance

Planned request:

`POST /api/webhooks/campaigns/:id/instances`

Headers:

- `X-Webhook-Key: <secret>`

Body:

```json
{
  "external_ref": "erp-batch-2026-03-20-001",
  "contacts": [
    {
      "phone_number": "+201000000000",
      "name": "John Doe",
      "variables": {
        "invoice_id": "INV-001"
      }
    }
  ]
}
```

### Webhook: Poll Campaign Instance Result

Planned request:

`GET /api/webhooks/campaigns/:id/instances/:runId`

Response should include:

- instance status
- total contacts
- processed contacts
- success/failure counts
- per-contact results

## Planned Upload Expansion

CSV is supported in the current implementation slice.

Next step:

- add XLSX parsing
- keep CSV backward compatible
- reuse the same normalized contact payload internally
