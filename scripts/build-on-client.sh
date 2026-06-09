#!/usr/bin/env bash
# ============================================================================
#  Build IVR-Lab images from source on the client server (no Harbor pull)
# ----------------------------------------------------------------------------
#  Use this when the client's firewall blocks Docker registry pulls (e.g.
#  FortiGuard flagging image blobs as Adware/Miner). Builds every image
#  locally with tags that match docker-compose.prod.yml so the prod compose
#  starts the locally-built images without trying to pull.
#
#  Prerequisites: Docker, docker compose plugin, git, internet access for
#  base images (node:20-alpine etc.) and npm/apk packages. Run as root.
#
#  Usage:
#    sudo ./build-on-client.sh                                  # all defaults
#    sudo EXTERNAL_IP=10.0.1.50 SIP_TRUNK_IP=10.0.1.100 ./build-on-client.sh
#
#  Optional env:
#    SOURCE_DIR        Path to repo on this host  (default /opt/ivr-lab-src)
#    INSTALL_DIR       Where compose runs from    (default /opt/ivr-lab)
#    GIT_URL           Repo URL                   (default github josephwasily/IVRLab)
#    GIT_REF           Branch/tag/sha to checkout (default main)
#    REGISTRY_HOST     Tag prefix to match prod compose
#                      (default 185.163.125.167:8888)
#    PROJECT           Harbor project name        (default ivr-lab)
#    TAG               Image tag                  (default latest)
#    SKIP_BALANCE_API  Skip the legacy demo svc   (default 1 = skip)
#    SKIP_DB_INIT      Skip migrate/seed          (default 0 = run them)
# ============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} ${BOLD}%s${NC}\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC}  %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

SOURCE_DIR="${SOURCE_DIR:-/opt/ivr-lab-src}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ivr-lab}"
GIT_URL="${GIT_URL:-https://github.com/josephwasily/IVRLab.git}"
GIT_REF="${GIT_REF:-main}"
REGISTRY_HOST="${REGISTRY_HOST:-185.163.125.167:8888}"
PROJECT="${PROJECT:-ivr-lab}"
TAG="${TAG:-latest}"
SIP_TRUNK_PORT="${SIP_TRUNK_PORT:-5060}"
IVR_LANGUAGE="${IVR_LANGUAGE:-ar}"
REAL_USER="${SUDO_USER:-root}"

# ---- pre-flight ----------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Run as root (use: sudo $0)"
command -v docker >/dev/null 2>&1 || die "docker not found — install it first (see bootstrap-client.sh)"
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found"
command -v git >/dev/null 2>&1 || apt-get update -y && apt-get install -y git

# ---- 1. collect IPs ------------------------------------------------------
DETECTED_IP=$(ip -4 addr show 2>/dev/null \
    | grep -oP '(?<=inet\s)\d+(\.\d+){3}' \
    | grep -v '^127\.' | grep -v '^172\.17\.' | grep -v '^169\.254\.' \
    | head -1 || true)

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

# ---- 2. fetch / refresh source ------------------------------------------
if [ -d "$SOURCE_DIR/.git" ]; then
    log "Refreshing source at $SOURCE_DIR ($GIT_REF)"
    git -C "$SOURCE_DIR" fetch --depth=1 origin "$GIT_REF"
    git -C "$SOURCE_DIR" checkout "$GIT_REF"
    git -C "$SOURCE_DIR" reset --hard "origin/$GIT_REF" 2>/dev/null || true
elif [ -d "$SOURCE_DIR" ] && [ -d "$SOURCE_DIR/platform-api" ]; then
    # Source was put here by other means (rsync/scp from dev). Trust it.
    ok "Using existing source at $SOURCE_DIR (not a git repo — won't update)"
else
    log "Cloning $GIT_URL → $SOURCE_DIR ($GIT_REF)"
    rm -rf "$SOURCE_DIR"
    git clone --depth=1 --branch "$GIT_REF" "$GIT_URL" "$SOURCE_DIR"
fi
ok "Source ready"

# ---- 3. build each service ----------------------------------------------
PREFIX="$REGISTRY_HOST/$PROJECT"

# --- ivr-prompts: special staging build (matches scripts/build-push-images.sh) ---
# The prompts image must include the `prompts/` tree AND the three `new sounds*`
# folders (which seed-ivr-flows.js consumes to generate billing/survey ulaw files).
# Building straight from prompts/ misses them and leaves the IVR silent.
log "Staging prompts (prompts/ + new sounds*)"
PROMPTS_STAGING=$(mktemp -d)
trap 'rm -rf "$PROMPTS_STAGING"' EXIT
cp -a "$SOURCE_DIR/prompts/"* "$PROMPTS_STAGING/" 2>/dev/null || true
rm -f "$PROMPTS_STAGING/Dockerfile"
for DIR in "new sounds" "new sounds 2" "new sounds 3" "new sounds 4" "new sounds 5" "new sounds 6"; do
    if [ -d "$SOURCE_DIR/$DIR" ]; then
        DEST="$PROMPTS_STAGING/$(echo "$DIR" | tr ' ' '-')"
        mkdir -p "$DEST"
        cp -a "$SOURCE_DIR/$DIR/"* "$DEST/"
    fi
done
cat > "$PROMPTS_STAGING/init.sh" <<'IEOF'
#!/bin/sh
set -e
mkdir -p /out/custom /out/ar
cd /data
find . -maxdepth 1 ! -name ar ! -name . -exec cp -a {} /out/custom/ \;
cp -a /data/ar/. /out/ar/ 2>/dev/null || true
echo '[prompts-init] Done'
IEOF
cat > "$PROMPTS_STAGING/Dockerfile" <<'DEOF'
FROM alpine:3.20
COPY . /data/
RUN rm -f /data/Dockerfile /data/init.sh
COPY init.sh /init.sh
RUN chmod +x /init.sh
CMD ["/init.sh"]
DEOF
log "Building ivr-prompts  ($PROMPTS_STAGING → $PREFIX/ivr-prompts:$TAG)"
docker build --pull -t "$PREFIX/ivr-prompts:$TAG" "$PROMPTS_STAGING"
rm -rf "$PROMPTS_STAGING"
trap - EXIT
ok "Built $PREFIX/ivr-prompts:$TAG"

# --- everything else: plain directory builds ---
declare -A BUILD_MAP=(
    [ivr-asterisk]=asterisk
    [ivr-node]=ivr-node
    [ivr-platform-api]=platform-api
    [ivr-admin-portal-v2]=admin-portal-v2
)
if [ "${SKIP_BALANCE_API:-1}" = "0" ]; then
    BUILD_MAP[ivr-balance-api]=balance-api
fi

for img in "${!BUILD_MAP[@]}"; do
    ctx="$SOURCE_DIR/${BUILD_MAP[$img]}"
    tag="$PREFIX/$img:$TAG"
    if [ ! -f "$ctx/Dockerfile" ]; then
        warn "Skipping $img — no Dockerfile at $ctx"
        continue
    fi
    log "Building $img  ($ctx → $tag)"
    docker build --pull -t "$tag" "$ctx"
    ok "Built $tag"
done
ok "All images built"

# ---- 4. set up install dir + compose + .env -----------------------------
mkdir -p "$INSTALL_DIR"
chown "$REAL_USER":"$REAL_USER" "$INSTALL_DIR"

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    log "Installing docker-compose.prod.yml → docker-compose.yml"
    cp "$SOURCE_DIR/docker-compose.prod.yml" "$INSTALL_DIR/docker-compose.yml"
else
    # Re-validate. If the existing file is broken (e.g. mangled by a previous
    # version of this script's sed-based strip), replace it from source.
    if (cd "$INSTALL_DIR" && docker compose config >/dev/null 2>&1); then
        ok "docker-compose.yml already present and valid (preserving)"
    else
        warn "Existing docker-compose.yml fails validation — replacing from source"
        cp "$SOURCE_DIR/docker-compose.prod.yml" "$INSTALL_DIR/docker-compose.yml"
    fi
fi

# Always re-check the balance-api strip — guards against a stale file from
# a previous run that predated SKIP_BALANCE_API support.
#
# We use awk (not sed) because the previous sed pattern ^  [a-z] matched
# both service names under services: and network names under networks:,
# so stripping balance-api accidentally consumed the top-level networks:
# key and left ivrnet: orphaned under services: (compose error:
# "services.ivrnet: Additional property ipam is not allowed").
#
# Block ends at EITHER the next service at 2-space indent OR the next
# top-level key at 0-space indent. Both correctly terminate the block.
if [ "${SKIP_BALANCE_API:-1}" = "1" ] && grep -q '^  balance-api:' "$INSTALL_DIR/docker-compose.yml"; then
    log "Stripping balance-api service from docker-compose.yml"
    awk '
        /^  balance-api:/                       { in_block=1; next }
        in_block && (/^[^ ]/ || /^  [^ ]/)      { in_block=0 }
        !in_block                               { print }
    ' "$INSTALL_DIR/docker-compose.yml" > "$INSTALL_DIR/docker-compose.yml.new"

    # Sanity-check the result before swapping in
    if grep -q '^networks:' "$INSTALL_DIR/docker-compose.yml.new" \
       && grep -q '^services:' "$INSTALL_DIR/docker-compose.yml.new" \
       && ! grep -q '^  balance-api:' "$INSTALL_DIR/docker-compose.yml.new"; then
        mv "$INSTALL_DIR/docker-compose.yml.new" "$INSTALL_DIR/docker-compose.yml"
        ok "balance-api stripped"
    else
        rm -f "$INSTALL_DIR/docker-compose.yml.new"
        warn "Strip failed sanity check — left docker-compose.yml untouched."
        warn "Bringing up explicit services instead."
        SKIP_BY_SERVICE_LIST=1
    fi
fi

if [ ! -f "$INSTALL_DIR/.env" ]; then
    log "Generating .env"
    JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
    cat > "$INSTALL_DIR/.env" <<EOF
EXTERNAL_IP=$EXTERNAL_IP
SIP_TRUNK_IP=$SIP_TRUNK_IP
SIP_TRUNK_PORT=$SIP_TRUNK_PORT
JWT_SECRET=$JWT_SECRET
IVR_LANGUAGE=$IVR_LANGUAGE
EOF
    chmod 600 "$INSTALL_DIR/.env"
    chown "$REAL_USER":"$REAL_USER" "$INSTALL_DIR/.env"
    ok ".env created"
else
    ok ".env already present"
fi

# ---- 5. copy prompts (the prod compose seeds them via ivr-prompts image,
#                       but if you also want raw .ulaw files on disk, place
#                       them under $INSTALL_DIR/prompts/) ------------------

# ---- 6. start the stack -------------------------------------------------
cd "$INSTALL_DIR"
log "Starting stack (using locally-built images, no pull)"
# --pull never  : never reach out to a registry; safe behind FortiGuard etc.
# --no-build    : we already built above; don't rebuild here.
if [ "${SKIP_BY_SERVICE_LIST:-0}" = "1" ]; then
    # Compose file still defines balance-api but we deliberately don't start it.
    docker compose up -d --pull never --no-build \
        prompts-init asterisk platform-api ivr-node admin-portal-v2
else
    docker compose up -d --pull never --no-build
fi

# ---- 7. first-run DB init -----------------------------------------------
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

# ---- 8. verify ----------------------------------------------------------
log "Stack status"
docker compose ps

cat <<EOF

${GREEN}${BOLD}✓ Build & deploy complete${NC}

  Source:        $SOURCE_DIR  (ref: $GIT_REF)
  Install dir:   $INSTALL_DIR
  Images built:  ${!BUILD_MAP[@]}

  Admin Portal:  http://$EXTERNAL_IP:8082
  Platform API:  http://$EXTERNAL_IP:3001
  Asterisk ARI:  http://$EXTERNAL_IP:8088
  Default login: admin@demo.com / admin123  ${YELLOW}(change immediately)${NC}

  ${YELLOW}Rebuild after a code change:${NC}
    cd $SOURCE_DIR && git pull
    sudo $0      # re-run this script — it'll rebuild and restart

  ${YELLOW}Logs:${NC}
    cd $INSTALL_DIR && docker compose logs -f

  ${RED}WARNING:${NC} never run \`docker compose down -v\` — the -v flag wipes the
  platform-data volume (database + backups).
EOF
