/**
 * Menia: swap the billing-inquiry-flow account-entry prompt to the new
 * "enter 9 digits account" recording from "new sounds 7".
 *
 * Steps:
 *   1. Convert /app/prompts/new-sounds-7/enter_9_digits_account_menia.mpeg
 *      to 8kHz mono ulaw (sox, ffmpeg fallback) alongside the source.
 *   2. Upsert a prompts row named enter_9_digits_account_menia pointing at
 *      new-sounds-7/enter_9_digits_account_menia.ulaw.
 *   3. Patch ONLY nodes.enter_account.prompt in billing-inquiry-flow's
 *      flow_data (everything else, incl. the ListBills API nodes, untouched).
 *
 * Idempotent: conversion is skipped if the ulaw exists, the prompt row is
 * updated in place, and re-patching the flow is a no-op.
 *
 * Usage inside platform-api container (see scripts/update-menia-enter-account-prompt.sh):
 *   node src/db/update-menia-enter-account-prompt.js [source-audio-path]
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';

const AUDIO_SUBDIR = 'new-sounds-7';
const PROMPT_NAME = 'enter_9_digits_account_menia';
const TARGET_FLOW_ID = 'billing-inquiry-flow';
const TARGET_NODE_ID = 'enter_account';

const sourcePath = process.argv[2]
    || path.join(PROMPTS_DIR, AUDIO_SUBDIR, 'enter_9_digits_account_menia.mpeg');

function die(msg) {
    console.error(`[menia-enter-account] ${msg}`);
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

// -------- 1. Convert audio -------------------------------------------------

if (!fs.existsSync(sourcePath)) {
    die(`Source audio not found: ${sourcePath}. Did the wrapper script copy "new sounds 7/" into the container?`);
}

const ulawFile = `${PROMPT_NAME}.ulaw`;
const ulawPath = path.join(path.dirname(sourcePath), ulawFile);
const dbFilename = `${AUDIO_SUBDIR}/${ulawFile}`;

if (fs.existsSync(ulawPath)) {
    console.log(`✓ ulaw already exists: ${ulawPath}`);
} else {
    console.log(`converting: ${path.basename(sourcePath)} → ${ulawFile}`);
    if (!convertToUlaw(sourcePath, ulawPath)) {
        die('Audio conversion failed (sox and ffmpeg both errored).');
    }
}

const stats = fs.statSync(ulawPath);
const durationMs = Math.round((stats.size / 8000) * 1000);
console.log(`  ${stats.size} bytes (~${(durationMs / 1000).toFixed(1)}s)`);
if (stats.size === 0) die('Converted file is empty — check the source recording.');

// -------- 2. Upsert prompts row --------------------------------------------

const db = new Database(DB_PATH);

const flow = db.prepare('SELECT id, name, extension, tenant_id, flow_data FROM ivr_flows WHERE id = ?')
    .get(TARGET_FLOW_ID);
if (!flow) die(`IVR flow not found: ${TARGET_FLOW_ID}`);
const tenantId = flow.tenant_id;

const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();

const existing = db.prepare('SELECT id FROM prompts WHERE tenant_id = ? AND name = ?')
    .get(tenantId, PROMPT_NAME);
if (existing) {
    db.prepare(`
        UPDATE prompts
        SET filename = ?, duration_ms = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(dbFilename, durationMs, stats.size, existing.id);
    console.log(`✓ prompt row updated: ${PROMPT_NAME} → ${dbFilename}`);
} else {
    db.prepare(`
        INSERT INTO prompts
            (id, tenant_id, name, filename, language, category, description,
             duration_ms, file_size, original_filename, is_system, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
        uuidv4(),
        tenantId,
        PROMPT_NAME,
        dbFilename,
        'ar',
        'billing',
        'Menia: enter the 9-digit account number',
        durationMs,
        stats.size,
        path.basename(sourcePath),
        adminUser?.id || null
    );
    console.log(`✓ prompt row inserted: ${PROMPT_NAME} → ${dbFilename}`);
}

// -------- 3. Patch the flow's enter_account prompt --------------------------

const flowData = JSON.parse(flow.flow_data);
const node = flowData.nodes && flowData.nodes[TARGET_NODE_ID];
if (!node) die(`Node "${TARGET_NODE_ID}" not found in ${TARGET_FLOW_ID} — flow shape changed?`);

console.log(`enter_account prompt: ${node.prompt} → ${PROMPT_NAME}`);
node.prompt = PROMPT_NAME;

db.prepare('UPDATE ivr_flows SET flow_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(flowData), flow.id);

console.log(`✓ flow "${flow.name}" (ext ${flow.extension}) updated`);
console.log('Done. Next call to the flow plays the new recording.');

db.close();
