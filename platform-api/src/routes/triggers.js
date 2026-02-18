const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole } = require('../middleware/auth');
const net = require('net');

// Apply auth middleware
router.use(authMiddleware);

// AMI Configuration
const AMI_HOST = process.env.AMI_HOST || 'asterisk';
const AMI_PORT = parseInt(process.env.AMI_PORT || '5038');
const AMI_USER = process.env.AMI_USER || 'admin';
const AMI_SECRET = process.env.AMI_SECRET || 'amipass';

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

/**
 * Trigger a single outbound call
 * POST /api/triggers/call
 * 
 * Body:
 * - phone_number: The number to call (required)
 * - trunk_id: SIP trunk to use (required)
 * - ivr_id: IVR flow to run when answered (optional)
 * - caller_id: Caller ID to display (optional)
 * - variables: Object with variables to pass to IVR (optional)
 */
router.post('/call', requireRole('admin', 'editor'), async (req, res) => {
    try {
        const { phone_number, trunk_id, ivr_id, caller_id, variables = {} } = req.body;
        
        if (!phone_number) {
            return res.status(400).json({ error: 'phone_number is required' });
        }
        
        if (!trunk_id) {
            return res.status(400).json({ error: 'trunk_id is required' });
        }
        
        // Verify trunk belongs to tenant
        const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ? AND tenant_id = ?')
            .get(trunk_id, req.user.tenantId);
        
        if (!trunk) {
            return res.status(404).json({ error: 'SIP trunk not found' });
        }
        
        // Verify IVR if provided and get extension
        let ivrExtension = null;
        if (ivr_id) {
            const ivr = db.prepare('SELECT id, extension FROM ivr_flows WHERE id = ? AND tenant_id = ?')
                .get(ivr_id, req.user.tenantId);
            if (!ivr) {
                return res.status(404).json({ error: 'IVR flow not found' });
            }
            ivrExtension = ivr.extension;
        }
        
        // Create outbound call record
        const callId = uuidv4();
        const effectiveCallerId = caller_id || trunk.caller_id || '1000';
        
        db.prepare(`
            INSERT INTO outbound_calls (id, trunk_id, phone_number, caller_id, ivr_id, status, variables, created_at)
            VALUES (?, ?, ?, ?, ?, 'queued', ?, CURRENT_TIMESTAMP)
        `).run(callId, trunk_id, phone_number, effectiveCallerId, ivr_id, JSON.stringify(variables));
        
        // Originate call via AMI
        if (ivrExtension) {
            try {
                console.log(`Originating call to ${phone_number} with IVR extension ${ivrExtension}`);
                const channel = buildPjsipChannel(trunk, phone_number);
                
                await sendAMICommand('Originate', {
                    Channel: channel,
                    Context: 'outbound-ivr',
                    Exten: 's',
                    Priority: '1',
                    CallerID: `"Outbound" <${effectiveCallerId}>`,
                    Timeout: '30000',
                    Variable: `IVR_EXTENSION=${ivrExtension},OUTBOUND_CALL_ID=${callId}`,
                    Async: 'true'
                });
                
                console.log(`Call originated successfully: ${callId}`);
                db.prepare(`UPDATE outbound_calls SET status = 'ringing' WHERE id = ?`).run(callId);
            } catch (err) {
                console.error('Failed to originate call via AMI:', err.message);
                db.prepare(`UPDATE outbound_calls SET status = 'failed' WHERE id = ?`).run(callId);
            }
        }
        
        const call = db.prepare('SELECT * FROM outbound_calls WHERE id = ?').get(callId);
        
        res.status(202).json({
            success: true,
            message: 'Call initiated',
            call_id: callId,
            phone_number,
            ivr_extension: ivrExtension,
            status: call.status
        });
    } catch (error) {
        console.error('Error triggering call:', error);
        res.status(500).json({ error: 'Failed to trigger call' });
    }
});

/**
 * Trigger a campaign to start (creates a new run instance)
 * POST /api/triggers/campaign/:id
 */
router.post('/campaign/:id', requireRole('admin', 'editor'), async (req, res) => {
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
        
        // Get trunk details
        const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ?').get(trunkId);
        if (!trunk) {
            return res.status(400).json({ error: 'SIP trunk not found' });
        }
        
        // Get IVR details
        const ivr = db.prepare('SELECT * FROM ivr_flows WHERE id = ?').get(campaign.ivr_id);
        if (!ivr) {
            return res.status(400).json({ error: 'IVR flow not found' });
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
        const runId = require('uuid').v4();
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
        
        console.log(`Campaign ${req.params.id} triggered - Run #${runNumber} (${runId})`);
        
        // Start processing contacts asynchronously
        const effectiveCallerId = campaign.caller_id || settings.caller_id || trunk.caller_id || '1000';
        const maxConcurrent = campaign.max_concurrent_calls || settings.max_concurrent_calls || 5;
        
        // Process contacts in the background
        processCampaignContacts(req.params.id, runId, {
            trunk,
            ivrExtension: ivr.extension,
            callerId: effectiveCallerId,
            maxConcurrent
        });
        
        res.json({ 
            success: true, 
            message: `Campaign started - Run #${runNumber}`,
            campaign_id: req.params.id,
            run_id: runId,
            run_number: runNumber
        });
    } catch (error) {
        console.error('Error triggering campaign:', error);
        res.status(500).json({ error: 'Failed to trigger campaign' });
    }
});

/**
 * Process campaign contacts and make calls
 * @param {string} campaignId 
 * @param {string} runId 
 * @param {object} options 
 */
async function processCampaignContacts(campaignId, runId, options) {
    const { trunk, ivrExtension, callerId, maxConcurrent } = options;
    let activeCalls = 0;
    
    console.log(`[Campaign ${campaignId}] Starting to process contacts for run ${runId}`);
    
    // Keep processing until done
    const processNext = async () => {
        // Check if run is still active
        const run = db.prepare('SELECT status FROM campaign_runs WHERE id = ?').get(runId);
        if (!run || run.status !== 'running') {
            console.log(`[Campaign ${campaignId}] Run ${runId} is no longer running (status: ${run?.status})`);
            return;
        }
        
        // Get next pending contact
        const contact = db.prepare(`
            SELECT * FROM campaign_contacts 
            WHERE campaign_id = ? AND status = 'pending'
            LIMIT 1
        `).get(campaignId);
        
        if (!contact) {
            // Check if any calls are still in progress (calling status)
            const inProgress = db.prepare(`
                SELECT COUNT(*) as count FROM campaign_contacts 
                WHERE campaign_id = ? AND status = 'calling'
            `).get(campaignId).count;
            
            if (inProgress === 0) {
                // All done - mark run as completed
                db.prepare(`
                    UPDATE campaign_runs 
                    SET status = 'completed', completed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(runId);
                console.log(`[Campaign ${campaignId}] Run ${runId} completed`);
            }
            return;
        }
        
        // Mark contact as calling (using valid CHECK constraint value)
        db.prepare(`
            UPDATE campaign_contacts 
            SET status = 'calling', attempts = attempts + 1, last_attempt_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(contact.id);
        
        // Create outbound call record
        const callId = uuidv4();
        
        db.prepare(`
            INSERT INTO outbound_calls (id, campaign_id, contact_id, trunk_id, phone_number, caller_id, ivr_id, status, variables, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, CURRENT_TIMESTAMP)
        `).run(
            callId, 
            campaignId, 
            contact.id,
            trunk.id, 
            contact.phone_number, 
            callerId, 
            null, // ivr_id handled via extension
            contact.variables || '{}'
        );
        
        // Originate the call
        try {
            console.log(`[Campaign ${campaignId}] Calling ${contact.phone_number} via ${trunk.name}`);
            const dialString = buildPjsipChannel(trunk, contact.phone_number);
            
            await sendAMICommand('Originate', {
                Channel: dialString,
                Context: 'outbound-ivr',
                Exten: 's',
                Priority: '1',
                CallerID: `"Campaign" <${callerId}>`,
                Timeout: '30000',
                Variable: `IVR_EXTENSION=${ivrExtension},OUTBOUND_CALL_ID=${callId},CONTACT_ID=${contact.id}`,
                Async: 'true'
            });
            
            db.prepare(`UPDATE outbound_calls SET status = 'ringing' WHERE id = ?`).run(callId);
            db.prepare(`UPDATE campaign_runs SET contacts_called = contacts_called + 1 WHERE id = ?`).run(runId);
            activeCalls++;
            
            console.log(`[Campaign ${campaignId}] Call initiated to ${contact.phone_number} (call_id: ${callId})`);
            
        } catch (err) {
            console.error(`[Campaign ${campaignId}] Failed to call ${contact.phone_number}:`, err.message);
            db.prepare(`UPDATE outbound_calls SET status = 'failed' WHERE id = ?`).run(callId);
            db.prepare(`UPDATE campaign_contacts SET status = 'failed' WHERE id = ?`).run(contact.id);
            db.prepare(`UPDATE campaign_runs SET contacts_failed = contacts_failed + 1 WHERE id = ?`).run(runId);
        }
        
        // Wait a bit before next call
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Continue processing if under concurrent limit
        if (activeCalls < maxConcurrent) {
            processNext();
        }
    };
    
    // Start processing up to maxConcurrent calls
    for (let i = 0; i < maxConcurrent; i++) {
        processNext();
    }
}

/**
 * Get call status
 * GET /api/triggers/call/:id
 */
router.get('/call/:id', (req, res) => {
    try {
        const call = db.prepare(`
            SELECT oc.*, st.name as trunk_name, iv.name as ivr_name
            FROM outbound_calls oc
            LEFT JOIN sip_trunks st ON oc.trunk_id = st.id
            LEFT JOIN ivr_flows iv ON oc.ivr_id = iv.id
            WHERE oc.id = ?
        `).get(req.params.id);
        
        if (!call) {
            return res.status(404).json({ error: 'Call not found' });
        }
        
        // Verify tenant access via trunk
        const trunk = db.prepare('SELECT tenant_id FROM sip_trunks WHERE id = ?').get(call.trunk_id);
        if (!trunk || trunk.tenant_id !== req.user.tenantId) {
            return res.status(404).json({ error: 'Call not found' });
        }
        
        if (call.variables) try { call.variables = JSON.parse(call.variables); } catch(e) {}
        if (call.result) try { call.result = JSON.parse(call.result); } catch(e) {}
        if (call.dtmf_inputs) try { call.dtmf_inputs = JSON.parse(call.dtmf_inputs); } catch(e) {}
        
        res.json(call);
    } catch (error) {
        console.error('Error getting call:', error);
        res.status(500).json({ error: 'Failed to get call status' });
    }
});

/**
 * List recent calls (for debugging/monitoring)
 * GET /api/triggers/calls
 */
router.get('/calls', (req, res) => {
    try {
        const { status, limit = 50, campaign_id } = req.query;
        
        let query = `
            SELECT oc.*, st.name as trunk_name, iv.name as ivr_name, cc.attempts as contact_attempts
            FROM outbound_calls oc
            JOIN sip_trunks st ON oc.trunk_id = st.id
            LEFT JOIN ivr_flows iv ON oc.ivr_id = iv.id
            LEFT JOIN campaign_contacts cc ON oc.contact_id = cc.id
            WHERE st.tenant_id = ?
        `;
        const params = [req.user.tenantId];
        
        if (status) {
            query += ' AND oc.status = ?';
            params.push(status);
        }
        
        if (campaign_id) {
            query += ' AND oc.campaign_id = ?';
            params.push(campaign_id);
        }
        
        query += ' ORDER BY oc.created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const calls = db.prepare(query).all(...params);
        
        calls.forEach(call => {
            if (call.variables) try { call.variables = JSON.parse(call.variables); } catch(e) {}
            if (call.result) try { call.result = JSON.parse(call.result); } catch(e) {}
        });
        
        res.json(calls);
    } catch (error) {
        console.error('Error listing calls:', error);
        res.status(500).json({ error: 'Failed to list calls' });
    }
});

/**
 * Get outbound call analytics
 * GET /api/triggers/analytics
 */
router.get('/analytics', (req, res) => {
    try {
        const { campaign_id, start_date, end_date } = req.query;
        
        let baseWhere = `st.tenant_id = ?`;
        const params = [req.user.tenantId];
        
        if (campaign_id) {
            baseWhere += ' AND oc.campaign_id = ?';
            params.push(campaign_id);
        }
        
        if (start_date) {
            baseWhere += ' AND oc.created_at >= ?';
            params.push(start_date);
        }
        
        if (end_date) {
            baseWhere += ' AND oc.created_at <= ?';
            params.push(end_date);
        }
        
        // Get call outcome breakdown
        const outcomeStats = db.prepare(`
            SELECT 
                CASE
                    WHEN oc.status = 'failed' AND oc.hangup_cause = 'caller_hangup_early' THEN 'abrupt_end'
                    ELSE oc.status
                END as status,
                COUNT(*) as count,
                AVG(CASE WHEN oc.duration > 0 THEN oc.duration ELSE NULL END) as avg_duration
            FROM outbound_calls oc
            JOIN sip_trunks st ON oc.trunk_id = st.id
            WHERE ${baseWhere}
            GROUP BY 1
        `).all(...params);
        
        // Get totals
        const totals = db.prepare(`
            SELECT 
                COUNT(*) as total_calls,
                SUM(CASE WHEN oc.status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN oc.status = 'answered' THEN 1 ELSE 0 END) as answered,
                SUM(CASE WHEN oc.status = 'no_answer' THEN 1 ELSE 0 END) as no_answer,
                SUM(CASE WHEN oc.status = 'busy' THEN 1 ELSE 0 END) as busy,
                SUM(CASE WHEN oc.status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN oc.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                SUM(CASE WHEN oc.status = 'failed' AND oc.hangup_cause = 'caller_hangup_early' THEN 1 ELSE 0 END) as abrupt_ended,
                SUM(CASE WHEN oc.attempt_number > 1 THEN 1 ELSE 0 END) as retried_calls,
                SUM(CASE WHEN oc.status IN ('queued', 'dialing', 'ringing') THEN 1 ELSE 0 END) as in_progress,
                AVG(CASE WHEN oc.duration > 0 THEN oc.duration ELSE NULL END) as avg_duration,
                SUM(COALESCE(oc.duration, 0)) as total_duration
            FROM outbound_calls oc
            JOIN sip_trunks st ON oc.trunk_id = st.id
            WHERE ${baseWhere}
        `).get(...params);
        
        // Get hourly breakdown for today (or date range)
        const hourlyStats = db.prepare(`
            SELECT 
                strftime('%H', oc.created_at) as hour,
                COUNT(*) as calls,
                SUM(CASE WHEN oc.status = 'completed' THEN 1 ELSE 0 END) as completed
            FROM outbound_calls oc
            JOIN sip_trunks st ON oc.trunk_id = st.id
            WHERE ${baseWhere} AND date(oc.created_at) = date('now')
            GROUP BY strftime('%H', oc.created_at)
            ORDER BY hour
        `).all(...params);
        
        // Calculate success rate
        const successRate = totals.total_calls > 0 
            ? ((totals.completed / totals.total_calls) * 100).toFixed(1)
            : 0;
        
        const answerRate = totals.total_calls > 0
            ? (((totals.completed + totals.answered) / totals.total_calls) * 100).toFixed(1)
            : 0;
        
        res.json({
            totals: {
                ...totals,
                success_rate: parseFloat(successRate),
                answer_rate: parseFloat(answerRate)
            },
            outcomes: outcomeStats,
            hourly: hourlyStats
        });
    } catch (error) {
        console.error('Error getting analytics:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});

/**
 * Update call status (internal callback from IVR)
 * PUT /api/triggers/call/:id/status
 * Note: This endpoint has relaxed auth for internal IVR callbacks
 */
router.put('/call/:id/status', requireRole('admin', 'editor'), (req, res) => {
    try {
        const { 
            status, 
            hangup_cause, 
            duration, 
            result, 
            answer_time,
            end_time,
            dtmf_inputs 
        } = req.body;
        
        const call = db.prepare('SELECT * FROM outbound_calls WHERE id = ?').get(req.params.id);
        
        if (!call) {
            return res.status(404).json({ error: 'Call not found' });
        }
        
        const updates = [];
        const values = [];
        
        if (status) {
            updates.push('status = ?');
            values.push(status);
        }
        
        if (hangup_cause) {
            updates.push('hangup_cause = ?');
            values.push(hangup_cause);
        }
        
        if (duration !== undefined) {
            updates.push('duration = ?');
            values.push(duration);
        }
        
        if (result) {
            updates.push('result = ?');
            values.push(typeof result === 'string' ? result : JSON.stringify(result));
        }
        
        if (answer_time) {
            updates.push('answer_time = ?');
            values.push(answer_time);
        }
        
        if (end_time) {
            updates.push('end_time = ?');
            values.push(end_time);
        }
        
        if (dtmf_inputs) {
            updates.push('dtmf_inputs = ?');
            values.push(typeof dtmf_inputs === 'string' ? dtmf_inputs : JSON.stringify(dtmf_inputs));
        }
        
        if (updates.length > 0) {
            values.push(req.params.id);
            db.prepare(`UPDATE outbound_calls SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        }
        
        // Also update campaign_contacts if this call is tied to a contact
        if (call.contact_id && status) {
            let contactStatus = status;
            if (status === 'completed') contactStatus = 'completed';
            else if (status === 'answered') contactStatus = 'in_progress';
            else if (['no_answer', 'busy', 'failed', 'cancelled'].includes(status)) contactStatus = 'failed';
            
            db.prepare(`
                UPDATE campaign_contacts 
                SET status = ?, result = COALESCE(?, result), updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                contactStatus, 
                result ? (typeof result === 'string' ? result : JSON.stringify(result)) : null,
                call.contact_id
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating call status:', error);
        res.status(500).json({ error: 'Failed to update call status' });
    }
});

module.exports = router;
