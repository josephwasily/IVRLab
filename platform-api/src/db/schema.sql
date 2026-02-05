-- IVR Platform Database Schema
-- Version: 1.0.0

-- Tenants (Organizations)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    settings TEXT DEFAULT '{}',  -- JSON settings
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deleted')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'editor' CHECK(role IN ('admin', 'editor', 'viewer')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Extension Pool
CREATE TABLE IF NOT EXISTS extensions (
    extension TEXT PRIMARY KEY,
    tenant_id TEXT,
    ivr_id TEXT,
    status TEXT DEFAULT 'available' CHECK(status IN ('available', 'assigned', 'reserved')),
    assigned_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (ivr_id) REFERENCES ivr_flows(id)
);

-- IVR Flows
CREATE TABLE IF NOT EXISTS ivr_flows (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    extension TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'inactive', 'archived')),
    language TEXT DEFAULT 'en',
    flow_data TEXT NOT NULL,  -- JSON flow definition
    settings TEXT DEFAULT '{}',  -- JSON settings
    version INTEGER DEFAULT 1,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (extension) REFERENCES extensions(extension),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- IVR Templates
CREATE TABLE IF NOT EXISTS ivr_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    flow_data TEXT NOT NULL,  -- JSON flow definition
    settings TEXT DEFAULT '{}',
    is_system INTEGER DEFAULT 0,  -- 1 = built-in template
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Call Logs
CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    ivr_id TEXT,
    tenant_id TEXT,
    caller_id TEXT,
    extension TEXT,
    start_time DATETIME,
    end_time DATETIME,
    duration INTEGER,  -- seconds
    status TEXT CHECK(status IN ('answered', 'no_answer', 'busy', 'failed', 'completed')),
    flow_path TEXT,  -- JSON array of nodes visited
    dtmf_inputs TEXT,  -- JSON array of inputs
    api_calls TEXT,  -- JSON array of API calls made
    variables TEXT,  -- JSON object of captured variables (user inputs, API results, etc.)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ivr_id) REFERENCES ivr_flows(id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Outbound Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    campaign_type TEXT DEFAULT 'survey' CHECK(campaign_type IN ('survey', 'notification', 'reminder', 'collection', 'custom')),
    ivr_id TEXT NOT NULL,
    trunk_id TEXT,  -- SIP trunk to use for outbound calls
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),  -- Campaign lifecycle (not run status)
    caller_id TEXT,  -- Override trunk caller ID
    max_concurrent_calls INTEGER DEFAULT 5,
    calls_per_minute INTEGER DEFAULT 10,
    max_attempts INTEGER DEFAULT 3,
    retry_delay_minutes INTEGER DEFAULT 30,
    settings TEXT DEFAULT '{}',  -- JSON (time windows, etc.)
    total_contacts INTEGER DEFAULT 0,
    contacts_called INTEGER DEFAULT 0,
    contacts_completed INTEGER DEFAULT 0,
    contacts_failed INTEGER DEFAULT 0,
    scheduled_at DATETIME,
    started_at DATETIME,
    completed_at DATETIME,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (ivr_id) REFERENCES ivr_flows(id),
    FOREIGN KEY (trunk_id) REFERENCES sip_trunks(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Campaign Run Instances (each execution of a campaign)
CREATE TABLE IF NOT EXISTS campaign_runs (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    run_number INTEGER NOT NULL,  -- Sequential run number for this campaign
    status TEXT DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'cancelled', 'failed')),
    total_contacts INTEGER DEFAULT 0,
    contacts_called INTEGER DEFAULT 0,
    contacts_completed INTEGER DEFAULT 0,
    contacts_answered INTEGER DEFAULT 0,
    contacts_failed INTEGER DEFAULT 0,
    contacts_no_answer INTEGER DEFAULT 0,
    contacts_busy INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    started_by TEXT,
    settings TEXT DEFAULT '{}',  -- JSON snapshot of campaign settings at run time
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (started_by) REFERENCES users(id)
);

-- Campaign Contacts
CREATE TABLE IF NOT EXISTS campaign_contacts (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    variables TEXT DEFAULT '{}',  -- JSON custom variables
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'calling', 'completed', 'failed', 'skipped')),
    attempts INTEGER DEFAULT 0,
    last_attempt_at DATETIME,
    result TEXT,  -- JSON result data
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

-- API Connectors
CREATE TABLE IF NOT EXISTS connectors (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'rest', 'database', 'salesforce', etc.
    config TEXT NOT NULL,  -- JSON encrypted config
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Audio Prompts
CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,  -- relative path within prompts directory
    language TEXT DEFAULT 'ar',
    category TEXT DEFAULT 'custom',  -- 'system', 'custom', 'greeting', 'menu', 'error', etc.
    description TEXT,
    duration_ms INTEGER,  -- duration in milliseconds
    file_size INTEGER,  -- size in bytes
    original_filename TEXT,  -- original uploaded filename
    is_system INTEGER DEFAULT 0,  -- 1 = built-in prompt, cannot be deleted
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ivr_flows_tenant ON ivr_flows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ivr_flows_extension ON ivr_flows(extension);
CREATE INDEX IF NOT EXISTS idx_extensions_status ON extensions(status);
CREATE INDEX IF NOT EXISTS idx_call_logs_ivr ON call_logs(ivr_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_tenant ON call_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_time ON call_logs(start_time);
CREATE INDEX IF NOT EXISTS idx_prompts_tenant ON prompts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prompts_language ON prompts(language);

-- SIP Trunks for outbound calls
CREATE TABLE IF NOT EXISTS sip_trunks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL,  -- SIP server hostname/IP
    port INTEGER DEFAULT 5060,
    transport TEXT DEFAULT 'udp' CHECK(transport IN ('udp', 'tcp', 'tls')),
    username TEXT,
    password TEXT,  -- Should be encrypted in production
    caller_id TEXT,  -- Default caller ID for this trunk
    codecs TEXT DEFAULT 'ulaw,alaw',  -- Comma-separated codec list
    max_channels INTEGER DEFAULT 10,  -- Max concurrent calls
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'testing')),
    settings TEXT DEFAULT '{}',  -- JSON additional settings
    last_tested_at DATETIME,
    test_result TEXT,  -- JSON test result
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Campaign Triggers
CREATE TABLE IF NOT EXISTS campaign_triggers (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual', 'scheduled', 'api', 'csv_upload')),
    schedule TEXT,  -- Cron expression for scheduled triggers
    time_window_start TEXT,  -- HH:MM format, e.g., "09:00"
    time_window_end TEXT,  -- HH:MM format, e.g., "18:00"
    timezone TEXT DEFAULT 'UTC',
    days_of_week TEXT DEFAULT '1,2,3,4,5',  -- 0=Sun, 1=Mon, etc.
    is_active INTEGER DEFAULT 1,
    last_triggered_at DATETIME,
    next_trigger_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Outbound Call Records (detailed per-call tracking)
CREATE TABLE IF NOT EXISTS outbound_calls (
    id TEXT PRIMARY KEY,
    campaign_id TEXT,
    run_id TEXT,  -- Reference to campaign_runs
    contact_id TEXT,
    trunk_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    caller_id TEXT,
    ivr_id TEXT,
    channel_id TEXT,  -- Asterisk channel ID
    status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'dialing', 'ringing', 'answered', 'completed', 'busy', 'no_answer', 'failed', 'cancelled')),
    dial_start_time DATETIME,
    answer_time DATETIME,
    end_time DATETIME,
    duration INTEGER,  -- seconds after answer
    hangup_cause TEXT,
    dtmf_inputs TEXT,  -- JSON array
    variables TEXT DEFAULT '{}',  -- JSON variables passed to IVR
    result TEXT DEFAULT '{}',  -- JSON result from IVR
    attempt_number INTEGER DEFAULT 1,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (contact_id) REFERENCES campaign_contacts(id),
    FOREIGN KEY (trunk_id) REFERENCES sip_trunks(id),
    FOREIGN KEY (ivr_id) REFERENCES ivr_flows(id),
    FOREIGN KEY (run_id) REFERENCES campaign_runs(id)
);

-- Indexes for outbound calls
CREATE INDEX IF NOT EXISTS idx_sip_trunks_tenant ON sip_trunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_runs_campaign ON campaign_runs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_runs_status ON campaign_runs(status);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign ON campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status);
CREATE INDEX IF NOT EXISTS idx_campaign_triggers_campaign ON campaign_triggers(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outbound_calls_campaign ON outbound_calls(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outbound_calls_run ON outbound_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_outbound_calls_status ON outbound_calls(status);
CREATE INDEX IF NOT EXISTS idx_outbound_calls_created ON outbound_calls(created_at);
