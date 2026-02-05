// Update the billing flow with the new API and total extraction logic
const Database = require('better-sqlite3');
const db = new Database('/app/data/platform.db');

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
    },
    // Configure which variables to capture in analytics reports
    captureVariables: [
        { name: 'account_number', label: 'Account Number' },
        { name: 'total_amount', label: 'Balance (EGP)' }
    ]
};

// Update the billing flow
const result = db.prepare(`
    UPDATE ivr_flows 
    SET flow_data = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = 'billing-inquiry-flow'
`).run(JSON.stringify(updatedFlowData));

console.log('Updated billing flow:', result.changes, 'row(s) affected');

// Verify the update
const flow = db.prepare(`SELECT name, extension FROM ivr_flows WHERE id = 'billing-inquiry-flow'`).get();
if (flow) {
    console.log(`Flow: ${flow.name} (ext: ${flow.extension})`);
    console.log('New API URL: http://41.179.255.204:8070/api/query-bills?id={{account_number}}');
    console.log('Total extraction: Find inh_id="0", get inh_tot1');
}

db.close();
