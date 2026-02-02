const db = require('/app/src/db');

// Check if updated_at column exists in campaigns
const columns = db.prepare("PRAGMA table_info(campaigns)").all();
console.log('Campaigns columns:', columns.map(c => c.name).join(', '));

const hasUpdatedAt = columns.some(col => col.name === 'updated_at');

if (!hasUpdatedAt) {
    db.exec('ALTER TABLE campaigns ADD COLUMN updated_at DATETIME');
    db.exec("UPDATE campaigns SET updated_at = created_at WHERE updated_at IS NULL");
    console.log('Added updated_at column to campaigns');
} else {
    console.log('updated_at column already exists in campaigns');
}
