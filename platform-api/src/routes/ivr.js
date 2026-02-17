const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const BARGE_IN_DEFAULT_NODE_TYPES = new Set(['play', 'play_digits', 'play_sequence', 'collect']);

function applyBargeInDefaults(flow) {
    if (!flow || typeof flow !== 'object' || !flow.nodes || typeof flow.nodes !== 'object') {
        return flow;
    }

    const normalized = JSON.parse(JSON.stringify(flow));
    Object.values(normalized.nodes).forEach((node) => {
        if (!node || typeof node !== 'object') return;
        if (!BARGE_IN_DEFAULT_NODE_TYPES.has(node.type)) return;
        if (typeof node.bargeIn !== 'boolean') {
            node.bargeIn = true;
        }
    });

    return normalized;
}

// Apply auth middleware to all routes
router.use(authMiddleware);

// List all IVRs for tenant
router.get('/', (req, res) => {
    try {
        const ivrs = db.prepare(`
            SELECT id, name, description, extension, status, language, version,
                   created_at, updated_at
            FROM ivr_flows
            WHERE tenant_id = ? AND status != 'archived'
            ORDER BY created_at DESC
        `).all(req.user.tenantId);
        
        res.json(ivrs);
    } catch (error) {
        console.error('List IVRs error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get single IVR
router.get('/:id', (req, res) => {
    try {
        const ivr = db.prepare(`
            SELECT *
            FROM ivr_flows
            WHERE id = ? AND tenant_id = ?
        `).get(req.params.id, req.user.tenantId);
        
        if (!ivr) {
            return res.status(404).json({ error: 'IVR not found' });
        }
        
        res.json({
            ...ivr,
            flow_data: JSON.parse(ivr.flow_data),
            settings: JSON.parse(ivr.settings || '{}')
        });
    } catch (error) {
        console.error('Get IVR error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new IVR
router.post('/', requireRole('admin', 'editor'), (req, res) => {
    try {
        const { name, description, language = 'ar', flowData, templateId } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }
        
        // Get available extension
        const availableExt = db.prepare(`
            SELECT extension FROM extensions
            WHERE status = 'available'
            ORDER BY extension
            LIMIT 1
        `).get();
        
        if (!availableExt) {
            return res.status(400).json({ error: 'No extensions available' });
        }
        
        const ivrId = uuidv4();
        const extension = availableExt.extension;
        
        // If templateId provided, clone from template
        let flow = flowData;
        if (templateId && !flowData) {
            const template = db.prepare('SELECT flow_data FROM ivr_templates WHERE id = ?').get(templateId);
            if (template) {
                flow = JSON.parse(template.flow_data);
            }
        }
        
        if (!flow) {
            // Default empty flow
            flow = {
                startNode: 'welcome',
                nodes: {
                    welcome: {
                        id: 'welcome',
                        type: 'play',
                        prompt: 'welcome',
                        next: 'hangup'
                    },
                    hangup: {
                        id: 'hangup',
                        type: 'hangup'
                    }
                }
            };
        }

        flow = applyBargeInDefaults(flow);
        
        // Create IVR first (before assigning extension due to foreign key)
        db.prepare(`
            INSERT INTO ivr_flows (id, tenant_id, name, description, extension, language, flow_data, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(ivrId, req.user.tenantId, name, description, extension, language, JSON.stringify(flow), req.user.userId);
        
        // Then assign extension
        db.prepare(`
            UPDATE extensions
            SET tenant_id = ?, ivr_id = ?, status = 'assigned', assigned_at = CURRENT_TIMESTAMP
            WHERE extension = ?
        `).run(req.user.tenantId, ivrId, extension);
        
        const ivr = db.prepare('SELECT * FROM ivr_flows WHERE id = ?').get(ivrId);
        
        res.status(201).json({
            ...ivr,
            flow_data: JSON.parse(ivr.flow_data),
            settings: JSON.parse(ivr.settings || '{}')
        });
    } catch (error) {
        console.error('Create IVR error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update IVR
router.put('/:id', requireRole('admin', 'editor'), (req, res) => {
    try {
        const { name, description, language, flowData, settings, status } = req.body;
        
        const existing = db.prepare(`
            SELECT * FROM ivr_flows WHERE id = ? AND tenant_id = ?
        `).get(req.params.id, req.user.tenantId);
        
        if (!existing) {
            return res.status(404).json({ error: 'IVR not found' });
        }
        
        const updates = [];
        const params = [];
        
        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (language !== undefined) {
            updates.push('language = ?');
            params.push(language);
        }
        if (flowData !== undefined) {
            const normalizedFlow = applyBargeInDefaults(flowData);
            updates.push('flow_data = ?');
            params.push(JSON.stringify(normalizedFlow));
            updates.push('version = version + 1');
        }
        if (settings !== undefined) {
            updates.push('settings = ?');
            params.push(JSON.stringify(settings));
        }
        if (status !== undefined) {
            updates.push('status = ?');
            params.push(status);
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(req.params.id, req.user.tenantId);
        
        db.prepare(`
            UPDATE ivr_flows
            SET ${updates.join(', ')}
            WHERE id = ? AND tenant_id = ?
        `).run(...params);
        
        const ivr = db.prepare('SELECT * FROM ivr_flows WHERE id = ?').get(req.params.id);
        
        res.json({
            ...ivr,
            flow_data: JSON.parse(ivr.flow_data),
            settings: JSON.parse(ivr.settings || '{}')
        });
    } catch (error) {
        console.error('Update IVR error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete IVR (archive)
router.delete('/:id', requireRole('admin'), (req, res) => {
    try {
        const existing = db.prepare(`
            SELECT * FROM ivr_flows WHERE id = ? AND tenant_id = ?
        `).get(req.params.id, req.user.tenantId);
        
        if (!existing) {
            return res.status(404).json({ error: 'IVR not found' });
        }
        
        // Release extension
        if (existing.extension) {
            db.prepare(`
                UPDATE extensions
                SET tenant_id = NULL, ivr_id = NULL, status = 'available', assigned_at = NULL
                WHERE extension = ?
            `).run(existing.extension);
        }
        
        // Archive IVR
        db.prepare(`
            UPDATE ivr_flows
            SET status = 'archived', extension = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(req.params.id);
        
        res.json({ message: 'IVR deleted successfully' });
    } catch (error) {
        console.error('Delete IVR error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Activate/Deactivate IVR
router.post('/:id/activate', requireRole('admin', 'editor'), (req, res) => {
    try {
        const { active } = req.body;
        const status = active ? 'active' : 'inactive';
        
        db.prepare(`
            UPDATE ivr_flows
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND tenant_id = ?
        `).run(status, req.params.id, req.user.tenantId);
        
        res.json({ message: `IVR ${active ? 'activated' : 'deactivated'}` });
    } catch (error) {
        console.error('Activate IVR error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clone IVR
router.post('/:id/clone', requireRole('admin', 'editor'), (req, res) => {
    try {
        const { name } = req.body;
        
        const source = db.prepare(`
            SELECT * FROM ivr_flows WHERE id = ? AND tenant_id = ?
        `).get(req.params.id, req.user.tenantId);
        
        if (!source) {
            return res.status(404).json({ error: 'IVR not found' });
        }
        
        // Get available extension
        const availableExt = db.prepare(`
            SELECT extension FROM extensions
            WHERE status = 'available'
            ORDER BY extension
            LIMIT 1
        `).get();
        
        if (!availableExt) {
            return res.status(400).json({ error: 'No extensions available' });
        }
        
        const ivrId = uuidv4();
        const extension = availableExt.extension;
        const newName = name || `${source.name} (Copy)`;
        const sourceFlow = applyBargeInDefaults(JSON.parse(source.flow_data));
        
        // Assign extension
        db.prepare(`
            UPDATE extensions
            SET tenant_id = ?, ivr_id = ?, status = 'assigned', assigned_at = CURRENT_TIMESTAMP
            WHERE extension = ?
        `).run(req.user.tenantId, ivrId, extension);
        
        // Clone IVR
        db.prepare(`
            INSERT INTO ivr_flows (id, tenant_id, name, description, extension, language, flow_data, settings, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(ivrId, req.user.tenantId, newName, source.description, extension, source.language, JSON.stringify(sourceFlow), source.settings, req.user.userId);
        
        const ivr = db.prepare('SELECT * FROM ivr_flows WHERE id = ?').get(ivrId);
        
        res.status(201).json({
            ...ivr,
            flow_data: JSON.parse(ivr.flow_data),
            settings: JSON.parse(ivr.settings || '{}')
        });
    } catch (error) {
        console.error('Clone IVR error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
