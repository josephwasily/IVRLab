/**
 * Assuit: tell the caller what went wrong before asking again, and cap every
 * retry loop at 3 attempts.
 *
 *   1. Surveys (assuit-survey-1 ext 2040, assuit-survey-2 ext 2041):
 *        a key outside the question's range plays "اختيار خاطئ" and the
 *        question is asked again. After 3 failed attempts (wrong keys or
 *        silence) the call hangs up -- no thanks prompt, since it says the
 *        answers were received -- and is recorded as
 *        completed_capture_failed (completed, not redialled, answers missing).
 *        prompt: assuit_invalid_option → collect node `invalidPrompt`
 *        end:    collect node `onMaxAttempts` → hangup
 *   2. Billing (billing-inquiry-flow): ListBills rejecting the number
 *        (HTTP error such as 500 "رقم الحساب غير صحيح", or a reply without
 *        an account) plays
 *        "عفواً، رقم الاشتراك الذي أدخلته غير موجود، برجاء التأكد من الرقم وإعادة إدخاله."
 *        and sends the caller back to enter the number. 3 attempts in total,
 *        then goodbye.
 *        prompt: assuit_billing_account_not_found → node invalid_account
 *      The API being unreachable (timeout / connection refused) still goes to
 *      api_error ("could not retrieve"), since re-entering won't help there.
 *
 * Steps:
 *   1. Convert each recording in /app/prompts/new-sounds-11/ to 8kHz mono ulaw.
 *   2. Upsert a prompts row for each (per flow tenant).
 *   3. Patch only the affected nodes of the three flows.
 *
 * Idempotent: conversion is skipped if the ulaw is up to date, prompt rows
 * are updated in place, and re-patching the flows is a no-op.
 *
 * Usage inside platform-api container (see scripts/update-assuit-retry-prompts.sh):
 *   node src/db/update-assuit-retry-prompts.js
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';

const AUDIO_SUBDIR = 'new-sounds-11';
const MAX_ATTEMPTS = 3;
const SURVEY_FLOW_IDS = ['assuit-survey-1', 'assuit-survey-2'];
const BILLING_FLOW_ID = 'billing-inquiry-flow';

const PROMPTS = [
    {
        name: 'assuit_invalid_option',
        category: 'assuit',
        description: 'Assuit surveys: wrong choice (played before the question is asked again)'
    },
    {
        name: 'assuit_billing_account_not_found',
        category: 'billing',
        description: 'Assuit billing: subscription number not found, please check and re-enter'
    }
];

function die(msg) {
    console.error(`[assuit-retry-prompts] ${msg}`);
    process.exit(1);
}

function convertToUlaw(inputPath, outputPath) {
    try {
        execSync(`sox "${inputPath}" -r 8000 -c 1 -e u-law "${outputPath}"`, { stdio: 'pipe' });
        return true;
    } catch (_e) {
        try {
            execSync(`ffmpeg -y -i "${inputPath}" -ar 8000 -ac 1 -acodec pcm_mulaw -f mulaw "${outputPath}"`, { stdio: 'pipe' });
            return true;
        } catch (e2) {
            console.error(`  conversion failed: ${e2.message.split('\n')[0]}`);
            return false;
        }
    }
}

// Recordings arrive as mpeg/mp3/wav/etc. — match on the base name.
function findSource(dir, name) {
    if (!fs.existsSync(dir)) return null;
    const match = fs.readdirSync(dir)
        .find(f => path.parse(f).name === name && path.extname(f) !== '.ulaw');
    return match ? path.join(dir, match) : null;
}

// -------- 1. Convert audio -------------------------------------------------

const audioDir = path.join(PROMPTS_DIR, AUDIO_SUBDIR);

for (const p of PROMPTS) {
    const ulawPath = path.join(audioDir, `${p.name}.ulaw`);
    const sourcePath = findSource(audioDir, p.name);

    if (fs.existsSync(ulawPath) && !sourcePath) {
        console.log(`✓ ulaw already exists: ${ulawPath}`);
    } else if (!sourcePath) {
        die(`Recording not found: ${audioDir}/${p.name}.<mpeg|mp3|wav>. Did the wrapper script copy "new sounds 11/" into the container?`);
    } else if (fs.existsSync(ulawPath) && fs.statSync(ulawPath).mtimeMs >= fs.statSync(sourcePath).mtimeMs) {
        console.log(`✓ ulaw up to date: ${ulawPath}`);
    } else {
        console.log(`converting: ${path.basename(sourcePath)} → ${p.name}.ulaw`);
        if (!convertToUlaw(sourcePath, ulawPath)) {
            die('Audio conversion failed (sox and ffmpeg both errored).');
        }
    }

    const stats = fs.statSync(ulawPath);
    if (stats.size === 0) die(`Converted file is empty — check the recording for ${p.name}.`);
    p.sourcePath = sourcePath;
    p.dbFilename = `${AUDIO_SUBDIR}/${p.name}.ulaw`;
    p.fileSize = stats.size;
    p.durationMs = Math.round((stats.size / 8000) * 1000);
    console.log(`  ${stats.size} bytes (~${(p.durationMs / 1000).toFixed(1)}s)`);
}

// -------- 2. Upsert prompts rows -------------------------------------------

const db = new Database(DB_PATH);

const getFlow = db.prepare('SELECT id, name, extension, tenant_id, flow_data FROM ivr_flows WHERE id = ?');
const flows = [...SURVEY_FLOW_IDS, BILLING_FLOW_ID].map(id => {
    const flow = getFlow.get(id);
    if (!flow) die(`IVR flow not found: ${id}`);
    return flow;
});

const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();

// The engine resolves prompt names within the flow's tenant.
const tenantIds = [...new Set(flows.map(f => f.tenant_id))];

for (const tenantId of tenantIds) {
    for (const p of PROMPTS) {
        const existing = db.prepare('SELECT id FROM prompts WHERE tenant_id = ? AND name = ?')
            .get(tenantId, p.name);
        if (existing) {
            db.prepare(`
                UPDATE prompts
                SET filename = ?, duration_ms = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(p.dbFilename, p.durationMs, p.fileSize, existing.id);
            console.log(`✓ prompt row updated: ${p.name} → ${p.dbFilename}`);
        } else {
            db.prepare(`
                INSERT INTO prompts
                    (id, tenant_id, name, filename, language, category, description,
                     duration_ms, file_size, original_filename, is_system, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            `).run(
                uuidv4(),
                tenantId,
                p.name,
                p.dbFilename,
                'ar',
                p.category,
                p.description,
                p.durationMs,
                p.fileSize,
                p.sourcePath ? path.basename(p.sourcePath) : `${p.name}.ulaw`,
                adminUser?.id || null
            );
            console.log(`✓ prompt row inserted: ${p.name} → ${p.dbFilename}`);
        }
    }
}

// -------- 3. Patch the flows -----------------------------------------------

const saveFlow = db.prepare('UPDATE ivr_flows SET flow_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');

for (const flow of flows) {
    const flowData = JSON.parse(flow.flow_data);
    const nodes = flowData.nodes || {};

    if (SURVEY_FLOW_IDS.includes(flow.id)) {
        const questions = Object.values(nodes).filter(n => n.type === 'collect');
        if (questions.length === 0) die(`No questions found in ${flow.id} — flow shape changed?`);
        if (!nodes.hangup) die(`Node "hangup" not found in ${flow.id} — flow shape changed?`);
        for (const q of questions) {
            Object.assign(q, {
                invalidPrompt: 'assuit_invalid_option',
                maxAttempts: MAX_ATTEMPTS,
                onMaxAttempts: 'hangup'
            });
        }
        console.log(`✓ ${flow.id}: ${questions.map(q => q.id).join(', ')} → "wrong choice", ${MAX_ATTEMPTS} attempts, then hang up without thanks (completed_capture_failed)`);
    } else {
        for (const id of ['fetch_invoice', 'invalid_account', 'goodbye']) {
            if (!nodes[id]) die(`Node "${id}" not found in ${flow.id} — flow shape changed?`);
        }
        // ListBills answering with an error status means it rejected the number.
        nodes.fetch_invoice.onHttpError = 'invalid_account';
        Object.assign(nodes.invalid_account, {
            label: 'Account Not Found',
            prompt: 'assuit_billing_account_not_found',
            next: 'enter_account',
            maxRetries: MAX_ATTEMPTS,
            onMaxRetries: 'goodbye'
        });
        console.log(`✓ ${flow.id}: ListBills error / unknown account → invalid_account (assuit_billing_account_not_found), ${MAX_ATTEMPTS} attempts then goodbye`);
    }

    saveFlow.run(JSON.stringify(flowData), flow.id);
    console.log(`  flow "${flow.name}" (ext ${flow.extension}) saved`);
}

console.log('Done. Next call to each flow uses the new handling (ivr-node must run the engine with invalidPrompt / onHttpError support).');

db.close();
