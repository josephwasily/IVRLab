/**
 * Import a folder of audio files as IVR prompts.
 *
 * Scans /app/prompts/<subdir> for audio files (.mpeg/.mp3/.wav/.aac/.ogg/.m4a),
 * converts each to ulaw, and inserts a row in the prompts table so the file
 * shows up in the IVR flow editor's prompt dropdown.
 *
 * The engine plays prompts in the DB via /var/lib/asterisk/sounds/custom/<filename>
 * (see ivr-node/flow-engine.js getSoundPath()), so the converted .ulaw stays
 * in /app/prompts/<subdir>/ (which IS prompts-custom/<subdir>/) and the DB
 * filename is recorded as <subdir>/<safe_name>.ulaw.
 *
 * Idempotent: if a prompt with the same name already exists for the tenant,
 * it is skipped (the .ulaw file is left in place).
 *
 * Usage (inside the platform-api container):
 *   node src/db/import-sounds.js <subdir>           [language] [category]
 *   node src/db/import-sounds.js new-sounds-4       ar         menia
 *
 * Defaults: language=ar  category=custom
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';

const subdir = process.argv[2];
const language = process.argv[3] || 'ar';
const category = process.argv[4] || 'custom';

if (!subdir) {
    console.error('Usage: node import-sounds.js <subdir> [language=ar] [category=custom]');
    console.error('  <subdir> is relative to /app/prompts/ inside the container.');
    process.exit(1);
}

const sourceFolder = path.join(PROMPTS_DIR, subdir);
if (!fs.existsSync(sourceFolder) || !fs.statSync(sourceFolder).isDirectory()) {
    console.error(`Folder not found inside platform-api: ${sourceFolder}`);
    console.error('Copy your audio files into the prompts volume first — see scripts/import-sounds.sh');
    process.exit(1);
}

function convertToUlaw(inputPath, outputPath) {
    // sox first (better telephony output), fall back to ffmpeg
    try {
        execSync(`sox "${inputPath}" -r 8000 -c 1 -e u-law "${outputPath}"`, { stdio: 'pipe' });
        return true;
    } catch (_e) {
        try {
            execSync(`ffmpeg -y -i "${inputPath}" -ar 8000 -ac 1 -acodec pcm_mulaw -f mulaw "${outputPath}"`, { stdio: 'pipe' });
            return true;
        } catch (e2) {
            console.error(`  ✗ Conversion failed: ${e2.message.split('\n')[0]}`);
            return false;
        }
    }
}

function sanitizeName(raw) {
    return raw.toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

const db = new Database(DB_PATH);

const tenant = db.prepare("SELECT id FROM tenants WHERE slug = 'demo'").get();
if (!tenant) {
    console.error("Demo tenant not found. Run platform-api seed.js first.");
    process.exit(1);
}
const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();
const tenantId = tenant.id;
const userId = adminUser?.id || null;

const AUDIO_EXTS = new Set(['.mpeg', '.mp3', '.wav', '.aac', '.ogg', '.m4a', '.flac', '.webm', '.aiff']);

let imported = 0, skipped = 0, failed = 0;

console.log(`Scanning ${sourceFolder}`);
console.log(`Tenant: ${tenantId}  language=${language}  category=${category}`);
console.log('');

const entries = fs.readdirSync(sourceFolder).sort();

for (const entry of entries) {
    const inputPath = path.join(sourceFolder, entry);
    if (!fs.statSync(inputPath).isFile()) continue;

    const ext = path.extname(entry).toLowerCase();
    if (!AUDIO_EXTS.has(ext)) continue;

    const baseName = path.basename(entry, ext);
    const safeName = sanitizeName(baseName);
    if (!safeName) {
        console.warn(`  ! skip (unusable name): ${entry}`);
        continue;
    }

    const ulawFile = `${safeName}.ulaw`;
    const ulawPath = path.join(sourceFolder, ulawFile);
    const dbFilename = `${subdir}/${ulawFile}`;

    // Skip if a prompt by this name already exists for the tenant
    const existing = db.prepare(
        'SELECT id, filename FROM prompts WHERE tenant_id = ? AND name = ?'
    ).get(tenantId, safeName);
    if (existing) {
        console.log(`  ✓ already in DB: ${safeName}  (${existing.filename})`);
        skipped++;
        continue;
    }

    // Convert if the .ulaw doesn't already exist next to the source
    if (!fs.existsSync(ulawPath)) {
        console.log(`  converting: ${entry} → ${ulawFile}`);
        if (!convertToUlaw(inputPath, ulawPath)) {
            failed++;
            continue;
        }
    } else {
        console.log(`  reusing existing: ${ulawFile}`);
    }

    const stats = fs.statSync(ulawPath);
    // ulaw is 8000 bytes/sec
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
            safeName,
            dbFilename,
            language,
            category,
            `Imported from ${subdir}/${entry}`,
            durationMs,
            stats.size,
            entry,
            0,        // is_system = false → user can delete it from the UI
            userId
        );
        console.log(`  ✓ imported: ${safeName}  (${stats.size}B, ~${Math.round(durationMs/1000)}s)  → ${dbFilename}`);
        imported++;
    } catch (e) {
        console.error(`  ✗ DB insert failed for ${safeName}: ${e.message}`);
        failed++;
    }
}

db.close();

console.log('');
console.log(`Done. imported=${imported} skipped=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
