# IVR-Lab: Programmable Communications Platform

## Competitors

The IVR-Lab platform competes with several established solutions in the programmable communications and IVR automation space. Notable competitors include:

- **Plum Voice (PlumFuse)** ([plumvoice.com](https://www.plumvoice.com/))
   - PlumFuse is a cloud-based visual IVR builder and automation platform.
   - Key features (from [ProductSheet-PlumFuse-2022.1.pdf](https://www.plumvoice.com/wp-content/uploads/2022/09/ProductSheet-PlumFuse-2022.1.pdf)):
      - Drag-and-drop visual designer for IVR and voice workflows
      - Omnichannel support: voice, SMS, web, chat
      - Built-in speech recognition and text-to-speech
      - API integration for backend data access
      - Secure PCI/HIPAA-compliant hosting
      - Real-time analytics and reporting
      - No-code and low-code options for rapid deployment
      - Cloud and on-premises deployment options
      - Designed for enterprise and SMB use cases
   - Differentiators: Focus on compliance, ease of use, and rapid deployment for business users.

Other competitors include Twilio Studio, Genesys Cloud, Avaya Orchestration Designer, and Cisco Contact Center solutions.

## Overview

This platform is a low-code programmable communications automation system designed to enable organizations to build, deploy, and operate automated voice, IVR, and messaging experiences without the need to develop custom telephony infrastructure from scratch. It provides a visual flow-based design environment where users can create communication workflows that define how calls and messages are initiated, how users are interacted with, how data is collected, and how decisions are made in real time during an interaction. These workflows can be used for both outbound and inbound communication scenarios, including automated phone surveys, appointment reminders, payment notifications, customer satisfaction collection, and interactive IVR systems that dynamically respond to callers based on backend data.

---

## Core Capabilities

### Visual Flow Designer

At the core of the platform is a visual flow designer that allows users to model communication logic as a sequence of connected nodes representing actions such as:

- **Placing a call** - Initiate outbound calls through SIP trunks
- **Playing speech** - Using text-to-speech engines in multiple languages
- **Collecting user input** - Through speech recognition or DTMF keypad input
- **Sending messages** - SMS, notifications, and other messaging channels
- **Invoking external APIs** - Connect to CRMs, ERPs, billing systems, databases
- **Branching based on conditions** - Dynamic decision-making during live calls

### Sandboxed JavaScript Execution

Unlike simple no-code IVR builders, the platform includes a **sandboxed JavaScript execution engine** embedded directly into the flow runtime. This allows users to write controlled JavaScript logic within the workflow itself to:

- Perform calculations and data transformations
- Apply business rules and validation
- Validate user input in real time
- Make dynamic decisions during live interactions
- Pass output back into the flow to influence subsequent actions

This enables complex, stateful, and highly customized communication behavior without deploying separate backend services.

### SIP-Native Architecture

The platform is **SIP-native by design**, allowing it to integrate directly with:

- SIP trunks and carrier-provided SIP infrastructure
- Existing telephony environments such as Asterisk-based systems
- IP-PBXs and enterprise telephony platforms
- Regional and local telecom providers

This makes it particularly suitable for organizations that already operate within SIP ecosystems or prefer to maintain control over their telecom providers and call routing. The platform acts as an **orchestration layer on top of existing telephony infrastructure**, rather than replacing it, enabling flexible deployment models and regional compliance.

---

## Use Cases

### Outbound Automation
- Large-scale or targeted call campaigns
- Automated phone surveys
- **Outbound Appointment Reminders** - Confirm or reschedule upcoming appointments
- **Payment Reminders** - Notify customers of due payments
- Customer satisfaction surveys
- Delivery notifications

### Inbound IVR
- Intelligent IVR experiences beyond static menus
- Real-time logic execution during calls
- Live data retrieval from backend systems
- Dynamic response to caller requests
- **Account Inquiry** - Balance checks, transaction history, account status
- **Appointment Scheduling** - Book, reschedule, or cancel appointments
- **Card Activation** - Activate credit/debit cards with verification
- **Payment Processing** - Accept payments over the phone, confirm transactions
- **Prescription Management** - Refill requests, pharmacy notifications
- **Mobile Workforce** - Field worker check-ins, job status updates

### Multi-Channel Messaging
- SMS notifications and two-way messaging
- Consistent logic across voice and messaging
- Unified workflow design for all channels

---

## Multi-Tenant Architecture

The system is built as a **multi-tenant platform**, enabling multiple clients or organizations to:

- Create, manage, and operate independent workflows
- Configure their own phone numbers and SIP trunks
- Define custom JavaScript logic and integrations
- Maintain isolation and security between tenants

The sandboxed execution environment ensures that user-defined logic runs safely within controlled limits, preventing unauthorized access to the underlying system while still providing sufficient flexibility for real-world business logic.

---

## Commercial Positioning

The platform bridges the gap between:

| Traditional Call-Center Software | Developer-Only CPaaS Solutions |
|----------------------------------|--------------------------------|
| Rigid, expensive, requires agents | Requires significant development effort |
| Limited automation capabilities | Full flexibility but high complexity |

**IVR-Lab eliminates both problems by:**

- Removing the rigidity and cost of full call-center systems for organizations that need automation rather than human agents
- Removing the development burden typically associated with programmable telecom APIs
- Combining visual design, controlled code execution, and native SIP integration
- Enabling operational teams, system integrators, and technical business users to rapidly build and iterate

The result is a **scalable, extensible communications automation foundation** that can be adapted to a wide variety of industries and use cases, from customer engagement and support automation to operational notifications and data collection.

---

## 🏗️ Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           IVR-Lab Platform                                   │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    Admin Portal V2 (:8082)                             │  │
│  │         Visual Flow Builder • IVR CRUD • Analytics • Templates         │  │
│  └─────────────────────────────┬─────────────────────────────────────────┘  │
│                                 │                                            │
│                                 ▼                                            │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     Platform API (:3001)                               │  │
│  │        Authentication • IVR Management • Extension Pool • Logs         │  │
│  └─────────────────────────────┬─────────────────────────────────────────┘  │
│                                 │                                            │
│                                 ▼                                            │
│  ┌─────────────┐   ┌───────────┐   ┌─────────────┐   ┌───────────┐         │
│  │  Kamailio   │──▶│ Asterisk  │──▶│  IVR Node   │──▶│ Balance   │         │
│  │  SBC/NAT    │   │   PBX     │   │  (Dynamic)  │   │   API     │         │
│  │  :5062      │   │  :5060    │   │             │   │  :3000    │         │
│  └─────────────┘   └───────────┘   └─────────────┘   └───────────┘         │
│                                                                              │
│  Call Flow: Caller → Kamailio → Asterisk → IVR Node → Platform API         │
│             (NAT fix)  (Dialplan)  (ARI)     (Flow Config)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Asterisk** | Asterisk 20 | SIP PBX and media server |
| **Kamailio** | Kamailio SBC | NAT traversal and SDP rewriting |
| **IVR Node** | Node.js + ARI | Dynamic IVR execution engine |
| **Platform API** | Node.js + SQLite | IVR management, auth, analytics |
| **Admin Portal V2** | React + Vite | Visual flow builder and management UI |
| **Balance API** | Node.js + SQLite | Backend API and data storage |
| **Prompts** | Arabic TTS (gTTS) | Pre-recorded Arabic audio prompts |

---

## 🚀 Quick Start

### Prerequisites

- Docker Desktop
- Node.js 18+ (for development)
- SIP softphone (Zoiper, MicroSIP, 3CX)

### Configuration

**1. Create a `.env` file** with your host machine's IP address:

```bash
# Copy the example file
cp .env.example .env

# Edit .env and set your IP address
# Find your IP with: ipconfig (Windows) or ip addr (Linux)
```

Your `.env` file should contain:
```env
# REQUIRED: Your host machine's LAN IP address
EXTERNAL_IP=192.168.1.208

# Optional: ElevenLabs API key for text-to-speech
ELEVENLABS_API_KEY=your_api_key_here
```

> ⚠️ **Important:** If your IP address changes (e.g., after reboot, VPN, switching networks), update the `EXTERNAL_IP` in `.env` and restart Asterisk:
> ```bash
> docker-compose up -d --build asterisk
> ```

### Run the Platform

```bash
# Clone the repository
cd IVR-Lab

# Create and configure .env file (see Configuration above)
cp .env.example .env
# Edit .env with your IP address

# Update the connecting party (IP Office) IP address
# If you are connecting to an Avaya IP Office or similar PBX, update the 'ipoffice' SIP trunk IP in Asterisk:
python scripts/update-ipoffice-endpoint.py <IPO_IP_ADDRESS>
# Replace <IPO_IP_ADDRESS> with the actual IP address of the IP Office system.

# Start all services
docker-compose up -d --build

# Initialize database with seed data
docker exec platform-api node src/db/migrate.js
docker exec platform-api node src/db/seed.js
# Ensure analytics/report-only demo user exists
docker exec platform-api npm run seed:reports-user

# Check status
docker ps
```

### Pre-built IVR Flows

The platform includes two pre-built IVR flows that are automatically seeded on first startup:

| Flow | Extension | Description |
|------|-----------|-------------|
| **Billing Invoice Inquiry** | 2010 | Monthly billing/invoice inquiry with account number collection and verification |
| **Customer Satisfaction Survey** | 2020 | 5-question customer satisfaction survey collecting ratings from 1-5 |

These flows include Arabic audio prompts located in `prompts/billing/` and `prompts/survey/`.

**To add custom audio files for new IVR flows:**
1. Place your audio files in `new sounds/<flow-name>/` folder
2. Run the conversion script: `python scripts/convert_ivr_sounds.py`
3. The script converts audio to Asterisk-compatible ulaw format (8kHz mono)
4. Restart platform-api to seed the prompts: `docker compose restart platform-api`

### Water and Sewage Template (2009-Compatible)

To seed/update the Water and Sewage template used by extension `2009` behavior:

```bash
docker compose exec platform-api npm run seed:new-sounds-2
```

To verify the template is identical to the tested `2009` flow:

```bash
docker compose exec platform-api npm run verify:new-sounds-2-parity
```

Detailed notes (including DTMF barge-in behavior) are documented in:

- `docs/WATER_SEWAGE_TEMPLATE_AND_BARGEIN.md`

### Access the Admin Portal

Open **http://localhost:8082** in your browser.

Login with:
- **Email:** `admin@demo.com`
- **Password:** `admin123`
- **Reports User:** `user@demo.com` / `user123` (analytics + reports pages only)

### Connect a Softphone

| Setting | Value |
|---------|-------|
| **SIP Server** | `<your-ip>:5062` |
| **Username** | `1001` |
| **Password** | `1001pass` |
| **Transport** | UDP |

---

## 🔧 Troubleshooting

### IP Address Changed / Can't Connect to Asterisk

**Symptoms:**
- Softphone can't register or connect to Asterisk
- Was working before, stopped after reboot/network change
- "Connection timeout" or no response from SIP server

**Root Cause:** Your host machine's IP address changed (common with DHCP, VPN, or switching networks).

**Solution - Automatic (Recommended):**

Use the IP update script to automatically detect and update all configuration files:

```powershell
# Windows PowerShell
cd scripts
.\update-ip.ps1
```

The script will:
- Auto-detect your current IP address
- Update `asterisk/pjsip.conf` and other config files
- Restart the Asterisk container
- Verify endpoint status

You can also specify an IP manually:
```powershell
.\update-ip.ps1 -NewIP "192.168.1.100"
```

**Solution - Manual:**

1. **Find your current IP:**
   ```powershell
   # Windows PowerShell
   Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" -or $_.InterfaceAlias -like "*Ethernet*" }
   ```
   ```bash
   # Linux/Mac
   ip addr | grep "inet " | grep -v 127.0.0.1
   ```

2. **Update your `.env` file:**
   ```env
   EXTERNAL_IP=your.new.ip.address
   ```

3. **Rebuild Asterisk:**
   ```bash
   docker-compose up -d --build asterisk
   ```

4. **Update your softphone** to connect to the new IP address.

> 💡 **Tip:** For a stable setup, consider assigning a static IP to your development machine.

---

### DTMF Not Being Captured / Calls Timeout After 32 Seconds

**Symptoms:**
- IVR prompts play but pressing digits has no effect
- Calls hang up after ~32 seconds (3 retries × 10-second timeout)
- IVR logs show `dtmfInputs: []` (empty)

**Root Cause:** RTP/DTMF packets not reaching Asterisk because the SDP contains the wrong IP address.

When Asterisk runs in Docker, it may advertise the container's internal IP (e.g., `172.21.0.6`) in the SDP instead of the host's external IP. The softphone sends DTMF to the unreachable Docker IP, so packets never arrive.

**Solution:** Configure `local_net` in `pjsip.conf` to be very specific:

```ini
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0
; CRITICAL: Only this container's exact IP is "local"
; The Docker gateway (172.21.0.1) must NOT match local_net
; so that external_media_address is applied for softphone traffic
local_net=172.21.0.6/32
external_media_address=<YOUR_HOST_IP>
external_signaling_address=<YOUR_HOST_IP>
```

**Why this matters:**
- Docker NAT makes softphone traffic appear to come from `172.21.0.1` (gateway)
- If `local_net` includes `172.16.0.0/12`, the gateway IP matches → external address NOT applied
- Setting `local_net=172.21.0.6/32` (container only) ensures gateway traffic uses external address

**Verify the fix:**
```bash
# Enable SIP logging
docker exec asterisk asterisk -rx "pjsip set logger on"

# Make a call and check SDP shows your host IP, not Docker IP
docker logs asterisk 2>&1 | grep "c=IN IP4"
# Should show: c=IN IP4 192.168.1.5 (your host IP)
# NOT: c=IN IP4 172.21.0.6 (Docker IP)
```

---

### Softphone Registration Fails (403 Forbidden)

**Symptoms:**
- Zoiper shows "403 Forbidden" when trying to register
- SIP logs show request matched to `anonymous` endpoint instead of `1001`

**Root Cause:** The `identify` section in `pjsip.conf` matched the softphone's traffic to the wrong endpoint.

If `identify-sbc` has broad IP ranges like `match=192.168.0.0/16`, it captures softphone traffic and routes it to the `anonymous` endpoint (which may not allow registration).

**Solution:** Only match specific SBC hostnames/IPs in identify sections:

```ini
[identify-sbc]
type=identify
endpoint=anonymous
match=kamailio   ; Only match the Kamailio container hostname
; Do NOT use broad IP ranges like match=192.168.0.0/16
```

---

### One-Way Audio (Can Hear IVR but IVR Can't Hear You)

**Symptoms:**
- IVR prompts play correctly
- DTMF still not captured
- RTP debug shows only outbound packets, no inbound

**Root Cause:** Firewall blocking inbound RTP or wrong IP in SDP (see above).

**Solution:**
1. Ensure RTP ports are open: `10000-10100/udp`
2. Verify `external_media_address` is set correctly
3. Check `local_net` configuration as described above

---

### Session Timer Hangups (Call Disconnects Unexpectedly)

**Symptoms:**
- Call disconnects after exactly 30-90 seconds
- BYE sent by Asterisk with `Reason: Q.850`

**Root Cause:** SIP session timers (RFC 4028) requiring periodic re-INVITE that softphone doesn't support.

**Solution:** Disable timers in endpoint configuration:

```ini
[endpoint-defaults](!)
type=endpoint
; ... other settings ...
timers=no
timers_min_se=90
timers_sess_expires=1800
```

---

### Balance API Returns 404

**Symptoms:**
- IVR flow reaches `api_error` node
- Logs show API call to `/balance/123456` returns 404

**Root Cause:** API endpoint mismatch - IVR sends path parameter but API expects query parameter.

**Solution:** Ensure API supports both formats:
```javascript
// Path parameter: /balance/:account
app.get("/balance/:account", (req, res) => {
  const account = req.params.account;
  // ...
});

// Query parameter: /balance?account=123456
app.get("/balance", (req, res) => {
  const account = req.query.account;
  // ...
});
```

---

### Test the IVRs

| Extension | Description |
|-----------|-------------|
| **6000** | Legacy Balance Inquiry IVR |
| **2001** | Dynamic Balance Inquiry IVR (from Platform) |
| **2XXX** | Any IVR created via Admin Portal |

---

## 🎨 Visual Flow Builder

Create IVRs using the drag-and-drop visual builder:

1. Login to Admin Portal (http://localhost:8082)
2. Click **Create New IVR** or edit an existing one
3. Switch to **Visual Builder** tab
4. Drag nodes from the palette onto the canvas:
   - **Start** - Entry point
   - **Play Audio** - Play a prompt
   - **Collect Input** - Gather DTMF digits
   - **Branch** - Decision logic
   - **API Call** - Call external services
   - **Transfer** - Transfer to another extension
   - **End** - Hang up the call
5. Connect nodes by dragging from output handles to input handles
6. Click on nodes to configure their properties
7. Click **Save Flow** to save your changes

---

## 🌍 Language Support

Currently supported:
- **Arabic** (ar) - Full TTS prompts and digit pronunciation

Generate new Arabic prompts:
```bash
cd scripts
pip install gtts
python generate_arabic_prompts.py
```

---

## 🔌 Integration with Avaya ACCS

The platform can receive calls from Avaya ACCS via SIP trunk:

1. Configure SIP Entity in System Manager pointing to this server
2. Create routing policy for IVR extensions
3. Use Orchestration Designer to transfer calls to `sip:6000@<server-ip>:5062`

See [ACCS Integration Guide](#) for detailed instructions.

---

## 📁 Project Structure

```
IVR-Lab/
├── docker-compose.yml          # Container orchestration
├── asterisk/                   # Asterisk PBX configuration
│   ├── pjsip.conf              # SIP endpoints and trunks
│   ├── extensions.conf         # Dialplan (6000=legacy, 2XXX=dynamic)
│   └── ari.conf                # ARI configuration
├── ivr-node/                   # IVR execution engine
│   ├── index.js                # Legacy balance IVR
│   ├── dynamic-ivr.js          # Dynamic IVR engine (Platform API)
│   └── package.json
├── platform-api/               # Multi-tenant Platform API
│   ├── src/
│   │   ├── index.js            # Express server
│   │   ├── routes/             # API routes
│   │   │   ├── auth.js         # Authentication
│   │   │   ├── ivr.js          # IVR CRUD
│   │   │   ├── templates.js    # Template management
│   │   │   ├── extensions.js   # Extension pool
│   │   │   └── analytics.js    # Call analytics
│   │   ├── middleware/         # Auth middleware
│   │   └── db/                 # Database schema and seeds
│   └── package.json
├── admin-portal-v2/            # React Admin Dashboard
│   ├── src/
│   │   ├── App.jsx             # Main app with routing
│   │   ├── pages/              # Page components
│   │   │   ├── Login.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── IVRList.jsx
│   │   │   ├── IVRCreate.jsx
│   │   │   ├── IVREdit.jsx     # Visual flow builder
│   │   │   ├── Templates.jsx
│   │   │   └── Analytics.jsx
│   │   ├── components/
│   │   │   ├── Layout.jsx
│   │   │   └── flow/           # Visual flow builder components
│   │   │       ├── FlowBuilder.jsx
│   │   │       ├── FlowNodes.jsx
│   │   │       ├── NodePalette.jsx
│   │   │       └── NodeProperties.jsx
│   │   ├── contexts/           # Auth context
│   │   └── lib/                # API client and utilities
│   ├── Dockerfile              # Production build with nginx
│   └── package.json
├── admin-portal/               # Legacy web dashboard (:8081)
├── balance-api/                # Backend REST API
│   ├── server.js
│   └── package.json
├── prompts/                    # Audio prompts
│   ├── ar/                     # Arabic prompts
│   │   ├── *.ulaw              # IVR prompts
│   │   └── digits/             # Number pronunciation
│   └── en/                     # English prompts
├── sbc/                        # Kamailio SBC
│   └── opensips/
│       └── kamailio.cfg
└── docs/                       # Documentation
    └── DEVELOPMENT_ROADMAP.md
```

---

## 🛣️ Roadmap

### Phase 1: Core IVR ✅
- [x] Asterisk + ARI integration
- [x] Arabic TTS prompts
- [x] DTMF input handling
- [x] Balance inquiry flow
- [x] NAT traversal (Kamailio SBC)
- [x] Admin dashboard (legacy)

### Phase 2: Multi-Tenant Platform ✅
- [x] Platform API with authentication
- [x] Multi-tenant database schema
- [x] IVR CRUD operations
- [x] Extension pool management
- [x] Template system
- [x] Dynamic IVR engine

### Phase 3: Visual Flow Builder ✅
- [x] Web-based flow designer UI (React + React Flow)
- [x] Drag-and-drop nodes (Play, Collect, Branch, API Call, etc.)
- [x] Node property configuration panel
- [x] Flow export/import (JSON)
- [x] Admin Portal V2 with modern UI

### Phase 4: Advanced Features
- [ ] Outbound call campaigns
- [ ] SMS/WhatsApp integration
- [ ] Speech recognition (ASR)
- [ ] Real-time analytics dashboard
- [ ] Flow versioning and history
- [ ] Flow debugging tools

### Phase 5: Sandboxed Execution
- [ ] JavaScript sandbox for custom logic
- [ ] Variable system and context passing
- [ ] Error handling and logging
- [ ] Custom function library

### Phase 6: AI-Powered Voice Agents
- [ ] LLM integration for natural language understanding
- [ ] AI agent node for dynamic conversations
- [ ] Intent detection and entity extraction
- [ ] Conversational IVR with context memory
- [ ] AI-assisted inbound call handling (customer service, FAQ)
- [ ] AI-powered outbound campaigns (surveys, reminders, collections)
- [ ] Voice-to-text and text-to-voice with AI models
- [ ] Agent handoff with conversation summary
- [ ] Multi-language AI support (Arabic, English, etc.)

### Phase 7: Enterprise Integration
- [ ] Avaya ACCS native connector
- [ ] Genesys Cloud integration
- [ ] REST API for external orchestration
- [ ] Webhook triggers

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.
# IVRLab
