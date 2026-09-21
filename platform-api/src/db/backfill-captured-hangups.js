/**
 * Re-classify outbound calls that were logged as an abrupt caller hangup even
 * though every question in the flow had already been answered.
 *
 * Before the engine fix, a caller who hung up the instant they pressed the
 * last digit — i.e. during the thank-you prompt, after the final capture —
 * was recorded as status='failed' / hangup_cause='caller_hangup_early', which
 * the portal shows as "Aborted After Answer". The survey answers were stored
 * all the same, so those calls are completed surveys.
 *
 * A call is only rewritten when EVERY collect node in its flow has a value in
 * the stored result JSON — deliberately stricter than the runtime rule, so a
 * partially answered call is never promoted.
 *
 * Usage inside the platform-api container:
 *   node src/db/backfill-captured-hangups.js                    # dry run
 *   node src/db/backfill-captured-hangups.js --apply
 *   node src/db/backfill-captured-hangups.js --apply --campaign <campaign_id>
 *   node src/db/backfill-captured-hangups.js --apply --since 2026-09-21
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const readArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
};
const campaignId = readArg('--campaign');
const since = readArg('--since');

const db = new Database(DB_PATH);

function parseJson(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch (_e) { return fallback; }
}

// Collect variables per flow, cached — a flow is reused across thousands of calls.
const flowCache = new Map();
function getCollectVariables(ivrId) {
    if (flowCache.has(ivrId)) return flowCache.get(ivrId);
    const row = db.prepare('SELECT flow_data FROM ivr_flows WHERE id = ?').get(ivrId);
    const flow = parseJson(row?.flow_data, null);
    const variables = Object.values(flow?.nodes || {})
        .filter(n => n && n.type === 'collect')
        .map(n => n.variable)
        .filter(Boolean);
    flowCache.set(ivrId, variables);
    return variables;
}

let where = "oc.status = 'failed' AND oc.hangup_cause = 'caller_hangup_early'";
const params = [];
if (campaignId) { where += ' AND oc.campaign_id = ?'; params.push(campaignId); }
if (since) { where += ' AND date(COALESCE(oc.dial_start_time, oc.created_at)) >= date(?)'; params.push(since); }

const calls = db.prepare(`
    SELECT oc.id, oc.campaign_id, oc.ivr_id, oc.phone_number, oc.result,
           COALESCE(oc.dial_start_time, oc.created_at) AS event_time
    FROM outbound_calls oc
    WHERE ${where}
    ORDER BY event_time
`).all(...params);

console.log('================================================================');
console.log('Backfill: abrupt-end calls that actually captured every answer');
console.log('================================================================');
console.log(`db:        ${DB_PATH}`);
console.log(`mode:      ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
console.log(`campaign:  ${campaignId || '(all)'}`);
console.log(`since:     ${since || '(all time)'}`);
console.log(`candidates: ${calls.length}`);
console.log('');

const updateCall = db.prepare(`
    UPDATE outbound_calls
    SET status = 'completed', hangup_cause = 'captured_then_hangup', result = ?
    WHERE id = ?
`);
const updateLogs = db.prepare(`
    UPDATE call_logs SET status = 'completed'
    WHERE outbound_call_id = ? AND status = 'failed'
`);

let promoted = 0, incomplete = 0, noFlow = 0;
const perCampaign = {};

const run = db.transaction(() => {
    for (const call of calls) {
        const variables = call.ivr_id ? getCollectVariables(call.ivr_id) : [];
        if (variables.length === 0) { noFlow++; continue; }

        const result = parseJson(call.result, null);
        if (!result || typeof result !== 'object') { incomplete++; continue; }

        const complete = variables.every(v => {
            const value = result[`${v}_raw`] !== undefined && result[`${v}_raw`] !== null
                ? result[`${v}_raw`]
                : result[v];
            return value !== undefined && value !== null && String(value).trim() !== '';
        });
        if (!complete) { incomplete++; continue; }

        promoted++;
        perCampaign[call.campaign_id] = (perCampaign[call.campaign_id] || 0) + 1;
        console.log(`  ✓ ${call.event_time}  ${call.phone_number}  (${variables.length} answers)`);

        if (apply) {
            result.call_outcome = 'finished';
            result.flow_final_status = 'captured_then_hangup';
            result.reclassified_by = 'backfill-captured-hangups';
            updateCall.run(JSON.stringify(result), call.id);
            updateLogs.run(call.id);
        }
    }
});

run();

console.log('');
console.log('----------------------------------------------------------------');
console.log(`re-classified as completed: ${promoted}`);
console.log(`left as aborted (answers missing): ${incomplete}`);
console.log(`skipped (flow has no collect nodes): ${noFlow}`);
for (const [id, count] of Object.entries(perCampaign)) {
    console.log(`  campaign ${id}: ${count}`);
}
if (!apply && promoted > 0) console.log('\nDry run — nothing written. Re-run with --apply.');
console.log('----------------------------------------------------------------');

db.close();
