/**
 * Manages dynamic pjsip trunk configuration in Asterisk.
 *
 * When trunks are created/updated/deleted via the API, this service:
 *   1. Generates pjsip_trunks.conf from all active trunks in the DB
 *   2. Writes it to the shared Asterisk config volume
 *   3. Reloads pjsip via AMI
 *
 * The main pjsip.conf must include this file:
 *   #include pjsip_trunks.conf
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const db = require('../db/database');

const ASTERISK_HOST = process.env.ASTERISK_HOST || 'asterisk';
const AMI_PORT = parseInt(process.env.ASTERISK_AMI_PORT || '5038', 10);
const AMI_USER = process.env.AMI_USER || 'admin';
const AMI_SECRET = process.env.AMI_SECRET || 'amipass';
const PJSIP_TRUNKS_PATH = process.env.PJSIP_TRUNKS_PATH || '/asterisk-config/pjsip_trunks.conf';

function sendAMICommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let response = '';
        let loggedIn = false;
        let commandSent = false;

        client.setTimeout(5000);
        client.connect(AMI_PORT, ASTERISK_HOST, () => {});

        client.on('data', (data) => {
            response += data.toString();

            if (!loggedIn && response.includes('Asterisk Call Manager')) {
                client.write(`Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_SECRET}\r\n\r\n`);
                loggedIn = true;
                response = '';
            } else if (loggedIn && !commandSent && response.includes('Response: Success')) {
                let cmd = `Action: ${action}\r\n`;
                for (const [key, value] of Object.entries(params)) {
                    cmd += `${key}: ${value}\r\n`;
                }
                cmd += '\r\n';
                client.write(cmd);
                commandSent = true;
                response = '';
            } else if (commandSent && (response.includes('Response:') || response.includes('--END'))) {
                client.end();
                if (response.includes('Response: Error')) {
                    reject(new Error(response.trim()));
                } else {
                    resolve(response.trim());
                }
            }
        });

        client.on('timeout', () => { client.destroy(); reject(new Error('AMI timeout')); });
        client.on('error', (err) => reject(err));
    });
}

/**
 * Generate pjsip.conf snippet for a single trunk.
 * Each trunk gets: endpoint, aor, and identify sections.
 */
function generateTrunkConfig(trunk) {
    const settings = typeof trunk.settings === 'string'
        ? JSON.parse(trunk.settings || '{}')
        : (trunk.settings || {});

    // Use endpoint name from settings, or sanitize trunk name
    const endpointName = settings.endpoint
        || trunk.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const context = settings.context || 'from-ipoffice';
    const codecs = (trunk.codecs || 'ulaw,alaw').split(',').map(c => c.trim());

    let conf = '';
    conf += `; === Trunk: ${trunk.name} (${trunk.id}) ===\n`;

    // Endpoint
    conf += `[${endpointName}](endpoint-defaults)\n`;
    conf += `type=endpoint\n`;
    conf += `context=${context}\n`;
    conf += `disallow=all\n`;
    for (const codec of codecs) {
        conf += `allow=${codec}\n`;
    }
    if (trunk.username) {
        conf += `auth=${endpointName}\n`;
    }
    conf += `aors=${endpointName}\n`;
    if (settings.from_user) {
        conf += `from_user=${settings.from_user}\n`;
    }
    if (settings.from_domain) {
        conf += `from_domain=${settings.from_domain}\n`;
    }
    conf += '\n';

    // Auth (only if credentials provided)
    if (trunk.username) {
        conf += `[${endpointName}]\n`;
        conf += `type=auth\n`;
        conf += `auth_type=userpass\n`;
        conf += `username=${trunk.username}\n`;
        conf += `password=${trunk.password || ''}\n`;
        conf += '\n';
    }

    // AOR
    conf += `[${endpointName}]\n`;
    conf += `type=aor\n`;
    conf += `max_contacts=5\n`;
    conf += `qualify_frequency=60\n`;
    conf += `contact=sip:${trunk.host}:${trunk.port || 5060}\n`;
    conf += '\n';

    // Identify (match inbound calls by IP)
    conf += `[identify-${endpointName}]\n`;
    conf += `type=identify\n`;
    conf += `endpoint=${endpointName}\n`;
    conf += `match=${trunk.host}\n`;
    conf += '\n';

    return conf;
}

/**
 * Regenerate pjsip_trunks.conf from all active trunks and reload Asterisk.
 */
async function syncTrunksToAsterisk(tenantId) {
    // Get all active trunks (across all tenants if no tenantId, or for specific tenant)
    const trunks = tenantId
        ? db.prepare('SELECT * FROM sip_trunks WHERE status = ? AND tenant_id = ?').all('active', tenantId)
        : db.prepare('SELECT * FROM sip_trunks WHERE status = ?').all('active');

    // Actually get ALL active trunks for the config file (multi-tenant)
    const allTrunks = db.prepare('SELECT * FROM sip_trunks WHERE status = ?').all('active');

    let conf = '; Auto-generated by IVR-Lab platform-api\n';
    conf += `; Last updated: ${new Date().toISOString()}\n`;
    conf += `; Trunks: ${allTrunks.length}\n\n`;

    for (const trunk of allTrunks) {
        conf += generateTrunkConfig(trunk);
    }

    // Write config file
    const dir = path.dirname(PJSIP_TRUNKS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PJSIP_TRUNKS_PATH, conf, 'utf8');
    console.log(`[AsteriskConfig] Wrote ${allTrunks.length} trunks to ${PJSIP_TRUNKS_PATH}`);

    // Reload pjsip in Asterisk
    try {
        await sendAMICommand('Command', { Command: 'pjsip reload' });
        console.log('[AsteriskConfig] PJSIP reloaded successfully');
        return { success: true, trunks: allTrunks.length };
    } catch (err) {
        console.error('[AsteriskConfig] Failed to reload PJSIP:', err.message);
        return { success: false, trunks: allTrunks.length, error: err.message };
    }
}

module.exports = { syncTrunksToAsterisk, generateTrunkConfig };
