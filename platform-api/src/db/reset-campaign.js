const db = require('./index');

// Get all runs for the campaign
const campaignId = '4654b727-ae3c-4af4-b882-d98f13573768';
const runs = db.prepare('SELECT * FROM campaign_runs WHERE campaign_id = ?').all(campaignId);
console.log('Campaign runs:');
runs.forEach(r => console.log(`  Run #${r.run_number}: ${r.status}`));

// Cancel any running ones
const result = db.prepare("UPDATE campaign_runs SET status = 'cancelled' WHERE campaign_id = ? AND status = 'running'").run(campaignId);
console.log(`Cancelled ${result.changes} running runs`);

// Reset contacts
db.prepare("UPDATE campaign_contacts SET status = 'pending', attempts = 0 WHERE campaign_id = ?").run(campaignId);
console.log('Reset contacts to pending');
