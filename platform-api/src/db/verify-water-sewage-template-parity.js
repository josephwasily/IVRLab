const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const TEMPLATE_NAME = process.env.TEMPLATE_NAME || 'Water and Sewage Complaint';
const FLOW_EXTENSION = process.env.FLOW_EXTENSION || '2009';

function compare(a, b, atPath, diffs) {
    const aType = Object.prototype.toString.call(a);
    const bType = Object.prototype.toString.call(b);

    if (aType !== bType) {
        diffs.push({ path: atPath, kind: 'type', flow: aType, template: bType });
        return;
    }

    if (a && typeof a === 'object') {
        if (Array.isArray(a)) {
            const max = Math.max(a.length, b.length);
            for (let i = 0; i < max; i += 1) {
                compare(a[i], b[i], `${atPath}[${i}]`, diffs);
            }
            return;
        }

        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const key of keys) {
            const nextPath = atPath ? `${atPath}.${key}` : key;
            compare(a[key], b[key], nextPath, diffs);
        }
        return;
    }

    if (a !== b) {
        diffs.push({ path: atPath, kind: 'value', flow: a, template: b });
    }
}

function main() {
    const db = new Database(DB_PATH);
    try {
        const flowRow = db.prepare('SELECT id, name, flow_data FROM ivr_flows WHERE extension = ?').get(FLOW_EXTENSION);
        if (!flowRow) {
            console.error(`[parity] IVR flow with extension ${FLOW_EXTENSION} not found.`);
            process.exit(2);
        }

        const templateRow = db.prepare('SELECT id, name, flow_data FROM ivr_templates WHERE name = ?').get(TEMPLATE_NAME);
        if (!templateRow) {
            console.error(`[parity] Template "${TEMPLATE_NAME}" not found.`);
            process.exit(2);
        }

        const flow = JSON.parse(flowRow.flow_data);
        const template = JSON.parse(templateRow.flow_data);
        const diffs = [];
        compare(flow, template, '', diffs);

        if (diffs.length === 0) {
            console.log(`[parity] OK: flow ${FLOW_EXTENSION} matches template "${TEMPLATE_NAME}".`);
            return;
        }

        console.error(`[parity] MISMATCH: found ${diffs.length} difference(s).`);
        for (const diff of diffs) {
            console.error(JSON.stringify(diff));
        }
        process.exit(1);
    } finally {
        db.close();
    }
}

main();
