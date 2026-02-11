const express = require('express');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const ASTERISK_HOST = process.env.ASTERISK_HOST || 'asterisk';
const ASTERISK_AMI_PORT = parseInt(process.env.ASTERISK_AMI_PORT || '5038', 10);
const ASTERISK_LOG_PATH = process.env.ASTERISK_LOG_PATH || '/app/asterisk-log/messages.log';

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

router.get('/asterisk/status', async (req, res) => {
    try {
        const tcp = await checkAsteriskTcp();
        const logExists = fs.existsSync(ASTERISK_LOG_PATH);

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

router.get('/asterisk/logs', (req, res) => {
    try {
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

module.exports = router;
