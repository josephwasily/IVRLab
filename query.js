const Database = require('better-sqlite3');
const db = new Database('/app/data/platform.db');

console.log('TABLES:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());
console.log('CAMPAIGNS:', db.prepare("SELECT * FROM campaigns").all());
console.log('IVR_FLOWS:', db.prepare("SELECT id, name FROM ivr_flows").all());
try { console.log('TRUNKS:', db.prepare("SELECT * FROM trunks").all()); } catch(e) { console.log('No trunks table'); }
