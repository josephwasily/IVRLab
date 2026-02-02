/**
 * Migration to add missing columns to campaigns table
 */
const db = require('./index');

console.log('Running campaigns table migration...');

// Check if description column exists
const columns = db.pragma('table_info(campaigns)');
const columnNames = columns.map(c => c.name);

console.log('Current campaigns columns:', columnNames.join(', '));

const migrations = [];

// Add missing columns
if (!columnNames.includes('description')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN description TEXT");
}

if (!columnNames.includes('campaign_type')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN campaign_type TEXT DEFAULT 'survey'");
}

if (!columnNames.includes('trunk_id')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN trunk_id TEXT");
}

if (!columnNames.includes('caller_id')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN caller_id TEXT");
}

if (!columnNames.includes('max_concurrent_calls')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN max_concurrent_calls INTEGER DEFAULT 5");
}

if (!columnNames.includes('calls_per_minute')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN calls_per_minute INTEGER DEFAULT 10");
}

if (!columnNames.includes('retry_delay_minutes')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN retry_delay_minutes INTEGER DEFAULT 30");
}

if (!columnNames.includes('scheduled_at')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN scheduled_at DATETIME");
}

if (!columnNames.includes('updated_at')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN updated_at DATETIME");
}

if (!columnNames.includes('max_attempts')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN max_attempts INTEGER DEFAULT 3");
}

if (!columnNames.includes('created_by')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN created_by TEXT");
}

if (!columnNames.includes('total_contacts')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN total_contacts INTEGER DEFAULT 0");
}

if (!columnNames.includes('contacts_called')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN contacts_called INTEGER DEFAULT 0");
}

if (!columnNames.includes('contacts_completed')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN contacts_completed INTEGER DEFAULT 0");
}

if (!columnNames.includes('contacts_failed')) {
    migrations.push("ALTER TABLE campaigns ADD COLUMN contacts_failed INTEGER DEFAULT 0");
}

// Check campaign_runs table
const runsColumns = db.pragma('table_info(campaign_runs)');
if (runsColumns.length === 0) {
    // Table doesn't exist, create it
    migrations.push(`
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        )
    `);
}

// Run migrations
if (migrations.length > 0) {
    console.log(`Running ${migrations.length} migrations...`);
    for (const sql of migrations) {
        try {
            console.log('Executing:', sql.substring(0, 60) + '...');
            db.exec(sql);
            console.log('  ✓ Success');
        } catch (e) {
            console.log('  ✗ Error:', e.message);
        }
    }
} else {
    console.log('No migrations needed - all columns exist');
}

// Verify
const finalColumns = db.pragma('table_info(campaigns)');
console.log('\nFinal campaigns columns:', finalColumns.map(c => c.name).join(', '));

const finalRuns = db.pragma('table_info(campaign_runs)');
console.log('campaign_runs columns:', finalRuns.map(c => c.name).join(', '));

console.log('\nMigration complete!');
