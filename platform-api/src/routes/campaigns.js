const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const csv = require('csv-parse/sync');
const XLSX = require('xlsx');
const net = require('net');

// AMI Configuration
const AMI_HOST = process.env.AMI_HOST || 'asterisk';
const AMI_PORT = parseInt(process.env.AMI_PORT || '5038');
const AMI_USER = process.env.AMI_USER || 'admin';
const AMI_SECRET = process.env.AMI_SECRET || 'amipass';
const CALL_RESULT_TIMEOUT_MS = parseInt(process.env.OUTBOUND_CALL_RESULT_TIMEOUT_MS || '45000', 10);
const CAMPAIGN_CONTACTS_TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'campaign-contacts-template.csv');

function parseTrunkSettings(trunk) {
    if (!trunk || !trunk.settings) return {};
    if (typeof trunk.settings === 'object') return trunk.settings;
    try {
        return JSON.parse(trunk.settings);
    } catch (e) {
        return {};
    }
}

function resolveTrunkEndpointName(trunk) {
    const settings = parseTrunkSettings(trunk);
    if (settings.endpoint) return String(settings.endpoint).trim();
    if (settings.endpoint_name) return String(settings.endpoint_name).trim();
    if (settings.asterisk_endpoint) return String(settings.asterisk_endpoint).trim();
    const trunkName = String(trunk?.name || '').toLowerCase();
    if (trunkName.includes('ip office') || trunkName.includes('ipoffice')) return 'ipoffice';
    return null;
}

function buildPjsipChannel(trunk, phoneNumber) {
    const target = String(phoneNumber || '').trim();
    const endpoint = resolveTrunkEndpointName(trunk);
    if (endpoint) {
        return `PJSIP/${target}@${endpoint}`;
    }
    return `PJSIP/${target}`;
}

/**
 * Send AMI command to Asterisk
 */
function sendAMICommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let response = '';
        let loggedIn = false;
        
        client.setTimeout(10000);
        
        client.connect(AMI_PORT, AMI_HOST, () => {
            console.log('Connected to AMI');
        });
        
        client.on('data', (data) => {
            response += data.toString();
            
            // First, login
            if (!loggedIn && response.includes('Asterisk Call Manager')) {
                const loginCmd = `Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_SECRET}\r\n\r\n`;
                client.write(loginCmd);
                loggedIn = true;
                response = '';
            }
            // After login success, send the actual command
            else if (loggedIn && response.includes('Response: Success') && !response.includes('Message: Originate')) {
                let cmd = `Action: ${action}\r\n`;
                for (const [key, value] of Object.entries(params)) {
                    cmd += `${key}: ${value}\r\n`;
                }
                cmd += `\r\n`;
                client.write(cmd);
                response = '';
            }
            // Check for final response
            else if (response.includes('Message: Originate') || response.includes('Response: Error')) {
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
        
        client.on('error', (err) => {
            reject(err);
        });
        
        client.on('close', () => {
            console.log('AMI connection closed');
        });
    });
}

// Configure multer for CSV / Excel uploads
const ALLOWED_UPLOAD_EXTS = ['.csv', '.xlsx', '.xls'];
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const lower = (file.originalname || '').toLowerCase();
        if (ALLOWED_UPLOAD_EXTS.some((ext) => lower.endsWith(ext))) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV or Excel files are allowed'));
        }
    }
});

// Apply auth middleware
router.use(authMiddleware);
router.use(requireRole('admin', 'editor', 'viewer'));

function stringifyResult(result) {
    try {
        return JSON.stringify(result || {});
    } catch (_error) {
        return '{}';
    }
}

function buildAttemptResult({ outcome, attemptNumber, maxAttempts, retryScheduled, details = {} }) {
    return {
        call_outcome: outcome,
        attempt_number: attemptNumber,
        retry_count: Math.max(0, attemptNumber - 1),
        max_attempts: maxAttempts,
        retry_scheduled: !!retryScheduled,
        ...details
    };
}

function parseCampaignSettings(campaign) {
    if (!campaign?.settings) return {};
    try {
        return JSON.parse(campaign.settings);
    } catch (_error) {
        return {};
    }
}

function getCampaignExecutionContext(campaign) {
    const settings = parseCampaignSettings(campaign);
    const trunkId = campaign.trunk_id || settings.trunk_id;
    if (!trunkId) {
        throw new Error('Campaign must have a SIP trunk configured');
    }

    const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ?').get(trunkId);
    if (!trunk) {
        throw new Error('SIP trunk not found');
    }

    let ivrExtension = null;
    if (campaign.ivr_id) {
        const ivr = db.prepare('SELECT extension FROM ivr_flows WHERE id = ?').get(campaign.ivr_id);
        ivrExtension = ivr?.extension || null;
    }

    const maxAttempts = parseInt(campaign.max_attempts || settings.retry_attempts || 3, 10);
    const runSettings = {
        trunk_id: trunkId,
        ivr_id: campaign.ivr_id,
        caller_id: campaign.caller_id || settings.caller_id,
        max_concurrent_calls: campaign.max_concurrent_calls || settings.max_concurrent_calls,
        retry_attempts: maxAttempts,
        retry_delay_minutes: campaign.retry_delay_minutes || settings.retry_delay_minutes
    };

    return {
        settings,
        trunk,
        trunkId,
        ivrId: campaign.ivr_id || null,
        ivrExtension,
        callerId: campaign.caller_id || settings.caller_id || trunk.caller_id || '1000',
        maxConcurrent: campaign.max_concurrent_calls || settings.max_concurrent_calls || 5,
        maxAttempts,
        runSettings
    };
}

function createCampaignRunRecord(campaignId, startedBy, totalContacts, runSettings) {
    const lastRun = db.prepare(`
        SELECT MAX(run_number) as max_run FROM campaign_runs WHERE campaign_id = ?
    `).get(campaignId);

    const runId = uuidv4();
    const runNumber = (lastRun?.max_run || 0) + 1;

    db.prepare(`
        INSERT INTO campaign_runs (id, campaign_id, run_number, status, total_contacts, started_by, settings)
        VALUES (?, ?, ?, 'running', ?, ?, ?)
    `).run(runId, campaignId, runNumber, totalContacts, startedBy, JSON.stringify(runSettings));

    return { runId, runNumber };
}

function insertContactsForRun({ campaignId, runId, contacts }) {
    const insertStmt = db.prepare(`
        INSERT INTO campaign_contacts (id, campaign_id, run_id, phone_number, variables)
        VALUES (?, ?, ?, ?, ?)
    `);

    let imported = 0;
    let duplicates = 0;
    let skipped = 0;
    const seenPhones = new Set();

    const insertMany = db.transaction((contactList) => {
        for (const contact of contactList) {
            const phone = String(contact.phone_number || '').trim();
            if (!phone) {
                skipped++;
                continue;
            }

            if (seenPhones.has(phone)) {
                duplicates++;
                continue;
            }

            const variables = {};
            if (contact.name) variables.name = contact.name;
            if (contact.variables && typeof contact.variables === 'object') {
                Object.assign(variables, contact.variables);
            }

            insertStmt.run(uuidv4(), campaignId, runId, phone, JSON.stringify(variables));
            seenPhones.add(phone);
            imported++;
        }
    });

    insertMany(contacts);

    return { imported, duplicates, skipped };
}

function parseCsvContactsFromRequest(file, phoneColumn = 'phone') {
    if (!file) {
        throw new Error('No file uploaded');
    }

    const lowerName = (file.originalname || '').toLowerCase();
    const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');

    let records;
    if (isExcel) {
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            throw new Error('Excel file has no sheets');
        }
        const sheet = workbook.Sheets[sheetName];
        records = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
        records = records.map((row) => {
            const trimmed = {};
            for (const key of Object.keys(row)) {
                trimmed[String(key).trim()] = typeof row[key] === 'string' ? row[key].trim() : row[key];
            }
            return trimmed;
        });
    } else {
        records = csv.parse(file.buffer.toString(), {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true
        });
    }

    if (records.length === 0) {
        throw new Error(isExcel ? 'Excel file is empty' : 'CSV file is empty');
    }

    const firstRecord = records[0];
    if (!(phoneColumn in firstRecord)) {
        const error = new Error(`Column "${phoneColumn}" not found in file`);
        error.availableColumns = Object.keys(firstRecord);
        throw error;
    }

    return records.map((record) => {
        const phone = String(record[phoneColumn] || '').trim();
        const variables = { ...record };
        delete variables[phoneColumn];

        const inferredName = record.name || record.Name || record.full_name || record.customer_name || '';
        return {
            phone_number: phone,
            name: inferredName,
            variables
        };
    });
}

function startCampaignInstance({ campaign, contacts, startedBy }) {
    const runningRun = db.prepare(`
        SELECT * FROM campaign_runs WHERE campaign_id = ? AND status = 'running'
    `).get(campaign.id);

    if (runningRun) {
        throw new Error('Campaign already has an active run in progress');
    }

    const execution = getCampaignExecutionContext(campaign);
    const { runId, runNumber } = createCampaignRunRecord(
        campaign.id,
        startedBy,
        Array.isArray(contacts) ? contacts.length : 0,
        execution.runSettings
    );

    const importStats = insertContactsForRun({ campaignId: campaign.id, runId, contacts });

    if (importStats.imported === 0) {
        db.prepare('DELETE FROM campaign_runs WHERE id = ?').run(runId);
        throw new Error('No valid contacts provided for this campaign instance');
    }

    db.prepare('UPDATE campaign_runs SET total_contacts = ? WHERE id = ?').run(importStats.imported, runId);

    processCampaignContacts(campaign.id, runId, {
        trunk: execution.trunk,
        ivrId: execution.ivrId,
        ivrExtension: execution.ivrExtension,
        callerId: execution.callerId,
        maxConcurrent: execution.maxConcurrent,
        maxAttempts: execution.maxAttempts,
        contactScope: 'run'
    });

    return {
        runId,
        runNumber,
        imported: importStats.imported,
        duplicates: importStats.duplicates,
        skipped: importStats.skipped
    };
}

function finalizeContactAfterAttempt({
    campaignId,
    runId,
    contactId,
    attemptNumber,
    maxAttempts,
    finalStatus,
    resultPayload
}) {
    const retryable = finalStatus === 'no_answer' || finalStatus === 'busy';
    const shouldRetry = retryable && attemptNumber < maxAttempts;
    const resultJson = stringifyResult(resultPayload);

    if (shouldRetry) {
        db.prepare(`
            UPDATE campaign_contacts
            SET status = 'pending', result = ?, last_attempt_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(resultJson, contactId);
        return;
    }

    const contactStatus = finalStatus === 'completed' ? 'completed' : 'failed';
    db.prepare(`
        UPDATE campaign_contacts
        SET status = ?, result = ?, last_attempt_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(contactStatus, resultJson, contactId);

    if (runId) {
        if (contactStatus === 'completed') {
            db.prepare('UPDATE campaign_runs SET contacts_completed = contacts_completed + 1 WHERE id = ?').run(runId);
        } else {
            db.prepare('UPDATE campaign_runs SET contacts_failed = contacts_failed + 1 WHERE id = ?').run(runId);
            if (finalStatus === 'no_answer') {
                db.prepare('UPDATE campaign_runs SET contacts_no_answer = contacts_no_answer + 1 WHERE id = ?').run(runId);
            } else if (finalStatus === 'busy') {
                db.prepare('UPDATE campaign_runs SET contacts_busy = contacts_busy + 1 WHERE id = ?').run(runId);
            }
        }
    }
}

// List all campaigns for tenant
router.get('/', (req, res) => {
    try {
        const { status } = req.query;
        
        let query = `
            SELECT c.*, 
                   i.name as ivr_name,
                   (SELECT COUNT(*) FROM campaign_runs WHERE campaign_id = c.id) as run_count,
                   (SELECT COUNT(*) FROM campaign_runs WHERE campaign_id = c.id AND status = 'running') as running_instances_count,
                   (SELECT COUNT(*) FROM campaign_runs WHERE campaign_id = c.id AND status = 'paused') as paused_instances_count
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
                SELECT id, run_number, status, total_contacts, contacts_completed, contacts_failed, contacts_no_answer, started_at
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
            } catch(e) {
                campaign.settings = {};
            }
        } else {
            campaign.settings = {};
        }
        
        // Get trunk name if trunk_id exists (from direct column, not settings)
        if (campaign.trunk_id) {
            const trunk = db.prepare('SELECT name FROM sip_trunks WHERE id = ?').get(campaign.trunk_id);
            campaign.trunk_name = trunk ? trunk.name : null;
        }
        
        campaign.instance_count = db.prepare('SELECT COUNT(*) as count FROM campaign_runs WHERE campaign_id = ?')
            .get(req.params.id).count;
        campaign.running_instances_count = db.prepare(`
            SELECT COUNT(*) as count FROM campaign_runs WHERE campaign_id = ? AND status = 'running'
        `).get(req.params.id).count;
        
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
            max_concurrent_calls, calls_per_minute, max_attempts, retry_delay_minutes, settings,
            flag_variable, flag_value
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
        if (flag_variable !== undefined) { updates.push('flag_variable = ?'); values.push(flag_variable || null); }
        if (flag_value !== undefined) { updates.push('flag_value = ?'); values.push(flag_value || null); }

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

// Generate or regenerate webhook API key for a campaign
router.post('/:id/generate-api-key', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const crypto = require('crypto');
        const apiKey = crypto.randomBytes(32).toString('hex');

        db.prepare('UPDATE campaigns SET webhook_api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(apiKey, req.params.id);

        res.json({
            success: true,
            webhook_api_key: apiKey,
            webhook_trigger_url: `/api/webhooks/campaigns/${req.params.id}/trigger`,
            webhook_results_url: `/api/webhooks/campaigns/${req.params.id}/runs/{run_id}/results`
        });
    } catch (error) {
        console.error('Error generating API key:', error);
        res.status(500).json({ error: 'Failed to generate API key' });
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
        
        const activeRun = db.prepare(`
            SELECT id FROM campaign_runs
            WHERE campaign_id = ? AND status IN ('running', 'paused')
        `).get(req.params.id);

        if (activeRun) {
            return res.status(400).json({ error: 'Cannot delete campaign with an active instance' });
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
        res.status(410).json({
            error: 'Campaign-level contacts are no longer supported. Create a campaign instance instead.'
        });
    } catch (error) {
        console.error('Error adding manual contacts:', error);
        res.status(500).json({ error: error.message || 'Failed to add contacts' });
    }
});

// Upload contacts CSV
router.post('/:id/contacts', upload.single('file'), (req, res) => {
    try {
        res.status(410).json({
            error: 'Campaign-level contact uploads are no longer supported. Upload contacts when creating an instance.'
        });
    } catch (error) {
        console.error('Error uploading contacts:', error);
        res.status(500).json({ error: error.message || 'Failed to upload contacts' });
    }
});

// Download simple CSV template for campaign instance uploads
router.get('/:id/contacts/template.csv', (req, res) => {
    try {
        const campaign = db.prepare('SELECT id, name FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const template = fs.readFileSync(CAMPAIGN_CONTACTS_TEMPLATE_PATH, 'utf8');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${campaign.name.replace(/[^a-z0-9_-]+/gi, '_')}-contacts-template.csv"`);
        res.send(`\uFEFF${template}`);
    } catch (error) {
        console.error('Error generating campaign contact template:', error);
        res.status(500).json({ error: 'Failed to generate contact template' });
    }
});

// Create and start a campaign instance from manual contacts
router.post('/:id/instances/manual', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const { contacts } = req.body;
        if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({ error: 'No contacts provided' });
        }

        const invalidContacts = contacts.filter((contact) => !contact.phone_number || !String(contact.phone_number).trim());
        if (invalidContacts.length > 0) {
            return res.status(400).json({ error: 'Some contacts are missing phone numbers' });
        }

        const result = startCampaignInstance({
            campaign,
            contacts,
            startedBy: req.user.userId
        });

        res.status(201).json({
            success: true,
            message: `Campaign instance started - Run #${result.runNumber}`,
            run_id: result.runId,
            run_number: result.runNumber,
            imported: result.imported,
            duplicates: result.duplicates,
            skipped: result.skipped
        });
    } catch (error) {
        console.error('Error creating campaign instance from manual contacts:', error);
        res.status(500).json({ error: error.message || 'Failed to create campaign instance' });
    }
});

// Create and start a campaign instance from a CSV file
router.post('/:id/instances/upload', upload.single('file'), (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const { phone_column = 'phone' } = req.body;
        const contacts = parseCsvContactsFromRequest(req.file, phone_column);

        const result = startCampaignInstance({
            campaign,
            contacts,
            startedBy: req.user.userId
        });

        res.status(201).json({
            success: true,
            message: `Campaign instance started - Run #${result.runNumber}`,
            run_id: result.runId,
            run_number: result.runNumber,
            imported: result.imported,
            duplicates: result.duplicates,
            skipped: result.skipped
        });
    } catch (error) {
        console.error('Error creating campaign instance from upload:', error);
        const payload = { error: error.message || 'Failed to create campaign instance' };
        if (error.availableColumns) {
            payload.available_columns = error.availableColumns;
        }
        res.status(500).json(payload);
    }
});

// List contacts for a specific campaign instance
router.get('/:id/instances/:runId/contacts', (req, res) => {
    try {
        const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const run = db.prepare('SELECT id FROM campaign_runs WHERE id = ? AND campaign_id = ?')
            .get(req.params.runId, req.params.id);

        if (!run) {
            return res.status(404).json({ error: 'Campaign instance not found' });
        }

        const contacts = db.prepare(`
            SELECT * FROM campaign_contacts
            WHERE campaign_id = ? AND run_id = ?
            ORDER BY id
        `).all(req.params.id, req.params.runId);

        contacts.forEach((contact) => {
            if (contact.variables) try { contact.variables = JSON.parse(contact.variables); } catch (_error) {}
            if (contact.result) try { contact.result = JSON.parse(contact.result); } catch (_error) {}
        });

        res.json({
            contacts,
            total: contacts.length
        });
    } catch (error) {
        console.error('Error listing campaign instance contacts:', error);
        res.status(500).json({ error: 'Failed to list campaign instance contacts' });
    }
});

// List contacts
router.get('/:id/contacts', (req, res) => {
    try {
        res.status(410).json({
            error: 'Campaign-level contacts are no longer available. View contacts through a campaign instance.'
        });
    } catch (error) {
        console.error('Error listing contacts:', error);
        res.status(500).json({ error: 'Failed to list contacts' });
    }
});

// Delete all contacts
router.delete('/:id/contacts', (req, res) => {
    try {
        res.status(410).json({
            error: 'Campaign-level contacts are no longer available. Delete contacts from a campaign instance if needed.'
        });
    } catch (error) {
        console.error('Error deleting contacts:', error);
        res.status(500).json({ error: 'Failed to delete contacts' });
    }
});

// Delete single contact
router.delete('/:id/contacts/:contactId', (req, res) => {
    try {
        res.status(410).json({
            error: 'Campaign-level contacts are no longer available. Delete contacts from a campaign instance if needed.'
        });
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({ error: 'Failed to delete contact' });
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
router.get('/:id/instances', (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?')
            .get(req.params.id, req.user.tenantId);
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const instances = db.prepare(`
            SELECT cr.*, u.email as started_by_email
            FROM campaign_runs cr
            LEFT JOIN users u ON cr.started_by = u.id
            WHERE cr.campaign_id = ?
            ORDER BY cr.run_number DESC
        `).all(req.params.id);
        
        res.json(instances);
    } catch (error) {
        console.error('Error getting campaign instances:', error);
        res.status(500).json({ error: 'Failed to get campaign instances' });
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
        res.status(410).json({
            error: 'Starting a campaign without contacts is no longer supported. Create a campaign instance with uploaded contacts instead.'
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

        db.prepare(`
            UPDATE campaign_contacts
            SET status = 'skipped',
                result = COALESCE(result, ?)
            WHERE status = 'pending'
              AND run_id = ?
        `).run(
            stringifyResult({ call_outcome: 'campaign_cancelled', note: 'Campaign cancelled before dialing' }),
            activeRun.id
        );

        db.prepare(`
            UPDATE outbound_calls
            SET status = 'cancelled',
                end_time = CURRENT_TIMESTAMP,
                hangup_cause = 'campaign_cancelled',
                result = COALESCE(result, ?)
            WHERE run_id = ? AND status IN ('queued', 'dialing', 'ringing')
        `).run(
            stringifyResult({ call_outcome: 'campaign_cancelled', note: 'Campaign cancelled before answer' }),
            activeRun.id
        );
        
        res.json({ success: true, message: 'Campaign run cancelled', run_id: activeRun.id });
    } catch (error) {
        console.error('Error cancelling campaign:', error);
        res.status(500).json({ error: 'Failed to cancel campaign' });
    }
});

/**
 * Process campaign contacts and make calls
 * @param {string} campaignId 
 * @param {string} runId 
 * @param {object} options 
 */
async function processCampaignContacts(campaignId, runId, options) {
    const { trunk, ivrId, ivrExtension, callerId, maxConcurrent, maxAttempts, contactScope = 'campaign' } = options;
    const contactScopeWhere = contactScope === 'run'
        ? 'run_id = ?'
        : 'campaign_id = ? AND run_id IS NULL';
    const contactScopeValue = contactScope === 'run' ? runId : campaignId;
    
    console.log(`[Campaign ${campaignId}] Starting to process contacts for run ${runId}`);
    
    // Process contacts sequentially with concurrency limit
    const processNext = async () => {
        // Check if run is still active
        const run = db.prepare('SELECT status FROM campaign_runs WHERE id = ?').get(runId);
        if (!run || run.status !== 'running') {
            console.log(`[Campaign ${campaignId}] Run ${runId} is no longer running (status: ${run?.status})`);
            return;
        }
        
        // Count active calls
        const activeCalls = db.prepare(`
            SELECT COUNT(*) as count FROM campaign_contacts 
            WHERE ${contactScopeWhere} AND status = 'calling'
        `).get(contactScopeValue).count;
        
        if (activeCalls >= maxConcurrent) {
            // Wait and try again
            setTimeout(processNext, 2000);
            return;
        }
        
        // Get next pending contact
        const contact = db.prepare(`
            SELECT * FROM campaign_contacts 
            WHERE ${contactScopeWhere} AND status = 'pending'
            LIMIT 1
        `).get(contactScopeValue);
        
        if (!contact) {
            // Check if any calls are still in progress
            if (activeCalls === 0) {
                // All done - mark run as completed
                db.prepare(`
                    UPDATE campaign_runs 
                    SET status = 'completed', completed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(runId);
                console.log(`[Campaign ${campaignId}] Run ${runId} completed`);
            } else {
                // Wait for active calls to finish
                setTimeout(processNext, 2000);
            }
            return;
        }
        
        // Mark contact as calling
        const attemptNumber = (parseInt(contact.attempts, 10) || 0) + 1;
        db.prepare(`
            UPDATE campaign_contacts 
            SET status = 'calling', attempts = ?, last_attempt_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(attemptNumber, contact.id);
        
        // Create outbound call record
        const callId = uuidv4();
        db.prepare(`
            INSERT INTO outbound_calls (id, campaign_id, contact_id, run_id, trunk_id, phone_number, caller_id, ivr_id, status, created_at, attempt_number)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP, ?)
        `).run(callId, campaignId, contact.id, runId, trunk.id, contact.phone_number, callerId, ivrId, attemptNumber);
        
        const dialString = buildPjsipChannel(trunk, contact.phone_number);
        
        // Determine extension to call when answered
        const extension = ivrExtension || '1000';
        
        console.log(`[Campaign ${campaignId}] Calling ${contact.phone_number} via ${dialString} -> ext ${extension}`);
        
        try {
            await sendAMICommand('Originate', {
                Channel: dialString,
                Context: 'from-internal',
                Exten: extension,
                Priority: '1',
                CallerID: `"Campaign" <${callerId}>`,
                Timeout: '30000',
                Async: 'true',
                Variable: `CAMPAIGN_ID=${campaignId},CONTACT_ID=${contact.id},OUTBOUND_CALL_ID=${callId}`
            });
            
            // Update call status (use 'dialing' which is valid in CHECK constraint)
            db.prepare(`UPDATE outbound_calls SET status = 'dialing', dial_start_time = CURRENT_TIMESTAMP WHERE id = ?`).run(callId);
            db.prepare(`UPDATE campaign_runs SET contacts_called = contacts_called + 1 WHERE id = ?`).run(runId);
            
            console.log(`[Campaign ${campaignId}] Call initiated for ${contact.phone_number}`);

            // If no engine callback arrives in time, classify as no-answer and retry when allowed.
            setTimeout(() => {
                const currentCall = db.prepare(`
                    SELECT status FROM outbound_calls WHERE id = ?
                `).get(callId);
                if (!currentCall || !['queued', 'dialing', 'ringing'].includes(currentCall.status)) {
                    return;
                }

                const resultPayload = buildAttemptResult({
                    outcome: 'no_answer',
                    attemptNumber,
                    maxAttempts,
                    retryScheduled: attemptNumber < maxAttempts,
                    details: { reason: 'no_engine_callback_timeout' }
                });

                db.prepare(`
                    UPDATE outbound_calls
                    SET status = 'no_answer',
                        end_time = CURRENT_TIMESTAMP,
                        duration = COALESCE(duration, 0),
                        hangup_cause = 'no_answer_timeout',
                        result = ?
                    WHERE id = ? AND status IN ('queued', 'dialing', 'ringing')
                `).run(stringifyResult(resultPayload), callId);

                finalizeContactAfterAttempt({
                    campaignId,
                    runId,
                    contactId: contact.id,
                    attemptNumber,
                    maxAttempts,
                    finalStatus: 'no_answer',
                    resultPayload
                });
            }, CALL_RESULT_TIMEOUT_MS);
        } catch (error) {
            console.error(`[Campaign ${campaignId}] Failed to call ${contact.phone_number}:`, error.message);
            db.prepare(`UPDATE outbound_calls SET status = 'failed' WHERE id = ?`)
                .run(callId);

            const resultPayload = buildAttemptResult({
                outcome: 'originate_failed',
                attemptNumber,
                maxAttempts,
                retryScheduled: attemptNumber < maxAttempts,
                details: { error: error.message }
            });

            db.prepare(`
                UPDATE outbound_calls
                SET end_time = CURRENT_TIMESTAMP,
                    hangup_cause = COALESCE(hangup_cause, 'originate_failed'),
                    result = ?
                WHERE id = ?
            `).run(stringifyResult(resultPayload), callId);

            finalizeContactAfterAttempt({
                campaignId,
                runId,
                contactId: contact.id,
                attemptNumber,
                maxAttempts,
                finalStatus: 'failed',
                resultPayload
            });
        }
        
        // Process next contact
        setTimeout(processNext, 500);
    };
    
    // Start processing
    processNext();
}

module.exports = router;
module.exports.startCampaignInstance = startCampaignInstance;
module.exports.getCampaignExecutionContext = getCampaignExecutionContext;
