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

// Read and execute schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Ensure additive columns for existing databases
function ensureColumn(table, column, typeDef) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!columns.includes(column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
        console.log(`Added ${table}.${column}`);
    }
}

ensureColumn('call_logs', 'outbound_call_id', 'TEXT');
ensureColumn('call_logs', 'called_number', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_call_logs_outbound_call ON call_logs(outbound_call_id)');

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
