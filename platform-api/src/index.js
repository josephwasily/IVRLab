const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import routes
const authRoutes = require('./routes/auth');
const ivrRoutes = require('./routes/ivr');
const templateRoutes = require('./routes/templates');
const extensionRoutes = require('./routes/extensions');
const analyticsRoutes = require('./routes/analytics');
const promptsRoutes = require('./routes/prompts');
const trunksRoutes = require('./routes/trunks');
const campaignsRoutes = require('./routes/campaigns');
const triggersRoutes = require('./routes/triggers');
const systemRoutes = require('./routes/system');

const app = express();
const PORT = process.env.PORT || 3001;
const TERMINAL_OUTBOUND_STATUSES = new Set(['completed', 'busy', 'no_answer', 'failed', 'cancelled']);
const RETRYABLE_OUTBOUND_STATUSES = new Set(['no_answer', 'busy']);

function parseJsonSafe(value, fallback = {}) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    if (typeof value === 'object') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

function buildBranchDisplayMap(flowData) {
    const mapByVariable = {};
    if (!flowData || typeof flowData !== 'object' || !flowData.nodes || typeof flowData.nodes !== 'object') {
        return mapByVariable;
    }

    for (const node of Object.values(flowData.nodes)) {
        if (!node || node.type !== 'branch' || !node.variable) continue;
        const displayMap = node.branchDisplayNames || node.branchDisplayMap || {};
        if (!displayMap || typeof displayMap !== 'object') continue;

        const variableName = String(node.variable);
        if (!mapByVariable[variableName]) {
            mapByVariable[variableName] = {};
        }

        for (const [key, label] of Object.entries(displayMap)) {
            mapByVariable[variableName][String(key)] = String(label);
        }
    }

    return mapByVariable;
}

function normalizeVariableValue(value, valueMap = {}) {
    if (value === null || value === undefined) return value;
    const key = String(value);
    if (Object.prototype.hasOwnProperty.call(valueMap, key)) {
        return valueMap[key];
    }
    return value;
}

function normalizeResultVariables(resultObject, branchDisplayMap) {
    if (!resultObject || typeof resultObject !== 'object') return resultObject;
    const normalized = { ...resultObject };
    for (const [variableName, valueMap] of Object.entries(branchDisplayMap || {})) {
        if (!Object.prototype.hasOwnProperty.call(normalized, variableName)) continue;
        const rawValue = normalized[variableName];
        const mapped = normalizeVariableValue(rawValue, valueMap);
        if (mapped !== rawValue) {
            normalized[variableName] = mapped;
            normalized[`${variableName}_raw`] = rawValue;
        }
    }
    return normalized;
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/ivr', ivrRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/extensions', extensionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/prompts', promptsRoutes);
app.use('/api/trunks', trunksRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/triggers', triggersRoutes);
app.use('/api/system', systemRoutes);

// IVR Engine endpoint - called by Asterisk ARI
app.get('/api/engine/flow/:extension', async (req, res) => {
    try {
        const db = require('./db');
        const { extension } = req.params;
        
        const ivr = db.prepare(`
            SELECT f.*, t.settings as tenant_settings
            FROM ivr_flows f
            JOIN tenants t ON f.tenant_id = t.id
            WHERE f.extension = ? AND f.status = 'active'
        `).get(extension);
        
        if (!ivr) {
            return res.status(404).json({ error: 'IVR not found for extension' });
        }
        
        // Also fetch all prompts to build a name -> path mapping
        const prompts = db.prepare(`
            SELECT name, filename FROM prompts WHERE tenant_id = ?
        `).all(ivr.tenant_id);
        
        // Build prompt cache: { prompt_name: relative_file_path }
        const promptCache = {};
        for (const p of prompts) {
            promptCache[p.name] = p.filename;
        }
        
        res.json({
            id: ivr.id,
            name: ivr.name,
            extension: ivr.extension,
            language: ivr.language,
            flow: JSON.parse(ivr.flow_data),
            settings: JSON.parse(ivr.settings || '{}'),
            promptCache: promptCache
        });
    } catch (error) {
        console.error('Error fetching IVR flow:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// IVR Engine endpoint - called by IVR node to log completed calls
// No auth required - internal service-to-service communication
app.post('/api/engine/call-log', async (req, res) => {
    try {
        const db = require('./db');
        const { v4: uuidv4 } = require('uuid');
        const { 
            ivrId, 
            extension, 
            callerId, 
            outboundCallId,
            calledNumber,
            startTime, 
            endTime, 
            status, 
            nodeHistory, 
            dtmfInputs, 
            apiCalls,
            variables  // Captured variables from the call
        } = req.body;
        
        // Get tenant_id and captureVariables config from the IVR
        const ivr = db.prepare('SELECT tenant_id, flow_data FROM ivr_flows WHERE id = ?').get(ivrId);
        const tenantId = ivr?.tenant_id || null;
        
        // Filter variables to only include those configured in captureVariables
        let capturedVars = {};
        if (variables && ivr?.flow_data) {
            try {
                const flowData = parseJsonSafe(ivr.flow_data, {});
                const captureList = flowData.settings?.captureVariables || flowData.captureVariables || [];
                const branchDisplayMap = buildBranchDisplayMap(flowData);

                if (captureList.length > 0) {
                    // Only capture specified variables
                    for (const varConfig of captureList) {
                        const config = typeof varConfig === 'string' ? { name: varConfig } : varConfig;
                        const varName = config?.name;
                        if (!varName || variables[varName] === undefined) continue;

                        const rawValue = variables[varName];
                        const valueMap = {
                            ...(branchDisplayMap[varName] || {}),
                            ...((config && typeof config.valueMap === 'object') ? config.valueMap : {})
                        };
                        const normalizedValue = normalizeVariableValue(rawValue, valueMap);

                        capturedVars[varName] = {
                            value: normalizedValue,
                            rawValue,
                            label: config?.label || varName
                        };
                    }
                } else {
                    // If no capture list defined, capture common useful variables (excluding internal ones)
                    const excludeVars = ['caller_id', 'channel_id', 'extension', 'language', 'dtmf_input'];
                    for (const [key, value] of Object.entries(variables)) {
                        if (excludeVars.includes(key) || key.startsWith('_')) continue;
                        const normalizedValue = normalizeVariableValue(value, branchDisplayMap[key] || {});
                        capturedVars[key] = { value: normalizedValue, rawValue: value, label: key };
                    }
                }
            } catch (e) {
                console.error('Error parsing flow_data for captureVariables:', e);
            }
        }
        
        // Calculate duration in seconds
        const duration = startTime && endTime 
            ? Math.round((new Date(endTime) - new Date(startTime)) / 1000) 
            : 0;

        let resolvedCalledNumber = calledNumber || null;
        if (!resolvedCalledNumber && outboundCallId) {
            const outboundCall = db.prepare('SELECT phone_number FROM outbound_calls WHERE id = ?').get(outboundCallId);
            resolvedCalledNumber = outboundCall?.phone_number || null;
        }
        
        const id = uuidv4();
        db.prepare(`
            INSERT INTO call_logs (id, ivr_id, tenant_id, caller_id, outbound_call_id, called_number, extension, start_time, end_time, duration, status, flow_path, dtmf_inputs, api_calls, variables)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            ivrId,
            tenantId,
            callerId,
            outboundCallId || null,
            resolvedCalledNumber,
            extension,
            startTime,
            endTime,
            duration,
            status || 'completed',
            JSON.stringify(nodeHistory || []),
            JSON.stringify(dtmfInputs || []),
            JSON.stringify(apiCalls || []),
            JSON.stringify(capturedVars)
        );
        
        console.log(`Call logged: ${id} - IVR ${ivrId}, extension ${extension}, duration ${duration}s`);
        res.json({ success: true, id });
    } catch (error) {
        console.error('Error logging call:', error);
        res.status(500).json({ error: 'Failed to log call' });
    }
});

// Internal endpoint to update outbound call status (no auth - internal use only)
app.put('/api/engine/outbound-call/:id', async (req, res) => {
    try {
        const db = require('./db');
        const { 
            status, 
            hangup_cause, 
            duration, 
            result, 
            answer_time,
            end_time,
            dtmf_inputs,
            channel_id
        } = req.body;
        
        const call = db.prepare('SELECT * FROM outbound_calls WHERE id = ?').get(req.params.id);
        
        if (!call) {
            return res.status(404).json({ error: 'Call not found' });
        }

        const parsedIncomingResult = parseJsonSafe(result, null);
        let nextStatus = status || call.status;
        let nextHangupCause = hangup_cause || call.hangup_cause;
        let nextResult = parsedIncomingResult;

        // Classify abrupt caller hangup separately from successful completion.
        const isAbruptHangup = nextHangupCause === 'caller_hangup_early'
            || parsedIncomingResult?.call_outcome === 'abrupt_end';
        if (nextStatus === 'completed' && isAbruptHangup) {
            nextStatus = 'failed';
        }

        // Normalize outbound result payload with branch display-name mapping.
        if (parsedIncomingResult && typeof parsedIncomingResult === 'object' && call.ivr_id) {
            const ivr = db.prepare('SELECT flow_data FROM ivr_flows WHERE id = ?').get(call.ivr_id);
            if (ivr?.flow_data) {
                const flowData = parseJsonSafe(ivr.flow_data, {});
                const branchDisplayMap = buildBranchDisplayMap(flowData);
                nextResult = normalizeResultVariables(parsedIncomingResult, branchDisplayMap);
            }
        }

        if (nextResult && typeof nextResult === 'object') {
            if (!nextResult.call_outcome) {
                if (nextStatus === 'completed') nextResult.call_outcome = 'finished';
                else if (nextStatus === 'no_answer') nextResult.call_outcome = 'no_answer';
                else if (nextStatus === 'cancelled') nextResult.call_outcome = 'cancelled';
                else if (nextStatus === 'busy') nextResult.call_outcome = 'busy';
                else if (nextStatus === 'failed' && nextHangupCause === 'caller_hangup_early') nextResult.call_outcome = 'abrupt_end';
                else if (nextStatus === 'failed') nextResult.call_outcome = 'failed';
            }
            nextResult.attempt_number = call.attempt_number || 1;
            nextResult.retry_count = Math.max(0, (call.attempt_number || 1) - 1);
        }

        const updates = [];
        const values = [];
        
        if (nextStatus) {
            updates.push('status = ?');
            values.push(nextStatus);
        }
        
        if (nextHangupCause) {
            updates.push('hangup_cause = ?');
            values.push(nextHangupCause);
        }
        
        if (duration !== undefined) {
            updates.push('duration = ?');
            values.push(duration);
        }
        
        if (nextResult) {
            updates.push('result = ?');
            values.push(typeof nextResult === 'string' ? nextResult : JSON.stringify(nextResult));
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
        
        if (channel_id) {
            updates.push('channel_id = ?');
            values.push(channel_id);
        }
        
        if (updates.length > 0) {
            values.push(req.params.id);
            db.prepare(`UPDATE outbound_calls SET ${updates.join(', ')} WHERE id = ?`).run(...values);
            console.log(`Outbound call ${req.params.id} updated: status=${nextStatus}, duration=${duration}`);
        }

        const becameAnswered = nextStatus === 'answered' && call.status !== 'answered';
        const isTerminal = TERMINAL_OUTBOUND_STATUSES.has(nextStatus);
        const wasTerminal = TERMINAL_OUTBOUND_STATUSES.has(call.status);
        const becameTerminal = isTerminal && !wasTerminal;

        if (call.run_id && becameAnswered) {
            db.prepare(`
                UPDATE campaign_runs
                SET contacts_answered = contacts_answered + 1
                WHERE id = ?
            `).run(call.run_id);
        }

        if (call.contact_id && becameTerminal) {
            const campaign = call.campaign_id
                ? db.prepare('SELECT max_attempts FROM campaigns WHERE id = ?').get(call.campaign_id)
                : null;
            const maxAttempts = Math.max(1, parseInt(campaign?.max_attempts || 1, 10));
            const attemptNumber = Math.max(1, parseInt(call.attempt_number || 1, 10));
            const retryable = RETRYABLE_OUTBOUND_STATUSES.has(nextStatus);
            const shouldRetry = retryable && attemptNumber < maxAttempts;
            const resultJson = nextResult
                ? (typeof nextResult === 'string' ? nextResult : JSON.stringify(nextResult))
                : '{}';

            if (shouldRetry) {
                db.prepare(`
                    UPDATE campaign_contacts
                    SET status = 'pending',
                        last_attempt_at = CURRENT_TIMESTAMP,
                        result = ?
                    WHERE id = ?
                `).run(resultJson, call.contact_id);
            } else {
                const contactStatus = nextStatus === 'completed' ? 'completed' : 'failed';
                db.prepare(`
                    UPDATE campaign_contacts
                    SET status = ?,
                        last_attempt_at = CURRENT_TIMESTAMP,
                        result = ?
                    WHERE id = ?
                `).run(contactStatus, resultJson, call.contact_id);

                if (call.run_id) {
                    if (contactStatus === 'completed') {
                        db.prepare('UPDATE campaign_runs SET contacts_completed = contacts_completed + 1 WHERE id = ?')
                            .run(call.run_id);
                    } else {
                        db.prepare('UPDATE campaign_runs SET contacts_failed = contacts_failed + 1 WHERE id = ?')
                            .run(call.run_id);
                        if (nextStatus === 'no_answer') {
                            db.prepare('UPDATE campaign_runs SET contacts_no_answer = contacts_no_answer + 1 WHERE id = ?')
                                .run(call.run_id);
                        } else if (nextStatus === 'busy') {
                            db.prepare('UPDATE campaign_runs SET contacts_busy = contacts_busy + 1 WHERE id = ?')
                                .run(call.run_id);
                        }
                    }
                }
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating outbound call:', error);
        res.status(500).json({ error: 'Failed to update call' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
    console.log(`Platform API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});
