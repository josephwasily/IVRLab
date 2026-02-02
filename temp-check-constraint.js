const db = require('/app/src/db');

// Check campaign status constraint
const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='campaigns'").get();
console.log('Campaigns table SQL:', tableInfo.sql);

// We need to recreate the table or just update status to a valid value
// Since 'active' is not in the CHECK constraint, let's update campaign status to 'draft' (which is valid) during start and track running status via campaign_runs
