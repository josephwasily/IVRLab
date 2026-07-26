/**
 * Menia: create the Work Order Status IVR flow from "new sounds 8".
 *
 * Call path (ext 2032, inbound):
 *   1. welcome + collect work_order_number (up to 10 digits, # to finish)
 *   2. region menu: 1 = north / 2 = south
 *   3. center menu (north: 5 centers, south: 4 centers)
 *   4. problem status: 1 solved / 2 pending / 3 not found
 *   5. thanks (reuses menia_s1_thanks from the surveys) -> hangup
 *
 * Region/center/status digits are mapped to Arabic names via set_variable
 * nodes so reports show the actual Minya center names, and the collect
 * nodes carry reportLabelAr/En for the survey Excel report.
 *
 * Steps:
 *   1. Convert the five recordings in /app/prompts/new-sounds-8/ to ulaw
 *      (sox, ffmpeg fallback), matched by filename prefix.
 *   2. Upsert a prompts row per recording (category 'menia').
 *   3. Ensure extension 2032 exists, upsert flow 'menia-workorder-flow'.
 *
 * Idempotent. Usage (see scripts/create-menia-workorder-flow.sh):
 *   node src/db/create-menia-workorder-flow.js [source-dir]
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';

const AUDIO_SUBDIR = 'new-sounds-8';
const FLOW_ID = 'menia-workorder-flow';
const FLOW_NAME = 'حالة أوامر الشغل - المنيا';
const FLOW_DESCRIPTION = 'Menia Water & Sanitation — work order status line (region → center → status)';
const EXTENSION = '2032';
const THANKS_PROMPT = 'menia_s1_thanks';

const sourceDir = process.argv[2] || path.join(PROMPTS_DIR, AUDIO_SUBDIR);

// Recordings matched by leading filename pattern so the awkward original
// names (spaces, apostrophes) don't have to be reproduced exactly.
const RECORDINGS = [
    { match: /^1/i,          name: 'menia_wo_welcome_enter_order', description: 'Menia WO: welcome + enter work order number' },
    { match: /^2/i,          name: 'menia_wo_region_menu',         description: 'Menia WO: region menu (1 north / 2 south)' },
    { match: /^3.*if 1/i,    name: 'menia_wo_centers_north',       description: 'Menia WO: north centers menu (1-5)' },
    { match: /^3.*if 2/i,    name: 'menia_wo_centers_south',       description: 'Menia WO: south centers menu (1-4)' },
    { match: /^4/i,          name: 'menia_wo_status',              description: 'Menia WO: problem status (1 solved / 2 pending / 3 not found)' },
];

function die(msg) {
    console.error(`[menia-workorder] ${msg}`);
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

// -------- 1. Locate + convert recordings -----------------------------------

if (!fs.existsSync(sourceDir)) {
    die(`Source dir not found: ${sourceDir}. Did the wrapper script copy "new sounds 8/" into the container?`);
}

const AUDIO_EXTS = new Set(['.mp3', '.mpeg', '.aac', '.m4a', '.wav', '.ogg']);
const sourceFiles = fs.readdirSync(sourceDir)
    .filter(f => AUDIO_EXTS.has(path.extname(f).toLowerCase()));

const resolved = [];
for (const rec of RECORDINGS) {
    const file = sourceFiles.find(f => rec.match.test(f));
    if (!file) die(`No recording matching ${rec.match} for ${rec.name} in ${sourceDir}`);
    resolved.push({ ...rec, file });
}

const db = new Database(DB_PATH);

const tenant = db.prepare("SELECT id FROM tenants WHERE slug = 'demo'").get();
if (!tenant) die("Demo tenant not found. Run platform-api seed.js first.");
const tenantId = tenant.id;
const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();
const userId = adminUser?.id || null;

const thanksRow = db.prepare('SELECT id FROM prompts WHERE tenant_id = ? AND name = ?')
    .get(tenantId, THANKS_PROMPT);
if (!thanksRow) {
    die(`Prompt "${THANKS_PROMPT}" not found — run scripts/migrate-menia-surveys.sh first (the flow reuses its thank-you recording).`);
}

console.log('================================================================');
console.log('Menia work-order flow creation');
console.log('================================================================');

let imported = 0, skipped = 0;
for (const rec of resolved) {
    const ulawFile = `${rec.name}.ulaw`;
    const ulawPath = path.join(sourceDir, ulawFile);
    const dbFilename = `${AUDIO_SUBDIR}/${ulawFile}`;

    if (!fs.existsSync(ulawPath)) {
        console.log(`converting: ${rec.file} → ${ulawFile}`);
        if (!convertToUlaw(path.join(sourceDir, rec.file), ulawPath)) {
            die(`Conversion failed for ${rec.file}`);
        }
    }
    const stats = fs.statSync(ulawPath);
    if (stats.size === 0) die(`Converted file is empty: ${ulawFile}`);
    const durationMs = Math.round((stats.size / 8000) * 1000);

    const existing = db.prepare('SELECT id FROM prompts WHERE tenant_id = ? AND name = ?')
        .get(tenantId, rec.name);
    if (existing) {
        db.prepare(`
            UPDATE prompts SET filename = ?, duration_ms = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(dbFilename, durationMs, stats.size, existing.id);
        console.log(`  ✓ prompt updated: ${rec.name} (~${Math.round(durationMs / 1000)}s)`);
        skipped++;
    } else {
        db.prepare(`
            INSERT INTO prompts
                (id, tenant_id, name, filename, language, category, description,
                 duration_ms, file_size, original_filename, is_system, created_by)
            VALUES (?, ?, ?, ?, 'ar', 'menia', ?, ?, ?, ?, 0, ?)
        `).run(uuidv4(), tenantId, rec.name, dbFilename, rec.description,
               durationMs, stats.size, rec.file, userId);
        console.log(`  + prompt imported: ${rec.name} (~${Math.round(durationMs / 1000)}s)`);
        imported++;
    }
}

// -------- 2. Build the flow -------------------------------------------------

const NORTH_CENTERS = ['سمالوط', 'مطاي', 'بني مزار', 'مغاغة', 'العدوة'];
const SOUTH_CENTERS = ['المنيا', 'أبو قرقاص', 'ملوي', 'دير مواس'];
const STATUS_NAMES = { 1: 'تم حل المشكلة', 2: 'جاري العمل', 3: 'لم يتم العثور على المشكلة' };

const flowData = {
    startNode: 'enter_order',
    nodes: {
        enter_order: {
            id: 'enter_order', type: 'collect', label: 'Work Order Number',
            prompt: 'menia_wo_welcome_enter_order', variable: 'work_order_number',
            maxDigits: 10, timeout: 10, terminators: '#',
            reportLabelAr: 'رقم أمر الشغل', reportLabelEn: 'Work Order Number',
            next: 'region', onTimeout: 'region', onEmpty: 'region'
        },
        region: {
            id: 'region', type: 'collect', label: 'Region (1 north / 2 south)',
            prompt: 'menia_wo_region_menu', variable: 'region',
            maxDigits: 1, timeout: 10, validDigits: '12',
            reportLabelAr: 'المنطقة', reportLabelEn: 'Region',
            next: 'set_region_name', onTimeout: 'thanks', onEmpty: 'thanks'
        },
        set_region_name: {
            id: 'set_region_name', type: 'set_variable', label: 'Region Name',
            variable: 'region_name',
            expression: "vars.region === '1' ? 'شمال' : vars.region === '2' ? 'جنوب' : ''",
            next: 'branch_region'
        },
        branch_region: {
            id: 'branch_region', type: 'branch', label: 'Region Branch',
            variable: 'region',
            branches: { '1': 'centers_north', '2': 'centers_south' },
            default: 'thanks'
        },
        centers_north: {
            id: 'centers_north', type: 'collect', label: 'North Centers (1-5)',
            prompt: 'menia_wo_centers_north', variable: 'center',
            maxDigits: 1, timeout: 10, validDigits: '12345',
            reportLabelAr: 'المركز', reportLabelEn: 'Center',
            next: 'set_center_north', onTimeout: 'status', onEmpty: 'status'
        },
        set_center_north: {
            id: 'set_center_north', type: 'set_variable', label: 'Center Name (north)',
            variable: 'center_name',
            expression: `${JSON.stringify(NORTH_CENTERS)}[Number(vars.center) - 1] || ''`,
            next: 'status'
        },
        centers_south: {
            id: 'centers_south', type: 'collect', label: 'South Centers (1-4)',
            prompt: 'menia_wo_centers_south', variable: 'center',
            maxDigits: 1, timeout: 10, validDigits: '1234',
            reportLabelAr: 'المركز', reportLabelEn: 'Center',
            next: 'set_center_south', onTimeout: 'status', onEmpty: 'status'
        },
        set_center_south: {
            id: 'set_center_south', type: 'set_variable', label: 'Center Name (south)',
            variable: 'center_name',
            expression: `${JSON.stringify(SOUTH_CENTERS)}[Number(vars.center) - 1] || ''`,
            next: 'status'
        },
        status: {
            id: 'status', type: 'collect', label: 'Problem Status (1/2/3)',
            prompt: 'menia_wo_status', variable: 'status_digit',
            maxDigits: 1, timeout: 10, validDigits: '123',
            reportLabelAr: 'حالة المشكلة', reportLabelEn: 'Problem Status',
            next: 'set_status_name', onTimeout: 'thanks', onEmpty: 'thanks'
        },
        set_status_name: {
            id: 'set_status_name', type: 'set_variable', label: 'Status Name',
            variable: 'status_name',
            expression: `(${JSON.stringify(STATUS_NAMES)})[vars.status_digit] || ''`,
            next: 'thanks'
        },
        thanks: {
            id: 'thanks', type: 'play', label: 'Thanks',
            prompt: THANKS_PROMPT, next: 'hangup'
        },
        hangup: { id: 'hangup', type: 'hangup', label: 'End Call' }
    },
    captureVariables: [
        { name: 'work_order_number', label: 'رقم أمر الشغل' },
        { name: 'region_name', label: 'المنطقة' },
        { name: 'center_name', label: 'المركز' },
        { name: 'status_name', label: 'حالة المشكلة' }
    ]
};

// -------- 3. Upsert extension + flow ----------------------------------------

// Match by fixed id OR by tenant+name, so a flow already created through the
// portal/API (auto-assigned uuid + extension) is updated instead of duplicated.
const existingFlow = db.prepare('SELECT id, extension FROM ivr_flows WHERE id = ?').get(FLOW_ID)
    || db.prepare("SELECT id, extension FROM ivr_flows WHERE tenant_id = ? AND name = ? AND status != 'archived'")
        .get(tenantId, FLOW_NAME);

const targetExt = existingFlow?.extension || EXTENSION;
const existsExt = db.prepare('SELECT extension FROM extensions WHERE extension = ?').get(targetExt);
if (!existsExt) {
    db.prepare("INSERT INTO extensions (extension, status) VALUES (?, 'available')").run(targetExt);
    console.log(`  created extension ${targetExt}`);
}

if (existingFlow) {
    db.prepare(`
        UPDATE ivr_flows
        SET name = ?, description = ?, extension = ?, language = 'ar',
            flow_data = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(FLOW_NAME, FLOW_DESCRIPTION, targetExt, JSON.stringify(flowData), existingFlow.id);
    console.log(`  ↻ flow updated: ${existingFlow.id} (ext ${targetExt})`);
} else {
    db.prepare(`
        INSERT INTO ivr_flows
            (id, tenant_id, name, description, extension, status, language, flow_data, created_by)
        VALUES (?, ?, ?, ?, ?, 'active', 'ar', ?, ?)
    `).run(FLOW_ID, tenantId, FLOW_NAME, FLOW_DESCRIPTION, EXTENSION, JSON.stringify(flowData), userId);
    console.log(`  + flow created: ${FLOW_ID} (ext ${EXTENSION})`);
}

console.log('');
console.log(`prompts: ${imported} imported, ${skipped} updated`);
console.log(`Done. Dial ${EXTENSION} from the trunk to test.`);

db.close();
