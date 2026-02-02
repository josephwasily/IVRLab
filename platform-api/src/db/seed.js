const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const db = new Database(DB_PATH);

console.log('Seeding database with sample data...');

// Check if already seeded
const existingTenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get('demo');
if (existingTenant) {
    console.log('Database already seeded. Skipping...');
    console.log('\nLogin credentials:');
    console.log('  Email: admin@demo.com');
    console.log('  Password: admin123');
    db.close();
    process.exit(0);
}

// Create default tenant
const tenantId = uuidv4();
db.prepare(`
    INSERT INTO tenants (id, name, slug, settings)
    VALUES (?, ?, ?, ?)
`).run(tenantId, 'Demo Company', 'demo', JSON.stringify({
    timezone: 'UTC',
    defaultLanguage: 'ar'
}));
console.log('Created default tenant: Demo Company');

// Create admin user
const userId = uuidv4();
const passwordHash = bcrypt.hashSync('admin123', 10);
db.prepare(`
    INSERT INTO users (id, tenant_id, email, password_hash, name, role)
    VALUES (?, ?, ?, ?, ?, ?)
`).run(userId, tenantId, 'admin@demo.com', passwordHash, 'Admin User', 'admin');
console.log('Created admin user: admin@demo.com / admin123');

// Balance Inquiry Flow
const balanceFlowData = {
    startNode: 'welcome',
    nodes: {
        welcome: {
            id: 'welcome',
            type: 'play',
            prompt: 'enter_account',
            next: 'collect_account'
        },
        collect_account: {
            id: 'collect_account',
            type: 'collect',
            maxDigits: 6,
            timeout: 10,
            terminators: '#',
            next: 'confirm_account',
            onTimeout: 'invalid_input',
            onEmpty: 'invalid_input'
        },
        confirm_account: {
            id: 'confirm_account',
            type: 'play_digits',
            variable: 'account_number',
            prefix: 'you_entered',
            next: 'ask_confirm'
        },
        ask_confirm: {
            id: 'ask_confirm',
            type: 'collect',
            prompt: 'press_1_confirm_2_reenter',
            maxDigits: 1,
            timeout: 5,
            next: 'branch_confirm'
        },
        branch_confirm: {
            id: 'branch_confirm',
            type: 'branch',
            variable: 'dtmf_input',
            branches: {
                '1': 'fetch_balance',
                '2': 'welcome'
            },
            default: 'invalid_input'
        },
        fetch_balance: {
            id: 'fetch_balance',
            type: 'api_call',
            method: 'GET',
            url: '{{BALANCE_API_URL}}/balance/{{account_number}}',
            resultVariable: 'balance_result',
            next: 'check_balance',
            onError: 'api_error'
        },
        check_balance: {
            id: 'check_balance',
            type: 'branch',
            condition: 'balance_result.success === true',
            branches: {
                'true': 'announce_balance',
                'false': 'invalid_account'
            }
        },
        announce_balance: {
            id: 'announce_balance',
            type: 'play_sequence',
            sequence: [
                { type: 'prompt', value: 'balance_is' },
                { type: 'number', variable: 'balance_result.balance' },
                { type: 'prompt', value: 'currency_egp' }
            ],
            next: 'goodbye'
        },
        invalid_account: {
            id: 'invalid_account',
            type: 'play',
            prompt: 'invalid_account',
            next: 'welcome',
            maxRetries: 3,
            onMaxRetries: 'goodbye'
        },
        invalid_input: {
            id: 'invalid_input',
            type: 'play',
            prompt: 'invalid_account',
            next: 'welcome',
            maxRetries: 3,
            onMaxRetries: 'goodbye'
        },
        api_error: {
            id: 'api_error',
            type: 'play',
            prompt: 'could_not_retrieve',
            next: 'goodbye'
        },
        goodbye: {
            id: 'goodbye',
            type: 'play',
            prompt: 'goodbye',
            next: 'hangup'
        },
        hangup: {
            id: 'hangup',
            type: 'hangup'
        }
    }
};

// Create Balance Inquiry Template
const balanceTemplateId = uuidv4();
db.prepare(`
    INSERT INTO ivr_templates (id, name, description, category, flow_data, is_system)
    VALUES (?, ?, ?, ?, ?, ?)
`).run(
    balanceTemplateId,
    'Balance Inquiry',
    'Allow callers to check their account balance by entering an account number',
    'finance',
    JSON.stringify(balanceFlowData),
    1
);
console.log('Created template: Balance Inquiry');

// Create sample IVR from template
const ivrId = uuidv4();
const extension = '2001';

// Create IVR first (before assigning extension due to foreign key)
db.prepare(`
    INSERT INTO ivr_flows (id, tenant_id, name, description, extension, status, language, flow_data, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    ivrId,
    tenantId,
    'Account Balance IVR',
    'Main balance inquiry IVR for customers',
    extension,
    'active',
    'ar',
    JSON.stringify(balanceFlowData),
    userId
);

// Then assign extension
db.prepare(`
    UPDATE extensions 
    SET tenant_id = ?, ivr_id = ?, status = 'assigned', assigned_at = CURRENT_TIMESTAMP
    WHERE extension = ?
`).run(tenantId, ivrId, extension);
console.log(`Created sample IVR: Account Balance IVR (extension: ${extension})`);

// Create Appointment Scheduling Template
const appointmentFlowData = {
    startNode: 'welcome',
    nodes: {
        welcome: { id: 'welcome', type: 'play', prompt: 'welcome_appointment', next: 'main_menu' },
        main_menu: { id: 'main_menu', type: 'collect', prompt: 'appointment_menu', maxDigits: 1, timeout: 5, next: 'branch_menu' },
        branch_menu: { id: 'branch_menu', type: 'branch', variable: 'dtmf_input', branches: { '1': 'book', '2': 'reschedule', '3': 'cancel' }, default: 'main_menu' },
        book: { id: 'book', type: 'play', prompt: 'booking_instructions', next: 'goodbye' },
        reschedule: { id: 'reschedule', type: 'play', prompt: 'reschedule_instructions', next: 'goodbye' },
        cancel: { id: 'cancel', type: 'play', prompt: 'cancel_instructions', next: 'goodbye' },
        goodbye: { id: 'goodbye', type: 'play', prompt: 'goodbye', next: 'hangup' },
        hangup: { id: 'hangup', type: 'hangup' }
    }
};

db.prepare(`
    INSERT INTO ivr_templates (id, name, description, category, flow_data, is_system)
    VALUES (?, ?, ?, ?, ?, ?)
`).run(
    uuidv4(),
    'Appointment Scheduling',
    'Allow callers to book, reschedule, or cancel appointments',
    'healthcare',
    JSON.stringify(appointmentFlowData),
    1
);
console.log('Created template: Appointment Scheduling');

// Create Card Activation Template
const cardFlowData = {
    startNode: 'welcome',
    nodes: {
        welcome: { id: 'welcome', type: 'play', prompt: 'welcome_card', next: 'collect_card' },
        collect_card: { id: 'collect_card', type: 'collect', prompt: 'enter_card_number', maxDigits: 16, timeout: 15, next: 'collect_cvv' },
        collect_cvv: { id: 'collect_cvv', type: 'collect', prompt: 'enter_cvv', maxDigits: 3, timeout: 10, next: 'verify' },
        verify: { id: 'verify', type: 'api_call', method: 'POST', url: '{{CARD_API}}/activate', next: 'result', onError: 'error' },
        result: { id: 'result', type: 'play', prompt: 'card_activated', next: 'goodbye' },
        error: { id: 'error', type: 'play', prompt: 'activation_failed', next: 'goodbye' },
        goodbye: { id: 'goodbye', type: 'play', prompt: 'goodbye', next: 'hangup' },
        hangup: { id: 'hangup', type: 'hangup' }
    }
};

db.prepare(`
    INSERT INTO ivr_templates (id, name, description, category, flow_data, is_system)
    VALUES (?, ?, ?, ?, ?, ?)
`).run(
    uuidv4(),
    'Card Activation',
    'Activate credit or debit cards with identity verification',
    'finance',
    JSON.stringify(cardFlowData),
    1
);
console.log('Created template: Card Activation');

console.log('\n✅ Database seeding completed!');
console.log('\nLogin credentials:');
console.log('  Email: admin@demo.com');
console.log('  Password: admin123');
console.log(`\nSample IVR Extension: ${extension}`);

db.close();
