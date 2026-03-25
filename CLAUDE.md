# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IVR-Lab is a multi-tenant IVR (Interactive Voice Response) platform built on Asterisk 20 with ARI (Asterisk REST Interface). Call logic runs in Node.js via ARI events, not traditional Asterisk dialplan. The system has a visual flow builder (React Flow) for designing IVR call flows that get executed by a dynamic engine.

## Architecture

- **asterisk/** — PBX config (pjsip.conf, extensions.conf, ari.conf). Asterisk runs in Stasis/ARI mode; all call handling is in Node.js, not in extensions.conf.
- **ivr-node/** — IVR execution engine connecting to Asterisk via ARI. `index.js` = legacy hardcoded IVR (ext 6000), `dynamic-ivr.js` = template-based flow engine (ext 2000-2099), `flow-engine.js` = reusable flow logic.
- **platform-api/** — Express REST API (:3001) with SQLite (better-sqlite3). Multi-tenant with JWT auth. Routes: auth, ivr, templates, extensions, prompts, campaigns, triggers, analytics, trunks, system.
- **admin-portal-v2/** — React 18 + Vite SPA (:8082) with TailwindCSS. Visual flow builder in `src/components/flow/`. Nginx reverse proxy in production.
- **balance-api/** — Legacy backend (:3000).
- **prompts/** — Audio files in ulaw format (8kHz mono). Arabic (default) and English.
- **scripts/** — IP update scripts, audio conversion, TTS generation.

## Build & Run Commands

**Everything runs in Docker. Never run `npm install` or `npm run dev` on the host.**

```bash
docker compose build
docker compose up -d
docker compose logs -f <service>    # service: asterisk, ivr-node, platform-api, admin-portal-v2, balance-api
```

### Database Setup (after first build)
```bash
docker exec platform-api node src/db/migrate.js
docker exec platform-api node src/db/seed.js
docker exec platform-api npm run seed:reports-user
```

### Access Points
- Admin Portal: http://localhost:8082
- Platform API: http://localhost:3001
- Asterisk ARI: http://localhost:8088

## Key Architectural Decisions

- **Multi-tenancy**: Schema-based isolation via `tenant_id` foreign keys. JWT tokens carry tenant context. All API routes enforce tenant ownership.
- **Extension pool**: Extensions 2000-2099 are pre-allocated for dynamic IVRs, auto-assigned on creation.
- **Flow execution**: IVR flows are JSON node graphs (start, play, collect, branch, api_call, transfer, end). Saved to DB and interpreted at runtime by the flow engine with variable context and state tracking.
- **External IP requirement**: `EXTERNAL_IP` in `.env` is critical for NAT/SDP — needed for DTMF reception from softphones. Local net is set to container IP only (`172.30.0.10/32`) to force external address usage.
- **Outbound campaigns**: Call initiation via Asterisk spool directory. Separate `outbound-ivr` context for answered calls. Retry logic based on call outcome.
- **Audio prompts**: Arabic default, ulaw codec. Prompts exist in filesystem AND database. Pre-generated digit files for number pronunciation.
- **Docker networking**: Custom bridge network `172.30.0.0/16` with static IPs for containers.

## Database

SQLite at `platform-api/data/platform.db`. Schema in `platform-api/src/db/schema.sql`. Migrations are additive (add columns, not remove). Uses prepared statements and transactions for campaign operations.

## Frontend

React Router for navigation, Zustand for state management, React Flow (@xyflow/react) for the visual flow builder. API calls proxied via Vite dev server or Nginx (`/api` prefix). Auth via `AuthContext.jsx` with JWT in Authorization header.
