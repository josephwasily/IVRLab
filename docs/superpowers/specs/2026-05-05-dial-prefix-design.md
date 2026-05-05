# Dial Prefix for Outbound Calls — Design

**Date:** 2026-05-05
**Status:** Approved (pending spec review)

## Problem

Some SIP trunks require a leading digit (typically `9`) to route an outbound call to the PSTN. Today, IVR-Lab dials the contact's phone number verbatim. When a trunk needs a prefix, operators have to edit every row in their Excel before importing — error-prone and tedious.

We want the platform to handle this automatically: configure the prefix once, store contact numbers clean, and prepend the prefix at dial-time.

## Goals

- Operators store phone numbers in their natural form. The platform adds the prefix.
- Prefix is configured per trunk (because it's a property of the trunk's physical routing requirement) with an optional per-campaign override.
- All outbound paths that go through a trunk inherit its prefix: campaigns, single-call API, webhook triggers.
- Existing campaigns and trunks continue to work with no behavior change.

## Non-Goals

- Per-region or per-destination prefix routing (e.g., different prefix for international vs local).
- Stripping prefixes from inbound caller-ID.
- Rippling a trunk-level prefix change to existing campaigns retroactively. We snapshot at campaign creation time.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Where does the prefix live? | Trunk default + campaign override |
| Override semantics | Snapshot trunk prefix into campaign at creation; campaign field then editable; empty = no prefix |
| Numbers that already start with the prefix | Always prepend, no smart-skip — predictable, user owns data quality |
| Which call paths apply it | Trunk prefix everywhere (campaigns, single-call API, webhooks); campaign override only on the campaign path |

## Data Model

Two new columns, both nullable, both default NULL.

```sql
ALTER TABLE sip_trunks ADD COLUMN dial_prefix TEXT;
ALTER TABLE campaigns  ADD COLUMN dial_prefix TEXT;
```

- `sip_trunks.dial_prefix` — the trunk's required outbound prefix.
- `campaigns.dial_prefix` — campaign-specific override.

**Resolution at dial-time** (per call):

1. If a campaign is in scope, use `campaigns.dial_prefix` as-is (NULL or empty → no prefix). The campaign field is the source of truth because it was already snapshotted from the trunk at creation time. The trunk is **not** consulted again — that matches the chosen "snapshot at creation, empty means none" semantics and prevents surprising re-inheritance after the user has explicitly cleared the field.
2. If no campaign is in scope (single-call API, webhook trigger), use `sip_trunks.dial_prefix` (or none if null).
3. The chosen prefix is **always prepended** to `phone_number` before building the PJSIP dial string. No smart-skip logic.

**Validation:** `^[0-9*#]{0,15}$` — digits and SIP DTMF symbols only, max 15 chars. Empty input is normalized to NULL on write.

**Migration:** additive only (matches CLAUDE.md rule). Add to `platform-api/src/db/migrate.js`. The migration must be idempotent — check for column existence before adding so re-runs on already-migrated DBs don't fail.

## API

### Trunk routes (`platform-api/src/routes/trunks.js`)

- `POST /trunks` and `PATCH /trunks/:id` accept optional `dial_prefix`.
- `GET /trunks` and `GET /trunks/:id` return `dial_prefix`.
- Validate against the regex above; reject otherwise with `400 Bad Request`.
- Empty string normalized to NULL before insert/update.

### Campaign routes (`platform-api/src/routes/campaigns.js`)

- `POST /campaigns` accepts optional `dial_prefix`.
  - **Default-on-create**: if the request omits `dial_prefix` and provides a `trunk_id`, copy that trunk's current `dial_prefix` into the new campaign row.
  - If the request explicitly provides `dial_prefix` (including empty string), respect that value (empty → NULL).
- `PATCH /campaigns/:id` accepts `dial_prefix`. Empty string → NULL.
- `GET /campaigns` and `GET /campaigns/:id` return `dial_prefix`. The campaign's own `dial_prefix` is sufficient for the instance-wizard banner; no need to enrich with the trunk's value (snapshot model means trunk isn't consulted at dial time).
- Same validation regex as trunks.

### Shared dial-string helper

New module: `platform-api/src/services/dialPrefix.js`.

```js
function resolveDialPrefix({ campaign, trunk }) {
  // Campaign in scope: campaign value is authoritative (snapshot model).
  // NULL or empty on the campaign means "no prefix" — do NOT fall back to trunk.
  if (campaign) return campaign.dial_prefix || '';
  // No campaign (single-call API / webhook): use trunk default.
  if (trunk && trunk.dial_prefix) return trunk.dial_prefix;
  return '';
}

function applyDialPrefix(prefix, phoneNumber) {
  const num = String(phoneNumber || '').trim();
  if (!prefix) return num;
  return `${prefix}${num}`;
}

module.exports = { resolveDialPrefix, applyDialPrefix };
```

Both existing dial-string builders are updated to call `applyDialPrefix` once before assembling the PJSIP target:

- `platform-api/src/routes/campaigns.js:42` — `buildPjsipChannel(trunk, phoneNumber)` becomes `buildPjsipChannel(trunk, phoneNumber, prefix)`. Callers resolve the prefix from `{campaign, trunk}` and pass it in.
- `platform-api/src/services/outboundDialer.js:34` — `buildPjsipDialString(trunk, phoneNumber)` becomes `buildPjsipDialString(trunk, phoneNumber, prefix)`. The `originateCall` and `triggerSingleCall` callers compute the prefix the same way (campaign in `originateCall`, just trunk in `triggerSingleCall`).

Webhook trigger paths (`webhooks.js`, `triggers.js`) that originate calls go through the same helpers and inherit prefix application automatically.

The raw `phone_number` is **not modified** in `campaign_contacts` or `outbound_calls`. Only the PJSIP dial string is prefixed.

### Logging

Existing `[Dialer] Calling 0123... via PJSIP/901234@trunk` log lines already show the final dial target, so prefix application is observable for free. No new logs needed.

## UI

### Trunks page (`admin-portal-v2/src/pages/Trunks.jsx`)

- New form input under `caller_id`:
  - Label: "Dial Prefix" / "بادئة الاتصال" (localized via `useI18n`/`t()`).
  - Helper text: "Digits prepended to every outbound number on this trunk (e.g., 9). Leave empty for none."
  - HTML `pattern="[0-9*#]{0,15}"` + a JS check before submit.
- In the trunks list, add a small inline indicator (chip or column) showing the prefix so admins can scan trunks at a glance. Display `—` when null.

### Campaign edit page (`admin-portal-v2/src/pages/CampaignEdit.jsx`)

- New "Dial Prefix" input next to the trunk selector.
  - Helper text: "Optional. Prepended to all numbers in this campaign. Leave empty to use no prefix. Defaults to the trunk's prefix when the campaign is created."
- **Trunk-change handler**: when the user changes the selected trunk, if the `dial_prefix` field is currently empty, auto-fill it with the newly selected trunk's prefix. If the user has typed something, leave it alone.
- Same validation.

### Campaign instance wizard (`admin-portal-v2/src/components/CampaignInstanceForm.jsx`)

- Read-only banner shown above the contact-entry area when the effective prefix is non-empty. Example:
  > 🛈 Numbers will be dialed with prefix `9`. Example: `01234567` → `901234567`. Edit the campaign to change.
- Effective prefix comes from `campaign.dial_prefix` only — never falling back to the trunk. This mirrors the dialer's snapshot semantics: when a campaign is in scope, the trunk's prefix is not consulted, so showing it in the banner would mislead users whose campaigns have explicitly cleared the field.
- No edit control here — the wizard stays focused on contacts.
- Localize both English and Arabic.

### What does NOT change

- Excel/CSV upload flow. Numbers stay raw.
- `phone_number` displayed in OutboundCalls/reports. Keep showing the raw input — that's what the user recognizes. The prefix is only assembled at origination time.

## Testing

### Unit tests

New file: `platform-api/test/dialPrefix.test.js` (or inline alongside the helper if the project lacks Jest infra — to be verified during planning).

```
applyDialPrefix('',  '01234')      → '01234'
applyDialPrefix('9', '01234')      → '901234'
applyDialPrefix('9', '  01234 ')   → '901234'
resolveDialPrefix({campaign:{dial_prefix:'8'},  trunk:{dial_prefix:'9'}}) → '8'
resolveDialPrefix({campaign:{dial_prefix:null}, trunk:{dial_prefix:'9'}}) → ''   // snapshot model: null on campaign = no prefix
resolveDialPrefix({campaign:{dial_prefix:''},   trunk:{dial_prefix:'9'}}) → ''
resolveDialPrefix({campaign:null, trunk:{dial_prefix:'9'}})               → '9'  // no-campaign path uses trunk
resolveDialPrefix({campaign:null, trunk:null})                            → ''
```

### Manual verification

1. Run migration on an existing DB (`docker exec platform-api node src/db/migrate.js`). Existing campaigns/trunks come back with `dial_prefix=NULL` and dial behavior unchanged.
2. Set a trunk's prefix to `9`. Create a new campaign on it without specifying prefix → campaign row has `dial_prefix='9'`.
3. Edit that campaign, blank the field → DB stores NULL, instance wizard shows no banner, dial uses no prefix.
4. Run a campaign instance with an Excel-imported number → `outbound_calls.phone_number` stays raw; `[Dialer] Calling … via PJSIP/9...` shows prepended target.
5. Single-call trigger API on the same trunk (no campaign) → trunk prefix is applied.
6. Validation: `dial_prefix='9a'` via API → 400; via UI → input rejected.

## Rollout

- Additive migration, no data backfill (NULL preserves existing behavior).
- No `asterisk/` config or `ivr-node/` engine changes — prefix is a platform-API/admin-portal concern.
- Soft-disable path: clearing all `dial_prefix` values returns the system to current behavior without code rollback.

## Files Touched (estimate)

**Backend:**
- `platform-api/src/db/schema.sql` — column definitions for new installs.
- `platform-api/src/db/migrate.js` — idempotent ALTER TABLE for existing DBs.
- `platform-api/src/services/dialPrefix.js` — new helper.
- `platform-api/src/services/outboundDialer.js` — wire helper into dial path.
- `platform-api/src/routes/campaigns.js` — wire helper into dial path; accept/return field; default-from-trunk on create; include trunk prefix in detail response.
- `platform-api/src/routes/trunks.js` — accept/return field with validation.
- `platform-api/test/dialPrefix.test.js` — unit tests.

**Frontend:**
- `admin-portal-v2/src/pages/Trunks.jsx` — form input, list indicator.
- `admin-portal-v2/src/pages/CampaignEdit.jsx` — form input, trunk-change autofill.
- `admin-portal-v2/src/components/CampaignInstanceForm.jsx` — effective-prefix banner.
- `admin-portal-v2/src/lib/api.js` — only if any client function strips/whitelists fields (most pass body through).
- `admin-portal-v2/src/contexts/I18nContext.jsx` (or wherever strings live) — EN/AR strings for the new labels and banner.
