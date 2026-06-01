#!/usr/bin/env bash
# ============================================================================
#  IVR-Lab Client Bootstrap — Ubuntu 20.04 LTS
# ----------------------------------------------------------------------------
#  Automates the steps in docs/CLIENT-SETUP.md on a fresh Ubuntu host.
#
#  Usage:
#    sudo ./bootstrap-client.sh                 # interactive (prompts for IPs)
#    sudo EXTERNAL_IP=10.0.1.50 SIP_TRUNK_IP=10.0.1.100 ./bootstrap-client.sh
#
#  Optional env vars:
#    EXTERNAL_IP        This server's LAN IP (auto-detected if unset)
#    SIP_TRUNK_IP       Client PBX / contact-center IP (REQUIRED)
#    SIP_TRUNK_PORT     SIP port of the trunk          (default 5060)
#    JWT_SECRET         JWT secret                     (auto-generated if unset)
#    IVR_LANGUAGE       ar | en                        (default ar)
#    INSTALL_DIR        Install path                   (default /opt/ivr-lab)
#    REGISTRY_HOST      Harbor host:port               (default 185.163.125.167:8888)
#    COMPOSE_URL        URL of docker-compose.prod.yml (default GitHub main)
#    SKIP_LOGIN=1       Skip `docker login` (assumes already logged in)
#    SKIP_DB_INIT=1     Skip migrate/seed (e.g. restoring an existing volume)
#
#  Safety:
#    * NEVER runs `docker compose down -v` — that flag wipes the platform
#      database volume. Use the documented backup/restore flow instead.
# ============================================================================

set -euo pipefail

# ---- pretty output --------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} ${BOLD}%s${NC}\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC}  %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

# ---- defaults -------------------------------------------------------------
INSTALL_DIR="${INSTALL_DIR:-/opt/ivr-lab}"
REGISTRY_HOST="${REGISTRY_HOST:-185.163.125.167:8888}"
COMPOSE_URL="${COMPOSE_URL:-https://raw.githubusercontent.com/josephwasily/IVRLab/main/docker-compose.prod.yml}"
SIP_TRUNK_PORT="${SIP_TRUNK_PORT:-5060}"
IVR_LANGUAGE="${IVR_LANGUAGE:-ar}"

# ---- pre-flight -----------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Run as root (use: sudo $0)"

if [ -r /etc/os-release ]; then
    . /etc/os-release
    if [ "${ID:-}" != "ubuntu" ]; then
        warn "Detected $PRETTY_NAME — this script targets Ubuntu 20.04 LTS. Continuing anyway."
    elif [ "${VERSION_ID:-}" != "20.04" ]; then
        warn "Detected Ubuntu $VERSION_ID (not 20.04). Continuing anyway."
    fi
fi

REAL_USER="${SUDO_USER:-root}"

# ---- 0. base dependencies -------------------------------------------------
# Minimal Ubuntu images ship without curl/openssl; install them before anything
# else so the steps below (IP prompt, compose download, JWT secret) all work.
log "Installing base dependencies (curl, ca-certificates, openssl, iproute2)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates openssl iproute2
ok "Base dependencies present"

# ---- 1. detect / collect IPs ---------------------------------------------
log "Detecting host IP"
DETECTED_IP=$(ip -4 addr show \
    | grep -oP '(?<=inet\s)\d+(\.\d+){3}' \
    | grep -v '^127\.' | grep -v '^172\.17\.' | grep -v '^169\.254\.' \
    | head -1 || true)
[ -n "$DETECTED_IP" ] || DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

EXTERNAL_IP="${EXTERNAL_IP:-}"
if [ -z "$EXTERNAL_IP" ]; then
    read -r -p "  EXTERNAL_IP (this server's LAN IP) [$DETECTED_IP]: " EXTERNAL_IP
    EXTERNAL_IP="${EXTERNAL_IP:-$DETECTED_IP}"
fi
[ -n "$EXTERNAL_IP" ] || die "EXTERNAL_IP is required"

if [ -z "${SIP_TRUNK_IP:-}" ]; then
    read -r -p "  SIP_TRUNK_IP (client PBX / contact-center IP): " SIP_TRUNK_IP
fi
[ -n "${SIP_TRUNK_IP:-}" ] || die "SIP_TRUNK_IP is required"

ok "EXTERNAL_IP=$EXTERNAL_IP"
ok "SIP_TRUNK_IP=$SIP_TRUNK_IP  SIP_TRUNK_PORT=$SIP_TRUNK_PORT"

# ---- 2. install docker ----------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker already installed ($(docker --version))"
else
    log "Installing Docker from official apt repo"
    # NOTE: we don't use `curl get.docker.com | sh` — on Ubuntu 20.04 (focal)
    # it tries to install `docker-model-plugin`, which isn't published for
    # focal, and the whole install aborts. We install the same packages
    # directly, minus that one.

    UBUNTU_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-focal}")"
    ARCH="$(dpkg --print-architecture)"

    # remove any old/conflicting packages from Ubuntu's own repo
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    apt-get install -y gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $UBUNTU_CODENAME stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -y
    apt-get install -y \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    systemctl enable --now docker
    ok "Docker installed"
fi

# add the invoking user to the docker group (non-fatal if already)
if [ "$REAL_USER" != "root" ]; then
    usermod -aG docker "$REAL_USER" 2>/dev/null || true
    ok "User '$REAL_USER' added to docker group (re-login to use docker without sudo)"
fi

# ---- 3. allow insecure Harbor registry -----------------------------------
log "Configuring Docker for Harbor registry ($REGISTRY_HOST)"
DAEMON_JSON=/etc/docker/daemon.json
DESIRED_JSON="{ \"insecure-registries\": [\"$REGISTRY_HOST\"] }"
if [ -f "$DAEMON_JSON" ] && grep -q "$REGISTRY_HOST" "$DAEMON_JSON"; then
    ok "daemon.json already allows $REGISTRY_HOST"
else
    [ -f "$DAEMON_JSON" ] && cp "$DAEMON_JSON" "${DAEMON_JSON}.bak.$(date +%s)"
    echo "$DESIRED_JSON" > "$DAEMON_JSON"
    systemctl restart docker
    ok "daemon.json written, docker restarted"
fi

# ---- 4. project directory + compose file ---------------------------------
log "Preparing $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
chown "$REAL_USER":"$REAL_USER" "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ -f docker-compose.yml ]; then
    ok "docker-compose.yml already present (leaving untouched)"
else
    log "Downloading docker-compose.prod.yml"
    curl -fSL "$COMPOSE_URL" -o docker-compose.yml

    # Strip balance-api: it's a legacy demo service nothing depends on, and its
    # image often trips FortiGuard's heuristic AV on client firewalls. Skip via
    # SKIP_BALANCE_API=0 if you actually need the demo backend.
    if [ "${SKIP_BALANCE_API:-1}" = "1" ]; then
        log "Removing balance-api from docker-compose.yml (legacy demo service)"
        sed -i '/^  balance-api:/,/^  [a-z]/{/^  [a-z]/!d;}' docker-compose.yml
        sed -i '/^  balance-api:/d' docker-compose.yml
        ok "balance-api stripped (set SKIP_BALANCE_API=0 to keep it)"
    fi
    chown "$REAL_USER":"$REAL_USER" docker-compose.yml
    ok "docker-compose.yml downloaded"
fi

# ---- 5. .env --------------------------------------------------------------
if [ -f .env ]; then
    warn ".env already exists — leaving as-is (delete it to regenerate)"
else
    log "Generating .env"
    JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
    cat > .env <<EOF
# Generated by bootstrap-client.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
EXTERNAL_IP=$EXTERNAL_IP
SIP_TRUNK_IP=$SIP_TRUNK_IP
SIP_TRUNK_PORT=$SIP_TRUNK_PORT
JWT_SECRET=$JWT_SECRET
IVR_LANGUAGE=$IVR_LANGUAGE
EOF
    chmod 600 .env
    chown "$REAL_USER":"$REAL_USER" .env
    ok ".env created (mode 600)"
fi

# ---- 6. Harbor login ------------------------------------------------------
if [ "${SKIP_LOGIN:-0}" = "1" ]; then
    warn "SKIP_LOGIN=1 — skipping docker login"
else
    log "Logging in to Harbor at $REGISTRY_HOST"
    echo "    (you will be prompted for username / password)"
    if ! docker login "$REGISTRY_HOST"; then
        die "docker login failed — re-run with valid credentials or set SKIP_LOGIN=1"
    fi
    ok "Logged in"
fi

# ---- 7. pull + start ------------------------------------------------------
log "Pulling images"
# --ignore-pull-failures: tolerate a single image being blocked by a client
# firewall AV (e.g. FortiGuard flagging the balance-api blob). Other services
# don't depend on it; the stack still comes up.
docker compose pull --ignore-pull-failures

log "Starting stack"
docker compose up -d

# ---- 8. first-run DB init -------------------------------------------------
if [ "${SKIP_DB_INIT:-0}" = "1" ]; then
    warn "SKIP_DB_INIT=1 — skipping migrate/seed"
else
    log "Waiting for platform-api to be ready"
    for i in $(seq 1 30); do
        if docker compose exec -T platform-api node -e "process.exit(0)" >/dev/null 2>&1; then
            break
        fi
        sleep 2
    done

    log "Running database migration (idempotent)"
    docker compose exec -T platform-api node src/db/migrate.js \
        || warn "migrate.js returned non-zero — check logs if this is a fresh install"

    # Seed only if the DB looks empty (no users yet)
    USER_COUNT=$(docker compose exec -T platform-api node -e \
        "const db=require('./src/db'); try{console.log(db.prepare('SELECT COUNT(*) as c FROM users').get().c)}catch(e){console.log(0)}" \
        2>/dev/null | tr -d '\r' || echo 0)
    if [ "${USER_COUNT:-0}" = "0" ]; then
        log "Seeding initial data"
        docker compose exec -T platform-api node src/db/seed.js \
            || warn "seed.js returned non-zero — review logs"
    else
        ok "Users already exist ($USER_COUNT) — skipping seed"
    fi
fi

# ---- 9. verify ------------------------------------------------------------
log "Stack status"
docker compose ps

cat <<EOF

${GREEN}${BOLD}✓ Bootstrap complete${NC}

  Admin Portal:   http://$EXTERNAL_IP:8082
  Platform API:   http://$EXTERNAL_IP:3001
  Asterisk ARI:   http://$EXTERNAL_IP:8088
  Default login:  admin@demo.com / admin123  ${YELLOW}(change immediately)${NC}

  Project dir:    $INSTALL_DIR
  Env file:       $INSTALL_DIR/.env

  ${YELLOW}Next steps:${NC}
    1. Copy audio prompts from your dev machine:
         scp -r prompts/ ${REAL_USER}@$EXTERNAL_IP:$INSTALL_DIR/prompts/
    2. Verify SIP trunk:
         docker compose exec asterisk asterisk -rx "pjsip show endpoints"
    3. Tail logs:
         cd $INSTALL_DIR && docker compose logs -f

  ${RED}WARNING:${NC} never run \`docker compose down -v\` — the -v flag wipes the
  platform-data volume (database + backups). Use the backup/restore flow in
  docs/CLIENT-SETUP.md instead.
EOF
