# IVR Platform - Phase 1 Implementation Summary

## What Was Built

### 1. Platform API (`platform-api/`)
A complete REST API for managing IVR flows with the following features:

**Authentication**
- JWT-based authentication
- Login, register, and user management
- Role-based access control (admin, editor, viewer)

**IVR Management**
- CRUD operations for IVR flows
- Clone IVR functionality
- Activate/deactivate IVRs
- Version tracking

**Extension Management**
- Extension pool (2000-2099 initialized)
- Auto-assignment when IVR is created
- Extension release when IVR is deleted

**Templates**
- Pre-built IVR templates (Balance Inquiry, Appointment Scheduling, Card Activation)
- Clone from template to create new IVRs

**Analytics**
- Dashboard stats
- Call logs with filtering
- Hourly call charts
- Per-IVR statistics

### 2. Database Schema
SQLite database with tables for:
- `tenants` - Multi-tenant support
- `users` - User accounts with roles
- `ivr_flows` - IVR configurations (JSON-based)
- `ivr_templates` - Pre-built templates
- `extensions` - Extension pool management
- `call_logs` - Call history and analytics
- `campaigns` - Future outbound support
- `connectors` - API integration configs

### 3. Admin Portal V2 (`admin-portal-v2/`)
React-based admin interface with:
- Login page with demo credentials
- Dashboard with stats overview
- IVR list with status management
- Create IVR wizard (blank or from template)
- IVR editor with node editing
- Templates browser
- Analytics and call logs

### 4. Dynamic IVR Engine (`ivr-node/flow-engine.js`)
Runtime flow executor that:
- Loads IVR configuration from database
- Executes nodes dynamically (play, collect, branch, API call, etc.)
- Supports variable interpolation
- Handles error recovery
- Logs execution for analytics

### 5. Asterisk Dialplan Updates
- Dynamic routing for extensions 2000-2999
- Passes extension to Stasis app for flow lookup

## API Endpoints

### Authentication
```
POST /api/auth/login          - Login
POST /api/auth/register       - Register new tenant
GET  /api/auth/me             - Get current user
```

### IVR Management
```
GET    /api/ivr               - List all IVRs
GET    /api/ivr/:id           - Get IVR details
POST   /api/ivr               - Create new IVR
PUT    /api/ivr/:id           - Update IVR
DELETE /api/ivr/:id           - Delete (archive) IVR
POST   /api/ivr/:id/activate  - Activate/deactivate
POST   /api/ivr/:id/clone     - Clone IVR
```

### Templates
```
GET /api/templates            - List templates
GET /api/templates/:id        - Get template details
```

### Extensions
```
GET /api/extensions           - List extensions
GET /api/extensions/stats     - Extension statistics
```

### Analytics
```
GET /api/analytics/dashboard  - Dashboard stats
GET /api/analytics/calls      - Call logs
GET /api/analytics/calls/hourly - Hourly chart data
GET /api/analytics/ivr/:id    - IVR-specific stats
```

### Engine (Internal)
```
GET /api/engine/flow/:extension - Get flow for extension (used by IVR engine)
```

## How to Run

### 1. Start the Platform
```bash
# Build and start all services
docker-compose up --build -d

# Initialize database (runs automatically in Docker)
# Or manually:
cd platform-api
npm install
npm run migrate
npm run seed
```

### 2. Access the Admin Portal
- Open http://localhost:3001 (API)
- Admin portal development: `cd admin-portal-v2 && npm install && npm run dev`

### 3. Default Credentials
```
Email: admin@demo.com
Password: admin123
```

### 4. Sample IVR Extension
The seed script creates a sample "Account Balance IVR" on extension **2001**.

## IVR Flow JSON Structure

```json
{
  "startNode": "welcome",
  "nodes": {
    "welcome": {
      "id": "welcome",
      "type": "play",
      "prompt": "enter_account",
      "next": "collect_account"
    },
    "collect_account": {
      "id": "collect_account",
      "type": "collect",
      "maxDigits": 6,
      "timeout": 10,
      "next": "process"
    },
    "process": {
      "id": "process",
      "type": "api_call",
      "method": "GET",
      "url": "{{BALANCE_API_URL}}/balance/{{account_number}}",
      "next": "announce"
    },
    "hangup": {
      "id": "hangup",
      "type": "hangup"
    }
  }
}
```

## Node Types

| Type | Description | Properties |
|------|-------------|------------|
| `play` | Play audio file | prompt, next |
| `play_digits` | Say digits | variable, prefix, suffix, next |
| `play_sequence` | Play sequence of prompts/numbers | sequence[], next |
| `collect` | Collect DTMF input | maxDigits, timeout, terminators, next |
| `branch` | Conditional routing | variable, condition, branches{}, default |
| `api_call` | Make HTTP request | method, url, body, headers, resultVariable, next |
| `set_variable` | Set runtime variable | variable, value, expression, next |
| `transfer` | Transfer call | destination, next |
| `hangup` | End call | - |

## Next Steps

### Phase 2: Connect IVR Engine to Platform API
- Update `ivr-node/index.js` to fetch flows from Platform API
- Implement the second Stasis app `ivr-engine` for dynamic extensions
- Add call logging to Platform API

### Phase 3: Admin Portal Deployment
- Build production version of admin-portal-v2
- Add Dockerfile for serving static files
- Integrate with platform-api

### Phase 4: Visual Flow Builder
- Add React Flow for drag-and-drop
- Node palette with all node types
- Real-time validation
- Export/import flows

### Phase 5: Outbound Campaigns
- Campaign management UI
- Contact list upload
- Outbound dialer integration
- Campaign analytics
