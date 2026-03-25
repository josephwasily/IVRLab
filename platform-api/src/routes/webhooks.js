const express = require('express');
const router = express.Router();
const db = require('../db');
const { startCampaignInstance } = require('./campaigns');

function parseJsonSafe(value, fallback = {}) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_e) { return fallback; }
}

// Webhook API key authentication middleware
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

// POST /api/webhooks/campaigns/:campaignId/trigger
// Trigger a new campaign run with provided contacts
router.post('/:campaignId/trigger', webhookAuth, (req, res) => {
    try {
        const campaign = req.campaign;

        const { contacts } = req.body;
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
            startedBy: null // webhook-triggered, no user
        });

        res.status(201).json({
            success: true,
            run_id: result.runId,
            run_number: result.runNumber,
            total_contacts: result.imported,
            duplicates: result.duplicates,
            skipped: result.skipped
        });
    } catch (error) {
        console.error('Webhook trigger error:', error);
        const status = error.message.includes('already has an active run') ? 409 : 500;
        res.status(status).json({ error: error.message || 'Failed to trigger campaign' });
    }
});

// GET /api/webhooks/campaigns/:campaignId/runs/:runId/results
// Get call results for a campaign run
router.get('/:campaignId/runs/:runId/results', webhookAuth, (req, res) => {
    try {
        const campaign = req.campaign;
        const { runId } = req.params;

        const run = db.prepare(
            'SELECT * FROM campaign_runs WHERE id = ? AND campaign_id = ?'
        ).get(runId, campaign.id);

        if (!run) {
            return res.status(404).json({ error: 'Campaign run not found' });
        }

        // Get all contacts for this run
        const contacts = db.prepare(`
            SELECT * FROM campaign_contacts
            WHERE campaign_id = ? AND run_id = ?
            ORDER BY id
        `).all(campaign.id, runId);

        // Get the latest outbound call for each contact (for dtmf_inputs, duration, call status)
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

            // Compute flag: check the variable in the contact result or call result
            let flag = null;
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
                name: contactVars.name || null,
                flag,
                status: contact.status,
                call_status: call?.status || null,
                attempts: contact.attempts || (call?.attempt_number || 0),
                max_attempts: maxAttempts,
                variables: contactResult,
                dtmf_inputs: dtmfInputs,
                duration: call?.duration || null,
                last_attempt_at: contact.last_attempt_at || null
            };
        });

        // Run-level summary
        const summary = {
            run_id: run.id,
            run_number: run.run_number,
            status: run.status,
            total_contacts: run.total_contacts,
            contacts_completed: run.contacts_completed,
            contacts_failed: run.contacts_failed,
            contacts_answered: run.contacts_answered,
            contacts_no_answer: run.contacts_no_answer,
            contacts_busy: run.contacts_busy,
            started_at: run.started_at,
            completed_at: run.completed_at
        };

        res.json({
            summary,
            results
        });
    } catch (error) {
        console.error('Webhook results error:', error);
        res.status(500).json({ error: 'Failed to retrieve campaign results' });
    }
});

module.exports = router;
