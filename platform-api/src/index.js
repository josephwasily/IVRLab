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

const app = express();
const PORT = process.env.PORT || 3001;

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
                const flowData = JSON.parse(ivr.flow_data);
                const captureList = flowData.settings?.captureVariables || flowData.captureVariables || [];
                
                if (captureList.length > 0) {
                    // Only capture specified variables
                    for (const varConfig of captureList) {
                        const varName = typeof varConfig === 'string' ? varConfig : varConfig.name;
                        if (variables[varName] !== undefined) {
                            capturedVars[varName] = {
                                value: variables[varName],
                                label: typeof varConfig === 'object' ? varConfig.label : varName
                            };
                        }
                    }
                } else {
                    // If no capture list defined, capture common useful variables (excluding internal ones)
                    const excludeVars = ['caller_id', 'channel_id', 'extension', 'language', 'dtmf_input'];
                    for (const [key, value] of Object.entries(variables)) {
                        if (!excludeVars.includes(key) && !key.startsWith('_')) {
                            capturedVars[key] = { value, label: key };
                        }
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
        
        const id = uuidv4();
        db.prepare(`
            INSERT INTO call_logs (id, ivr_id, tenant_id, caller_id, extension, start_time, end_time, duration, status, flow_path, dtmf_inputs, api_calls, variables)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            ivrId,
            tenantId,
            callerId,
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
        
        if (channel_id) {
            updates.push('channel_id = ?');
            values.push(channel_id);
        }
        
        if (updates.length > 0) {
            values.push(req.params.id);
            db.prepare(`UPDATE outbound_calls SET ${updates.join(', ')} WHERE id = ?`).run(...values);
            console.log(`Outbound call ${req.params.id} updated: status=${status}, duration=${duration}`);
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
