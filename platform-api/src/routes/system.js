const express = require('express');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const ASTERISK_HOST = process.env.ASTERISK_HOST || 'asterisk';
const ASTERISK_AMI_PORT = parseInt(process.env.ASTERISK_AMI_PORT || '5038', 10);
const ASTERISK_LOG_PATH = process.env.ASTERISK_LOG_PATH || '/app/asterisk-log/messages.log';
const ASTERISK_PJSIP_PATH = process.env.ASTERISK_PJSIP_PATH || '/app/asterisk-pjsip.conf';
const EXTERNAL_IP = process.env.EXTERNAL_IP;
const AMI_USER = process.env.AMI_USER || 'admin';
const AMI_SECRET = process.env.AMI_SECRET || 'amipass';

router.use(authMiddleware);

function checkAsteriskTcp() {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;
        const start = Date.now();

        const finish = (running, error = null) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve({
                running,
                latencyMs: Date.now() - start,
                error
            });
        };

        socket.setTimeout(1500);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false, 'timeout'));
        socket.once('error', (err) => finish(false, err.message));
        socket.connect(ASTERISK_AMI_PORT, ASTERISK_HOST);
    });
}

function tailFile(filePath, maxLines = 200) {
    const stats = fs.statSync(filePath);
    const bytesToRead = Math.min(stats.size, 256 * 1024);
    const start = Math.max(0, stats.size - bytesToRead);
    const fd = fs.openSync(filePath, 'r');

    try {
        const buffer = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buffer, 0, bytesToRead, start);
        const content = buffer.toString('utf8');
        const lines = content.split(/\r?\n/).filter(Boolean);
        return {
            lines: lines.slice(-maxLines),
            size: stats.size,
            modifiedAt: stats.mtime.toISOString()
        };
    } finally {
        fs.closeSync(fd);
    }
}

function sendAMICommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let response = '';
        let loggedIn = false;

        client.setTimeout(5000);

        client.connect(ASTERISK_AMI_PORT, ASTERISK_HOST, () => {});

        client.on('data', (data) => {
            response += data.toString();

            if (!loggedIn && response.includes('Asterisk Call Manager')) {
                const loginCmd = `Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_SECRET}\r\n\r\n`;
                client.write(loginCmd);
                loggedIn = true;
                response = '';
            } else if (loggedIn && response.includes('Response: Success') && !response.includes(`ActionID:`)) {
                let cmd = `Action: ${action}\r\n`;
                for (const [key, value] of Object.entries(params)) {
                    cmd += `${key}: ${value}\r\n`;
                }
                cmd += `\r\n`;
                client.write(cmd);
                response = '';
            } else if (response.includes('Response: Error') || response.includes('Response: Success')) {
                client.end();
                if (response.includes('Response: Error')) {
                    reject(new Error(response));
                } else {
                    resolve(response);
                }
            }
        });

        client.on('timeout', () => {
            client.destroy();
            reject(new Error('AMI connection timeout'));
        });

        client.on('error', (err) => reject(err));
    });
}

async function setPjsipLogger(enabled) {
    const value = enabled ? 'on' : 'off';
    return sendAMICommand('Command', { Command: `pjsip set logger ${value}` });
}

function getAsteriskExternalMediaAddress() {
    try {
        if (!fs.existsSync(ASTERISK_PJSIP_PATH)) return null;
        const content = fs.readFileSync(ASTERISK_PJSIP_PATH, 'utf8');
        const match = content.match(/external_media_address\s*=\s*([0-9.]+)/);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
}

router.get('/asterisk/status', async (req, res) => {
    try {
        const tcp = await checkAsteriskTcp();
        const logExists = fs.existsSync(ASTERISK_LOG_PATH);
        const asteriskExternalIp = getAsteriskExternalMediaAddress();
        const ipMismatch = EXTERNAL_IP && asteriskExternalIp && EXTERNAL_IP !== asteriskExternalIp;

        let logMeta = null;
        if (logExists) {
            const stats = fs.statSync(ASTERISK_LOG_PATH);
            logMeta = {
                path: ASTERISK_LOG_PATH,
                size: stats.size,
                modifiedAt: stats.mtime.toISOString()
            };
        }

        res.json({
            running: tcp.running,
            host: ASTERISK_HOST,
            port: ASTERISK_AMI_PORT,
            checkedAt: new Date().toISOString(),
            connectivity: tcp,
            externalIp: EXTERNAL_IP || null,
            asteriskExternalMediaAddress: asteriskExternalIp,
            warnings: ipMismatch ? [
                `Asterisk external_media_address (${asteriskExternalIp}) does not match EXTERNAL_IP (${EXTERNAL_IP})`
            ] : [],
            log: {
                available: logExists,
                ...logMeta
            }
        });
    } catch (error) {
        console.error('Error checking Asterisk status:', error);
        res.status(500).json({ error: 'Failed to check Asterisk status' });
    }
});

router.get('/asterisk/logs', async (req, res) => {
    try {
        const verboseParam = String(req.query.verbose || '').toLowerCase();
        if (verboseParam === '1' || verboseParam === 'true' || verboseParam === 'on') {
            try { await setPjsipLogger(true); } catch (e) {}
        }
        if (verboseParam === '0' || verboseParam === 'false' || verboseParam === 'off') {
            try { await setPjsipLogger(false); } catch (e) {}
        }

        const linesParam = parseInt(req.query.lines || '200', 10);
        const lines = Number.isFinite(linesParam) ? Math.min(Math.max(linesParam, 20), 1000) : 200;

        if (!fs.existsSync(ASTERISK_LOG_PATH)) {
            return res.status(404).json({
                error: 'Asterisk log file not found',
                path: ASTERISK_LOG_PATH
            });
        }

        const data = tailFile(ASTERISK_LOG_PATH, lines);
        res.json({
            path: path.basename(ASTERISK_LOG_PATH),
            lines: data.lines,
            lineCount: data.lines.length,
            fileSize: data.size,
            modifiedAt: data.modifiedAt
        });
    } catch (error) {
        console.error('Error reading Asterisk logs:', error);
        res.status(500).json({ error: 'Failed to read Asterisk logs' });
    }
});

router.post('/asterisk/logging', async (req, res) => {
    try {
        const enabled = !!req.body?.pjsip;
        await setPjsipLogger(enabled);
        res.json({ success: true, pjsip: enabled });
    } catch (error) {
        console.error('Error toggling PJSIP logger:', error);
        res.status(500).json({ error: 'Failed to toggle PJSIP logger' });
    }
});

module.exports = router;
