const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./index');

const EMAIL = process.env.REPORT_VIEWER_EMAIL || 'user@demo.com';
const PASSWORD = process.env.REPORT_VIEWER_PASSWORD || 'user123';

try {
    const tenant = db.prepare("SELECT id FROM tenants WHERE slug = 'demo'").get();
    if (!tenant) {
        console.error('Demo tenant not found.');
        process.exit(1);
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL);
    if (existing) {
        db.prepare(`
            UPDATE users
            SET tenant_id = ?, role = 'viewer', status = 'active', name = 'Reports Viewer', updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
        `).run(tenant.id, EMAIL);
        console.log(`Updated reports user: ${EMAIL}`);
    } else {
        const id = uuidv4();
        const hash = bcrypt.hashSync(PASSWORD, 10);
        db.prepare(`
            INSERT INTO users (id, tenant_id, email, password_hash, name, role)
            VALUES (?, ?, ?, ?, ?, 'viewer')
        `).run(id, tenant.id, EMAIL, hash, 'Reports Viewer');
        console.log(`Created reports user: ${EMAIL} / ${PASSWORD}`);
    }
} catch (error) {
    console.error('Failed to ensure reports user:', error);
    process.exit(1);
}
