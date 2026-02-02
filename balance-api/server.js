import express from "express";
import Database from "better-sqlite3";
import path from "path";

const app = express();

// Initialize SQLite database
const dbPath = process.env.DB_PATH || "/data/ivr_calls.db";
const db = new Database(dbPath);

// Create call_logs table with status tracking
db.exec(`
  CREATE TABLE IF NOT EXISTS call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT,
    call_date TEXT NOT NULL,
    status TEXT DEFAULT 'started',
    account_number TEXT,
    balance REAL,
    currency TEXT,
    ended_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: add new columns if they don't exist (for existing databases)
try {
  db.exec(`ALTER TABLE call_logs ADD COLUMN channel_id TEXT`);
} catch (e) { /* column exists */ }
try {
  db.exec(`ALTER TABLE call_logs ADD COLUMN status TEXT DEFAULT 'started'`);
} catch (e) { /* column exists */ }
try {
  db.exec(`ALTER TABLE call_logs ADD COLUMN ended_at TEXT`);
} catch (e) { /* column exists */ }

// Prepare statements for better performance
const insertCallStart = db.prepare(`
  INSERT INTO call_logs (channel_id, call_date, status)
  VALUES (?, ?, 'started')
`);

const updateCallAccount = db.prepare(`
  UPDATE call_logs SET account_number = ?, status = 'account_entered'
  WHERE id = ?
`);

const updateCallBalance = db.prepare(`
  UPDATE call_logs SET balance = ?, currency = ?, status = 'completed'
  WHERE id = ?
`);

const updateCallEnded = db.prepare(`
  UPDATE call_logs SET status = ?, ended_at = ?
  WHERE id = ?
`);

const insertCallLog = db.prepare(`
  INSERT INTO call_logs (call_date, account_number, balance, currency, status)
  VALUES (?, ?, ?, ?, 'completed')
`);

const getAllCallLogs = db.prepare(`
  SELECT * FROM call_logs ORDER BY id DESC
`);

const getCallStats = db.prepare(`
  SELECT 
    COUNT(*) as total_calls,
    COUNT(DISTINCT account_number) as unique_accounts,
    AVG(balance) as avg_balance,
    MIN(balance) as min_balance,
    MAX(balance) as max_balance
  FROM call_logs WHERE status = 'completed'
`);

const getCallsByDate = db.prepare(`
  SELECT 
    DATE(call_date) as date,
    COUNT(*) as call_count
  FROM call_logs
  GROUP BY DATE(call_date)
  ORDER BY date DESC
  LIMIT 30
`);

const getCallsByStatus = db.prepare(`
  SELECT status, COUNT(*) as count
  FROM call_logs
  GROUP BY status
`);

app.use(express.json());

// Enable CORS for admin portal
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, OPTIONS");
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Start a new call record
app.post("/api/call/start", (req, res) => {
  try {
    const { channelId } = req.body;
    const callDate = new Date().toISOString();
    const result = insertCallStart.run(channelId || null, callDate);
    console.log(`Call started: id=${result.lastInsertRowid}, channel=${channelId}`);
    res.json({ callId: result.lastInsertRowid });
  } catch (err) {
    console.error("Failed to start call:", err.message);
    res.status(500).json({ error: "Failed to start call record" });
  }
});

// Update call with account number
app.patch("/api/call/:id/account", (req, res) => {
  try {
    const { id } = req.params;
    const { accountNumber } = req.body;
    updateCallAccount.run(accountNumber, id);
    console.log(`Call ${id}: account entered = ${accountNumber}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update account:", err.message);
    res.status(500).json({ error: "Failed to update call record" });
  }
});

// Update call with balance
app.patch("/api/call/:id/balance", (req, res) => {
  try {
    const { id } = req.params;
    const { balance, currency } = req.body;
    updateCallBalance.run(balance, currency || "EGP", id);
    console.log(`Call ${id}: balance retrieved = ${balance} ${currency}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update balance:", err.message);
    res.status(500).json({ error: "Failed to update call record" });
  }
});

// End call with final status
app.patch("/api/call/:id/end", (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const endedAt = new Date().toISOString();
    updateCallEnded.run(status || 'ended', endedAt, id);
    console.log(`Call ${id}: ended with status = ${status}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to end call:", err.message);
    res.status(500).json({ error: "Failed to update call record" });
  }
});

// Balance lookup with path parameter (for IVR flow)
app.get("/balance/:account", (req, res) => {
  const account = String(req.params.account || "").trim();
  
  if (!/^\d{6,16}$/.test(account)) {
    return res.status(400).json({ success: false, error: "invalid_account" });
  }

  const balance = Number((account.length * 123.45).toFixed(2));
  const currency = "EGP";
  
  console.log(`Balance lookup: account=${account}, balance=${balance}, currency=${currency}`);
  res.json({ success: true, account, balance, currency });
});

app.get("/balance", (req, res) => {
  const account = String(req.query.account || "").trim();
  const callId = req.query.callId;
  
  if (!/^\d{6,16}$/.test(account)) return res.status(400).json({ error: "invalid_account" });

  const balance = Number((account.length * 123.45).toFixed(2));
  const currency = "EGP";
  
  // Update existing call record if callId provided, otherwise create new
  try {
    if (callId) {
      updateCallBalance.run(balance, currency, callId);
      console.log(`Call ${callId}: balance=${balance}, currency=${currency}`);
    } else {
      const callDate = new Date().toISOString();
      insertCallLog.run(callDate, account, balance, currency);
      console.log(`Logged call: account=${account}, balance=${balance}, currency=${currency}`);
    }
  } catch (err) {
    console.error("Failed to log call:", err.message);
  }
  
  res.json({ account, balance, currency });
});

// API endpoint to get all call logs
app.get("/api/call-logs", (req, res) => {
  try {
    const logs = getAllCallLogs.all();
    res.json(logs);
  } catch (err) {
    console.error("Failed to get call logs:", err.message);
    res.status(500).json({ error: "Failed to retrieve call logs" });
  }
});

// API endpoint to get call statistics
app.get("/api/stats", (req, res) => {
  try {
    const stats = getCallStats.get();
    const callsByDate = getCallsByDate.all();
    const callsByStatus = getCallsByStatus.all();
    res.json({ ...stats, callsByDate, callsByStatus });
  } catch (err) {
    console.error("Failed to get stats:", err.message);
    res.status(500).json({ error: "Failed to retrieve statistics" });
  }
});

app.listen(3000, () => console.log("Balance API listening on :3000"));
