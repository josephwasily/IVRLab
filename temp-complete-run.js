const db = require('/app/src/db');
db.prepare(`UPDATE campaign_runs SET status = 'completed', completed_at = datetime('now') WHERE id = '2405ff92-1efe-4c09-ad23-311a8eb92e68'`).run();
console.log('Run marked as completed');
