const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const db = new Database(DB_PATH);

console.log('Running migration v2...');

try {
    // Create campaign_runs table if not exists
    db.exec(`
        CREATE TABLE IF NOT EXISTS campaign_runs (
            id TEXT PRIMARY KEY,
            campaign_id TEXT NOT NULL,
            run_number INTEGER NOT NULL,
            status TEXT DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'cancelled', 'failed')),
            total_contacts INTEGER DEFAULT 0,
            contacts_called INTEGER DEFAULT 0,
            contacts_completed INTEGER DEFAULT 0,
            contacts_answered INTEGER DEFAULT 0,
            contacts_failed INTEGER DEFAULT 0,
            contacts_no_answer INTEGER DEFAULT 0,
            contacts_busy INTEGER DEFAULT 0,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            started_by TEXT,
            settings TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('Created campaign_runs table');

    // Add run_id column to outbound_calls if not exists
    const columns = db.prepare("PRAGMA table_info(outbound_calls)").all();
    const hasRunId = columns.some(col => col.name === 'run_id');
    
    if (!hasRunId) {
        db.exec('ALTER TABLE outbound_calls ADD COLUMN run_id TEXT');
        console.log('Added run_id column to outbound_calls');
    } else {
        console.log('run_id column already exists in outbound_calls');
    }

    // Create indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_campaign_runs_campaign ON campaign_runs(campaign_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_campaign_runs_status ON campaign_runs(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_outbound_calls_run ON outbound_calls(run_id)`);
    console.log('Created indexes');

    console.log('Migration v2 completed successfully!');
} catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
}

db.close();
