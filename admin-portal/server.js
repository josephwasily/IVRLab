import express from "express";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize SQLite database (read-only access to shared database)
const dbPath = process.env.DB_PATH || "/data/ivr_calls.db";
let db;

function initDb() {
  try {
    db = new Database(dbPath, { readonly: true });
    console.log("Connected to SQLite database");
  } catch (err) {
    console.error("Failed to connect to database:", err.message);
    // Retry after a delay (database might not exist yet)
    setTimeout(initDb, 5000);
  }
}

initDb();

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// API endpoint to get all call logs
app.get("/api/call-logs", (req, res) => {
  if (!db) {
    return res.status(503).json({ error: "Database not ready" });
  }
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const logs = db.prepare(`
      SELECT * FROM call_logs 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    
    const total = db.prepare("SELECT COUNT(*) as count FROM call_logs").get();
    
    res.json({ 
      logs, 
      total: total.count,
      limit,
      offset 
    });
  } catch (err) {
    console.error("Failed to get call logs:", err.message);
    res.status(500).json({ error: "Failed to retrieve call logs" });
  }
});

// API endpoint to get call statistics
app.get("/api/stats", (req, res) => {
  if (!db) {
    return res.status(503).json({ error: "Database not ready" });
  }
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_calls,
        COUNT(DISTINCT account_number) as unique_accounts,
        ROUND(AVG(balance), 2) as avg_balance,
        ROUND(MIN(balance), 2) as min_balance,
        ROUND(MAX(balance), 2) as max_balance,
        ROUND(SUM(balance), 2) as total_balance
      FROM call_logs WHERE status = 'completed'
    `).get();
    
    const callsByDate = db.prepare(`
      SELECT 
        DATE(call_date) as date,
        COUNT(*) as call_count,
        ROUND(AVG(balance), 2) as avg_balance
      FROM call_logs
      GROUP BY DATE(call_date)
      ORDER BY date DESC
      LIMIT 30
    `).all();
    
    const recentCalls = db.prepare(`
      SELECT * FROM call_logs 
      ORDER BY id DESC 
      LIMIT 10
    `).all();
    
    const topAccounts = db.prepare(`
      SELECT 
        account_number,
        COUNT(*) as call_count,
        ROUND(AVG(balance), 2) as avg_balance
      FROM call_logs
      WHERE account_number IS NOT NULL
      GROUP BY account_number
      ORDER BY call_count DESC
      LIMIT 10
    `).all();
    
    const callsByStatus = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM call_logs
      GROUP BY status
    `).all();
    
    res.json({ 
      ...stats, 
      callsByDate,
      recentCalls,
      topAccounts,
      callsByStatus
    });
  } catch (err) {
    console.error("Failed to get stats:", err.message);
    res.status(500).json({ error: "Failed to retrieve statistics" });
  }
});

// Serve the main dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Admin Portal listening on :${PORT}`);
});
