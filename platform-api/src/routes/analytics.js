const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

function parseJsonSafe(value, fallback) {
    try {
        return JSON.parse(value || JSON.stringify(fallback));
    } catch (_error) {
        return fallback;
    }
}

function getVariableValue(variableEntry) {
    if (variableEntry && typeof variableEntry === 'object' && variableEntry.value !== undefined) {
        return variableEntry.value;
    }
    return variableEntry;
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (/[",\n\r]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}

function normalizeDateInput(input, fallbackIso) {
    if (!input) return fallbackIso;
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return fallbackIso;
    return date.toISOString();
}

function resolveDateRange(query, defaultHours = 24) {
    const now = new Date();
    const requestedHours = parseInt(query.hours, 10);
    const hours = Number.isNaN(requestedHours) ? defaultHours : requestedHours;
    const defaultFrom = new Date(now.getTime() - (hours * 60 * 60 * 1000));

    const fromIso = normalizeDateInput(query.from, defaultFrom.toISOString());
    const toIso = normalizeDateInput(query.to, now.toISOString());

    return { fromIso, toIso };
}

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

// Export call logs CSV
router.get('/calls/export', (req, res) => {
    try {
        const { ivrId } = req.query;
        const { fromIso, toIso } = resolveDateRange(req.query, 24);

        let query = `
            SELECT c.*, f.name as ivr_name
            FROM call_logs c
            LEFT JOIN ivr_flows f ON c.ivr_id = f.id
            WHERE c.tenant_id = ?
        `;
        const params = [req.user.tenantId];

        query += ' AND julianday(c.start_time) >= julianday(?) AND julianday(c.start_time) <= julianday(?)';
        params.push(fromIso, toIso);

        if (ivrId) {
            query += ' AND c.ivr_id = ?';
            params.push(ivrId);
        }

        query += ' ORDER BY c.start_time DESC';

        const calls = db.prepare(query).all(...params);

        const parsedCalls = calls.map((call) => {
            const variables = parseJsonSafe(call.variables, {});
            return {
                ...call,
                flow_path: parseJsonSafe(call.flow_path, []),
                dtmf_inputs: parseJsonSafe(call.dtmf_inputs, []),
                api_calls: parseJsonSafe(call.api_calls, []),
                variables
            };
        });

        const variableKeys = new Set();
        for (const call of parsedCalls) {
            for (const key of Object.keys(call.variables || {})) {
                variableKeys.add(key);
            }
        }

        const dynamicVariableColumns = Array.from(variableKeys)
            .sort()
            .map((key) => `variable.${key}`);

        const headers = [
            'id',
            'ivr_id',
            'ivr_name',
            'tenant_id',
            'caller_id',
            'extension',
            'start_time',
            'end_time',
            'duration',
            'status',
            'created_at',
            'account_number',
            'balance',
            'flow_path',
            'dtmf_inputs',
            'api_calls',
            'variables',
            ...dynamicVariableColumns
        ];

        const rows = parsedCalls.map((call) => {
            const accountNumber = getVariableValue(call.variables?.account_number);
            const balance =
                getVariableValue(call.variables?.total_amount) ??
                getVariableValue(call.variables?.balance) ??
                getVariableValue(call.variables?.balance_amount);

            const row = {
                id: call.id,
                ivr_id: call.ivr_id,
                ivr_name: call.ivr_name,
                tenant_id: call.tenant_id,
                caller_id: call.caller_id,
                extension: call.extension,
                start_time: call.start_time,
                end_time: call.end_time,
                duration: call.duration,
                status: call.status,
                created_at: call.created_at,
                account_number: accountNumber,
                balance: balance,
                flow_path: JSON.stringify(call.flow_path || []),
                dtmf_inputs: JSON.stringify(call.dtmf_inputs || []),
                api_calls: JSON.stringify(call.api_calls || []),
                variables: JSON.stringify(call.variables || {})
            };

            for (const column of dynamicVariableColumns) {
                const key = column.replace('variable.', '');
                const value = getVariableValue(call.variables?.[key]);
                row[column] = value === undefined ? '' : value;
            }

            return headers.map((header) => csvEscape(row[header])).join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const dateStamp = new Date().toISOString().slice(0, 10);
        const suffix = ivrId ? `-${ivrId}` : '';

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="analytics-calls${suffix}-${dateStamp}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Call logs export error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Call logs
router.get('/calls', (req, res) => {
    try {
        const { ivrId, limit = 50, offset = 0 } = req.query;
        const { fromIso, toIso } = resolveDateRange(req.query, 24);
        
        let query = `
            SELECT c.*, f.name as ivr_name
            FROM call_logs c
            LEFT JOIN ivr_flows f ON c.ivr_id = f.id
            WHERE c.tenant_id = ?
        `;
        const params = [req.user.tenantId];

        query += ' AND julianday(c.start_time) >= julianday(?) AND julianday(c.start_time) <= julianday(?)';
        params.push(fromIso, toIso);
        
        if (ivrId) {
            query += ' AND c.ivr_id = ?';
            params.push(ivrId);
        }
        
        query += ' ORDER BY c.start_time DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const calls = db.prepare(query).all(...params);
        
        res.json(calls.map(call => ({
            ...call,
            flow_path: parseJsonSafe(call.flow_path, []),
            dtmf_inputs: parseJsonSafe(call.dtmf_inputs, []),
            api_calls: parseJsonSafe(call.api_calls, []),
            variables: parseJsonSafe(call.variables, {})
        })));
    } catch (error) {
        console.error('Call logs error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Calls summary (for total count chart)
router.get('/calls/summary', (req, res) => {
    try {
        const { ivrId } = req.query;
        const { fromIso, toIso } = resolveDateRange(req.query, 24);

        let query = `
            SELECT
                COUNT(*) as total_calls,
                SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) as completed_calls,
                SUM(CASE WHEN c.status = 'failed' THEN 1 ELSE 0 END) as failed_calls,
                AVG(c.duration) as avg_duration
            FROM call_logs c
            WHERE c.tenant_id = ?
              AND julianday(c.start_time) >= julianday(?)
              AND julianday(c.start_time) <= julianday(?)
        `;
        const params = [req.user.tenantId, fromIso, toIso];

        if (ivrId) {
            query += ' AND c.ivr_id = ?';
            params.push(ivrId);
        }

        const summary = db.prepare(query).get(...params);

        res.json({
            totalCalls: summary?.total_calls || 0,
            completedCalls: summary?.completed_calls || 0,
            failedCalls: summary?.failed_calls || 0,
            avgDuration: Math.round(summary?.avg_duration || 0)
        });
    } catch (error) {
        console.error('Call summary error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Calls by hour (for charts)
router.get('/calls/hourly', (req, res) => {
    try {
        const { ivrId } = req.query;
        const { fromIso, toIso } = resolveDateRange(req.query, 24);

        let query = `
            SELECT 
                strftime('%Y-%m-%d %H:00', start_time) as hour,
                COUNT(*) as count
            FROM call_logs
            WHERE tenant_id = ?
              AND julianday(start_time) >= julianday(?)
              AND julianday(start_time) <= julianday(?)
        `;
        const params = [req.user.tenantId, fromIso, toIso];

        if (ivrId) {
            query += ' AND ivr_id = ?';
            params.push(ivrId);
        }

        query += `
            GROUP BY hour
            ORDER BY hour
        `;

        const data = db.prepare(query).all(...params);
        
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
