/**
 * Assuit surveys migration.
 *
 * Mirrors migrate-menia-surveys.js but for Assuit Water & Sanitation:
 *  - Reads /app/prompts/assuit-surveys/assuit-manifest.json (default).
 *  - Source audio stages from BOTH "new sounds 6/" (Assuit welcomes) and
 *    "new sounds 5/" (question/thanks audio shared with Menia). The
 *    wrapper script copies both folders into /app/prompts/assuit-surveys/.
 *  - Converts each referenced source file to ulaw, inserts a prompts row,
 *    upserts the IVR flow row (with reportLabelAr/En on each question),
 *    and upserts the matching campaign in 'draft' status.
 *
 * Idempotent — re-running skips prompts already in the DB and updates
 * existing flows/campaigns in place.
 *
 * Usage inside platform-api container:
 *   node src/db/migrate-assuit-surveys.js [manifest-path]
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';

const AUDIO_SUBDIR = 'assuit-surveys';
const MANIFEST_PATH = process.argv[2]
    || path.join(PROMPTS_DIR, AUDIO_SUBDIR, 'assuit-manifest.json');

function die(msg) {
    console.error(`[migrate-assuit] ${msg}`);
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

if (!fs.existsSync(MANIFEST_PATH)) die(`Manifest not found: ${MANIFEST_PATH}`);

let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
} catch (e) {
    die(`Cannot parse manifest: ${e.message}`);
}
if (!Array.isArray(manifest.surveys) || manifest.surveys.length === 0) {
    die('Manifest has no surveys[]');
}

const language = manifest.language || 'ar';
const category = manifest.category || 'assuit';
const sourceDir = path.join(PROMPTS_DIR, AUDIO_SUBDIR);

if (!fs.existsSync(sourceDir)) {
    die(`Audio source dir not found: ${sourceDir}. Did the wrapper copy the staging folders in?`);
}

const db = new Database(DB_PATH);

const tenant = db.prepare("SELECT id FROM tenants WHERE slug = 'demo'").get();
if (!tenant) die("Demo tenant not found. Run platform-api seed.js first.");
const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();
const tenantId = tenant.id;
const userId = adminUser?.id || null;

console.log('================================================================');
console.log('Assuit surveys migration');
console.log('================================================================');
console.log(`manifest: ${MANIFEST_PATH}`);
console.log(`tenant:   ${tenantId}`);
console.log(`language: ${language}  category: ${category}`);
console.log('');

let promptsImported = 0, promptsSkipped = 0, promptsFailed = 0;

// -------- 1. Import prompts -----------------------------------------------

for (const survey of manifest.surveys) {
    console.log(`--- ${survey.name} (${survey.id}) ---`);
    for (const p of survey.prompts) {
        const sourcePath = path.join(sourceDir, p.file);
        if (!fs.existsSync(sourcePath)) {
            console.warn(`  ! missing source: ${p.file}`);
            promptsFailed++;
            continue;
        }

        const ulawFile = `${p.name}.ulaw`;
        const ulawPath = path.join(sourceDir, ulawFile);
        const dbFilename = `${AUDIO_SUBDIR}/${ulawFile}`;

        const existing = db.prepare(
            'SELECT id FROM prompts WHERE tenant_id = ? AND name = ?'
        ).get(tenantId, p.name);
        if (existing) {
            console.log(`  ✓ already in DB: ${p.name}`);
            promptsSkipped++;
            continue;
        }

        if (!fs.existsSync(ulawPath)) {
            console.log(`  converting: ${p.file} → ${ulawFile}`);
            if (!convertToUlaw(sourcePath, ulawPath)) {
                promptsFailed++;
                continue;
            }
        }

        const stats = fs.statSync(ulawPath);
        const durationMs = Math.round((stats.size / 8000) * 1000);

        try {
            db.prepare(`
                INSERT INTO prompts
                    (id, tenant_id, name, filename, language, category, description,
                     duration_ms, file_size, original_filename, is_system, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                uuidv4(),
                tenantId,
                p.name,
                dbFilename,
                language,
                category,
                `${survey.name} / ${p.role}${p.reportLabelEn ? ` — ${p.reportLabelEn}` : ''}`,
                durationMs,
                stats.size,
                p.file,
                0,
                userId
            );
            console.log(`  ✓ imported: ${p.name}  (${stats.size}B, ~${Math.round(durationMs / 1000)}s)`);
            promptsImported++;
        } catch (e) {
            console.error(`  ✗ DB insert failed for ${p.name}: ${e.message}`);
            promptsFailed++;
        }
    }
    console.log('');
}

// -------- 2. Build & upsert IVR flows -------------------------------------

let flowsCreated = 0, flowsUpdated = 0;

for (const survey of manifest.surveys) {
    const questions = survey.prompts.filter(p => p.role === 'question');
    const welcomePromptName = survey.welcomePrompt
        || survey.prompts.find(p => p.role === 'welcome')?.name;
    const thanksPromptName = survey.thanksPrompt
        || survey.prompts.find(p => p.role === 'thanks')?.name;

    const nodes = {};

    nodes.welcome = {
        id: 'welcome', type: 'play', label: 'Welcome',
        prompt: welcomePromptName,
        next: questions[0] ? questions[0].variable : 'thanks'
    };

    questions.forEach((q, idx) => {
        const nextId = idx < questions.length - 1
            ? questions[idx + 1].variable
            : 'thanks';
        nodes[q.variable] = {
            id: q.variable,
            type: 'collect',
            label: `Q${idx + 1}: ${q.reportLabelEn || q.name}`,
            prompt: q.name,
            variable: q.variable,
            maxDigits: 1,
            timeout: 10,
            validDigits: q.validDigits || '12345',
            reportLabelAr: q.reportLabelAr || '',
            reportLabelEn: q.reportLabelEn || '',
            next: nextId,
            onTimeout: nextId,
            onEmpty: nextId
        };
    });

    nodes.thanks = {
        id: 'thanks', type: 'play', label: 'Thanks',
        prompt: thanksPromptName, next: 'hangup'
    };
    nodes.hangup = { id: 'hangup', type: 'hangup', label: 'End Call' };

    const flowData = { startNode: 'welcome', nodes };

    const existsExt = db.prepare('SELECT extension FROM extensions WHERE extension = ?').get(survey.extension);
    if (!existsExt) {
        db.prepare("INSERT INTO extensions (extension, status) VALUES (?, 'available')").run(survey.extension);
        console.log(`  created extension ${survey.extension}`);
    }

    const existingFlow = db.prepare("SELECT id FROM ivr_flows WHERE id = ?").get(survey.id);
    if (existingFlow) {
        db.prepare(`
            UPDATE ivr_flows
            SET name = ?, description = ?, extension = ?, language = ?,
                flow_data = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(survey.name, survey.description || '', survey.extension, language,
               JSON.stringify(flowData), survey.id);
        console.log(`  ↻ updated flow: ${survey.id}  (ext ${survey.extension}, ${questions.length} questions)`);
        flowsUpdated++;
    } else {
        db.prepare(`
            INSERT INTO ivr_flows
                (id, tenant_id, name, description, extension, status, language,
                 flow_data, created_by)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `).run(survey.id, tenantId, survey.name, survey.description || '',
               survey.extension, language, JSON.stringify(flowData), userId);
        console.log(`  + created flow: ${survey.id}  (ext ${survey.extension}, ${questions.length} questions)`);
        flowsCreated++;
    }
}

// -------- 3. Upsert campaigns ---------------------------------------------

let campaignsCreated = 0, campaignsUpdated = 0, campaignsSkipped = 0;

const defaultTrunk = db.prepare(
    'SELECT id FROM sip_trunks WHERE tenant_id = ? ORDER BY created_at LIMIT 1'
).get(tenantId);
if (!defaultTrunk) {
    console.warn('[!] No SIP trunk found for this tenant. Campaigns will be created without a trunk — set one in the admin UI before activating.');
}
const defaultTrunkId = defaultTrunk?.id || null;

for (const survey of manifest.surveys) {
    const c = survey.campaign;
    if (!c) { campaignsSkipped++; continue; }

    const existing = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(c.id);
    if (existing) {
        db.prepare(`
            UPDATE campaigns
            SET name = ?, description = ?, campaign_type = ?, ivr_id = ?,
                flag_variable = ?, flag_value = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(c.name, c.description || '', c.campaign_type || 'survey',
               survey.id, c.flag_variable || null, c.flag_value || null, c.id);
        console.log(`  ↻ updated campaign: ${c.id}`);
        campaignsUpdated++;
    } else {
        db.prepare(`
            INSERT INTO campaigns
                (id, tenant_id, name, description, campaign_type, ivr_id,
                 trunk_id, status, flag_variable, flag_value, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(c.id, tenantId, c.name, c.description || '',
               c.campaign_type || 'survey', survey.id, defaultTrunkId,
               c.status || 'draft', c.flag_variable || null,
               c.flag_value || null, userId);
        console.log(`  + created campaign: ${c.id}  → flow ${survey.id}  (status=${c.status || 'draft'})`);
        campaignsCreated++;
    }
}

db.close();

console.log('');
console.log('----------------------------------------------------------------');
console.log(`prompts:   imported=${promptsImported} skipped=${promptsSkipped} failed=${promptsFailed}`);
console.log(`flows:     created=${flowsCreated}  updated=${flowsUpdated}`);
console.log(`campaigns: created=${campaignsCreated}  updated=${campaignsUpdated}  skipped=${campaignsSkipped}`);
console.log('----------------------------------------------------------------');
console.log('');
console.log('Campaigns are in DRAFT status. Activate from the admin UI when ready.');

process.exit(promptsFailed > 0 ? 1 : 0);
