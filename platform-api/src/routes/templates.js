const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// Public endpoint - list system templates
router.get('/', (req, res) => {
    try {
        const templates = db.prepare(`
            SELECT id, name, description, category, is_system, created_at
            FROM ivr_templates
            WHERE is_system = 1
            ORDER BY category, name
        `).all();
        
        res.json(templates);
    } catch (error) {
        console.error('List templates error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get template details
router.get('/:id', (req, res) => {
    try {
        const template = db.prepare(`
            SELECT *
            FROM ivr_templates
            WHERE id = ?
        `).get(req.params.id);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json({
            ...template,
            flow_data: JSON.parse(template.flow_data),
            settings: JSON.parse(template.settings || '{}')
        });
    } catch (error) {
        console.error('Get template error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get templates by category
router.get('/category/:category', (req, res) => {
    try {
        const templates = db.prepare(`
            SELECT id, name, description, category, is_system, created_at
            FROM ivr_templates
            WHERE category = ? AND is_system = 1
            ORDER BY name
        `).all(req.params.category);
        
        res.json(templates);
    } catch (error) {
        console.error('List templates by category error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
