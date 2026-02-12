/**
 * Outbound Dialer Service
 * 
 * This service handles outbound call origination for campaigns.
 * It monitors campaigns and initiates calls via Asterisk ARI.
 */

const AriClient = require('ari-client');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

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

function buildPjsipDialString(trunk, phoneNumber) {
    const target = String(phoneNumber || '').trim();
    const endpoint = resolveTrunkEndpointName(trunk);
    if (endpoint) {
        return `PJSIP/${target}@${endpoint}`;
    }
    return `PJSIP/${target}`;
}

class OutboundDialer {
    constructor() {
        this.ari = null;
        this.activeCalls = new Map(); // channelId -> callInfo
        this.campaignWorkers = new Map(); // campaignId -> worker interval
        this.isRunning = false;
    }

    async connect() {
        const ariUrl = process.env.ARI_URL || 'http://asterisk:8088';
        const ariUser = process.env.ARI_USER || 'ariuser';
        const ariPass = process.env.ARI_PASS || 'aripass';

        try {
            this.ari = await AriClient.connect(ariUrl, ariUser, ariPass);
            console.log('[Dialer] Connected to Asterisk ARI');
            
            this.setupEventHandlers();
            this.isRunning = true;
            this.startCampaignMonitor();
            
            return true;
        } catch (error) {
            console.error('[Dialer] Failed to connect to ARI:', error.message);
            return false;
        }
    }

    setupEventHandlers() {
        // Channel state changes
        this.ari.on('StasisStart', (event, channel) => {
            console.log(`[Dialer] StasisStart: ${channel.id}`);
            this.handleStasisStart(event, channel);
        });

        this.ari.on('StasisEnd', (event, channel) => {
            console.log(`[Dialer] StasisEnd: ${channel.id}`);
            this.handleStasisEnd(event, channel);
        });

        this.ari.on('ChannelStateChange', (event, channel) => {
            this.handleStateChange(event, channel);
        });

        this.ari.on('ChannelDestroyed', (event, channel) => {
            this.handleChannelDestroyed(event, channel);
        });

        // Start the dialer application
        this.ari.start('outbound-dialer');
    }

    async handleStasisStart(event, channel) {
        const callInfo = this.activeCalls.get(channel.id);
        if (!callInfo) return;

        // Update call status to answered
        callInfo.status = 'answered';
        callInfo.answerTime = new Date();
        
        this.updateCallRecord(callInfo.callId, {
            status: 'answered',
            answer_time: callInfo.answerTime.toISOString()
        });

        // If there's an IVR to run, start it
        if (callInfo.ivrId) {
            await this.runIVR(channel, callInfo);
        }
    }

    async handleStasisEnd(event, channel) {
        const callInfo = this.activeCalls.get(channel.id);
        if (!callInfo) return;

        this.finalizeCall(channel.id, 'completed');
    }

    handleStateChange(event, channel) {
        const callInfo = this.activeCalls.get(channel.id);
        if (!callInfo) return;

        console.log(`[Dialer] Channel ${channel.id} state: ${channel.state}`);

        if (channel.state === 'Ringing') {
            callInfo.status = 'ringing';
            this.updateCallRecord(callInfo.callId, { status: 'ringing' });
        }
    }

    handleChannelDestroyed(event, channel) {
        const callInfo = this.activeCalls.get(channel.id);
        if (!callInfo) return;

        const hangupCause = event.cause_txt || 'Unknown';
        let finalStatus = 'failed';

        switch (event.cause) {
            case 16: // Normal clearing
                finalStatus = callInfo.status === 'answered' ? 'completed' : 'no_answer';
                break;
            case 17: // User busy
                finalStatus = 'busy';
                break;
            case 18: // No user responding
            case 19: // No answer
                finalStatus = 'no_answer';
                break;
            case 21: // Call rejected
            case 34: // No circuit available
            default:
                finalStatus = 'failed';
        }

        this.finalizeCall(channel.id, finalStatus, hangupCause);
    }

    async runIVR(channel, callInfo) {
        try {
            // Load IVR flow
            const ivr = db.prepare('SELECT * FROM ivr_flows WHERE id = ?').get(callInfo.ivrId);
            if (!ivr) {
                console.error(`[Dialer] IVR ${callInfo.ivrId} not found`);
                await channel.hangup();
                return;
            }

            const flowData = JSON.parse(ivr.flow_data);
            
            // For now, just answer and play prompts
            // In production, integrate with the full flow engine
            await channel.answer();
            
            // Simple flow execution - find play nodes
            for (const node of flowData.nodes || []) {
                if (node.type === 'play' && node.data?.prompt) {
                    await this.playPrompt(channel, node.data.prompt, ivr.language || 'en');
                }
            }

            // Hangup after flow completes
            setTimeout(async () => {
                try {
                    await channel.hangup();
                } catch (e) {}
            }, 2000);

        } catch (error) {
            console.error(`[Dialer] Error running IVR:`, error);
            try { await channel.hangup(); } catch(e) {}
        }
    }

    async playPrompt(channel, promptName, language) {
        try {
            const soundPath = language === 'ar' 
                ? `sound:ar/${promptName}`
                : `sound:custom/${promptName}`;
            
            const playback = this.ari.Playback();
            await channel.play({ media: soundPath }, playback);
            
            return new Promise((resolve) => {
                playback.on('PlaybackFinished', resolve);
                setTimeout(resolve, 30000); // Timeout
            });
        } catch (error) {
            console.error(`[Dialer] Error playing prompt:`, error);
        }
    }

    finalizeCall(channelId, status, hangupCause = null) {
        const callInfo = this.activeCalls.get(channelId);
        if (!callInfo) return;

        const endTime = new Date();
        const duration = callInfo.answerTime 
            ? Math.round((endTime - callInfo.answerTime) / 1000)
            : 0;

        this.updateCallRecord(callInfo.callId, {
            status,
            end_time: endTime.toISOString(),
            duration,
            hangup_cause: hangupCause
        });

        // Update contact status
        if (callInfo.contactId) {
            const contactStatus = status === 'completed' ? 'completed' : 
                                  (callInfo.attempt >= callInfo.maxAttempts ? 'failed' : 'pending');
            
            db.prepare(`
                UPDATE campaign_contacts 
                SET status = ?, attempts = ?, last_attempt_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(contactStatus, callInfo.attempt, callInfo.contactId);
        }

        // Update campaign counters
        if (callInfo.campaignId) {
            if (status === 'completed') {
                db.prepare('UPDATE campaigns SET contacts_completed = contacts_completed + 1 WHERE id = ?')
                    .run(callInfo.campaignId);
            } else if (callInfo.attempt >= callInfo.maxAttempts) {
                db.prepare('UPDATE campaigns SET contacts_failed = contacts_failed + 1 WHERE id = ?')
                    .run(callInfo.campaignId);
            }
        }

        this.activeCalls.delete(channelId);
        console.log(`[Dialer] Call ${callInfo.callId} finalized: ${status}`);
    }

    updateCallRecord(callId, updates) {
        const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);
        values.push(callId);
        
        db.prepare(`UPDATE outbound_calls SET ${sets} WHERE id = ?`).run(...values);
    }

    // Campaign monitoring
    startCampaignMonitor() {
        setInterval(() => this.checkCampaigns(), 5000); // Check every 5 seconds
    }

    checkCampaigns() {
        if (!this.isRunning) return;

        try {
            // Find running campaigns
            const campaigns = db.prepare(`
                SELECT * FROM campaigns WHERE status = 'running'
            `).all();

            for (const campaign of campaigns) {
                if (!this.campaignWorkers.has(campaign.id)) {
                    this.startCampaignWorker(campaign);
                }
            }

            // Stop workers for non-running campaigns
            for (const [campaignId, worker] of this.campaignWorkers) {
                const campaign = campaigns.find(c => c.id === campaignId);
                if (!campaign) {
                    clearInterval(worker);
                    this.campaignWorkers.delete(campaignId);
                    console.log(`[Dialer] Stopped worker for campaign ${campaignId}`);
                }
            }
        } catch (error) {
            console.error('[Dialer] Error checking campaigns:', error);
        }
    }

    startCampaignWorker(campaign) {
        console.log(`[Dialer] Starting worker for campaign: ${campaign.name}`);
        
        const worker = setInterval(() => {
            this.processCampaign(campaign.id);
        }, 1000); // Process every second

        this.campaignWorkers.set(campaign.id, worker);
    }

    async processCampaign(campaignId) {
        try {
            const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
            if (!campaign || campaign.status !== 'running') {
                return;
            }

            // Count active calls for this campaign
            const activeCalls = Array.from(this.activeCalls.values())
                .filter(c => c.campaignId === campaignId).length;

            if (activeCalls >= campaign.max_concurrent_calls) {
                return; // At capacity
            }

            // Get next contact to call
            const contact = db.prepare(`
                SELECT * FROM campaign_contacts 
                WHERE campaign_id = ? AND status = 'pending'
                AND (last_attempt_at IS NULL OR datetime(last_attempt_at, '+' || ? || ' minutes') < datetime('now'))
                ORDER BY id
                LIMIT 1
            `).get(campaignId, campaign.retry_delay_minutes);

            if (!contact) {
                // Check if campaign is complete
                const pending = db.prepare(`
                    SELECT COUNT(*) as count FROM campaign_contacts 
                    WHERE campaign_id = ? AND status = 'pending'
                `).get(campaignId).count;

                if (pending === 0 && activeCalls === 0) {
                    db.prepare(`
                        UPDATE campaigns 
                        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).run(campaignId);
                    console.log(`[Dialer] Campaign ${campaignId} completed`);
                }
                return;
            }

            // Get trunk
            const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ?').get(campaign.trunk_id);
            if (!trunk) {
                console.error(`[Dialer] Trunk ${campaign.trunk_id} not found`);
                return;
            }

            // Mark contact as calling
            db.prepare('UPDATE campaign_contacts SET status = ? WHERE id = ?')
                .run('calling', contact.id);

            // Originate the call
            await this.originateCall({
                campaignId,
                contactId: contact.id,
                phoneNumber: contact.phone_number,
                trunk,
                ivrId: campaign.ivr_id,
                callerId: campaign.caller_id || trunk.caller_id,
                variables: JSON.parse(contact.variables || '{}'),
                attempt: contact.attempts + 1,
                maxAttempts: campaign.max_attempts
            });

            // Update campaign counter
            db.prepare('UPDATE campaigns SET contacts_called = contacts_called + 1 WHERE id = ?')
                .run(campaignId);

        } catch (error) {
            console.error(`[Dialer] Error processing campaign ${campaignId}:`, error);
        }
    }

    async originateCall(options) {
        const { campaignId, contactId, phoneNumber, trunk, ivrId, callerId, variables, attempt, maxAttempts } = options;

        const callId = uuidv4();
        
        // Build dial string
        const dialString = buildPjsipDialString(trunk, phoneNumber);
        
        console.log(`[Dialer] Originating call: ${dialString}`);

        try {
            // Create call record
            db.prepare(`
                INSERT INTO outbound_calls (id, campaign_id, contact_id, trunk_id, phone_number, caller_id, ivr_id, status, dial_start_time, variables, attempt_number)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'dialing', CURRENT_TIMESTAMP, ?, ?)
            `).run(callId, campaignId, contactId, trunk.id, phoneNumber, callerId, ivrId, JSON.stringify(variables), attempt);

            // Originate via ARI
            const channel = this.ari.Channel();
            
            this.activeCalls.set(channel.id, {
                callId,
                campaignId,
                contactId,
                phoneNumber,
                ivrId,
                variables,
                attempt,
                maxAttempts,
                status: 'dialing',
                dialTime: new Date(),
                answerTime: null
            });

            await channel.originate({
                endpoint: dialString,
                app: 'outbound-dialer',
                callerId: callerId || phoneNumber,
                timeout: 30,
                variables: {
                    OUTBOUND_CALL_ID: callId,
                    CAMPAIGN_ID: campaignId || '',
                    IVR_ID: ivrId || ''
                }
            });

            // Update call record with channel ID
            db.prepare('UPDATE outbound_calls SET channel_id = ? WHERE id = ?')
                .run(channel.id, callId);

        } catch (error) {
            console.error(`[Dialer] Failed to originate call:`, error);
            
            db.prepare(`
                UPDATE outbound_calls 
                SET status = 'failed', error_message = ?, end_time = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(error.message, callId);

            // Reset contact status for retry
            db.prepare(`
                UPDATE campaign_contacts 
                SET status = 'pending', attempts = ?
                WHERE id = ?
            `).run(attempt, contactId);
        }
    }

    // Single call API trigger
    async triggerSingleCall(trunkId, phoneNumber, ivrId, variables = {}, callerId = null) {
        const trunk = db.prepare('SELECT * FROM sip_trunks WHERE id = ?').get(trunkId);
        if (!trunk) {
            throw new Error('SIP trunk not found');
        }

        return this.originateCall({
            campaignId: null,
            contactId: null,
            phoneNumber,
            trunk,
            ivrId,
            callerId: callerId || trunk.caller_id,
            variables,
            attempt: 1,
            maxAttempts: 1
        });
    }

    shutdown() {
        this.isRunning = false;
        
        for (const [campaignId, worker] of this.campaignWorkers) {
            clearInterval(worker);
        }
        this.campaignWorkers.clear();
        
        if (this.ari) {
            this.ari.stop();
        }
        
        console.log('[Dialer] Shutdown complete');
    }
}

// Singleton instance
const dialer = new OutboundDialer();

module.exports = dialer;
