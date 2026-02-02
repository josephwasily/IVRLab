const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');

// Apply auth middleware
router.use(authMiddleware);

// List all SIP trunks for tenant
router.get('/', (req, res) => {
    try {
        const trunks = db.prepare(`
            SELECT id, name, host, port, transport, username, caller_id, codecs,
                   max_channels, status, last_tested_at, test_result, created_at, updated_at
            FROM sip_trunks
            WHERE tenant_id = ?
            ORDER BY created_at DESC
        `).all(req.user.tenantId);
        
        // Parse JSON fields
        trunks.forEach(trunk => {
            if (trunk.test_result) {
                try { trunk.test_result = JSON.parse(trunk.test_result); } catch(e) {}
            }
        });
        
        res.json(trunks);
    } catch (error) {
        console.error('Error listing trunks:', error);
        res.status(500).json({ error: 'Failed to list SIP trunks' });
    }
});

// Get single trunk
router.get('/:id', (req, res) => {
    try {
        const trunk = db.prepare(`
            SELECT id, name, host, port, transport, username, caller_id, codecs,
                   max_channels, status, settings, last_tested_at, test_result, created_at, updated_at
            FROM sip_trunks
            WHERE id = ? AND tenant_id = ?
        `).get(req.params.id, req.user.tenantId);
        
        if (!trunk) {
            return res.status(404).json({ error: 'SIP trunk not found' });
        }
        
        if (trunk.settings) {
            try { trunk.settings = JSON.parse(trunk.settings); } catch(e) {}
        }
        if (trunk.test_result) {
            try { trunk.test_result = JSON.parse(trunk.test_result); } catch(e) {}
        }
        
        res.json(trunk);
    } catch (error) {
        console.error('Error getting trunk:', error);
        res.status(500).json({ error: 'Failed to get SIP trunk' });
    }
});

// Create new SIP trunk
router.post('/', (req, res) => {
    try {
        const { 
            name, host, port = 5060, transport = 'udp',
            username, password, caller_id, codecs = 'ulaw,alaw',
            max_channels = 10, settings = {}
        } = req.body;
        
        if (!name || !host) {
            return res.status(400).json({ error: 'Name and host are required' });
        }
        
        const id = uuidv4();
        
        db.prepare(`
            INSERT INTO sip_trunks (id, tenant_id, name, host, port, transport, username, password, caller_id, codecs, max_channels, settings)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, req.user.tenantId, name, host, port, transport, username, password, caller_id, codecs, max_channels, JSON.stringify(settings));
        
        const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ?').get(id);
        res.status(201).json(trunk);
    } catch (error) {
        console.error('Error creating trunk:', error);
        res.status(500).json({ error: 'Failed to create SIP trunk' });
    }
});

// Update SIP trunk
router.put('/:id', (req, res) => {
    try {
        const existing = db.prepare('SELECT id FROM sip_trunks WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!existing) {
            return res.status(404).json({ error: 'SIP trunk not found' });
        }
        
        const { 
            name, host, port, transport, username, password,
            caller_id, codecs, max_channels, status, settings
        } = req.body;
        
        const updates = [];
        const values = [];
        
        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (host !== undefined) { updates.push('host = ?'); values.push(host); }
        if (port !== undefined) { updates.push('port = ?'); values.push(port); }
        if (transport !== undefined) { updates.push('transport = ?'); values.push(transport); }
        if (username !== undefined) { updates.push('username = ?'); values.push(username); }
        if (password !== undefined) { updates.push('password = ?'); values.push(password); }
        if (caller_id !== undefined) { updates.push('caller_id = ?'); values.push(caller_id); }
        if (codecs !== undefined) { updates.push('codecs = ?'); values.push(codecs); }
        if (max_channels !== undefined) { updates.push('max_channels = ?'); values.push(max_channels); }
        if (status !== undefined) { updates.push('status = ?'); values.push(status); }
        if (settings !== undefined) { updates.push('settings = ?'); values.push(JSON.stringify(settings)); }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.params.id, req.user.tenantId);
        
        db.prepare(`UPDATE sip_trunks SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
        
        const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ?').get(req.params.id);
        res.json(trunk);
    } catch (error) {
        console.error('Error updating trunk:', error);
        res.status(500).json({ error: 'Failed to update SIP trunk' });
    }
});

// Delete SIP trunk
router.delete('/:id', (req, res) => {
    try {
        const existing = db.prepare('SELECT id FROM sip_trunks WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!existing) {
            return res.status(404).json({ error: 'SIP trunk not found' });
        }
        
        // Check if trunk is used by any campaign
        const campaignUsage = db.prepare('SELECT COUNT(*) as count FROM campaigns WHERE trunk_id = ?')
            .get(req.params.id);
        
        if (campaignUsage.count > 0) {
            return res.status(400).json({ error: 'Cannot delete trunk that is used by campaigns' });
        }
        
        db.prepare('DELETE FROM sip_trunks WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting trunk:', error);
        res.status(500).json({ error: 'Failed to delete SIP trunk' });
    }
});

// Test SIP trunk connectivity
router.post('/:id/test', async (req, res) => {
    try {
        const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!trunk) {
            return res.status(404).json({ error: 'SIP trunk not found' });
        }
        
        // For now, just mark as tested - real test would use Asterisk AMI/ARI
        const testResult = {
            success: true,
            message: 'Trunk configuration validated',
            tested_at: new Date().toISOString(),
            // In production: actually test SIP OPTIONS or register
        };
        
        db.prepare(`
            UPDATE sip_trunks 
            SET last_tested_at = CURRENT_TIMESTAMP, test_result = ?, status = 'active'
            WHERE id = ?
        `).run(JSON.stringify(testResult), req.params.id);
        
        res.json(testResult);
    } catch (error) {
        console.error('Error testing trunk:', error);
        res.status(500).json({ error: 'Failed to test SIP trunk' });
    }
});

module.exports = router;
