# IVR-Lab Client Deployment Guide

Deploy IVR-Lab on a client machine using pre-built Docker images — no source code required.

## Prerequisites

- Docker Engine 24+ with Compose v2
- Network access to your container registry (or images pre-loaded via `docker load`)

## What the client needs

```
client-deploy/
├── docker-compose.prod.yml
├── .env
└── prompts/          # audio prompt files (copy from source repo)
    ├── ar/
    └── *.ulaw
```

## Step-by-step

### 1. Copy files to client machine

```bash
# Copy these from the repo to the client:
#   docker-compose.prod.yml
#   .env.example → .env
#   prompts/   (entire directory)
```

### 2. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | Description | Example |
|----------|-------------|---------|
| `EXTERNAL_IP` | Host machine's LAN IP (for SIP audio) | `10.0.1.50` |
| `SIP_TRUNK_IP` | Client's PBX/contact center IP | `10.0.1.100` |
| `REGISTRY` | Your container registry URL | `ghcr.io/your-org` |
| `JWT_SECRET` | Random secret for API auth | `$(openssl rand -hex 32)` |

### 3. Pull and start

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### 4. Initialize database (first run only)

Migrations run automatically on startup. To seed demo data:

```bash
docker compose -f docker-compose.prod.yml exec platform-api node src/db/seed.js
```

### 5. Verify

- Admin Portal: http://localhost:8082
- Platform API: http://localhost:3001/api/health
- Login: admin@demo.com / admin123

## CLI Operations (no source code needed)

All scripts run inside the containers:

```bash
# Run migrations
docker compose -f docker-compose.prod.yml exec platform-api node src/db/migrate.js

# Seed database
docker compose -f docker-compose.prod.yml exec platform-api node src/db/seed.js

# Seed reports user
docker compose -f docker-compose.prod.yml exec platform-api node src/db/ensure-reports-user.js

# Check Asterisk SIP trunk status
docker compose -f docker-compose.prod.yml exec asterisk asterisk -rx "pjsip show endpoints"

# View logs
docker compose -f docker-compose.prod.yml logs -f asterisk
docker compose -f docker-compose.prod.yml logs -f ivr-node
```

## Building and Pushing Images

### Option A: GitHub Actions (automatic)

Push to `main` or tag a release — images are built and pushed to GHCR automatically.

### Option B: Manual / Self-hosted registry

```bash
# Login to your registry
docker login myregistry.example.com

# Build and push all images
./scripts/build-push-images.sh myregistry.example.com v1.3
```

### Option C: Air-gapped / offline

```bash
# On build machine — save images to a tarball
docker compose build
docker save $(docker compose config --images) | gzip > ivr-lab-images.tar.gz

# On client machine — load from tarball
docker load < ivr-lab-images.tar.gz
# Then set REGISTRY to match the image names in the tarball
```

## Updating

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
# Run migrations after update
docker compose -f docker-compose.prod.yml exec platform-api node src/db/migrate.js
```
