# Dial Prefix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-trunk outbound dial prefix (e.g., `9`) with a per-campaign override snapshotted at creation, applied automatically at dial-time so operators no longer edit Excel rows by hand.

**Architecture:** Two new nullable columns (`sip_trunks.dial_prefix`, `campaigns.dial_prefix`) plus a single shared helper module that resolves the effective prefix and prepends it. All three existing dial-string builders call the helper. Campaign-scoped calls use the campaign field as the sole authority (snapshot model — empty means none). No-campaign paths (single-call API, webhook trigger) fall back to the trunk.

**Tech Stack:** Node.js / Express / better-sqlite3 (platform-api), React 18 / Vite / Tailwind (admin-portal-v2), Node's built-in `node:test` runner for unit tests (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-05-05-dial-prefix-design.md`

---

## File Structure

**Backend (`platform-api/`):**
- Create `src/services/dialPrefix.js` — pure helper module: `resolveDialPrefix({ campaign, trunk })` and `applyDialPrefix(prefix, phoneNumber)`. Single responsibility. No I/O.
- Create `test/dialPrefix.test.js` — `node:test` unit tests for the helper.
- Modify `src/db/schema.sql` — add `dial_prefix TEXT` to `sip_trunks` and `campaigns` (for fresh installs).
- Modify `src/db/migrate.js` — add idempotent `ensureColumn` calls for existing DBs.
- Modify `src/routes/trunks.js` — accept/return `dial_prefix` on POST/PUT/GET; validate; add to explicit SELECT lists.
- Modify `src/routes/campaigns.js` — accept/return `dial_prefix` on POST/PUT; default-from-trunk on create; thread prefix through `getCampaignExecutionContext` → `processCampaignContacts` → `buildPjsipChannel`.
- Modify `src/services/outboundDialer.js` — load campaign in `originateCall` to resolve prefix; thread it through `buildPjsipDialString`.
- Modify `src/routes/triggers.js` — thread prefix through both dial sites (single-trigger uses trunk only; legacy campaign run uses campaign+trunk).
- Modify `package.json` — add `"test"` script.

**Frontend (`admin-portal-v2/`):**
- Modify `src/pages/Trunks.jsx` — add Dial Prefix input under Caller ID; add column/chip in trunks list.
- Modify `src/pages/CampaignEdit.jsx` — add Dial Prefix input next to trunk selector; trunk-change autofill.
- Modify `src/components/CampaignInstanceForm.jsx` — read-only effective-prefix banner above contact entry.
- Modify `src/contexts/I18nContext.jsx` — add EN/AR strings under `instanceWizard`, `campaignEdit`, and a new `trunks` block (or existing one).

---

## Task 1: Add test infrastructure and helper module (TDD)

**Files:**
- Create: `platform-api/test/dialPrefix.test.js`
- Create: `platform-api/src/services/dialPrefix.js`
- Modify: `platform-api/package.json`

- [ ] **Step 1: Add test script to package.json**

Modify `platform-api/package.json` — add a `test` entry to `scripts`. The full `scripts` block becomes:

```json
"scripts": {
  "start": "node src/index.js",
  "dev": "nodemon src/index.js",
  "test": "node --test test/",
  "migrate": "node src/db/migrate.js",
  "seed": "node src/db/seed.js",
  "seed:reports-user": "node src/db/ensure-reports-user.js",
  "seed:new-sounds-2": "node src/db/seed-new-sounds-2-template.js",
  "seed:new-sounds-3": "node src/db/seed-new-sounds-3-template.js",
  "verify:new-sounds-2-parity": "node src/db/verify-water-sewage-template-parity.js",
  "water-sewage:sync": "node src/db/sync-water-sewage-flow.js",
  "water-sewage:verify": "node src/db/verify-water-sewage-template-parity.js"
}
```

No new dependencies. `node --test` is built into Node 18+.

- [ ] **Step 2: Write the failing test**

Create `platform-api/test/dialPrefix.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDialPrefix, applyDialPrefix } = require('../src/services/dialPrefix');

test('applyDialPrefix returns trimmed number when prefix is empty', () => {
  assert.equal(applyDialPrefix('', '01234'), '01234');
  assert.equal(applyDialPrefix(null, '01234'), '01234');
  assert.equal(applyDialPrefix(undefined, '  01234  '), '01234');
});

test('applyDialPrefix prepends prefix to trimmed number', () => {
  assert.equal(applyDialPrefix('9', '01234'), '901234');
  assert.equal(applyDialPrefix('9', '  01234 '), '901234');
});

test('applyDialPrefix handles multi-char prefix and DTMF symbols', () => {
  assert.equal(applyDialPrefix('901', '5551234'), '9015551234');
  assert.equal(applyDialPrefix('*9', '01234'), '*901234');
});

test('applyDialPrefix returns empty string when phoneNumber is empty', () => {
  assert.equal(applyDialPrefix('9', ''), '9');
  assert.equal(applyDialPrefix('9', null), '9');
});

test('resolveDialPrefix uses campaign value as authority when campaign present', () => {
  // Snapshot model: when a campaign is in scope, its value wins — even if null/empty.
  assert.equal(
    resolveDialPrefix({ campaign: { dial_prefix: '8' }, trunk: { dial_prefix: '9' } }),
    '8'
  );
  assert.equal(
    resolveDialPrefix({ campaign: { dial_prefix: null }, trunk: { dial_prefix: '9' } }),
    ''
  );
  assert.equal(
    resolveDialPrefix({ campaign: { dial_prefix: '' }, trunk: { dial_prefix: '9' } }),
    ''
  );
});

test('resolveDialPrefix falls back to trunk when no campaign in scope', () => {
  assert.equal(
    resolveDialPrefix({ campaign: null, trunk: { dial_prefix: '9' } }),
    '9'
  );
  assert.equal(
    resolveDialPrefix({ campaign: undefined, trunk: { dial_prefix: '9' } }),
    '9'
  );
});

test('resolveDialPrefix returns empty when nothing is configured', () => {
  assert.equal(resolveDialPrefix({ campaign: null, trunk: null }), '');
  assert.equal(resolveDialPrefix({ campaign: null, trunk: { dial_prefix: null } }), '');
  assert.equal(resolveDialPrefix({}), '');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `docker exec platform-api npm test`
Expected: FAIL — module `../src/services/dialPrefix` not found.

(If platform-api container is not running, run `docker compose up -d platform-api` first.)

- [ ] **Step 4: Write minimal implementation**

Create `platform-api/src/services/dialPrefix.js`:

```js
function resolveDialPrefix({ campaign, trunk } = {}) {
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

- [ ] **Step 5: Run test to verify it passes**

Run: `docker exec platform-api npm test`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add platform-api/package.json platform-api/test/dialPrefix.test.js platform-api/src/services/dialPrefix.js
git commit -m "Add dial prefix helper with unit tests"
```

---

## Task 2: Database migration and schema

**Files:**
- Modify: `platform-api/src/db/schema.sql`
- Modify: `platform-api/src/db/migrate.js`

- [ ] **Step 1: Add columns to schema.sql for fresh installs**

In `platform-api/src/db/schema.sql`, add `dial_prefix TEXT` to the `sip_trunks` table block. Find the line `caller_id TEXT,  -- Default caller ID for this trunk` (line 220) and insert immediately after:

```
    dial_prefix TEXT,  -- Digits prepended to outbound numbers on this trunk (e.g., "9")
```

In the same file, add the column to `campaigns`. Find the line `caller_id TEXT,  -- Override trunk caller ID` (line 105) and insert immediately after:

```
    dial_prefix TEXT,  -- Override trunk dial prefix; null = no prefix on this campaign
```

- [ ] **Step 2: Add idempotent migration calls for existing DBs**

In `platform-api/src/db/migrate.js`, find the existing webhook-column block:

```js
// Webhook columns for campaigns
ensureColumn('campaigns', 'webhook_api_key', 'TEXT');
ensureColumn('campaigns', 'flag_variable', 'TEXT');
ensureColumn('campaigns', 'flag_value', 'TEXT');
```

Add immediately after it:

```js
// Dial prefix (per-trunk default + per-campaign override)
ensureColumn('sip_trunks', 'dial_prefix', 'TEXT');
ensureColumn('campaigns', 'dial_prefix', 'TEXT');
```

- [ ] **Step 3: Run migration and verify columns exist**

Run:
```bash
docker exec platform-api node src/db/migrate.js
docker exec platform-api node -e "const db=require('./src/db'); console.log(db.prepare('PRAGMA table_info(sip_trunks)').all().map(c=>c.name).filter(n=>n==='dial_prefix')); console.log(db.prepare('PRAGMA table_info(campaigns)').all().map(c=>c.name).filter(n=>n==='dial_prefix'));"
```

Expected: two `[ 'dial_prefix' ]` lines printed. Migration log shows `Added sip_trunks.dial_prefix` and `Added campaigns.dial_prefix` on first run, nothing on subsequent runs.

- [ ] **Step 4: Commit**

```bash
git add platform-api/src/db/schema.sql platform-api/src/db/migrate.js
git commit -m "Add dial_prefix column to sip_trunks and campaigns"
```

---

## Task 3: Trunk routes — accept and return dial_prefix

**Files:**
- Modify: `platform-api/src/routes/trunks.js`

- [ ] **Step 1: Add validation helper at top of file**

In `platform-api/src/routes/trunks.js`, after the `router.use(authMiddleware);` line (around line 9), insert:

```js
const DIAL_PREFIX_PATTERN = /^[0-9*#]{0,15}$/;

function normalizeDialPrefix(value) {
    if (value === undefined) return undefined; // not in request body — leave field alone
    if (value === null || value === '') return null;
    const trimmed = String(value).trim();
    if (trimmed === '') return null;
    if (!DIAL_PREFIX_PATTERN.test(trimmed)) {
        const err = new Error('dial_prefix must be 0-15 chars of digits or * #');
        err.status = 400;
        throw err;
    }
    return trimmed;
}
```

- [ ] **Step 2: Include dial_prefix in list endpoint**

Find the GET / handler (around line 12). Update the SELECT to include `dial_prefix`:

```js
const trunks = db.prepare(`
    SELECT id, name, host, port, transport, username, caller_id, dial_prefix, codecs,
           max_channels, status, last_tested_at, test_result, created_at, updated_at
    FROM sip_trunks
    WHERE tenant_id = ?
    ORDER BY created_at DESC
`).all(req.user.tenantId);
```

- [ ] **Step 3: Include dial_prefix in single-trunk endpoint**

Find the GET /:id handler (around line 37). Update the SELECT to include `dial_prefix`:

```js
const trunk = db.prepare(`
    SELECT id, name, host, port, transport, username, caller_id, dial_prefix, codecs,
           max_channels, status, settings, last_tested_at, test_result, created_at, updated_at
    FROM sip_trunks
    WHERE id = ? AND tenant_id = ?
`).get(req.params.id, req.user.tenantId);
```

- [ ] **Step 4: Accept dial_prefix on create**

Find `router.post('/', requireRole('admin', 'editor'), async (req, res) => {` (around line 65). Replace the body of the handler so it destructures, normalizes, and inserts `dial_prefix`. The full handler becomes:

```js
router.post('/', requireRole('admin', 'editor'), async (req, res) => {
    try {
        const {
            name, host, port = 5060, transport = 'udp',
            username, password, caller_id, codecs = 'ulaw,alaw',
            max_channels = 10, settings = {}
        } = req.body;

        if (!name || !host) {
            return res.status(400).json({ error: 'Name and host are required' });
        }

        let dial_prefix;
        try {
            dial_prefix = normalizeDialPrefix(req.body.dial_prefix);
        } catch (err) {
            return res.status(err.status || 400).json({ error: err.message });
        }

        // Auto-set Asterisk endpoint name from trunk name if not provided
        const resolvedSettings = { ...settings };
        if (!resolvedSettings.endpoint) {
            resolvedSettings.endpoint = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        }

        const id = uuidv4();

        db.prepare(`
            INSERT INTO sip_trunks (id, tenant_id, name, host, port, transport, username, password, caller_id, dial_prefix, codecs, max_channels, settings)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, req.user.tenantId, name, host, port, transport, username, password, caller_id, dial_prefix ?? null, codecs, max_channels, JSON.stringify(resolvedSettings));

        const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ?').get(id);

        const syncResult = await syncTrunksToAsterisk();
        console.log(`[Trunks] Created trunk "${name}" -> Asterisk sync:`, syncResult);

        res.status(201).json(trunk);
    } catch (error) {
        console.error('Error creating trunk:', error);
        res.status(500).json({ error: 'Failed to create SIP trunk' });
    }
});
```

- [ ] **Step 5: Accept dial_prefix on update**

Find `router.put('/:id', requireRole('admin', 'editor'), async (req, res) => {` (around line 104). In the destructuring block, add `dial_prefix`:

Locate:
```js
const {
    name, host, port, transport, username, password,
    caller_id, codecs, max_channels, status, settings
} = req.body;
```

Replace with:
```js
const {
    name, host, port, transport, username, password,
    caller_id, codecs, max_channels, status, settings
} = req.body;

let dial_prefix;
try {
    dial_prefix = normalizeDialPrefix(req.body.dial_prefix);
} catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
}
```

Then locate the `if (caller_id !== undefined)` line:
```js
if (caller_id !== undefined) { updates.push('caller_id = ?'); values.push(caller_id); }
```

Insert immediately after:
```js
if (dial_prefix !== undefined) { updates.push('dial_prefix = ?'); values.push(dial_prefix); }
```

- [ ] **Step 6: Smoke-test via curl**

Restart platform-api: `docker compose restart platform-api`. Then:

```bash
# Capture an admin JWT first via your usual login flow.
TOKEN=...
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/trunks | python -m json.tool
```

Expected: trunks listed; each has a `dial_prefix` field (likely `null`).

```bash
# Set prefix on an existing trunk
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dial_prefix":"9"}' \
  http://localhost:3001/api/trunks/<trunk-id> | python -m json.tool

# Validation error
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dial_prefix":"9abc"}' \
  http://localhost:3001/api/trunks/<trunk-id>
```

Expected: first call returns the trunk with `dial_prefix: "9"`. Second returns `400` with the validation error message.

- [ ] **Step 7: Commit**

```bash
git add platform-api/src/routes/trunks.js
git commit -m "Accept and return dial_prefix on trunk routes"
```

---

## Task 4: Campaign routes — accept dial_prefix and snapshot from trunk on create

**Files:**
- Modify: `platform-api/src/routes/campaigns.js`

- [ ] **Step 1: Add validation helper near other helpers at top of file**

In `platform-api/src/routes/campaigns.js`, after the `buildPjsipChannel` function (ends around line 49), insert:

```js
const DIAL_PREFIX_PATTERN = /^[0-9*#]{0,15}$/;

function normalizeDialPrefix(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const trimmed = String(value).trim();
    if (trimmed === '') return null;
    if (!DIAL_PREFIX_PATTERN.test(trimmed)) {
        const err = new Error('dial_prefix must be 0-15 chars of digits or * #');
        err.status = 400;
        throw err;
    }
    return trimmed;
}
```

- [ ] **Step 2: Snapshot trunk prefix into campaign on create**

Find `router.post('/', (req, res) => {` (around line 663). In the destructuring block, replace:

```js
const { 
    name, description, campaign_type = 'survey',
    ivr_id, trunk_id, caller_id,
    max_concurrent_calls = 5, calls_per_minute = 10,
    max_attempts = 3, retry_delay_minutes = 30,
    settings = {}
} = req.body;
```

with:

```js
const { 
    name, description, campaign_type = 'survey',
    ivr_id, trunk_id, caller_id,
    max_concurrent_calls = 5, calls_per_minute = 10,
    max_attempts = 3, retry_delay_minutes = 30,
    settings = {}
} = req.body;

let dial_prefix;
try {
    dial_prefix = normalizeDialPrefix(req.body.dial_prefix);
} catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
}
```

Then find the trunk-verification block:

```js
// Verify trunk if provided
if (trunk_id) {
    const trunk = db.prepare('SELECT id FROM sip_trunks WHERE id = ? AND tenant_id = ?')
        .get(trunk_id, req.user.tenantId);
    if (!trunk) {
        return res.status(400).json({ error: 'SIP trunk not found' });
    }
}
```

Replace it with:

```js
// Verify trunk if provided; snapshot its dial_prefix when caller didn't specify one.
if (trunk_id) {
    const trunk = db.prepare('SELECT id, dial_prefix FROM sip_trunks WHERE id = ? AND tenant_id = ?')
        .get(trunk_id, req.user.tenantId);
    if (!trunk) {
        return res.status(400).json({ error: 'SIP trunk not found' });
    }
    if (dial_prefix === undefined) {
        dial_prefix = trunk.dial_prefix ?? null;
    }
}
```

Then change the INSERT and its parameters to include `dial_prefix`. Find:

```js
db.prepare(`
    INSERT INTO campaigns (id, tenant_id, name, description, campaign_type, ivr_id, trunk_id, caller_id,
        max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, settings, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(id, req.user.tenantId, name, description, campaign_type, ivr_id, trunk_id, caller_id,
    max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, 
    JSON.stringify(settings), req.user.userId);
```

Replace with:

```js
db.prepare(`
    INSERT INTO campaigns (id, tenant_id, name, description, campaign_type, ivr_id, trunk_id, caller_id, dial_prefix,
        max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, settings, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(id, req.user.tenantId, name, description, campaign_type, ivr_id, trunk_id, caller_id, dial_prefix ?? null,
    max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes,
    JSON.stringify(settings), req.user.userId);
```

- [ ] **Step 3: Accept dial_prefix on update**

Find `router.put('/:id', (req, res) => {` (around line 712). In the destructuring block, replace:

```js
const {
    name, description, campaign_type, ivr_id, trunk_id, caller_id,
    max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, settings,
    flag_variable, flag_value
} = req.body;
```

with:

```js
const {
    name, description, campaign_type, ivr_id, trunk_id, caller_id,
    max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, settings,
    flag_variable, flag_value
} = req.body;

let dial_prefix;
try {
    dial_prefix = normalizeDialPrefix(req.body.dial_prefix);
} catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
}
```

Then find:

```js
if (caller_id !== undefined) { updates.push('caller_id = ?'); values.push(caller_id); }
```

Insert immediately after:

```js
if (dial_prefix !== undefined) { updates.push('dial_prefix = ?'); values.push(dial_prefix); }
```

- [ ] **Step 4: Verify dial_prefix flows through campaign GET**

The campaign GET handlers already use `SELECT *`, so the new `dial_prefix` column flows through automatically with no code change required. Confirm by hitting the endpoint after this task lands (Step 5).

(No enrichment of the trunk's prefix is needed in the campaign response — per the snapshot semantics, the wizard banner reflects only `campaign.dial_prefix`. The trunk-change autofill on the campaign edit page reads from the existing `getTrunks()` list query, not from the campaign response.)

- [ ] **Step 5: Smoke-test the flow**

```bash
# Set a trunk prefix
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dial_prefix":"9"}' http://localhost:3001/api/trunks/<trunk-id>

# Create a new campaign on that trunk WITHOUT specifying dial_prefix
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"prefix-snapshot-test","ivr_id":"<ivr-id>","trunk_id":"<trunk-id>"}' \
  http://localhost:3001/api/campaigns | python -m json.tool
```

Expected: response contains `"dial_prefix": "9"` (snapshotted from trunk).

```bash
# GET the campaign — should include dial_prefix in the response
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/campaigns/<new-campaign-id> | python -m json.tool
```

Expected: response has `"dial_prefix": "9"`.

```bash
# Clear the campaign's prefix
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dial_prefix":""}' http://localhost:3001/api/campaigns/<new-campaign-id>
```

Expected: `"dial_prefix": null` in response.

- [ ] **Step 6: Commit**

```bash
git add platform-api/src/routes/campaigns.js
git commit -m "Accept dial_prefix on campaigns and snapshot from trunk on create"
```

---

## Task 5: Apply prefix at dial-time in campaigns.js (AMI path)

**Files:**
- Modify: `platform-api/src/routes/campaigns.js`

- [ ] **Step 1: Import the helper and update buildPjsipChannel signature**

In `platform-api/src/routes/campaigns.js`, near the top imports (after the `surveyReport` require, around line 11), add:

```js
const { resolveDialPrefix, applyDialPrefix } = require('../services/dialPrefix');
```

Then find `function buildPjsipChannel(trunk, phoneNumber)` (around line 42). Replace the whole function with:

```js
function buildPjsipChannel(trunk, phoneNumber, dialPrefix = '') {
    const target = applyDialPrefix(dialPrefix, phoneNumber);
    const endpoint = resolveTrunkEndpointName(trunk);
    if (endpoint) {
        return `PJSIP/${target}@${endpoint}`;
    }
    return `PJSIP/${target}`;
}
```

- [ ] **Step 2: Resolve the prefix in getCampaignExecutionContext**

Find `function getCampaignExecutionContext(campaign)` (around line 159). Replace its return block. Find:

```js
return {
    settings,
    trunk,
    trunkId,
    ivrId: campaign.ivr_id || null,
    ivrExtension,
    callerId: campaign.caller_id || settings.caller_id || trunk.caller_id || '1000',
    maxConcurrent: campaign.max_concurrent_calls || settings.max_concurrent_calls || 5,
    maxAttempts,
    runSettings
};
```

Replace with:

```js
return {
    settings,
    trunk,
    trunkId,
    ivrId: campaign.ivr_id || null,
    ivrExtension,
    callerId: campaign.caller_id || settings.caller_id || trunk.caller_id || '1000',
    dialPrefix: resolveDialPrefix({ campaign, trunk }),
    maxConcurrent: campaign.max_concurrent_calls || settings.max_concurrent_calls || 5,
    maxAttempts,
    runSettings
};
```

- [ ] **Step 3: Pass dialPrefix into processCampaignContacts**

Find the call site (around line 341):

```js
processCampaignContacts(campaign.id, runId, {
    trunk: execution.trunk,
    ivrId: execution.ivrId,
    ivrExtension: execution.ivrExtension,
    callerId: execution.callerId,
    maxConcurrent: execution.maxConcurrent,
    maxAttempts: execution.maxAttempts,
    contactScope: 'run'
});
```

Replace with:

```js
processCampaignContacts(campaign.id, runId, {
    trunk: execution.trunk,
    ivrId: execution.ivrId,
    ivrExtension: execution.ivrExtension,
    callerId: execution.callerId,
    dialPrefix: execution.dialPrefix,
    maxConcurrent: execution.maxConcurrent,
    maxAttempts: execution.maxAttempts,
    contactScope: 'run'
});
```

- [ ] **Step 4: Use dialPrefix in processCampaignContacts**

Find `async function processCampaignContacts(campaignId, runId, options)` (around line 1293). Replace:

```js
const { trunk, ivrId, ivrExtension, callerId, maxConcurrent, maxAttempts, contactScope = 'campaign' } = options;
```

with:

```js
const { trunk, ivrId, ivrExtension, callerId, dialPrefix = '', maxConcurrent, maxAttempts, contactScope = 'campaign' } = options;
```

Then find (around line 1362):

```js
const dialString = buildPjsipChannel(trunk, contact.phone_number);
```

Replace with:

```js
const dialString = buildPjsipChannel(trunk, contact.phone_number, dialPrefix);
```

- [ ] **Step 5: Restart and verify a real campaign call uses the prefix**

Restart: `docker compose restart platform-api`

Run a campaign instance against the trunk you set `dial_prefix=9` on. Watch logs:

```bash
docker compose logs -f platform-api | grep -i "Calling"
```

Expected log line shape: `[Campaign <id>] Calling 0123456 via PJSIP/90123456@<endpoint> -> ext <extension>` — note the prefix `9` in the PJSIP target while `phone_number` stays raw. If the campaign's `dial_prefix` was cleared to NULL, the PJSIP target should be `PJSIP/0123456@...` (no prefix) — confirming the snapshot semantics.

- [ ] **Step 6: Commit**

```bash
git add platform-api/src/routes/campaigns.js
git commit -m "Apply dial_prefix at AMI originate site in campaigns route"
```

---

## Task 6: Apply prefix at dial-time in outboundDialer.js (ARI path)

**Files:**
- Modify: `platform-api/src/services/outboundDialer.js`

- [ ] **Step 1: Import helper and extend buildPjsipDialString**

In `platform-api/src/services/outboundDialer.js`, near the top (after the `uuid` require, around line 10), add:

```js
const { resolveDialPrefix, applyDialPrefix } = require('./dialPrefix');
```

Then find `function buildPjsipDialString(trunk, phoneNumber)` (around line 34). Replace the whole function with:

```js
function buildPjsipDialString(trunk, phoneNumber, dialPrefix = '') {
    const target = applyDialPrefix(dialPrefix, phoneNumber);
    const endpoint = resolveTrunkEndpointName(trunk);
    if (endpoint) {
        return `PJSIP/${target}@${endpoint}`;
    }
    return `PJSIP/${target}`;
}
```

- [ ] **Step 2: Load campaign in originateCall and resolve prefix**

Find `async originateCall(options)` (around line 384). Replace the destructuring + dial-string lines:

```js
async originateCall(options) {
    const { campaignId, contactId, phoneNumber, trunk, ivrId, callerId, variables, attempt, maxAttempts } = options;

    const callId = uuidv4();
    
    // Build dial string
    const dialString = buildPjsipDialString(trunk, phoneNumber);
    
    console.log(`[Dialer] Originating call: ${dialString}`);
```

Replace with:

```js
async originateCall(options) {
    const { campaignId, contactId, phoneNumber, trunk, ivrId, callerId, variables, attempt, maxAttempts } = options;

    const callId = uuidv4();

    // Resolve the dial prefix. Campaign (when present) is authoritative;
    // trunk is the fallback for single-call API / webhook paths.
    const campaign = campaignId
        ? db.prepare('SELECT dial_prefix FROM campaigns WHERE id = ?').get(campaignId)
        : null;
    const dialPrefix = resolveDialPrefix({ campaign, trunk });

    // Build dial string
    const dialString = buildPjsipDialString(trunk, phoneNumber, dialPrefix);

    console.log(`[Dialer] Originating call: ${dialString}`);
```

(`processCampaign` already does its own prefix-irrelevant work and routes through `originateCall`, so no further plumbing in this service.)

- [ ] **Step 3: Restart and trigger a single-call API request**

```bash
docker compose restart platform-api
```

Trigger a single call via `POST /api/triggers/call` (existing endpoint in `triggers.js`). Use a trunk that has `dial_prefix=9`. Watch ARI dialer logs:

```bash
docker compose logs -f platform-api | grep "\[Dialer\] Originating"
```

Expected: `[Dialer] Originating call: PJSIP/90123...@<endpoint>` — prefix applied because `campaign=null` and trunk has the prefix.

- [ ] **Step 4: Commit**

```bash
git add platform-api/src/services/outboundDialer.js
git commit -m "Apply dial_prefix in ARI outbound dialer service"
```

---

## Task 7: Apply prefix at dial-time in triggers.js

**Files:**
- Modify: `platform-api/src/routes/triggers.js`

This file has two dial sites: a single-call trigger (no campaign in scope) and a legacy campaign-run path that does have a campaign.

- [ ] **Step 1: Import helper and extend the local buildPjsipChannel**

In `platform-api/src/routes/triggers.js`, near the top imports, add:

```js
const { resolveDialPrefix, applyDialPrefix } = require('../services/dialPrefix');
```

Find `function buildPjsipChannel(trunk, phoneNumber)` (around line 37). Replace the whole function with:

```js
function buildPjsipChannel(trunk, phoneNumber, dialPrefix = '') {
    const target = applyDialPrefix(dialPrefix, phoneNumber);
    // Reuse local resolveTrunkEndpointName if defined; otherwise inline like before.
    const settings = trunk?.settings ? (typeof trunk.settings === 'object' ? trunk.settings : (() => { try { return JSON.parse(trunk.settings); } catch { return {}; } })()) : {};
    const endpoint = settings.endpoint || settings.endpoint_name || settings.asterisk_endpoint
        || (String(trunk?.name || '').toLowerCase().includes('ipoffice') ? 'ipoffice' : null)
        || (String(trunk?.name || '').toLowerCase().includes('ip office') ? 'ipoffice' : null);
    if (endpoint) {
        return `PJSIP/${target}@${endpoint}`;
    }
    return `PJSIP/${target}`;
}
```

(Verify the existing implementation matches this endpoint-resolution shape before replacing — if `triggers.js` already has its own `resolveTrunkEndpointName` helper, keep using that one and only change the `target` line.)

- [ ] **Step 2: Apply prefix at the single-call trigger site (no campaign)**

Find the dial line at around line 162:

```js
const channel = buildPjsipChannel(trunk, phone_number);
```

Replace with:

```js
const dialPrefix = resolveDialPrefix({ campaign: null, trunk });
const channel = buildPjsipChannel(trunk, phone_number, dialPrefix);
```

- [ ] **Step 3: Apply prefix at the legacy campaign-run site (campaign in scope)**

Find the second dial line at around line 288:

```js
const dialString = buildPjsipChannel(trunk, contact.phone_number);
```

Look upward in the same function to confirm a `campaign` variable is loaded. If it is, replace with:

```js
const dialPrefix = resolveDialPrefix({ campaign, trunk });
const dialString = buildPjsipChannel(trunk, contact.phone_number, dialPrefix);
```

If no `campaign` object is in scope (the function may only have `campaignId`), load it once just before the call:

```js
const campaign = db.prepare('SELECT dial_prefix FROM campaigns WHERE id = ?').get(campaignId);
const dialPrefix = resolveDialPrefix({ campaign, trunk });
const dialString = buildPjsipChannel(trunk, contact.phone_number, dialPrefix);
```

(Read the surrounding 30 lines before editing to confirm which case applies.)

- [ ] **Step 4: Restart and verify**

```bash
docker compose restart platform-api
```

Trigger a single call via `POST /api/triggers/call` against a trunk with prefix `9`. Watch logs:

```bash
docker compose logs -f platform-api | grep -i originating
```

Expected: log shows the prefixed dial string `PJSIP/90123...`.

- [ ] **Step 5: Commit**

```bash
git add platform-api/src/routes/triggers.js
git commit -m "Apply dial_prefix in trigger routes"
```

---

## Task 8: i18n strings

**Files:**
- Modify: `admin-portal-v2/src/contexts/I18nContext.jsx`

Add new keys for both `ar` and `en`. The existing structure has top-level keys like `common`, `layout`, `instanceWizard`, etc.

- [ ] **Step 1: Add Arabic strings**

In `admin-portal-v2/src/contexts/I18nContext.jsx`, find the `instanceWizard` block in the `ar` section (around line 218). Inside that object, before the closing `}`, append:

```js
      dialPrefixBanner: 'سيتم الاتصال بالأرقام مع البادئة {{prefix}}. مثال: {{example}} → {{prefixed}}.',
      dialPrefixBannerHint: 'لتغيير البادئة عدّل الحملة.',
```

Then locate (or add) `campaignEdit` and `trunks` blocks in the `ar` section. If `campaignEdit` already exists, add inside it:

```js
      dialPrefix: 'بادئة الاتصال',
      dialPrefixHelp: 'اختياري. يضاف قبل كل رقم في هذه الحملة. اتركه فارغاً لعدم استخدام بادئة. تُنسخ من بادئة الترانك عند إنشاء الحملة.',
```

If a `trunks` block exists in `ar`, add inside it:

```js
      dialPrefix: 'بادئة الاتصال',
      dialPrefixHelp: 'أرقام تضاف قبل كل رقم خارجي على هذا الترانك (مثل 9). اتركها فارغة لعدم استخدام بادئة.',
      dialPrefixColumn: 'البادئة',
```

If `trunks` does not exist as a top-level block, add it just before the closing `}` of the `ar` object:

```js
    trunks: {
      dialPrefix: 'بادئة الاتصال',
      dialPrefixHelp: 'أرقام تضاف قبل كل رقم خارجي على هذا الترانك (مثل 9). اتركها فارغة لعدم استخدام بادئة.',
      dialPrefixColumn: 'البادئة'
    },
```

- [ ] **Step 2: Add English strings**

In the `en` section, find the `instanceWizard` block (around line 477). Append inside it:

```js
      dialPrefixBanner: 'Numbers will be dialed with prefix {{prefix}}. Example: {{example}} → {{prefixed}}.',
      dialPrefixBannerHint: 'Edit the campaign to change.',
```

In the `en.campaignEdit` block, append:

```js
      dialPrefix: 'Dial Prefix',
      dialPrefixHelp: 'Optional. Prepended to every number in this campaign. Leave empty for no prefix. Defaults to the trunk\'s prefix when the campaign is created.',
```

In the `en.trunks` block (or create if missing — see Step 1 pattern):

```js
      dialPrefix: 'Dial Prefix',
      dialPrefixHelp: 'Digits prepended to every outbound number on this trunk (e.g., 9). Leave empty for none.',
      dialPrefixColumn: 'Prefix',
```

Verify both `ar` and `en` blocks contain matching keys after editing.

- [ ] **Step 3: Commit**

```bash
git add admin-portal-v2/src/contexts/I18nContext.jsx
git commit -m "Add i18n strings for dial prefix UI"
```

---

## Task 9: Trunks page UI — form input and list indicator

**Files:**
- Modify: `admin-portal-v2/src/pages/Trunks.jsx`

- [ ] **Step 1: Add dial_prefix to form state**

Find the form-state initializer (around line 163):

```js
name: trunk?.name || '',
host: trunk?.host || '',
```

In the same object, after the `caller_id` line, add:

```js
dial_prefix: trunk?.dial_prefix || '',
```

- [ ] **Step 2: Add the input below caller_id**

Find the caller_id input (around line 290-292):

```js
<input
  value={form.caller_id}
  onChange={(e) => setForm({ ...form, caller_id: e.target.value })}
  ...
/>
```

Locate the surrounding `<div>` (the caller_id labelled block) and add a new labelled block immediately after it:

```jsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">{t('trunks.dialPrefix')}</label>
  <input
    type="text"
    pattern="[0-9*#]{0,15}"
    maxLength={15}
    value={form.dial_prefix}
    onChange={(e) => setForm({ ...form, dial_prefix: e.target.value })}
    placeholder="9"
    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
  />
  <p className="mt-1 text-xs text-gray-500">{t('trunks.dialPrefixHelp')}</p>
</div>
```

If the file does not yet pull `t` from `useI18n`, import it. At the top of the file:

```jsx
import { useI18n } from '../contexts/I18nContext'
```

And inside the component:

```jsx
const { t } = useI18n()
```

Use plain string literals "Dial Prefix" and the help text if `useI18n` integration is too disruptive — but the i18n block from Task 8 is expected to land, so prefer `t(...)`.

- [ ] **Step 3: Send dial_prefix in the submit body**

Locate the submit handler (search for `fetch(` or the mutation body). Wherever the body object is built from `form`, ensure the body includes:

```js
dial_prefix: form.dial_prefix.trim() || null,
```

If the existing handler already spreads `form` into the body, no change is needed beyond Step 1/2 — `dial_prefix: ''` will be normalized to NULL by the API.

- [ ] **Step 4: Show a prefix indicator in the trunks list**

Find the list row that renders host info (around line 95-103, where `{trunk.name}` and `{trunk.host}` appear). After the host line block, add a small chip:

```jsx
{trunk.dial_prefix && (
  <span className="ml-2 inline-flex items-center rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
    {t('trunks.dialPrefixColumn')}: {trunk.dial_prefix}
  </span>
)}
```

- [ ] **Step 5: Verify in the dev environment**

```bash
docker compose restart admin-portal-v2
```

Open `http://localhost:8082/trunks`. Edit a trunk, set Dial Prefix to `9`, save. Reload the page.

Expected:
- Input retains the value after reload (round-trip works).
- The list shows a `Prefix: 9` chip on that trunk.
- Try `9abc` and submit — the API returns 400 and the UI surfaces the error (existing error-display path).

- [ ] **Step 6: Commit**

```bash
git add admin-portal-v2/src/pages/Trunks.jsx
git commit -m "Add Dial Prefix field and list indicator to Trunks page"
```

---

## Task 10: Campaign edit UI — input with trunk-change autofill

**Files:**
- Modify: `admin-portal-v2/src/pages/CampaignEdit.jsx`

- [ ] **Step 1: Add dial_prefix to form state**

Find the `formData` initializer block (around line 50-55) which already has `trunk_id`, `caller_id`. Add:

```js
dial_prefix: '',
```

Find the `useEffect` that populates form state from `campaign` (around line 95-100). Add:

```js
dial_prefix: campaign.dial_prefix || '',
```

- [ ] **Step 2: Add the Dial Prefix input next to Caller ID**

Find the Caller ID labelled block (around line 240-242):

```jsx
<label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.callerId')}</label>
<input value={formData.caller_id} onChange={(e) => setFormData({ ...formData, caller_id: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
```

Insert a sibling labelled block immediately after the wrapping `<div>` of the Caller ID block:

```jsx
<div>
  <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.dialPrefix')}</label>
  <input
    type="text"
    pattern="[0-9*#]{0,15}"
    maxLength={15}
    value={formData.dial_prefix}
    onChange={(e) => setFormData({ ...formData, dial_prefix: e.target.value })}
    disabled={!isEditable}
    placeholder="9"
    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
  />
  <p className="mt-1 text-xs text-gray-500">{t('campaignEdit.dialPrefixHelp')}</p>
</div>
```

- [ ] **Step 3: Autofill prefix when the user changes the trunk**

Replace the trunk select onChange (around line 234):

```jsx
<select value={formData.trunk_id} onChange={(e) => setFormData({ ...formData, trunk_id: e.target.value })} ...>
```

with:

```jsx
<select value={formData.trunk_id} onChange={(e) => {
  const newTrunkId = e.target.value;
  const newTrunk = trunks?.find((trunk) => trunk.id === newTrunkId);
  setFormData((prev) => ({
    ...prev,
    trunk_id: newTrunkId,
    // Only autofill the prefix when the user has not typed one.
    dial_prefix: prev.dial_prefix?.trim() ? prev.dial_prefix : (newTrunk?.dial_prefix || '')
  }));
}} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100">
```

- [ ] **Step 4: Send dial_prefix on save**

Locate the save mutation body (search for `updateCampaign` or `createCampaign`). Verify the request body includes `dial_prefix: formData.dial_prefix?.trim() || null` (or a trimmed empty string — the API normalizes empty to NULL). If the existing handler spreads `formData`, no change is needed.

- [ ] **Step 5: Verify**

```bash
docker compose restart admin-portal-v2
```

Open a campaign edit page. Confirm:
- The Dial Prefix field shows the campaign's current value (likely `9` if snapshotted from the trunk).
- Clear the field, save, reload — value persists as empty/null.
- Switch to a different trunk that has a different prefix while the field is empty → field autofills with the new trunk's prefix.
- Type a prefix manually, then change the trunk — manual value is preserved.

- [ ] **Step 6: Commit**

```bash
git add admin-portal-v2/src/pages/CampaignEdit.jsx
git commit -m "Add Dial Prefix field with trunk-change autofill on Campaign edit"
```

---

## Task 11: Instance wizard banner

**Files:**
- Modify: `admin-portal-v2/src/components/CampaignInstanceForm.jsx`

- [ ] **Step 1: Compute effective prefix and render the banner**

In `admin-portal-v2/src/components/CampaignInstanceForm.jsx`, find the existing `noTrunk` warning (around line 165) — that gives you the place where pre-contact-entry banners live.

Add, just below where the component reads `campaign` props, a small derivation. The banner must mirror what the dialer will actually do (snapshot model: campaign value is authoritative, trunk is NOT consulted at dial time when a campaign is in scope). Showing the trunk prefix here would mislead users when their campaign's prefix is NULL.

```js
// Banner mirrors actual dial behavior: campaign.dial_prefix is the sole source of truth.
// trunk_dial_prefix is intentionally NOT used here.
const effectivePrefix = campaign?.dial_prefix || ''
```

Then render the banner just above (or below) the existing `noTrunk` block:

```jsx
{effectivePrefix && (
  <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
    {t('instanceWizard.dialPrefixBanner', {
      prefix: effectivePrefix,
      example: '01234567',
      prefixed: `${effectivePrefix}01234567`
    })}{' '}
    <span className="text-blue-700/80">{t('instanceWizard.dialPrefixBannerHint')}</span>
  </div>
)}
```

(Confirm the project's `t()` supports placeholder substitution via the `{{name}}` pattern — the existing `activeInstance` key already uses `{{number}}` and `{{status}}`, so the substitution mechanism is in place.)

- [ ] **Step 2: Verify**

```bash
docker compose restart admin-portal-v2
```

Open the campaign instance wizard for a campaign whose `dial_prefix` is `9`. Expected: a blue info banner reading `Numbers will be dialed with prefix 9. Example: 01234567 → 901234567. Edit the campaign to change.`

For a campaign whose `dial_prefix` is null AND whose `trunk_dial_prefix` is also null: no banner appears.

- [ ] **Step 3: Commit**

```bash
git add admin-portal-v2/src/components/CampaignInstanceForm.jsx
git commit -m "Show effective dial-prefix banner in campaign instance wizard"
```

---

## Task 12: Manual end-to-end verification

This is a verification-only task — no code changes. Use it to confirm the feature behaves correctly across all paths before declaring done.

- [ ] **Step 1: Migration safety**

```bash
docker exec platform-api node src/db/migrate.js
```

Expected: idempotent — re-running prints no `Added ...` lines for `dial_prefix` after the first run. Existing trunks/campaigns still load with `dial_prefix=null` and dialing keeps working without a prefix.

- [ ] **Step 2: Snapshot semantics on campaign create**

Set trunk prefix to `9` via UI. Create a new campaign on that trunk via UI without touching the prefix field. Inspect:

```bash
docker exec platform-api node -e "console.log(require('./src/db').prepare('SELECT name, dial_prefix FROM campaigns ORDER BY created_at DESC LIMIT 1').get())"
```

Expected: `{ name: '<your campaign>', dial_prefix: '9' }`.

- [ ] **Step 3: Empty-on-campaign means no prefix**

Edit the campaign, blank the Dial Prefix field, save. Confirm DB:

```bash
docker exec platform-api node -e "console.log(require('./src/db').prepare('SELECT name, dial_prefix FROM campaigns ORDER BY updated_at DESC LIMIT 1').get())"
```

Expected: `{ name: '<your campaign>', dial_prefix: null }`. Open the instance wizard for this campaign — the prefix banner should NOT appear.

- [ ] **Step 4: Campaign run uses snapshotted prefix, not trunk re-read**

With the trunk still set to `9` and the campaign's prefix still NULL, run an instance. Watch:

```bash
docker compose logs -f platform-api | grep -i "calling\|originating"
```

Expected: `PJSIP/<raw-number>@<endpoint>` with NO `9` prepended — confirming the snapshot model wins over the trunk default.

- [ ] **Step 5: Single-call API uses trunk prefix**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"trunk_id":"<trunk-id-with-prefix-9>","phone_number":"01234567","ivr_id":"<ivr-id>"}' \
  http://localhost:3001/api/triggers/call
```

Watch logs — expected: `PJSIP/901234567@<endpoint>`.

- [ ] **Step 6: Validation rejects junk prefixes**

```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dial_prefix":"9abc"}' \
  http://localhost:3001/api/trunks/<trunk-id>
```

Expected: `400 Bad Request`.

- [ ] **Step 7: Raw number storage unchanged**

```bash
docker exec platform-api node -e "console.log(require('./src/db').prepare('SELECT phone_number FROM outbound_calls ORDER BY created_at DESC LIMIT 5').all())"
```

Expected: every `phone_number` is the raw form (no prefix applied to stored data — only to the dial string).

- [ ] **Step 8: Final commit (only if any docs need updating)**

If you noticed anything during verification that needs a doc note, fix it now and commit. Otherwise this task is verification-only.

---

## Done

All 12 tasks complete = feature ready. Recommend running through Task 12 once more with a real Excel-imported instance before declaring shippable.
