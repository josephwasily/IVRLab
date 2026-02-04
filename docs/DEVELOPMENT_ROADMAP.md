# IVR Platform Development Roadmap

## Current State (Phase 0) ✅
- Single hardcoded IVR flow (Balance Inquiry)
- Static Asterisk dialplan
- No multi-tenancy
- No administration interface

---

## Phase 1: Core IVR Engine & Database (Current Sprint)

### Goal
Create a database-driven IVR system that loads flow configurations dynamically instead of hardcoded logic.

### Components

#### 1.1 Database Schema
```
├── tenants          # Organizations/companies
├── users            # Admin users per tenant
├── ivr_flows        # IVR configurations
├── ivr_nodes        # Individual steps in each flow
├── extensions       # SIP extension assignments
└── call_logs        # CDR and analytics
```

#### 1.2 IVR Flow Engine
- JSON-based flow definitions
- Node types: Play, Collect, Branch, API Call, Transfer, Hangup
- Runtime interpreter that executes flows

#### 1.3 Extension Manager
- Pool of available extensions (e.g., 2000-2999)
- Auto-assignment when IVR is created
- Extension-to-IVR routing

### Deliverables
- [ ] SQLite/PostgreSQL database with schema
- [ ] IVR CRUD API (Create, Read, Update, Delete)
- [ ] Dynamic flow execution engine
- [ ] Extension pool management

---

## Phase 2: Administration Portal

### Goal
Web-based admin interface for managing IVRs without code changes.

### Features
- Dashboard with IVR list and statistics
- Create new IVR from templates
- Configure IVR steps (prompts, DTMF handling, API calls)
- Assign/view SIP extension
- View call logs and analytics

### Technology
- React or Vue.js frontend
- REST API backend
- JWT authentication

### Deliverables
- [ ] Login/authentication system
- [ ] IVR list and management pages
- [ ] IVR configuration editor (form-based)
- [ ] Extension management UI
- [ ] Basic analytics dashboard

---

## Phase 3: Multi-Tenancy

### Goal
Support multiple organizations with isolated IVRs and data.

### Features
- Tenant registration and management
- User roles (Admin, Editor, Viewer)
- Tenant-scoped extensions
- White-label customization
- Usage quotas and billing hooks

### Deliverables
- [ ] Tenant isolation in database
- [ ] Role-based access control (RBAC)
- [ ] Tenant-specific settings
- [ ] Usage tracking per tenant

---

## Phase 4: Pre-Built IVR Templates

### Goal
Quick-start templates for common use cases.

### Templates
1. **Account Inquiry** - Balance check, transaction history
2. **Appointment Scheduling** - Book, reschedule, cancel
3. **Card Activation** - Verify identity, activate card
4. **Payment Processing** - Accept payments via IVR
5. **Survey/Feedback** - Post-call surveys
6. **Order Status** - Track orders, shipments
7. **Support Queue** - Route to agents with queue

### Deliverables
- [ ] Template library
- [ ] Clone template to new IVR
- [ ] Customize template parameters

---

## Phase 5: Low-Code Visual Builder

### Goal
Drag-and-drop flow designer for building complex IVRs.

### Features
- Visual canvas with node palette
- Drag-and-drop flow construction
- Connection lines between nodes
- Real-time validation
- Preview/test mode
- Version control for flows

### Node Types
- **Play**: Play audio prompt
- **Say**: TTS with language selection
- **Collect**: Gather DTMF input
- **Branch**: Conditional logic
- **API Call**: HTTP request to external service
- **Set Variable**: Store data
- **Transfer**: Transfer to extension/queue
- **Voicemail**: Leave voicemail
- **Hangup**: End call

### Technology
- React Flow or similar library
- Real-time collaboration (optional)
- Export/import flows as JSON

---

## Phase 6: Outbound Campaigns

### Goal
Automated outbound calling with IVR flows.

### Features
- Upload contact lists (CSV, API)
- Schedule campaigns
- Retry logic for failed calls
- Real-time campaign monitoring
- DNC (Do Not Call) list management
- Compliance controls (time windows, frequency)

### Deliverables
- [ ] Campaign management UI
- [ ] Contact list management
- [ ] Outbound dialer engine
- [ ] Campaign analytics

---

## Phase 7: Integrations & Connectors

### Goal
Connect IVRs to external systems.

### Connectors
- REST API (generic)
- Salesforce
- Microsoft Dynamics
- Zendesk
- Custom webhooks
- Database queries (read-only)

### Deliverables
- [ ] Connector framework
- [ ] OAuth support for integrations
- [ ] Connector marketplace UI

---

## Phase 8: AI Agent Features (Voiceflow.com Analysis)

### Goal
Analyze and integrate conversational AI agent capabilities inspired by Voiceflow.com to enhance IVR intelligence.

### Research Areas
- **Conversational AI Integration**: Natural language understanding (NLU) for voice interactions
- **Intent Recognition**: Automatic detection of caller intent without rigid menu structures
- **Entity Extraction**: Extract key data from natural speech (dates, names, account numbers)
- **Dialog Management**: Multi-turn conversations with context retention
- **AI-Powered Responses**: GPT/LLM integration for dynamic response generation
- **Knowledge Base Integration**: Connect to FAQs and documentation for automated answers
- **Agent Handoff**: Intelligent escalation to human agents with context transfer
- **Analytics & Training**: Conversation analytics to improve AI models

### Voiceflow Features to Evaluate
- Visual conversation designer with AI blocks
- No-code NLU training interface
- Multi-channel deployment (voice, chat, SMS)
- Built-in testing and debugging tools
- Collaboration features for team workflows
- API and webhook integrations
- Custom functions and logic blocks
- Voice-specific features (SSML, voice selection)

### Potential Implementations
- [ ] NLU engine integration (Dialogflow, LUIS, or open-source)
- [ ] AI conversation blocks in flow designer
- [ ] Voice-to-text transcription for natural input
- [ ] LLM integration for dynamic responses
- [ ] Conversation memory and context management
- [ ] A/B testing for conversation flows
- [ ] Sentiment analysis during calls

---

## Phase 9: Application Licensing & Cloud Deployment

### Goal
Implement a licensing system to enable commercial distribution and SaaS deployment.

### Licensing System

#### License Types
1. **Trial License**: 14-30 day evaluation, limited features
2. **Starter License**: Small business, limited extensions/campaigns
3. **Professional License**: Full features, higher limits
4. **Enterprise License**: Unlimited, white-label, priority support
5. **On-Premise License**: Self-hosted with license key validation

#### Implementation Options

**Option A: Cloud License Server**
```
┌─────────────────┐     ┌──────────────────────┐
│  IVR Platform   │────▶│  License Server      │
│  (Customer)     │◀────│  (Cloud Database)    │
└─────────────────┘     │  - PostgreSQL/MySQL  │
                        │  - License validation│
                        │  - Usage metering    │
                        └──────────────────────┘
```

**Option B: Hybrid Model**
- Cloud database for license validation and telemetry
- Local SQLite for operational data (IVRs, campaigns, logs)
- Periodic sync for usage reporting

#### Cloud Database Architecture
- **License Database (Cloud)**:
  - License keys and activation status
  - Customer/tenant registration
  - Usage metrics and quotas
  - Billing integration hooks
  
- **Operational Database (Local)**:
  - IVR flows and configurations
  - Call logs and CDR
  - Contacts and campaigns
  - Real-time operational data

#### License Validation
- Online validation at startup
- Periodic heartbeat checks
- Grace period for offline operation
- Feature flags based on license tier
- Hardware fingerprinting for on-premise licenses

### Deliverables
- [ ] License key generation system
- [ ] Cloud license validation API
- [ ] License tier management
- [ ] Usage metering and reporting
- [ ] Quota enforcement
- [ ] Admin portal for license management
- [ ] Customer self-service portal
- [ ] Billing system integration (Stripe, etc.)
- [ ] License expiration and renewal handling
- [ ] Offline grace period handling

### Cloud Providers to Consider
- AWS RDS / DynamoDB
- Azure SQL / Cosmos DB
- Google Cloud SQL
- Supabase (PostgreSQL + Auth)
- PlanetScale (MySQL)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Admin Portal (React)                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Dashboard│ │IVR Mgmt │ │Templates│ │Campaigns│ │Analytics│   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Platform API (Node.js)                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Auth API │ │IVR CRUD │ │Ext Mgmt │ │Campaign │ │Analytics│   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    Database     │ │   IVR Engine    │ │ Outbound Dialer │
│   (PostgreSQL)  │ │   (Node.js)     │ │   (Node.js)     │
└─────────────────┘ └─────────────────┘ └─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Asterisk PBX                                │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │  ARI Interface  │ │ Dynamic Dialplan│ │   SIP Channels  │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   SBC/Kamailio  │
                    │   (NAT/Media)   │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  External SIP   │
                    │  (Customer PBX) │
                    └─────────────────┘
```

---

## Extension Assignment Strategy

### Extension Pools
- **2000-2999**: Inbound IVR extensions
- **3000-3999**: Outbound campaign extensions
- **4000-4999**: Reserved for future use

### Routing Logic
1. Call comes to extension (e.g., 2001)
2. Asterisk dialplan looks up extension → IVR mapping
3. Stasis application launched with IVR ID
4. IVR Engine loads flow from database
5. Flow executes dynamically

### Customer Integration
Customers connect their PBX to our SBC via SIP trunk and route specific DIDs to assigned extensions.

---

## Getting Started: Phase 1 Implementation

### Step 1: Database Setup
Create database schema for IVRs, extensions, and tenants.

### Step 2: Platform API
REST API for CRUD operations on IVR flows.

### Step 3: IVR Engine Refactor
Modify ivr-node to load flow from database instead of hardcoded logic.

### Step 4: Dynamic Dialplan
Update Asterisk to route extensions dynamically.

### Step 5: Basic Admin Portal
Simple web UI to create and manage IVRs.
