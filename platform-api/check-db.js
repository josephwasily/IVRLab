const db = require('better-sqlite3')('/app/data/ivr.db');

// List all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

// Check campaigns table columns
const campaignCols = db.pragma('table_info(campaigns)');
console.log('\nCampaigns columns:', campaignCols.map(c => c.name).join(', '));

// Check if outbound_calls exists
const callsCols = db.pragma('table_info(outbound_calls)');
console.log('Outbound calls columns:', callsCols.map(c => c.name).join(', '));

// Check campaign_contacts
const contactsCols = db.pragma('table_info(campaign_contacts)');
console.log('Campaign contacts columns:', contactsCols.map(c => c.name).join(', '));

db.close();
