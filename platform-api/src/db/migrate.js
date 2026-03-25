const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

console.log('Running database migrations...');

function hasTable(table) {
    const row = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
    `).get(table);
    return !!row;
}

function ensureColumn(table, column, typeDef) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!columns.includes(column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
        console.log(`Added ${table}.${column}`);
    }
}

// Preflight additive columns that are referenced by indexes in schema.sql.
if (hasTable('campaign_contacts')) {
    ensureColumn('campaign_contacts', 'run_id', 'TEXT');
}

// Read and execute schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Ensure additive columns for existing databases
ensureColumn('call_logs', 'outbound_call_id', 'TEXT');
ensureColumn('call_logs', 'called_number', 'TEXT');
ensureColumn('users', 'language', "TEXT DEFAULT 'ar' CHECK(language IN ('ar', 'en'))");
ensureColumn('campaign_contacts', 'run_id', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_call_logs_outbound_call ON call_logs(outbound_call_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_campaign_contacts_run ON campaign_contacts(run_id)');
db.exec("UPDATE users SET language = 'ar' WHERE language IS NULL OR TRIM(language) = ''");
db.exec("UPDATE users SET language = 'ar', updated_at = CURRENT_TIMESTAMP WHERE email = 'admin@demo.com'");

// Webhook columns for campaigns
ensureColumn('campaigns', 'webhook_api_key', 'TEXT');
ensureColumn('campaigns', 'flag_variable', 'TEXT');
ensureColumn('campaigns', 'flag_value', 'TEXT');

// Initialize extension pool (2000-2999 for inbound IVRs)
console.log('Initializing extension pool...');
const insertExt = db.prepare('INSERT OR IGNORE INTO extensions (extension, status) VALUES (?, ?)');
const insertMany = db.transaction((extensions) => {
    for (const ext of extensions) {
        insertExt.run(ext, 'available');
    }
});

const extensions = [];
for (let i = 2000; i <= 2099; i++) {  // Start with 100 extensions
    extensions.push(i.toString());
}
insertMany(extensions);

console.log(`Initialized ${extensions.length} extensions (2000-2099)`);
console.log('Database migration completed successfully!');
console.log(`Database location: ${DB_PATH}`);

db.close();
