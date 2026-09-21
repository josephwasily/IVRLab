/**
 * Drop the flat per-node `timeout` from collect nodes so the engine derives
 * the wait from how much the caller has to enter.
 *
 * Every flow generated so far baked `timeout: 10` into each collect node,
 * which meant one size for everything: a single-digit yes/no question waited
 * as long as a 9-digit account number, and a 9-digit entry allowed 10 seconds
 * between *each* digit. With the node value removed the engine applies the
 * standard two-wait model instead --
 *
 *   first digit  COLLECT_FIRST_DIGIT_TIMEOUT (default 5s)
 *   each further COLLECT_INTER_DIGIT_TIMEOUT (default 3s)
 *
 * -- so the budget scales as first + (maxDigits - 1) x inter:
 *
 *   1-digit question   5s
 *   6-digit account   20s   (3s between digits)
 *   9-digit account   29s   (3s between digits)
 *
 * A node that genuinely needs longer can keep an explicit `timeout`; pass
 * --keep <nodeId,nodeId> to preserve specific ones.
 *
 * Usage inside the platform-api container:
 *   node src/db/retune-collect-timeouts.js                 # dry run
 *   node src/db/retune-collect-timeouts.js --apply
 *   node src/db/retune-collect-timeouts.js --apply --keep enter_account
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const keepArg = args.indexOf('--keep');
const keep = new Set(keepArg !== -1 && args[keepArg + 1] ? args[keepArg + 1].split(',') : []);

const FIRST = parseInt(process.env.COLLECT_FIRST_DIGIT_TIMEOUT || '5', 10);
const INTER = parseInt(process.env.COLLECT_INTER_DIGIT_TIMEOUT || '3', 10);

const db = new Database(DB_PATH);
const flows = db.prepare("SELECT id, name, extension, flow_data FROM ivr_flows").all();

console.log('================================================================');
console.log('Retune collect timeouts');
console.log('================================================================');
console.log(`db:    ${DB_PATH}`);
console.log(`mode:  ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
console.log(`model: first digit ${FIRST}s, inter-digit ${INTER}s`);
if (keep.size) console.log(`keep:  ${[...keep].join(', ')}`);
console.log('');

const update = db.prepare(
  'UPDATE ivr_flows SET flow_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
);

let flowsChanged = 0, nodesChanged = 0, nodesKept = 0;

const run = db.transaction(() => {
  for (const row of flows) {
    let flow;
    try { flow = JSON.parse(row.flow_data || '{}'); } catch (_e) { continue; }
    const nodes = flow.nodes || {};
    const touched = [];

    for (const node of Object.values(nodes)) {
      if (!node || node.type !== 'collect') continue;
      if (node.timeout === undefined) continue;
      if (keep.has(node.id)) { nodesKept++; continue; }

      const maxDigits = node.maxDigits || 10;
      const budget = FIRST + Math.max(0, maxDigits - 1) * INTER;
      touched.push(`${node.id} (maxDigits=${maxDigits}): ${node.timeout}s flat -> ${FIRST}s + ${Math.max(0, maxDigits - 1)}x${INTER}s = ${budget}s`);
      delete node.timeout;
      nodesChanged++;
    }

    if (!touched.length) continue;
    flowsChanged++;
    console.log(`--- ${row.name} (ext ${row.extension}) ---`);
    for (const t of touched) console.log(`    ${t}`);
    if (apply) update.run(JSON.stringify(flow), row.id);
  }
});

run();

console.log('');
console.log('----------------------------------------------------------------');
console.log(`flows changed: ${flowsChanged}   collect nodes retuned: ${nodesChanged}   kept: ${nodesKept}`);
if (!apply && nodesChanged > 0) console.log('\nDry run — nothing written. Re-run with --apply.');
console.log('----------------------------------------------------------------');

db.close();
