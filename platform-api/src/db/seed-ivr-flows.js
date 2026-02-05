/**
 * Seed Script for IVR Flows
 * 
 * This script seeds the database with predefined IVR flows and their prompts
 * It only runs once on first startup (checks for marker record)
 * 
 * Flow 1: Billing Invoice Inquiry - Monthly billing/invoice check flow
 * Flow 2: Customer Satisfaction Survey - Post-call satisfaction survey
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const PROMPTS_DIR = process.env.PROMPTS_PATH || process.env.PROMPTS_DIR || '/app/prompts';
const NEW_SOUNDS_DIR = process.env.NEW_SOUNDS_DIR || '/app/new-sounds';

// IVR Flow Definitions
const BILLING_FLOW = {
    id: 'billing-inquiry-flow',
    name: 'Billing Invoice Inquiry',
    description: 'Monthly billing and invoice inquiry service for customers',
    extension: '2010',
    prompts: [
        { name: 'billing_welcome', source: 'welcome.mpeg', description: 'Welcome message for billing service' },
        { name: 'billing_enter_account', source: 'enter the account number.mpeg', description: 'Prompt to enter account number' },
        { name: 'billing_confirm_press_1', source: 'to confirm press 1.mpeg', description: 'Press 1 to confirm' },
        { name: 'billing_change_press_2', source: 'to change the number enter 2.mpeg', description: 'Press 2 to re-enter number' },
        { name: 'billing_incorrect_number', source: 'incorrect number try to call again.mpeg', description: 'Invalid account number message' },
        { name: 'billing_thank_you', source: 'thanks for using monthly invoice inquiry service.mpeg', description: 'Goodbye and thank you message' }
    ],
    flowData: {
        startNode: 'welcome',
        nodes: {
            welcome: {
                id: 'welcome',
                type: 'play',
                label: 'Welcome',
                prompt: 'billing_welcome',
                next: 'enter_account'
            },
            enter_account: {
                id: 'enter_account',
                type: 'collect',
                label: 'Enter Account',
                prompt: 'billing_enter_account',
                maxDigits: 10,
                timeout: 10,
                terminators: '#',
                next: 'confirm_account',
                onTimeout: 'invalid_input',
                onEmpty: 'invalid_input'
            },
            confirm_account: {
                id: 'confirm_account',
                type: 'play_digits',
                label: 'Read Back Account',
                variable: 'account_number',
                next: 'ask_confirm'
            },
            ask_confirm: {
                id: 'ask_confirm',
                type: 'collect',
                label: 'Confirm or Re-enter',
                prompt: 'billing_confirm_press_1',
                prompt2: 'billing_change_press_2',
                maxDigits: 1,
                timeout: 5,
                next: 'branch_confirm'
            },
            branch_confirm: {
                id: 'branch_confirm',
                type: 'branch',
                label: 'Confirm Decision',
                variable: 'dtmf_input',
                branches: {
                    '1': 'fetch_invoice',
                    '2': 'enter_account'
                },
                default: 'invalid_input'
            },
            fetch_invoice: {
                id: 'fetch_invoice',
                type: 'api_call',
                label: 'Fetch Invoice',
                method: 'GET',
                url: 'http://41.179.255.204:8070/api/query-bills?id={{account_number}}',
                headers: {
                    'Authorization': 'Basic QXZheWE6QVZpc0AyMDI1Pw=='
                },
                resultVariable: 'bills_result',
                next: 'extract_total',
                onError: 'api_error'
            },
            extract_total: {
                id: 'extract_total',
                type: 'set_variable',
                label: 'Extract Total',
                variable: 'total_amount',
                // Find the item where inh_id === "0" and get its inh_tot1
                expression: 'bills_result.find(b => b.inh_id === "0")?.inh_tot1 || 0',
                next: 'check_total'
            },
            check_total: {
                id: 'check_total',
                type: 'branch',
                label: 'Check Total',
                condition: 'total_amount > 0',
                branches: {
                    'true': 'announce_amount',
                    'false': 'invalid_account'
                }
            },
            announce_amount: {
                id: 'announce_amount',
                type: 'play_sequence',
                label: 'Announce Amount',
                sequence: [
                    { type: 'prompt', value: 'balance_is' },
                    { type: 'number', variable: 'total_amount' },
                    { type: 'prompt', value: 'currency_egp' }
                ],
                next: 'goodbye'
            },
            invalid_input: {
                id: 'invalid_input',
                type: 'play',
                label: 'Invalid Input',
                prompt: 'billing_incorrect_number',
                next: 'enter_account',
                maxRetries: 3,
                onMaxRetries: 'goodbye'
            },
            invalid_account: {
                id: 'invalid_account',
                type: 'play',
                label: 'Invalid Account',
                prompt: 'billing_incorrect_number',
                next: 'enter_account',
                maxRetries: 3,
                onMaxRetries: 'goodbye'
            },
            api_error: {
                id: 'api_error',
                type: 'play',
                label: 'API Error',
                prompt: 'could_not_retrieve',
                next: 'goodbye'
            },
            goodbye: {
                id: 'goodbye',
                type: 'play',
                label: 'Goodbye',
                prompt: 'billing_thank_you',
                next: 'hangup'
            },
            hangup: {
                id: 'hangup',
                type: 'hangup',
                label: 'End Call'
            }
        }
    }
};

const SURVEY_FLOW = {
    id: 'customer-survey-flow',
    name: 'Customer Satisfaction Survey',
    description: 'Post-call customer satisfaction survey with 5 questions',
    extension: '2020',
    prompts: [
        { name: 'survey_welcome', source: '0 welcome.mpeg', description: 'Welcome to the customer survey' },
        { name: 'survey_q1_satisfaction', source: '1- how much you are satisifed 1-5.aac', description: 'Q1: Overall satisfaction 1-5' },
        { name: 'survey_q2_employees', source: '2- how much you evaluate the employees 1-5.aac', description: 'Q2: Employee evaluation 1-5' },
        { name: 'survey_q3_accuracy', source: '3 - how much accurate is survey.aac', description: 'Q3: Survey accuracy rating' },
        { name: 'survey_q4_speed', source: '4 - speed of call.aac', description: 'Q4: Call speed satisfaction' },
        { name: 'survey_q5_overall', source: '5 - overall satisifaction.aac', description: 'Q5: Overall experience rating' }
    ],
    flowData: {
        startNode: 'welcome',
        nodes: {
            welcome: {
                id: 'welcome',
                type: 'play',
                label: 'Survey Welcome',
                prompt: 'survey_welcome',
                next: 'q1_satisfaction'
            },
            q1_satisfaction: {
                id: 'q1_satisfaction',
                type: 'collect',
                label: 'Q1: Satisfaction',
                prompt: 'survey_q1_satisfaction',
                maxDigits: 1,
                timeout: 10,
                validDigits: '12345',
                next: 'q2_employees',
                onTimeout: 'q1_retry',
                onEmpty: 'q1_retry',
                variable: 'rating_satisfaction'
            },
            q1_retry: {
                id: 'q1_retry',
                type: 'play',
                label: 'Q1 Retry',
                prompt: 'survey_q1_satisfaction',
                next: 'q1_satisfaction',
                maxRetries: 2,
                onMaxRetries: 'q2_employees'
            },
            q2_employees: {
                id: 'q2_employees',
                type: 'collect',
                label: 'Q2: Employees',
                prompt: 'survey_q2_employees',
                maxDigits: 1,
                timeout: 10,
                validDigits: '12345',
                next: 'q3_accuracy',
                onTimeout: 'q2_retry',
                onEmpty: 'q2_retry',
                variable: 'rating_employees'
            },
            q2_retry: {
                id: 'q2_retry',
                type: 'play',
                label: 'Q2 Retry',
                prompt: 'survey_q2_employees',
                next: 'q2_employees',
                maxRetries: 2,
                onMaxRetries: 'q3_accuracy'
            },
            q3_accuracy: {
                id: 'q3_accuracy',
                type: 'collect',
                label: 'Q3: Accuracy',
                prompt: 'survey_q3_accuracy',
                maxDigits: 1,
                timeout: 10,
                validDigits: '12345',
                next: 'q4_speed',
                onTimeout: 'q3_retry',
                onEmpty: 'q3_retry',
                variable: 'rating_accuracy'
            },
            q3_retry: {
                id: 'q3_retry',
                type: 'play',
                label: 'Q3 Retry',
                prompt: 'survey_q3_accuracy',
                next: 'q3_accuracy',
                maxRetries: 2,
                onMaxRetries: 'q4_speed'
            },
            q4_speed: {
                id: 'q4_speed',
                type: 'collect',
                label: 'Q4: Speed',
                prompt: 'survey_q4_speed',
                maxDigits: 1,
                timeout: 10,
                validDigits: '12345',
                next: 'q5_overall',
                onTimeout: 'q4_retry',
                onEmpty: 'q4_retry',
                variable: 'rating_speed'
            },
            q4_retry: {
                id: 'q4_retry',
                type: 'play',
                label: 'Q4 Retry',
                prompt: 'survey_q4_speed',
                next: 'q4_speed',
                maxRetries: 2,
                onMaxRetries: 'q5_overall'
            },
            q5_overall: {
                id: 'q5_overall',
                type: 'collect',
                label: 'Q5: Overall',
                prompt: 'survey_q5_overall',
                maxDigits: 1,
                timeout: 10,
                validDigits: '12345',
                next: 'save_survey',
                onTimeout: 'q5_retry',
                onEmpty: 'q5_retry',
                variable: 'rating_overall'
            },
            q5_retry: {
                id: 'q5_retry',
                type: 'play',
                label: 'Q5 Retry',
                prompt: 'survey_q5_overall',
                next: 'q5_overall',
                maxRetries: 2,
                onMaxRetries: 'save_survey'
            },
            save_survey: {
                id: 'save_survey',
                type: 'api_call',
                label: 'Save Survey Results',
                method: 'POST',
                url: '{{SURVEY_API_URL}}/survey',
                body: {
                    caller_id: '{{caller_id}}',
                    q1_satisfaction: '{{rating_satisfaction}}',
                    q2_employees: '{{rating_employees}}',
                    q3_accuracy: '{{rating_accuracy}}',
                    q4_speed: '{{rating_speed}}',
                    q5_overall: '{{rating_overall}}'
                },
                next: 'thank_you',
                onError: 'thank_you'
            },
            thank_you: {
                id: 'thank_you',
                type: 'play',
                label: 'Thank You',
                prompt: 'goodbye',
                next: 'hangup'
            },
            hangup: {
                id: 'hangup',
                type: 'hangup',
                label: 'End Call'
            }
        }
    }
};

const IVR_FLOWS = [BILLING_FLOW, SURVEY_FLOW];

/**
 * Convert audio file to ulaw format using ffmpeg or sox
 */
function convertToUlaw(inputPath, outputPath) {
    console.log(`  Converting: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
    
    try {
        // Try ffmpeg first (better format support)
        execSync(`ffmpeg -y -i "${inputPath}" -ar 8000 -ac 1 -f mulaw "${outputPath}" 2>/dev/null`, {
            stdio: 'pipe'
        });
        return true;
    } catch (ffmpegError) {
        try {
            // Fallback to sox
            execSync(`sox "${inputPath}" -r 8000 -c 1 -t ul "${outputPath}" 2>/dev/null`, {
                stdio: 'pipe'
            });
            return true;
        } catch (soxError) {
            console.error(`  Failed to convert ${inputPath}:`, soxError.message);
            return false;
        }
    }
}

/**
 * Main seed function
 */
async function seedIvrFlows() {
    // Initialize database connection
    const db = new Database(DB_PATH);
    
    console.log('='.repeat(60));
    console.log('IVR Flow Seeding Script');
    console.log('='.repeat(60));
    
    // Check if already seeded
    const seedMarker = db.prepare("SELECT id FROM ivr_flows WHERE id = 'billing-inquiry-flow'").get();
    if (seedMarker) {
        console.log('IVR flows already seeded. Skipping...');
        db.close();
        return;
    }
    
    // Get demo tenant and admin user
    const tenant = db.prepare("SELECT id FROM tenants WHERE slug = 'demo'").get();
    const adminUser = db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get();
    
    if (!tenant) {
        console.error('Demo tenant not found. Please run main seed.js first.');
        db.close();
        process.exit(1);
    }
    
    const tenantId = tenant.id;
    const userId = adminUser?.id || null;
    
    console.log(`\nUsing tenant: ${tenantId}`);
    
    // Create source folder mappings (for new sounds that need conversion)
    const SOURCE_FOLDERS = {
        'billing-inquiry-flow': path.join(NEW_SOUNDS_DIR, 'billing'),
        'customer-survey-flow': path.join(NEW_SOUNDS_DIR, 'surveys')
    };
    
    // Target folders for already-converted files and for DB filename prefix
    const CONVERTED_FOLDERS = {
        'billing-inquiry-flow': path.join(PROMPTS_DIR, 'billing'),
        'customer-survey-flow': path.join(PROMPTS_DIR, 'survey')
    };
    
    // Folder name prefix for database filename field
    const FOLDER_NAMES = {
        'billing-inquiry-flow': 'billing',
        'customer-survey-flow': 'survey'
    };
    
    // Seed each flow
    for (const flow of IVR_FLOWS) {
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`Processing: ${flow.name}`);
        console.log(`${'─'.repeat(50)}`);
        
        const sourceFolder = SOURCE_FOLDERS[flow.id];
        const convertedFolder = CONVERTED_FOLDERS[flow.id];
        const targetFolder = convertedFolder;  // Use the explicitly mapped folder
        const folderName = FOLDER_NAMES[flow.id];
        
        // Create target folder if it doesn't exist
        if (!fs.existsSync(targetFolder)) {
            fs.mkdirSync(targetFolder, { recursive: true });
            console.log(`Created folder: ${targetFolder}`);
        }
        
        // Process prompts
        console.log('\nProcessing audio prompts:');
        const createdPrompts = [];
        
        for (const prompt of flow.prompts) {
            const targetFilename = `${prompt.name}.ulaw`;
            const relativeFilename = folderName + '/' + targetFilename;
            
            let targetPath = path.join(targetFolder, targetFilename);
            let fileExists = fs.existsSync(targetPath);
            
            // Also check in converted folders (should be same as targetFolder now)
            if (!fileExists && fs.existsSync(convertedFolder)) {
                const convertedPath = path.join(convertedFolder, targetFilename);
                if (fs.existsSync(convertedPath)) {
                    targetPath = convertedPath;
                    fileExists = true;
                }
            }
            
            // If file doesn't exist, try to convert from source
            if (!fileExists) {
                const sourcePath = path.join(sourceFolder, prompt.source);
                if (fs.existsSync(sourcePath)) {
                    console.log(`  Converting: ${prompt.source}`);
                    const converted = convertToUlaw(sourcePath, targetPath);
                    if (!converted) {
                        console.warn(`  WARNING: Failed to convert ${prompt.source}`);
                        continue;
                    }
                    fileExists = true;
                } else {
                    console.warn(`  WARNING: Source file not found: ${sourcePath}`);
                    continue;
                }
            } else {
                console.log(`  ✓ Found: ${targetFilename}`);
            }
            
            if (!fileExists) continue;
            
            // Get file stats
            const stats = fs.statSync(targetPath);
            
            // Create prompt record
            const promptId = uuidv4();
            db.prepare(`
                INSERT INTO prompts (id, tenant_id, name, filename, language, category, description, file_size, original_filename, is_system, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                promptId,
                tenantId,
                prompt.name,
                relativeFilename,
                'ar',
                flow.id.includes('billing') ? 'billing' : 'survey',
                prompt.description,
                stats.size,
                prompt.source,
                1, // is_system = true (cannot be deleted)
                userId
            );
            
            createdPrompts.push(prompt.name);
            console.log(`  ✓ Created prompt: ${prompt.name}`);
        }
        
        console.log(`\nCreated ${createdPrompts.length} prompts for ${flow.name}`);
        
        // Check if extension is available
        const extension = db.prepare('SELECT * FROM extensions WHERE extension = ?').get(flow.extension);
        if (!extension) {
            // Create the extension
            db.prepare(`
                INSERT INTO extensions (extension, status)
                VALUES (?, 'available')
            `).run(flow.extension);
        }
        
        // Create IVR flow
        db.prepare(`
            INSERT INTO ivr_flows (id, tenant_id, name, description, extension, status, language, flow_data, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            flow.id,
            tenantId,
            flow.name,
            flow.description,
            flow.extension,
            'active',
            'ar',
            JSON.stringify(flow.flowData),
            userId
        );
        
        // Assign extension
        db.prepare(`
            UPDATE extensions 
            SET tenant_id = ?, ivr_id = ?, status = 'assigned', assigned_at = CURRENT_TIMESTAMP
            WHERE extension = ?
        `).run(tenantId, flow.id, flow.extension);
        
        console.log(`\n✓ Created IVR Flow: ${flow.name}`);
        console.log(`  Extension: ${flow.extension}`);
        console.log(`  Status: active`);
    }
    
    // Also create templates for these flows
    console.log(`\n${'─'.repeat(50)}`);
    console.log('Creating IVR Templates');
    console.log(`${'─'.repeat(50)}`);
    
    for (const flow of IVR_FLOWS) {
        const templateId = uuidv4();
        db.prepare(`
            INSERT INTO ivr_templates (id, name, description, category, flow_data, is_system)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            templateId,
            flow.name + ' Template',
            flow.description,
            flow.id.includes('billing') ? 'finance' : 'survey',
            JSON.stringify(flow.flowData),
            1
        );
        console.log(`✓ Created template: ${flow.name} Template`);
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('IVR Flow Seeding Complete!');
    console.log(`${'='.repeat(60)}`);
    console.log('\nSeeded IVR Flows:');
    for (const flow of IVR_FLOWS) {
        console.log(`  - ${flow.name} (ext: ${flow.extension})`);
    }
    
    db.close();
}

// Run if called directly
if (require.main === module) {
    seedIvrFlows().catch(err => {
        console.error('Seed failed:', err);
        process.exit(1);
    });
}

module.exports = { seedIvrFlows, IVR_FLOWS };
