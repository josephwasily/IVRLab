// Builds the per-run summary + per-contact results returned by the external
// APIs (webhooks + /api/v2/campaigns/executions). Shared so both versions
// report a run exactly the same way.

const db = require('../db');

function parseJsonSafe(value, fallback = {}) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_e) { return fallback; }
}

function buildRunSummary(run) {
    return {
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
}

function buildRunContactResults(campaign, run) {
    const contacts = db.prepare(`
        SELECT * FROM campaign_contacts
        WHERE campaign_id = ? AND run_id = ?
        ORDER BY id
    `).all(campaign.id, run.id);

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
    `).all(run.id, run.id);

    const callsByContact = {};
    for (const call of outboundCalls) {
        callsByContact[call.contact_id] = call;
    }

    const flagVariable = campaign.flag_variable || null;
    const flagValue = campaign.flag_value || null;
    const maxAttempts = campaign.max_attempts || 3;

    return contacts.map(contact => {
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
}

module.exports = { buildRunSummary, buildRunContactResults };
