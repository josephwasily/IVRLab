const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// List extensions for tenant
router.get('/', (req, res) => {
    try {
        const extensions = db.prepare(`
            SELECT e.extension, e.status, e.assigned_at,
                   f.id as ivr_id, f.name as ivr_name
            FROM extensions e
            LEFT JOIN ivr_flows f ON e.ivr_id = f.id
            WHERE e.tenant_id = ? OR e.status = 'available'
            ORDER BY e.extension
        `).all(req.user.tenantId);
        
        res.json(extensions);
    } catch (error) {
        console.error('List extensions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get extension stats
router.get('/stats', requireRole('admin'), (req, res) => {
    try {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned,
                SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved
            FROM extensions
        `).get();
        
        const tenantStats = db.prepare(`
            SELECT COUNT(*) as tenant_extensions
            FROM extensions
            WHERE tenant_id = ?
        `).get(req.user.tenantId);
        
        res.json({
            ...stats,
            tenant_extensions: tenantStats.tenant_extensions
        });
    } catch (error) {
        console.error('Extension stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
