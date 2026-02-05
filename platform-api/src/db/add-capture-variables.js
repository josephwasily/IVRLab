// Add captureVariables configuration to IVR flows
const Database = require('better-sqlite3');
const db = new Database('/app/data/platform.db');

// Update Billing flow (2010) with captureVariables
const billingFlow = db.prepare(`SELECT flow_data FROM ivr_flows WHERE extension = '2010'`).get();
if (billingFlow) {
    const flowData = JSON.parse(billingFlow.flow_data);
    flowData.captureVariables = [
        { name: 'account_number', label: 'Account Number' },
        { name: 'total_amount', label: 'Balance (EGP)' }
    ];
    
    const result = db.prepare(`
        UPDATE ivr_flows SET flow_data = ?, updated_at = CURRENT_TIMESTAMP WHERE extension = '2010'
    `).run(JSON.stringify(flowData));
    console.log('Updated billing flow (2010):', result.changes, 'row(s)');
    console.log('  Capture variables: account_number, total_amount');
}

// Update Survey flow (2020) with captureVariables
const surveyFlow = db.prepare(`SELECT flow_data FROM ivr_flows WHERE extension = '2020'`).get();
if (surveyFlow) {
    const flowData = JSON.parse(surveyFlow.flow_data);
    flowData.captureVariables = [
        { name: 'rating_satisfaction', label: 'Q1: Satisfaction' },
        { name: 'rating_employees', label: 'Q2: Employees' },
        { name: 'rating_accuracy', label: 'Q3: Accuracy' },
        { name: 'rating_speed', label: 'Q4: Speed' },
        { name: 'rating_overall', label: 'Q5: Overall' }
    ];
    
    const result = db.prepare(`
        UPDATE ivr_flows SET flow_data = ?, updated_at = CURRENT_TIMESTAMP WHERE extension = '2020'
    `).run(JSON.stringify(flowData));
    console.log('Updated survey flow (2020):', result.changes, 'row(s)');
    console.log('  Capture variables: rating_satisfaction, rating_employees, rating_accuracy, rating_speed, rating_overall');
}

console.log('\n✅ captureVariables configuration added to flows');
console.log('These variables will be saved in call_logs.variables for reporting');

db.close();
