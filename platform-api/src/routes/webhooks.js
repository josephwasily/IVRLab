const express = require('express');
const router = express.Router();
const db = require('../db');
const { startCampaignInstance } = require('./campaigns');

function parseJsonSafe(value, fallback = {}) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_e) { return fallback; }
}

// --- Auth ----------------------------------------------------------------

// Per-campaign auth — used by trigger + results endpoints scoped to a single campaign.
function webhookAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required. Pass it in the X-API-Key header.' });
    }

    const campaign = db.prepare(
        'SELECT * FROM campaigns WHERE id = ? AND webhook_api_key = ?'
    ).get(req.params.campaignId, apiKey);

    if (!campaign) {
        return res.status(401).json({ error: 'Invalid API key or campaign not found' });
    }

    req.campaign = campaign;
    next();
}

// Tenant-scoped auth — used by the cross-campaign /runs query endpoint.
// Caller passes any campaign's X-API-Key; we look it up to resolve the tenant,
// then scope results to that tenant. This lets a CMS query across all the
// campaigns it owns without needing JWT login.
function webhookAuthAnyTenantCampaign(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required. Pass it in the X-API-Key header.' });
    }

    const campaign = db.prepare(
        'SELECT id, tenant_id FROM campaigns WHERE webhook_api_key = ?'
    ).get(apiKey);

    if (!campaign) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    req.tenantId = campaign.tenant_id;
    next();
}

// --- Trigger -------------------------------------------------------------

// POST /api/webhooks/campaigns/:campaignId/trigger
// Trigger a new campaign run with provided contacts.
//
// Body:
//   {
//     "survey_id":  "...",     // optional, per-run external survey identifier
//     "contacts": [
//       {
//         "phone_number": "+201...",  // required
//         "cms_id":       "case-1",    // optional, per-contact external identifier
//         "name":         "...",       // optional
//         "variables":    { ... }       // optional, passed to the IVR flow
//       },
//       ...
//     ]
//   }
router.post('/campaigns/:campaignId/trigger', webhookAuth, (req, res) => {
    try {
        const campaign = req.campaign;

        const { contacts, survey_id, cms_id } = req.body;
        // cms_id at body level is the legacy per-run field. New integrations
        // send cms_id PER CONTACT and use survey_id at the run level.
        // We still accept the legacy top-level cms_id for backwards compat.

        if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({ error: 'contacts array is required and must not be empty' });
        }

        const invalidContacts = contacts.filter(c => !c.phone_number || !String(c.phone_number).trim());
        if (invalidContacts.length > 0) {
            return res.status(400).json({
                error: 'Some contacts are missing phone_number',
                invalid_count: invalidContacts.length
            });
        }

        const result = startCampaignInstance({
            campaign,
            contacts,
            startedBy: null,                 // webhook-triggered, no user
            cms_id:    cms_id    || null,    // legacy per-run field; rarely needed now
            survey_id: survey_id || null
        });

        res.status(201).json({
            success: true,
            run_id:        result.runId,
            run_number:    result.runNumber,
            survey_id:     survey_id || null,
            total_contacts: result.imported,
            duplicates:    result.duplicates,
            skipped:       result.skipped
        });
    } catch (error) {
        console.error('Webhook trigger error:', error);
        const status = error.message.includes('already has an active run') ? 409 : 500;
        res.status(status).json({ error: error.message || 'Failed to trigger campaign' });
    }
});

// --- Per-run results -----------------------------------------------------

// GET /api/webhooks/campaigns/:campaignId/runs/:runId/results
//
// Response:
//   {
//     "summary": { run_id, run_number, survey_id, cms_id, status, contact counts, dates },
//     "results": [ { phone_number, cms_id, name, flag, status, call_status, ... }, ... ]
//   }
router.get('/campaigns/:campaignId/runs/:runId/results', webhookAuth, (req, res) => {
    try {
        const campaign = req.campaign;
        const { runId } = req.params;

        const run = db.prepare(
            'SELECT * FROM campaign_runs WHERE id = ? AND campaign_id = ?'
        ).get(runId, campaign.id);

        if (!run) {
            return res.status(404).json({ error: 'Campaign run not found' });
        }

        const contacts = db.prepare(`
            SELECT * FROM campaign_contacts
            WHERE campaign_id = ? AND run_id = ?
            ORDER BY id
        `).all(campaign.id, runId);

        const outboundCalls = db.prepare(`
            SELECT oc.*
            FROM outbound_calls oc
            INNER JOIN (
                SELECT contact_id, MAX(created_at) as max_created
                FROM outbound_calls
                WHERE run_id = ?
                GROUP BY contact_id
            ) latest ON oc.contact_id = latest.contact_id AND oc.created_at = latest.max_created
            WHERE oc.run_id = ?
        `).all(runId, runId);

        const callsByContact = {};
        for (const call of outboundCalls) {
            callsByContact[call.contact_id] = call;
        }

        const flagVariable = campaign.flag_variable || null;
        const flagValue = campaign.flag_value || null;
        const maxAttempts = campaign.max_attempts || 3;

        const results = contacts.map(contact => {
            const contactResult = parseJsonSafe(contact.result, {});
            const contactVars = parseJsonSafe(contact.variables, {});
            const call = callsByContact[contact.id];
            const callResult = call ? parseJsonSafe(call.result, {}) : {};
            const dtmfInputs = call ? parseJsonSafe(call.dtmf_inputs, []) : [];

            let flag = false;
            if (flagVariable && flagValue !== null) {
                const varValue = contactResult[flagVariable]
                    ?? contactResult[`${flagVariable}_raw`]
                    ?? callResult[flagVariable]
                    ?? callResult[`${flagVariable}_raw`]
                    ?? null;
                flag = varValue !== null ? String(varValue) === String(flagValue) : false;
            }

            return {
                phone_number: contact.phone_number,
                cms_id:       contact.cms_id || null,
                name:         contactVars.name || null,
                flag,
                status:       contact.status,
                call_status:  call?.status || null,
                attempts:     contact.attempts || (call?.attempt_number || 0),
                max_attempts: maxAttempts,
                variables:    contactResult,
                dtmf_inputs:  dtmfInputs,
                duration:     call?.duration || null,
                last_attempt_at: contact.last_attempt_at || null
            };
        });

        const summary = {
            run_id:             run.id,
            run_number:         run.run_number,
            survey_id:          run.survey_id || null,
            cms_id:             run.cms_id || null,    // legacy field; null on new runs
            status:             run.status,
            total_contacts:     run.total_contacts,
            contacts_completed: run.contacts_completed,
            contacts_failed:    run.contacts_failed,
            contacts_answered:  run.contacts_answered,
            contacts_no_answer: run.contacts_no_answer,
            contacts_busy:      run.contacts_busy,
            started_at:         run.started_at,
            completed_at:       run.completed_at
        };

        res.json({ summary, results });
    } catch (error) {
        console.error('Webhook results error:', error);
        res.status(500).json({ error: 'Failed to retrieve campaign results' });
    }
});

// --- Cross-campaign runs query -------------------------------------------

// GET /api/webhooks/runs
//   ?survey_id=...
//   &campaign_ids=A,B,C   (comma-separated)
//   &status=running|completed|...   (optional)
//   &limit=50&offset=0
//
// Auth: X-API-Key matching ANY campaign in the tenant. The result set is
// scoped to that tenant's campaigns only.
//
// Response:
//   {
//     "total":  <number of matching runs>,
//     "limit":  <effective limit>,
//     "offset": <effective offset>,
//     "runs":   [ { run summary, including campaign_id + name }, ... ]
//   }
router.get('/runs', webhookAuthAnyTenantCampaign, (req, res) => {
    try {
        const tenantId = req.tenantId;

        const surveyId = req.query.survey_id ? String(req.query.survey_id).trim() : null;
        const status   = req.query.status    ? String(req.query.status).trim()    : null;
        const campaignIdsRaw = req.query.campaign_ids ? String(req.query.campaign_ids) : '';
        const campaignIds = campaignIdsRaw
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        const limitRaw = parseInt(req.query.limit, 10);
        const offsetRaw = parseInt(req.query.offset, 10);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(limitRaw, 500)
            : 50;
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0
            ? offsetRaw
            : 0;

        // Build dynamic WHERE
        const where = ['c.tenant_id = ?'];
        const params = [tenantId];

        if (surveyId) {
            where.push('cr.survey_id = ?');
            params.push(surveyId);
        }
        if (campaignIds.length > 0) {
            where.push(`cr.campaign_id IN (${campaignIds.map(() => '?').join(',')})`);
            params.push(...campaignIds);
        }
        if (status) {
            where.push('cr.status = ?');
            params.push(status);
        }

        const whereSql = where.join(' AND ');

        const countRow = db.prepare(`
            SELECT COUNT(*) AS n
            FROM campaign_runs cr
            JOIN campaigns c ON c.id = cr.campaign_id
            WHERE ${whereSql}
        `).get(...params);

        const rows = db.prepare(`
            SELECT
                cr.id              AS run_id,
                cr.run_number,
                cr.campaign_id,
                c.name             AS campaign_name,
                cr.survey_id,
                cr.cms_id,
                cr.status,
                cr.total_contacts,
                cr.contacts_completed,
                cr.contacts_failed,
                cr.contacts_answered,
                cr.contacts_no_answer,
                cr.contacts_busy,
                cr.started_at,
                cr.completed_at
            FROM campaign_runs cr
            JOIN campaigns c ON c.id = cr.campaign_id
            WHERE ${whereSql}
            ORDER BY cr.started_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        res.json({
            total:  countRow.n,
            limit,
            offset,
            filters: {
                survey_id:    surveyId,
                campaign_ids: campaignIds,
                status
            },
            runs: rows
        });
    } catch (error) {
        console.error('Webhook runs query error:', error);
        res.status(500).json({ error: 'Failed to query campaign runs' });
    }
});

module.exports = router;
