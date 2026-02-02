const db = require('/app/src/db');

// Check runs
const runs = db.prepare("SELECT * FROM campaign_runs").all();
console.log('Campaign runs:', runs);

// Mark all runs as completed
db.exec("UPDATE campaign_runs SET status = 'completed', completed_at = datetime('now') WHERE status = 'running'");
console.log('All running runs marked as completed');
