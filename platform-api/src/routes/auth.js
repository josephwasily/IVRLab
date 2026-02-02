const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');

// Login
router.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const user = db.prepare(`
            SELECT u.*, t.name as tenant_name, t.slug as tenant_slug
            FROM users u
            JOIN tenants t ON u.tenant_id = t.id
            WHERE u.email = ? AND u.status = 'active'
        `).get(email);
        
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({
            userId: user.id,
            tenantId: user.tenant_id,
            email: user.email,
            name: user.name,
            role: user.role
        }, JWT_SECRET, { expiresIn: '24h' });
        
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                tenant: {
                    id: user.tenant_id,
                    name: user.tenant_name,
                    slug: user.tenant_slug
                }
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
    try {
        const user = db.prepare(`
            SELECT u.id, u.email, u.name, u.role, u.tenant_id,
                   t.name as tenant_name, t.slug as tenant_slug
            FROM users u
            JOIN tenants t ON u.tenant_id = t.id
            WHERE u.id = ?
        `).get(req.user.userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            tenant: {
                id: user.tenant_id,
                name: user.tenant_name,
                slug: user.tenant_slug
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Register new tenant and admin user
router.post('/register', (req, res) => {
    try {
        const { tenantName, email, password, name } = req.body;
        
        if (!tenantName || !email || !password || !name) {
            return res.status(400).json({ error: 'All fields required' });
        }
        
        // Check if email exists
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        const tenantId = uuidv4();
        const userId = uuidv4();
        const slug = tenantName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const passwordHash = bcrypt.hashSync(password, 10);
        
        // Create tenant
        db.prepare(`
            INSERT INTO tenants (id, name, slug)
            VALUES (?, ?, ?)
        `).run(tenantId, tenantName, slug);
        
        // Create admin user
        db.prepare(`
            INSERT INTO users (id, tenant_id, email, password_hash, name, role)
            VALUES (?, ?, ?, ?, ?, 'admin')
        `).run(userId, tenantId, email, passwordHash, name);
        
        const token = jwt.sign({
            userId,
            tenantId,
            email,
            name,
            role: 'admin'
        }, JWT_SECRET, { expiresIn: '24h' });
        
        res.status(201).json({
            token,
            user: {
                id: userId,
                email,
                name,
                role: 'admin',
                tenant: {
                    id: tenantId,
                    name: tenantName,
                    slug
                }
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
