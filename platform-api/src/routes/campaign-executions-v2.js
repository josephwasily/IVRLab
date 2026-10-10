// v2 external campaign API — mounted at /api/v2/campaigns.
//
// Same behaviour as the v1 webhook API (/api/webhooks/...), which stays
// unchanged for existing integrations, but region-neutral paths: the campaign
// is chosen by campaign_type (+ region) rather than by an id in the URL.
//
//   POST /api/v2/campaigns/executions                  trigger an execution (= run)
//   GET  /api/v2/campaigns/executions                  list executions
//   GET  /api/v2/campaigns/executions/:execution_id    execution status + results
//
// Auth: X-API-Key of any campaign in the tenant (same as v1 GET /runs);
// everything is scoped to that tenant.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { startCampaignInstance } = require('./campaigns');
const { webhookAuthAnyTenantCampaign } = require('./webhooks');
const { buildRunSummary, buildRunContactResults } = require('../services/campaign-run-results');
const { normalizeKey, normalizeRegion, resolveCampaign } = require('../services/campaign-lookup');

function toExecution(run, campaign) {
    const { run_id, ...summary } = buildRunSummary(run);
    return {
        execution_id:  run_id,
        campaign_type: campaign.api_campaign_type || null,
        region:        campaign.region || null,
        campaign_id:   campaign.id,
        campaign_name: campaign.name,
        ...summary
    };
}

// POST /api/v2/campaigns/executions[?region=assiut]
//
// Body:
//   {
//     "campaign_type": "complaint_resolution",   // required
//     "region":        "assiut",                 // optional (or ?region=); required
//                                                //   only if the type exists in several regions
//     "survey_id":     "...",                    // optional
//     "contacts": [ { "phone_number": "...", "cms_id": "...", "name": "...", "variables": {} } ]
//   }
router.post('/executions', webhookAuthAnyTenantCampaign, (req, res) => {
    try {
        const body = req.body || {};
        const campaignType = normalizeKey(body.campaign_type);
        const region = normalizeRegion(body.region ?? req.query.region);
        const { contacts, survey_id } = body;

        if (!campaignType) {
            return res.status(400).json({ error: 'campaign_type is required' });
        }
        if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({ error: 'contacts array is required and must not be empty' });
        }
        const invalidContacts = contacts.filter(c => !c || !c.phone_number || !String(c.phone_number).trim());
        if (invalidContacts.length > 0) {
            return res.status(400).json({
                error: 'Some contacts are missing phone_number',
                invalid_count: invalidContacts.length
            });
        }

        const lookup = resolveCampaign(req.tenantId, campaignType, region);
        if (!lookup.campaign) {
            const { status, ...details } = lookup;
            return res.status(status).json(details);
        }
        const campaign = lookup.campaign;

        const result = startCampaignInstance({
            campaign,
            contacts,
            startedBy: null,
            survey_id: survey_id || null
        });

        const run = db.prepare('SELECT * FROM campaign_runs WHERE id = ?').get(result.runId);

        res.status(201).json({
            success: true,
            ...toExecution(run, campaign),
            total_contacts: result.imported,
            duplicates:     result.duplicates,
            skipped:        result.skipped
        });
    } catch (error) {
        console.error('v2 execution trigger error:', error);
        const status = error.message.includes('already has an active run') ? 409 : 500;
        res.status(status).json({ error: error.message || 'Failed to trigger campaign execution' });
    }
});

// GET /api/v2/campaigns/executions
//   ?campaign_type=...&region=...&survey_id=...&status=running|completed|...
//   &limit=50&offset=0
router.get('/executions', webhookAuthAnyTenantCampaign, (req, res) => {
    try {
        const campaignType = normalizeKey(req.query.campaign_type);
        const region = normalizeRegion(req.query.region);
        const surveyId = req.query.survey_id ? String(req.query.survey_id).trim() : null;
        const status = req.query.status ? String(req.query.status).trim() : null;

        const limitRaw = parseInt(req.query.limit, 10);
        const offsetRaw = parseInt(req.query.offset, 10);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50;
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

        const where = ['c.tenant_id = ?'];
        const params = [req.tenantId];
        if (campaignType) { where.push('c.api_campaign_type = ?'); params.push(campaignType); }
        if (region)       { where.push('c.region = ?');            params.push(region); }
        if (surveyId)     { where.push('cr.survey_id = ?');        params.push(surveyId); }
        if (status)       { where.push('cr.status = ?');           params.push(status); }
        const whereSql = where.join(' AND ');

        const countRow = db.prepare(`
            SELECT COUNT(*) AS n
            FROM campaign_runs cr
            JOIN campaigns c ON c.id = cr.campaign_id
            WHERE ${whereSql}
        `).get(...params);

        const rows = db.prepare(`
            SELECT cr.*, c.id AS c_id, c.name AS c_name,
                   c.api_campaign_type AS c_api_campaign_type, c.region AS c_region
            FROM campaign_runs cr
            JOIN campaigns c ON c.id = cr.campaign_id
            WHERE ${whereSql}
            ORDER BY cr.started_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        res.json({
            total: countRow.n,
            limit,
            offset,
            filters: { campaign_type: campaignType, region, survey_id: surveyId, status },
            executions: rows.map(r => toExecution(r, {
                id: r.c_id,
                name: r.c_name,
                api_campaign_type: r.c_api_campaign_type,
                region: r.c_region
            }))
        });
    } catch (error) {
        console.error('v2 execution list error:', error);
        res.status(500).json({ error: 'Failed to list campaign executions' });
    }
});

// GET /api/v2/campaigns/executions/:execution_id
//
// Response: { "execution": { execution_id, campaign_type, region, status, counts, dates, ... },
//             "results":   [ per-contact results, same shape as v1 ] }
router.get('/executions/:execution_id', webhookAuthAnyTenantCampaign, (req, res) => {
    try {
        const run = db.prepare(`
            SELECT cr.*
            FROM campaign_runs cr
            JOIN campaigns c ON c.id = cr.campaign_id
            WHERE cr.id = ? AND c.tenant_id = ?
        `).get(req.params.execution_id, req.tenantId);

        if (!run) {
            return res.status(404).json({ error: 'Campaign execution not found' });
        }

        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(run.campaign_id);

        res.json({
            execution: toExecution(run, campaign),
            results:   buildRunContactResults(campaign, run)
        });
    } catch (error) {
        console.error('v2 execution status error:', error);
        res.status(500).json({ error: 'Failed to retrieve campaign execution' });
    }
});

module.exports = router;
