const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const csv = require('csv-parse/sync');

// Configure multer for CSV uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

// Apply auth middleware
router.use(authMiddleware);

// List all campaigns for tenant
router.get('/', (req, res) => {
    try {
        const { status } = req.query;
        
        let query = `
            SELECT c.*, 
                   i.name as ivr_name,
                   (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id) as total_contacts,
                   (SELECT COUNT(*) FROM campaign_runs WHERE campaign_id = c.id) as run_count
            FROM campaigns c
            LEFT JOIN ivr_flows i ON c.ivr_id = i.id
            WHERE c.tenant_id = ?
        `;
        const params = [req.user.tenantId];
        
        if (status) {
            query += ' AND c.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY c.created_at DESC';
        
        const campaigns = db.prepare(query).all(...params);
        
        // Parse settings and add computed fields
        campaigns.forEach(c => {
            if (c.settings) {
                try { 
                    c.settings = JSON.parse(c.settings);
                    // Extract common fields from settings for UI compatibility
                    if (!c.trunk_id && c.settings.trunk_id) c.trunk_id = c.settings.trunk_id;
                    if (!c.caller_id && c.settings.caller_id) c.caller_id = c.settings.caller_id;
                    if (!c.description && c.settings.description) c.description = c.settings.description;
                    if (!c.campaign_type && c.settings.campaign_type) c.campaign_type = c.settings.campaign_type;
                    c.max_concurrent_calls = c.max_concurrent_calls || c.settings.max_concurrent_calls;
                    c.retry_attempts = c.max_attempts || c.settings.retry_attempts;
                    c.retry_delay_minutes = c.retry_delay_minutes || c.settings.retry_delay_minutes;
                } catch(e) {}
            }
            
            // Get trunk name if trunk_id exists
            if (c.trunk_id) {
                const trunk = db.prepare('SELECT name FROM sip_trunks WHERE id = ?').get(c.trunk_id);
                c.trunk_name = trunk ? trunk.name : null;
            }
            
            // Get active run info if any
            const activeRun = db.prepare(`
                SELECT id, run_number, status, total_contacts, contacts_completed, contacts_failed, started_at
                FROM campaign_runs 
                WHERE campaign_id = ? AND status IN ('running', 'paused')
                ORDER BY run_number DESC LIMIT 1
            `).get(c.id);
            
            c.active_run = activeRun || null;
            c.is_running = !!activeRun && activeRun.status === 'running';
            c.is_paused = !!activeRun && activeRun.status === 'paused';
        });
        
        res.json(campaigns);
    } catch (error) {
        console.error('Error listing campaigns:', error);
        res.status(500).json({ error: 'Failed to list campaigns' });
    }
});

// Get single campaign with details
router.get('/:id', (req, res) => {
    try {
        const campaign = db.prepare(`
            SELECT c.*, 
                   i.name as ivr_name
            FROM campaigns c
            LEFT JOIN ivr_flows i ON c.ivr_id = i.id
            WHERE c.id = ? AND c.tenant_id = ?
        `).get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        if (campaign.settings) {
            try { 
                campaign.settings = JSON.parse(campaign.settings);
                // Extract common fields from settings
                campaign.trunk_id = campaign.settings.trunk_id;
                campaign.caller_id = campaign.settings.caller_id;
                campaign.description = campaign.settings.description;
                campaign.campaign_type = campaign.settings.campaign_type;
                campaign.max_concurrent_calls = campaign.settings.max_concurrent_calls;
                campaign.retry_attempts = campaign.settings.retry_attempts;
                campaign.retry_delay_minutes = campaign.settings.retry_delay_minutes;
                
                // Get trunk name
                if (campaign.trunk_id) {
                    const trunk = db.prepare('SELECT name FROM sip_trunks WHERE id = ?').get(campaign.trunk_id);
                    campaign.trunk_name = trunk ? trunk.name : null;
                }
            } catch(e) {}
        }
        
        // Default values
        campaign.total_contacts = campaign.total_contacts || 0;
        campaign.contacts_called = campaign.contacts_called || 0;
        campaign.contacts_completed = campaign.contacts_completed || 0;
        campaign.contacts_failed = campaign.contacts_failed || 0;
        
        // Get triggers (if table exists)
        try {
            campaign.triggers = db.prepare(`
                SELECT * FROM campaign_triggers WHERE campaign_id = ?
            `).all(req.params.id);
        } catch (e) {
            campaign.triggers = [];
        }
        
        res.json(campaign);
    } catch (error) {
        console.error('Error getting campaign:', error);
        res.status(500).json({ error: 'Failed to get campaign' });
    }
});

// Create new campaign
router.post('/', (req, res) => {
    try {
        const { 
            name, description, campaign_type = 'survey',
            ivr_id, trunk_id, caller_id,
            max_concurrent_calls = 5, calls_per_minute = 10,
            max_attempts = 3, retry_delay_minutes = 30,
            settings = {}
        } = req.body;
        
        if (!name || !ivr_id) {
            return res.status(400).json({ error: 'Name and IVR are required' });
        }
        
        // Verify IVR exists
        const ivr = db.prepare('SELECT id FROM ivr_flows WHERE id = ? AND tenant_id = ?')
            .get(ivr_id, req.user.tenantId);
        if (!ivr) {
            return res.status(400).json({ error: 'IVR flow not found' });
        }
        
        // Verify trunk if provided
        if (trunk_id) {
            const trunk = db.prepare('SELECT id FROM sip_trunks WHERE id = ? AND tenant_id = ?')
                .get(trunk_id, req.user.tenantId);
            if (!trunk) {
                return res.status(400).json({ error: 'SIP trunk not found' });
            }
        }
        
        const id = uuidv4();
        
        db.prepare(`
            INSERT INTO campaigns (id, tenant_id, name, description, campaign_type, ivr_id, trunk_id, caller_id,
                max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, settings, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, req.user.tenantId, name, description, campaign_type, ivr_id, trunk_id, caller_id,
            max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, 
            JSON.stringify(settings), req.user.userId);
        
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
        res.status(201).json(campaign);
    } catch (error) {
        console.error('Error creating campaign:', error);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

// Update campaign
router.put('/:id', (req, res) => {
    try {
        const existing = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!existing) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        if (existing.status === 'running') {
            return res.status(400).json({ error: 'Cannot modify running campaign' });
        }
        
        const { 
            name, description, campaign_type, ivr_id, trunk_id, caller_id,
            max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, settings
        } = req.body;
        
        const updates = [];
        const values = [];
        
        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (campaign_type !== undefined) { updates.push('campaign_type = ?'); values.push(campaign_type); }
        if (ivr_id !== undefined) { updates.push('ivr_id = ?'); values.push(ivr_id); }
        if (trunk_id !== undefined) { updates.push('trunk_id = ?'); values.push(trunk_id); }
        if (caller_id !== undefined) { updates.push('caller_id = ?'); values.push(caller_id); }
        if (max_concurrent_calls !== undefined) { updates.push('max_concurrent_calls = ?'); values.push(max_concurrent_calls); }
        if (calls_per_minute !== undefined) { updates.push('calls_per_minute = ?'); values.push(calls_per_minute); }
        if (max_attempts !== undefined) { updates.push('max_attempts = ?'); values.push(max_attempts); }
        if (retry_delay_minutes !== undefined) { updates.push('retry_delay_minutes = ?'); values.push(retry_delay_minutes); }
        if (settings !== undefined) { updates.push('settings = ?'); values.push(JSON.stringify(settings)); }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.params.id, req.user.tenantId);
        
        db.prepare(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
        
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        res.json(campaign);
    } catch (error) {
        console.error('Error updating campaign:', error);
        res.status(500).json({ error: 'Failed to update campaign' });
    }
});

// Delete campaign
router.delete('/:id', (req, res) => {
    try {
        const existing = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!existing) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        if (existing.status === 'running') {
            return res.status(400).json({ error: 'Cannot delete running campaign' });
        }
        
        // Delete related data
        db.prepare('DELETE FROM outbound_calls WHERE campaign_id = ?').run(req.params.id);
        db.prepare('DELETE FROM campaign_contacts WHERE campaign_id = ?').run(req.params.id);
        db.prepare('DELETE FROM campaign_triggers WHERE campaign_id = ?').run(req.params.id);
        db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting campaign:', error);
        res.status(500).json({ error: 'Failed to delete campaign' });
    }
});

// Add manual contacts - MUST be before /:id/contacts to avoid route conflict
router.post('/:id/contacts/manual', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const { contacts, clear_existing = false } = req.body;
        
        if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({ error: 'No contacts provided' });
        }
        
        // Validate contacts
        const invalidContacts = contacts.filter(c => !c.phone_number || c.phone_number.trim() === '');
        if (invalidContacts.length > 0) {
            return res.status(400).json({ error: 'Some contacts are missing phone numbers' });
        }
        
        // Clear existing contacts if requested
        if (clear_existing) {
            db.prepare('DELETE FROM campaign_contacts WHERE campaign_id = ?').run(req.params.id);
        }
        
        // Insert contacts
        const insertStmt = db.prepare(`
            INSERT INTO campaign_contacts (id, campaign_id, phone_number, variables)
            VALUES (?, ?, ?, ?)
        `);
        
        let imported = 0;
        
        const insertMany = db.transaction((contactList) => {
            for (const contact of contactList) {
                const phone = contact.phone_number.trim();
                const variables = {};
                if (contact.name) variables.name = contact.name;
                if (contact.variables) Object.assign(variables, contact.variables);
                
                insertStmt.run(uuidv4(), req.params.id, phone, JSON.stringify(variables));
                imported++;
            }
        });
        
        insertMany(contacts);
        
        // Get total contacts count (not stored in campaigns table - computed on read)
        const totalContacts = db.prepare('SELECT COUNT(*) as count FROM campaign_contacts WHERE campaign_id = ?')
            .get(req.params.id).count;
        
        res.json({ 
            success: true, 
            imported, 
            total: totalContacts 
        });
    } catch (error) {
        console.error('Error adding manual contacts:', error);
        res.status(500).json({ error: error.message || 'Failed to add contacts' });
    }
});

// Upload contacts CSV
router.post('/:id/contacts', upload.single('file'), (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No CSV file uploaded' });
        }
        
        const { phone_column = 'phone', clear_existing = 'false' } = req.body;
        
        // Parse CSV
        const records = csv.parse(req.file.buffer.toString(), {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        
        if (records.length === 0) {
            return res.status(400).json({ error: 'CSV file is empty' });
        }
        
        // Validate phone column exists
        const firstRecord = records[0];
        if (!firstRecord[phone_column]) {
            return res.status(400).json({ 
                error: `Column "${phone_column}" not found in CSV`,
                available_columns: Object.keys(firstRecord)
            });
        }
        
        // Clear existing contacts if requested
        if (clear_existing === 'true') {
            db.prepare('DELETE FROM campaign_contacts WHERE campaign_id = ?').run(req.params.id);
        }
        
        // Insert contacts
        const insertStmt = db.prepare(`
            INSERT INTO campaign_contacts (id, campaign_id, phone_number, variables)
            VALUES (?, ?, ?, ?)
        `);
        
        let imported = 0;
        let skipped = 0;
        
        const insertMany = db.transaction((records) => {
            for (const record of records) {
                const phone = record[phone_column]?.trim();
                if (!phone) {
                    skipped++;
                    continue;
                }
                
                // Store all columns as variables (except phone)
                const variables = { ...record };
                delete variables[phone_column];
                
                insertStmt.run(uuidv4(), req.params.id, phone, JSON.stringify(variables));
                imported++;
            }
        });
        
        insertMany(records);
        
        // Get total contacts count (computed, not stored)
        const totalContacts = db.prepare('SELECT COUNT(*) as count FROM campaign_contacts WHERE campaign_id = ?')
            .get(req.params.id).count;
        
        res.json({ 
            success: true, 
            imported, 
            skipped, 
            total: totalContacts 
        });
    } catch (error) {
        console.error('Error uploading contacts:', error);
        res.status(500).json({ error: error.message || 'Failed to upload contacts' });
    }
});

// List contacts
router.get('/:id/contacts', (req, res) => {
    try {
        const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const { status, limit = 100, offset = 0 } = req.query;
        
        let query = 'SELECT * FROM campaign_contacts WHERE campaign_id = ?';
        const params = [req.params.id];
        
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY id LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const contacts = db.prepare(query).all(...params);
        
        contacts.forEach(c => {
            if (c.variables) try { c.variables = JSON.parse(c.variables); } catch(e) {}
            if (c.result) try { c.result = JSON.parse(c.result); } catch(e) {}
        });
        
        const total = db.prepare('SELECT COUNT(*) as count FROM campaign_contacts WHERE campaign_id = ?')
            .get(req.params.id).count;
        
        res.json({ contacts, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (error) {
        console.error('Error listing contacts:', error);
        res.status(500).json({ error: 'Failed to list contacts' });
    }
});

// Delete all contacts
router.delete('/:id/contacts', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        if (campaign.status === 'running') {
            return res.status(400).json({ error: 'Cannot delete contacts while campaign is running' });
        }
        
        db.prepare('DELETE FROM campaign_contacts WHERE campaign_id = ?').run(req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting contacts:', error);
        res.status(500).json({ error: 'Failed to delete contacts' });
    }
});

// Get campaign statistics
router.get('/:id/stats', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Contact status breakdown
        const contactStats = db.prepare(`
            SELECT status, COUNT(*) as count 
            FROM campaign_contacts 
            WHERE campaign_id = ? 
            GROUP BY status
        `).all(req.params.id);
        
        // Call outcome breakdown
        const callStats = db.prepare(`
            SELECT status, COUNT(*) as count 
            FROM outbound_calls 
            WHERE campaign_id = ? 
            GROUP BY status
        `).all(req.params.id);
        
        // Average call duration
        const avgDuration = db.prepare(`
            SELECT AVG(duration) as avg_duration
            FROM outbound_calls
            WHERE campaign_id = ? AND status = 'completed' AND duration > 0
        `).get(req.params.id);
        
        res.json({
            campaign_id: req.params.id,
            status: campaign.status,
            total_contacts: campaign.total_contacts,
            contacts_called: campaign.contacts_called,
            contacts_completed: campaign.contacts_completed,
            contacts_failed: campaign.contacts_failed,
            contact_breakdown: contactStats,
            call_breakdown: callStats,
            avg_duration_seconds: avgDuration?.avg_duration || 0
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get campaign statistics' });
    }
});

// Get campaign runs (history of executions)
router.get('/:id/runs', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const runs = db.prepare(`
            SELECT cr.*, u.email as started_by_email
            FROM campaign_runs cr
            LEFT JOIN users u ON cr.started_by = u.id
            WHERE cr.campaign_id = ?
            ORDER BY cr.run_number DESC
        `).all(req.params.id);
        
        res.json(runs);
    } catch (error) {
        console.error('Error getting campaign runs:', error);
        res.status(500).json({ error: 'Failed to get campaign runs' });
    }
});

// Get specific run details
router.get('/:id/runs/:runId', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const run = db.prepare(`
            SELECT cr.*, u.email as started_by_email
            FROM campaign_runs cr
            LEFT JOIN users u ON cr.started_by = u.id
            WHERE cr.id = ? AND cr.campaign_id = ?
        `).get(req.params.runId, req.params.id);
        
        if (!run) {
            return res.status(404).json({ error: 'Run not found' });
        }
        
        // Get run statistics from outbound_calls
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_calls,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered,
                SUM(CASE WHEN status = 'no_answer' THEN 1 ELSE 0 END) as no_answer,
                SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) as busy,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(CASE WHEN duration > 0 THEN duration ELSE NULL END) as avg_duration
            FROM outbound_calls
            WHERE run_id = ?
        `).get(req.params.runId);
        
        run.stats = stats;
        res.json(run);
    } catch (error) {
        console.error('Error getting run details:', error);
        res.status(500).json({ error: 'Failed to get run details' });
    }
});

// Start campaign - creates a new run instance
router.post('/:id/start', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Parse settings if stored as JSON
        let settings = {};
        if (campaign.settings) {
            try { settings = JSON.parse(campaign.settings); } catch(e) {}
        }
        
        // Get trunk_id from campaign or settings
        const trunkId = campaign.trunk_id || settings.trunk_id;
        if (!trunkId) {
            return res.status(400).json({ error: 'Campaign must have a SIP trunk configured' });
        }
        
        // Get total contacts count
        const contactCount = db.prepare('SELECT COUNT(*) as count FROM campaign_contacts WHERE campaign_id = ?')
            .get(req.params.id).count;
        
        if (contactCount === 0) {
            return res.status(400).json({ error: 'Campaign has no contacts' });
        }
        
        // Check if there's already a running run for this campaign
        const runningRun = db.prepare(`
            SELECT * FROM campaign_runs WHERE campaign_id = ? AND status = 'running'
        `).get(req.params.id);
        
        if (runningRun) {
            return res.status(400).json({ error: 'Campaign already has an active run in progress' });
        }
        
        // Get the next run number
        const lastRun = db.prepare(`
            SELECT MAX(run_number) as max_run FROM campaign_runs WHERE campaign_id = ?
        `).get(req.params.id);
        const runNumber = (lastRun?.max_run || 0) + 1;
        
        // Create new run instance with settings snapshot
        const runId = uuidv4();
        const runSettings = {
            trunk_id: trunkId,
            ivr_id: campaign.ivr_id,
            caller_id: campaign.caller_id || settings.caller_id,
            max_concurrent_calls: campaign.max_concurrent_calls || settings.max_concurrent_calls,
            retry_attempts: campaign.max_attempts || settings.retry_attempts,
            retry_delay_minutes: campaign.retry_delay_minutes || settings.retry_delay_minutes
        };
        
        db.prepare(`
            INSERT INTO campaign_runs (id, campaign_id, run_number, status, total_contacts, started_by, settings)
            VALUES (?, ?, ?, 'running', ?, ?, ?)
        `).run(runId, req.params.id, runNumber, contactCount, req.user.id, JSON.stringify(runSettings));
        
        // Reset contact statuses for this new run
        db.prepare(`
            UPDATE campaign_contacts SET status = 'pending', attempts = 0, last_attempt_at = NULL, result = NULL
            WHERE campaign_id = ?
        `).run(req.params.id);
        
        // Note: Campaign status is now tracked via campaign_runs, not campaigns table
        // This allows multiple runs without changing the campaign definition
        
        console.log(`Campaign ${req.params.id} started - Run #${runNumber} (${runId})`);
        
        res.json({ 
            success: true, 
            message: `Campaign started - Run #${runNumber}`,
            run_id: runId,
            run_number: runNumber
        });
    } catch (error) {
        console.error('Error starting campaign:', error);
        res.status(500).json({ error: 'Failed to start campaign' });
    }
});

// Pause campaign run
router.post('/:id/pause', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Find running run
        const runningRun = db.prepare(`
            SELECT * FROM campaign_runs WHERE campaign_id = ? AND status = 'running'
        `).get(req.params.id);
        
        if (!runningRun) {
            return res.status(400).json({ error: 'No active run to pause' });
        }
        
        db.prepare(`
            UPDATE campaign_runs SET status = 'paused' WHERE id = ?
        `).run(runningRun.id);
        
        res.json({ success: true, message: 'Campaign run paused', run_id: runningRun.id });
    } catch (error) {
        console.error('Error pausing campaign:', error);
        res.status(500).json({ error: 'Failed to pause campaign' });
    }
});

// Resume campaign run
router.post('/:id/resume', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Find paused run
        const pausedRun = db.prepare(`
            SELECT * FROM campaign_runs WHERE campaign_id = ? AND status = 'paused'
        `).get(req.params.id);
        
        if (!pausedRun) {
            return res.status(400).json({ error: 'No paused run to resume' });
        }
        
        db.prepare(`
            UPDATE campaign_runs SET status = 'running' WHERE id = ?
        `).run(pausedRun.id);
        
        res.json({ success: true, message: 'Campaign run resumed', run_id: pausedRun.id });
    } catch (error) {
        console.error('Error resuming campaign:', error);
        res.status(500).json({ error: 'Failed to resume campaign' });
    }
});

// Cancel campaign run (or stop active run)
router.post('/:id/cancel', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Find any active run (running or paused)
        const activeRun = db.prepare(`
            SELECT * FROM campaign_runs WHERE campaign_id = ? AND status IN ('running', 'paused')
        `).get(req.params.id);
        
        if (!activeRun) {
            return res.status(400).json({ error: 'No active run to cancel' });
        }
        
        db.prepare(`
            UPDATE campaign_runs SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(activeRun.id);
        
        res.json({ success: true, message: 'Campaign run cancelled', run_id: activeRun.id });
    } catch (error) {
        console.error('Error cancelling campaign:', error);
        res.status(500).json({ error: 'Failed to cancel campaign' });
    }
});

module.exports = router;
