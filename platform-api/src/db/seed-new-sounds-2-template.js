const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';
const NEW_SOUNDS_2_DIR = process.env.NEW_SOUNDS_2_DIR || '/app/new-sounds-2';

const FALLBACK_LOCAL_SOUNDS_DIR = path.resolve(__dirname, '../../../new sounds 2');

const TEMPLATE_NAME = 'Water and Sewage Complaint';
const TEMPLATE_CATEGORY = 'utilities';
const PROMPT_FOLDER = 'ns2';

const PROMPT_MANIFEST = [
    { prompt: 'ns2_east_water', source: '1 east water.mpeg', description: 'Menu option 1: East water complaint', category: 'menu' },
    { prompt: 'ns2_west_water', source: '2 west water.mpeg', description: 'Menu option 2: West water complaint', category: 'menu' },
    { prompt: 'ns2_east_sewage', source: '3 east sewage.mpeg', description: 'Menu option 3: East sewage complaint', category: 'menu' },
    { prompt: 'ns2_west_sewage', source: '4 west sewage.mpeg', description: 'Menu option 4: West sewage complaint', category: 'menu' },
    { prompt: 'ns2_acknowledge_number', source: 'acknowledge number.wav', description: 'Acknowledge account number', category: 'confirmation' },
    { prompt: 'ns2_location_for_1_or_3', source: 'if option 1 or 3 location was chosen.mpeg', description: 'Route message for options 1 and 3', category: 'confirmation' },
    { prompt: 'ns2_location_for_2_or_4', source: 'if option 2 or 4 chosen location was chosen.mpeg', description: 'Route message for options 2 and 4', category: 'confirmation' },
    { prompt: 'ns2_input_account_number', source: 'input your account number.wav', description: 'Prompt to enter account number', category: 'menu' },
    { prompt: 'ns2_close_or_working_or_no_issues', source: 'Last option - to close the complaint presss 1 if you are still working on it press 2 if you found no issues press 3.wav', description: 'Complaint closure/status options', category: 'menu' },
    { prompt: 'ns2_sure_or_repeat', source: 'sure_or_repeat.wav', description: 'Prompt to confirm or repeat entry', category: 'confirmation' }
];

const FLOW_DATA = {
    startNode: 'service_menu',
    captureVariables: [
        { name: 'service_option', label: 'Service Branch' },
        { name: 'account_number', label: 'Account Number' },
        { name: 'confirm_choice', label: 'Confirm Choice' },
        { name: 'complaint_resolution', label: 'Complaint Resolution' }
    ],
    nodes: {
        service_menu: {
            id: 'service_menu',
            type: 'play_sequence',
            sequence: [
                { type: 'prompt', value: 'ns2_east_water' },
                { type: 'prompt', value: 'ns2_west_water' },
                { type: 'prompt', value: 'ns2_east_sewage' },
                { type: 'prompt', value: 'ns2_west_sewage' }
            ],
            next: 'branch_service_option'
        },
        collect_service_option: {
            id: 'collect_service_option',
            type: 'collect',
            prompt: 'ns2_sure_or_repeat',
            maxDigits: 1,
            timeout: 7,
            variable: 'service_option',
            next: 'branch_service_option'
        },
        branch_service_option: {
            id: 'branch_service_option',
            type: 'branch',
            variable: 'service_option',
            branches: {
                '1': 'location_1_or_3',
                '2': 'location_2_or_4',
                '3': 'location_1_or_3',
                '4': 'location_2_or_4'
            },
            branchDisplayNames: {
                '1': 'East Water',
                '2': 'West Water',
                '3': 'East Sewage',
                '4': 'West Sewage'
            },
            default: 'collect_service_option'
        },
        location_1_or_3: {
            id: 'location_1_or_3',
            type: 'play',
            prompt: 'ns2_location_for_1_or_3',
            next: 'collect_account'
        },
        location_2_or_4: {
            id: 'location_2_or_4',
            type: 'play',
            prompt: 'ns2_location_for_2_or_4',
            next: 'collect_account'
        },
        collect_account: {
            id: 'collect_account',
            type: 'collect',
            prompt: 'ns2_input_account_number',
            maxDigits: 20,
            timeout: 10,
            terminators: '#',
            variable: 'account_number',
            next: 'ack_account',
            onError: 'collect_account',
            minDigits: 6,
            onInvalid: 'collect_account'
        },
        ack_account: {
            id: 'ack_account',
            type: 'play_digits',
            next: 'confirm_or_repeat',
            prefix: 'ns2_acknowledge_number',
            variable: 'account_number'
        },
        confirm_or_repeat: {
            id: 'confirm_or_repeat',
            type: 'collect',
            prompt: 'ns2_sure_or_repeat',
            maxDigits: 1,
            timeout: 7,
            variable: 'confirm_choice',
            next: 'branch_confirm'
        },
        branch_confirm: {
            id: 'branch_confirm',
            type: 'branch',
            variable: 'confirm_choice',
            branches: {
                '1': 'last_option',
                '2': 'collect_account'
            },
            branchDisplayNames: {
                '1': 'Confirm Account',
                '2': 'Re-enter Account'
            },
            default: 'collect_account'
        },
        last_option: {
            id: 'last_option',
            type: 'collect',
            prompt: 'ns2_close_or_working_or_no_issues',
            maxDigits: 1,
            timeout: 7,
            variable: 'complaint_resolution',
            next: 'branch_last_option'
        },
        branch_last_option: {
            id: 'branch_last_option',
            type: 'branch',
            variable: 'complaint_resolution',
            branches: {
                '1': 'hangup',
                '2': 'hangup',
                '3': 'hangup'
            },
            branchDisplayNames: {
                '1': 'Close Complaint',
                '2': 'Still Working',
                '3': 'No Issues Found'
            },
            default: 'last_option'
        },
        hangup: {
            id: 'hangup',
            type: 'hangup'
        }
    }
};

function resolveSourceDir() {
    if (fs.existsSync(NEW_SOUNDS_2_DIR)) {
        return NEW_SOUNDS_2_DIR;
    }
    if (fs.existsSync(FALLBACK_LOCAL_SOUNDS_DIR)) {
        return FALLBACK_LOCAL_SOUNDS_DIR;
    }
    return null;
}

function runPythonConversion(sourceDir, outputDir) {
    const scriptPath = path.join(__dirname, '../scripts/convert_prompts.py');
    const manifest = PROMPT_MANIFEST.map((p) => ({
        source: p.source,
        output: `${p.prompt}.ulaw`
    }));
    const args = [
        scriptPath,
        '--source-dir',
        sourceDir,
        '--output-dir',
        outputDir,
        '--manifest',
        JSON.stringify(manifest)
    ];

    const pythonCandidates = ['python3', 'python'];
    let lastResult = null;
    for (const pythonCmd of pythonCandidates) {
        const result = spawnSync(pythonCmd, args, { encoding: 'utf8' });
        if (!result.error && result.status === 0) {
            return { ok: true, output: result.stdout };
        }
        lastResult = result;
    }

    return {
        ok: false,
        error: lastResult?.error?.message || lastResult?.stderr || 'Unknown Python conversion error'
    };
}

async function seedNewSounds2Template() {
    const db = new Database(DB_PATH);

    try {
        const existingTemplate = db.prepare(
            'SELECT id FROM ivr_templates WHERE name = ?'
        ).get(TEMPLATE_NAME);

        if (existingTemplate) {
            db.prepare(`
                UPDATE ivr_templates
                SET description = ?, category = ?, flow_data = ?, is_system = 1
                WHERE id = ?
            `).run(
                'Template seeded from new sounds 2 media set',
                TEMPLATE_CATEGORY,
                JSON.stringify(FLOW_DATA),
                existingTemplate.id
            );
            console.log(`[new-sounds-2] Template "${TEMPLATE_NAME}" already exists. Flow updated.`);
            return;
        }

        const sourceDir = resolveSourceDir();
        if (!sourceDir) {
            console.log('[new-sounds-2] Source folder not found. Skipping.');
            return;
        }

        const tenant = db.prepare("SELECT id FROM tenants WHERE slug = 'demo'").get();
        const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();
        if (!tenant) {
            console.log('[new-sounds-2] Demo tenant not found. Skipping.');
            return;
        }

        const promptsDir = path.join(PROMPTS_DIR, PROMPT_FOLDER);
        fs.mkdirSync(promptsDir, { recursive: true });

        const conversion = runPythonConversion(sourceDir, promptsDir);
        if (!conversion.ok) {
            console.warn(`[new-sounds-2] Prompt conversion failed: ${conversion.error}`);
            return;
        }

        let conversionSummary = {};
        try {
            conversionSummary = JSON.parse((conversion.output || '').trim() || '{}');
        } catch (err) {
            console.warn('[new-sounds-2] Could not parse Python conversion summary.');
        }

        const tenantId = tenant.id;
        const userId = adminUser?.id || null;

        for (const prompt of PROMPT_MANIFEST) {
            const relativeFilename = `${PROMPT_FOLDER}/${prompt.prompt}.ulaw`;
            const absoluteFilename = path.join(PROMPTS_DIR, relativeFilename);
            if (!fs.existsSync(absoluteFilename)) {
                console.warn(`[new-sounds-2] Missing converted prompt: ${absoluteFilename}`);
                continue;
            }

            const existingPrompt = db.prepare(
                'SELECT id FROM prompts WHERE tenant_id = ? AND name = ?'
            ).get(tenantId, prompt.prompt);

            if (existingPrompt) {
                db.prepare(`
                    UPDATE prompts
                    SET filename = ?, category = ?, description = ?, original_filename = ?, is_system = 1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(relativeFilename, prompt.category, prompt.description, prompt.source, existingPrompt.id);
                continue;
            }

            const stats = fs.statSync(absoluteFilename);
            db.prepare(`
                INSERT INTO prompts (id, tenant_id, name, filename, language, category, description, file_size, original_filename, is_system, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                uuidv4(),
                tenantId,
                prompt.prompt,
                relativeFilename,
                'ar',
                prompt.category,
                prompt.description,
                stats.size,
                prompt.source,
                1,
                userId
            );
        }

        db.prepare(`
            INSERT INTO ivr_templates (id, name, description, category, flow_data, is_system)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            uuidv4(),
            TEMPLATE_NAME,
            'Template seeded from new sounds 2 media set',
            TEMPLATE_CATEGORY,
            JSON.stringify(FLOW_DATA),
            1
        );

        console.log(`[new-sounds-2] Created template "${TEMPLATE_NAME}".`);
        if (Array.isArray(conversionSummary.converted)) {
            console.log(`[new-sounds-2] Converted ${conversionSummary.converted.length} file(s).`);
        }
    } finally {
        db.close();
    }
}

if (require.main === module) {
    seedNewSounds2Template().catch((err) => {
        console.error('[new-sounds-2] Seed failed:', err);
        process.exit(1);
    });
}

module.exports = { seedNewSounds2Template };
