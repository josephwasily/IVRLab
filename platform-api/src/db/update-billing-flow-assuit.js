// Update the billing flow on extension 2010 to use the Assuit client's
// ListBills API (172.18.2.32:25555) and the new response shape.
//
// Run:
//   docker exec platform-api node src/db/update-billing-flow-assuit.js

const Database = require('better-sqlite3');
const db = new Database('/app/data/platform.db');

const TARGET_EXTENSION = '2010';
const API_URL = 'http://172.18.2.32:25555/api/Query/ListBills?custkey={{account_number}}';

const updatedFlowData = {
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
            maxDigits: 11,
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
            label: 'Fetch Invoice (Assuit ListBills)',
            method: 'GET',
            url: API_URL,
            headers: {},
            resultVariable: 'bills_result',
            next: 'extract_total',
            onError: 'api_error'
        },
        extract_total: {
            id: 'extract_total',
            type: 'set_variable',
            label: 'Extract Total',
            variable: 'total_amount',
            // Use CL_BLNCE if present; otherwise sum DUE_AMOUNT across BILLS[].
            expression: 'bills_result && bills_result.CL_BLNCE != null ? Number(bills_result.CL_BLNCE) : (bills_result && Array.isArray(bills_result.BILLS) ? bills_result.BILLS.reduce((s, b) => s + Number(b.DUE_AMOUNT || 0), 0) : 0)',
            next: 'check_total'
        },
        check_total: {
            id: 'check_total',
            type: 'branch',
            label: 'Check Account Found',
            // Account is valid when the API returned a non-empty CUSTKEY.
            condition: '!!(bills_result && bills_result.CUSTKEY && String(bills_result.CUSTKEY).length > 0)',
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
    },
    captureVariables: [
        { name: 'account_number', label: 'Account Number' },
        { name: 'total_amount', label: 'Balance (EGP)' }
    ]
};

const flow = db.prepare(`SELECT id, name, extension FROM ivr_flows WHERE extension = ?`).get(TARGET_EXTENSION);
if (!flow) {
    console.error(`No IVR flow found on extension ${TARGET_EXTENSION}.`);
    process.exit(1);
}

const result = db.prepare(`
    UPDATE ivr_flows
    SET flow_data = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
`).run(JSON.stringify(updatedFlowData), flow.id);

console.log(`Updated flow "${flow.name}" (id=${flow.id}, ext=${flow.extension}): ${result.changes} row(s)`);
console.log(`New API URL: ${API_URL}`);
console.log('Total extraction: CL_BLNCE (fallback: sum of BILLS[].DUE_AMOUNT)');
console.log('Account validity check: response has non-empty CUSTKEY');

db.close();
