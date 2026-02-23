const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';
const NEW_SOUNDS_3_DIR = process.env.NEW_SOUNDS_3_DIR || '/app/new-sounds-3';

const FALLBACK_LOCAL_SOUNDS_DIR = path.resolve(__dirname, '../../../new sounds 3');

const TEMPLATE_NAME = 'Issue Resolution Follow-up (Yes/No)';
const TEMPLATE_CATEGORY = 'survey';
const PROMPT_FOLDER = 'ns3';

const PROMPT_MANIFEST = [
    { prompt: 'ns3_welcome', source: 'welcome.mpeg', description: 'Welcome message for follow-up survey', category: 'greeting' },
    { prompt: 'ns3_problem_solved_question', source: '1-was the problem solved.mpeg', description: 'Question 1: Was the problem solved?', category: 'menu' },
    { prompt: 'ns3_satisfied_question', source: '2- are you satisified.mpeg', description: 'Question 2: Are you satisfied?', category: 'menu' },
    { prompt: 'ns3_end', source: 'end.mpeg', description: 'Closing message', category: 'confirmation' }
];

const FLOW_DATA = {
    startNode: 'welcome',
    captureVariables: [
        { name: 'problem_solved', label: 'Problem Solved' },
        { name: 'customer_satisfied', label: 'Customer Satisfied' }
    ],
    nodes: {
        welcome: {
            id: 'welcome',
            type: 'play',
            prompt: 'ns3_welcome',
            next: 'collect_problem_solved',
            bargeIn: true
        },
        collect_problem_solved: {
            id: 'collect_problem_solved',
            type: 'collect',
            prompt: 'ns3_problem_solved_question',
            maxDigits: 1,
            timeout: 8,
            validDigits: '12',
            variable: 'problem_solved',
            next: 'branch_problem_solved',
            maxRetries: 2,
            onInvalid: 'collect_problem_solved',
            onTimeout: 'collect_problem_solved',
            onEmpty: 'collect_problem_solved',
            onMaxRetries: 'hangup',
            bargeIn: true
        },
        branch_problem_solved: {
            id: 'branch_problem_solved',
            type: 'branch',
            variable: 'problem_solved',
            branches: {
                '1': 'collect_customer_satisfied',
                '2': 'collect_customer_satisfied'
            },
            branchDisplayNames: {
                '1': 'Yes',
                '2': 'No'
            },
            default: 'collect_customer_satisfied'
        },
        collect_customer_satisfied: {
            id: 'collect_customer_satisfied',
            type: 'collect',
            prompt: 'ns3_satisfied_question',
            maxDigits: 1,
            timeout: 8,
            validDigits: '12',
            variable: 'customer_satisfied',
            next: 'branch_customer_satisfied',
            maxRetries: 2,
            onInvalid: 'collect_customer_satisfied',
            onTimeout: 'collect_customer_satisfied',
            onEmpty: 'collect_customer_satisfied',
            onMaxRetries: 'hangup',
            bargeIn: true
        },
        branch_customer_satisfied: {
            id: 'branch_customer_satisfied',
            type: 'branch',
            variable: 'customer_satisfied',
            branches: {
                '1': 'end_message',
                '2': 'end_message'
            },
            branchDisplayNames: {
                '1': 'Yes',
                '2': 'No'
            },
            default: 'end_message'
        },
        end_message: {
            id: 'end_message',
            type: 'play',
            prompt: 'ns3_end',
            next: 'hangup',
            bargeIn: true
        },
        hangup: {
            id: 'hangup',
            type: 'hangup'
        }
    }
};

function resolveSourceDir() {
    if (fs.existsSync(NEW_SOUNDS_3_DIR)) {
        return NEW_SOUNDS_3_DIR;
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

async function seedNewSounds3Template() {
    const db = new Database(DB_PATH);

    try {
        const sourceDir = resolveSourceDir();
        if (!sourceDir) {
            console.log('[new-sounds-3] Source folder not found. Skipping.');
            return;
        }

        const tenant = db.prepare("SELECT id FROM tenants WHERE slug = 'demo'").get();
        const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();
        if (!tenant) {
            console.log('[new-sounds-3] Demo tenant not found. Skipping.');
            return;
        }

        const promptsDir = path.join(PROMPTS_DIR, PROMPT_FOLDER);
        fs.mkdirSync(promptsDir, { recursive: true });

        const conversion = runPythonConversion(sourceDir, promptsDir);
        if (!conversion.ok) {
            console.warn(`[new-sounds-3] Prompt conversion failed: ${conversion.error}`);
            return;
        }

        let conversionSummary = {};
        try {
            conversionSummary = JSON.parse((conversion.output || '').trim() || '{}');
        } catch (err) {
            console.warn('[new-sounds-3] Could not parse Python conversion summary.');
        }

        const tenantId = tenant.id;
        const userId = adminUser?.id || null;

        for (const prompt of PROMPT_MANIFEST) {
            const relativeFilename = `${PROMPT_FOLDER}/${prompt.prompt}.ulaw`;
            const absoluteFilename = path.join(PROMPTS_DIR, relativeFilename);
            if (!fs.existsSync(absoluteFilename)) {
                console.warn(`[new-sounds-3] Missing converted prompt: ${absoluteFilename}`);
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

        const existingTemplate = db.prepare(
            'SELECT id FROM ivr_templates WHERE name = ?'
        ).get(TEMPLATE_NAME);

        if (existingTemplate) {
            db.prepare(`
                UPDATE ivr_templates
                SET description = ?, category = ?, flow_data = ?, is_system = 1
                WHERE id = ?
            `).run(
                'Two-question yes/no follow-up survey seeded from new sounds 3 media set',
                TEMPLATE_CATEGORY,
                JSON.stringify(FLOW_DATA),
                existingTemplate.id
            );
            console.log(`[new-sounds-3] Template "${TEMPLATE_NAME}" already exists. Flow updated.`);
        } else {
            db.prepare(`
                INSERT INTO ivr_templates (id, name, description, category, flow_data, is_system)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                uuidv4(),
                TEMPLATE_NAME,
                'Two-question yes/no follow-up survey seeded from new sounds 3 media set',
                TEMPLATE_CATEGORY,
                JSON.stringify(FLOW_DATA),
                1
            );
            console.log(`[new-sounds-3] Created template "${TEMPLATE_NAME}".`);
        }

        if (Array.isArray(conversionSummary.converted)) {
            console.log(`[new-sounds-3] Converted ${conversionSummary.converted.length} file(s).`);
        }
    } finally {
        db.close();
    }
}

if (require.main === module) {
    seedNewSounds3Template().catch((err) => {
        console.error('[new-sounds-3] Seed failed:', err);
        process.exit(1);
    });
}

module.exports = { seedNewSounds3Template };
