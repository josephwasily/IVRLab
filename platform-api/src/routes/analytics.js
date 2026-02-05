const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// Dashboard stats
router.get('/dashboard', (req, res) => {
    try {
        // IVR counts
        const ivrStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
                SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive
            FROM ivr_flows
            WHERE tenant_id = ? AND status != 'archived'
        `).get(req.user.tenantId);
        
        // Call stats (last 24 hours)
        const callStats = db.prepare(`
            SELECT 
                COUNT(*) as total_calls,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                AVG(duration) as avg_duration
            FROM call_logs
            WHERE tenant_id = ? AND start_time >= datetime('now', '-24 hours')
        `).get(req.user.tenantId);
        
        // Extension count
        const extStats = db.prepare(`
            SELECT COUNT(*) as extensions
            FROM extensions
            WHERE tenant_id = ?
        `).get(req.user.tenantId);
        
        res.json({
            ivrs: ivrStats,
            calls: {
                total: callStats.total_calls || 0,
                completed: callStats.completed || 0,
                avgDuration: Math.round(callStats.avg_duration || 0)
            },
            extensions: extStats.extensions
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Call logs
router.get('/calls', (req, res) => {
    try {
        const { ivrId, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT c.*, f.name as ivr_name
            FROM call_logs c
            LEFT JOIN ivr_flows f ON c.ivr_id = f.id
            WHERE c.tenant_id = ?
        `;
        const params = [req.user.tenantId];
        
        if (ivrId) {
            query += ' AND c.ivr_id = ?';
            params.push(ivrId);
        }
        
        query += ' ORDER BY c.start_time DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const calls = db.prepare(query).all(...params);
        
        res.json(calls.map(call => ({
            ...call,
            flow_path: JSON.parse(call.flow_path || '[]'),
            dtmf_inputs: JSON.parse(call.dtmf_inputs || '[]'),
            api_calls: JSON.parse(call.api_calls || '[]'),
            variables: JSON.parse(call.variables || '{}')
        })));
    } catch (error) {
        console.error('Call logs error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Calls by hour (for charts)
router.get('/calls/hourly', (req, res) => {
    try {
        const { hours = 24 } = req.query;
        
        const data = db.prepare(`
            SELECT 
                strftime('%Y-%m-%d %H:00', start_time) as hour,
                COUNT(*) as count
            FROM call_logs
            WHERE tenant_id = ? AND start_time >= datetime('now', '-' || ? || ' hours')
            GROUP BY hour
            ORDER BY hour
        `).all(req.user.tenantId, parseInt(hours));
        
        res.json(data);
    } catch (error) {
        console.error('Hourly calls error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// IVR performance
router.get('/ivr/:id', (req, res) => {
    try {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_calls,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(duration) as avg_duration,
                MIN(start_time) as first_call,
                MAX(start_time) as last_call
            FROM call_logs
            WHERE ivr_id = ? AND tenant_id = ?
        `).get(req.params.id, req.user.tenantId);
        
        res.json({
            totalCalls: stats.total_calls || 0,
            completed: stats.completed || 0,
            failed: stats.failed || 0,
            completionRate: stats.total_calls > 0 
                ? Math.round((stats.completed / stats.total_calls) * 100) 
                : 0,
            avgDuration: Math.round(stats.avg_duration || 0),
            firstCall: stats.first_call,
            lastCall: stats.last_call
        });
    } catch (error) {
        console.error('IVR stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
