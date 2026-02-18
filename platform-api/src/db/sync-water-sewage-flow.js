const Database = require('better-sqlite3');
const path = require('path');
const { randomUUID } = require('crypto');

function getArgValue(name) {
    const exact = `--${name}`;
    const withEqPrefix = `${exact}=`;

    for (let i = 0; i < process.argv.length; i += 1) {
        const arg = process.argv[i];
        if (arg.startsWith(withEqPrefix)) {
            return arg.slice(withEqPrefix.length);
        }
        if (arg === exact && process.argv[i + 1]) {
            return process.argv[i + 1];
        }
    }

    return undefined;
}

const DB_PATH = getArgValue('db-path') || process.env.DB_PATH || path.join(__dirname, '../../data/platform.db');
const TEMPLATE_NAME = getArgValue('template') || process.env.TEMPLATE_NAME || 'Water and Sewage Complaint';
const FLOW_EXTENSION = getArgValue('extension') || process.env.FLOW_EXTENSION || '2009';
const TENANT_SLUG = getArgValue('tenant-slug') || process.env.TENANT_SLUG || 'demo';
const FLOW_NAME = getArgValue('flow-name') || process.env.FLOW_NAME || TEMPLATE_NAME;

function main() {
    const db = new Database(DB_PATH);

    try {
        const templateRow = db.prepare('SELECT id, name, flow_data FROM ivr_templates WHERE name = ?').get(TEMPLATE_NAME);
        if (!templateRow) {
            console.error(`[sync] Template "${TEMPLATE_NAME}" not found.`);
            process.exit(2);
        }

        const tenantRow = db.prepare('SELECT id, slug FROM tenants WHERE slug = ?').get(TENANT_SLUG)
            || db.prepare('SELECT id, slug FROM tenants ORDER BY created_at ASC LIMIT 1').get();
        if (!tenantRow) {
            console.error('[sync] No tenant found. Run migrate/seed first.');
            process.exit(2);
        }

        const adminUser = db.prepare('SELECT id FROM users WHERE tenant_id = ? ORDER BY created_at ASC LIMIT 1').get(tenantRow.id);

        let flowRow = db.prepare('SELECT id FROM ivr_flows WHERE extension = ?').get(FLOW_EXTENSION);

        if (flowRow) {
            db.prepare(`
                UPDATE ivr_flows
                SET name = ?, description = ?, status = 'active', language = 'ar', flow_data = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                FLOW_NAME,
                `Template-synced flow for extension ${FLOW_EXTENSION}`,
                templateRow.flow_data,
                flowRow.id
            );
            console.log(`[sync] Updated existing flow ${flowRow.id} on extension ${FLOW_EXTENSION}.`);
        } else {
            const newFlowId = randomUUID();
            db.prepare(`
                INSERT INTO ivr_flows (id, tenant_id, name, description, extension, status, language, flow_data, created_by)
                VALUES (?, ?, ?, ?, ?, 'active', 'ar', ?, ?)
            `).run(
                newFlowId,
                tenantRow.id,
                FLOW_NAME,
                `Template-synced flow for extension ${FLOW_EXTENSION}`,
                FLOW_EXTENSION,
                templateRow.flow_data,
                adminUser?.id || null
            );
            flowRow = { id: newFlowId };
            console.log(`[sync] Created new flow ${flowRow.id} on extension ${FLOW_EXTENSION}.`);
        }

        db.prepare('INSERT OR IGNORE INTO extensions (extension, status) VALUES (?, ?)').run(FLOW_EXTENSION, 'available');
        db.prepare(`
            UPDATE extensions
            SET status = 'assigned', tenant_id = ?, ivr_id = ?, assigned_at = CURRENT_TIMESTAMP
            WHERE extension = ?
        `).run(tenantRow.id, flowRow.id, FLOW_EXTENSION);

        console.log(`[sync] Extension ${FLOW_EXTENSION} assigned to flow ${flowRow.id} (tenant: ${tenantRow.slug}).`);
        console.log(`[sync] Flow now matches template "${TEMPLATE_NAME}".`);
    } finally {
        db.close();
    }
}

main();
