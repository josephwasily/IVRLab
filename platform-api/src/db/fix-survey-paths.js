// Fix survey prompt paths in database
const Database = require('better-sqlite3');
const db = new Database('/app/data/platform.db');

// Update survey prompts to use correct path
const result = db.prepare(`UPDATE prompts SET filename = REPLACE(filename, 'customer/', 'survey/') WHERE filename LIKE 'customer/%'`).run();
console.log('Updated', result.changes, 'prompts');

// Verify
const prompts = db.prepare(`SELECT name, filename FROM prompts WHERE name LIKE 'survey_%'`).all();
console.log('Survey prompts:');
prompts.forEach(p => console.log('  ' + p.name + ' -> ' + p.filename));

db.close();
