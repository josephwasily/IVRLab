/**
 * Menia: split the billing flow's "wrong number" handling into two cases,
 * each with its own recording, and send the caller back to re-enter the
 * subscription number in both.
 *
 *   1. Entry is not 9 digits (too short, '*', or silence):
 *        "الرقم المدخل غير صحيح، برجاء إدخال رقم الاشتراك المكون من 9 أرقام."
 *        prompt: menia_invalid_9_digits  → node invalid_input
 *   2. 9 digits but ListBills returns no account:
 *        "عفوًا، رقم الاشتراك الذي تم إدخاله غير موجود أو غير صحيح.
 *         برجاء مراجعة رقم الاشتراك وإعادة إدخاله."
 *        prompt: menia_account_not_found → node invalid_account
 *
 * Steps:
 *   1. Convert each recording in /app/prompts/new-sounds-10/ to 8kHz mono ulaw.
 *   2. Upsert a prompts row for each.
 *   3. Patch ONLY the affected nodes of billing-inquiry-flow:
 *        enter_account  — exactly 9 digits; first bad entry goes straight to
 *                         invalid_input (no silent re-ask).
 *        invalid_input  — plays menia_invalid_9_digits, back to enter_account.
 *        invalid_account— plays menia_account_not_found, back to enter_account.
 *        ask_confirm / branch_confirm — a bad confirm key no longer lands on
 *                         invalid_input (whose message is now about 9 digits).
 *      The enter_account prompt, API nodes, and everything else are untouched.
 *
 * Idempotent: conversion is skipped if the ulaw exists, prompt rows are
 * updated in place, and re-patching the flow is a no-op.
 *
 * Usage inside platform-api container (see scripts/update-menia-billing-invalid-number.sh):
 *   node src/db/update-menia-billing-invalid-number.js
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';

const AUDIO_SUBDIR = 'new-sounds-10';
const TARGET_FLOW_ID = 'billing-inquiry-flow';
const ACCOUNT_DIGITS = 9;

const PROMPTS = [
    {
        name: 'menia_invalid_9_digits',
        description: 'Menia: entered number is not 9 digits, please enter the 9-digit subscription number'
    },
    {
        name: 'menia_account_not_found',
        description: 'Menia: subscription number not found or incorrect, please check and re-enter'
    }
];

function die(msg) {
    console.error(`[menia-invalid-number] ${msg}`);
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
        die(`Recording not found: ${audioDir}/${p.name}.<mpeg|mp3|wav>. Did the wrapper script copy "new sounds 10/" into the container?`);
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

const flow = db.prepare('SELECT id, name, extension, tenant_id, flow_data FROM ivr_flows WHERE id = ?')
    .get(TARGET_FLOW_ID);
if (!flow) die(`IVR flow not found: ${TARGET_FLOW_ID}`);
const tenantId = flow.tenant_id;

const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();

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
            'billing',
            p.description,
            p.durationMs,
            p.fileSize,
            p.sourcePath ? path.basename(p.sourcePath) : `${p.name}.ulaw`,
            adminUser?.id || null
        );
        console.log(`✓ prompt row inserted: ${p.name} → ${p.dbFilename}`);
    }
}

// -------- 3. Patch the flow ------------------------------------------------

const flowData = JSON.parse(flow.flow_data);
const nodes = flowData.nodes || {};
for (const id of ['enter_account', 'invalid_input', 'invalid_account', 'ask_confirm', 'branch_confirm', 'goodbye']) {
    if (!nodes[id]) die(`Node "${id}" not found in ${TARGET_FLOW_ID} — flow shape changed?`);
}

// Case 1: anything other than exactly 9 digits. maxAttempts 1 skips the
// engine's silent re-ask so the caller hears the explanation right away.
Object.assign(nodes.enter_account, {
    minDigits: ACCOUNT_DIGITS,
    maxDigits: ACCOUNT_DIGITS,
    validDigits: '0123456789',
    maxAttempts: 1,
    onEmpty: 'invalid_input',
    onTimeout: 'invalid_input',
    onInvalid: 'invalid_input'
});

Object.assign(nodes.invalid_input, {
    label: 'Not 9 Digits',
    prompt: 'menia_invalid_9_digits',
    next: 'enter_account'
});

// Case 2: 9 digits, but ListBills has no such subscription.
Object.assign(nodes.invalid_account, {
    label: 'Account Not Found',
    prompt: 'menia_account_not_found',
    next: 'enter_account'
});

// A wrong key on "1 to confirm / 2 to change" is not a number error, so it
// must not reach invalid_input. The engine re-asks on its own; after the
// attempts run out the call ends politely.
Object.assign(nodes.ask_confirm, {
    validDigits: '12',
    onEmpty: 'goodbye',
    onTimeout: 'goodbye',
    onInvalid: 'goodbye'
});
nodes.branch_confirm.default = 'goodbye';

db.prepare('UPDATE ivr_flows SET flow_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(flowData), flow.id);

console.log(`✓ flow "${flow.name}" (ext ${flow.extension}) updated`);
console.log(`  not ${ACCOUNT_DIGITS} digits   → invalid_input   (menia_invalid_9_digits)  → enter_account`);
console.log('  not found in ListBills → invalid_account (menia_account_not_found) → enter_account');
console.log('Done. Next call to the flow uses the new handling.');

db.close();
