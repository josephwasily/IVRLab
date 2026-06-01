#!/usr/bin/env bash
# ============================================================================
#  Sideload IVR-Lab images to a client server (bypasses FortiGuard / firewall
#  AV scanning that blocks Docker HTTP pulls).
#
#  Usage (from WSL Ubuntu, your dev machine):
#    ./sideload-images.sh                                   # save tarball only
#    ./sideload-images.sh client-user@client-server         # save + scp + load
#
#  Optional env:
#    REGISTRY    Harbor host:port (default 185.163.125.167:8888)
#    PROJECT     Harbor project    (default ivr-lab)
#    TAG         Image tag         (default latest)
#    OUT         Output file       (default ./ivr-lab-images.tar)
#    REMOTE_DIR  Path on client    (default /opt/ivr-lab)
# ============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC}  %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

REGISTRY="${REGISTRY:-185.163.125.167:8888}"
PROJECT="${PROJECT:-ivr-lab}"
TAG="${TAG:-latest}"
OUT="${OUT:-./ivr-lab-images.tar}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ivr-lab}"
REMOTE="${1:-}"

IMAGES=(
    "ivr-admin-portal-v2"
    "ivr-asterisk"
    "ivr-node"
    "ivr-platform-api"
    "ivr-prompts"
)
# Legacy demo service. Nothing depends on it. Often trips client AV firewalls.
# Add it back here if you actually need the demo balance endpoint.
# "ivr-balance-api"

# ---- pre-flight ----------------------------------------------------------
command -v docker >/dev/null 2>&1 \
    || die "docker not found. In WSL: enable Docker Desktop's WSL integration, or 'sudo apt install docker.io'."
docker info >/dev/null 2>&1 \
    || die "docker daemon not reachable. Start Docker Desktop (with WSL integration) or 'sudo service docker start'."

# ---- 1. login to harbor --------------------------------------------------
if grep -q "\"$REGISTRY\"" ~/.docker/config.json 2>/dev/null; then
    ok "Already logged in to $REGISTRY"
else
    log "Logging in to $REGISTRY"
    docker login "$REGISTRY" || die "docker login failed"
fi

# ---- 2. pull all images --------------------------------------------------
TAGS=()
for img in "${IMAGES[@]}"; do
    full="$REGISTRY/$PROJECT/$img:$TAG"
    log "Pulling $full"
    docker pull "$full"
    TAGS+=("$full")
done
ok "All ${#IMAGES[@]} images pulled"

# ---- 3. save to single tar -----------------------------------------------
log "Saving to $OUT (this can take a few minutes)"
docker save "${TAGS[@]}" -o "$OUT"
SIZE=$(du -h "$OUT" | cut -f1)
ok "Wrote $OUT ($SIZE)"

# ---- 4. optionally compress for slow links -------------------------------
if [ "${COMPRESS:-0}" = "1" ]; then
    log "Compressing (use pigz if available)"
    if command -v pigz >/dev/null 2>&1; then
        pigz -f "$OUT"
    else
        gzip -f "$OUT"
    fi
    OUT="${OUT}.gz"
    SIZE=$(du -h "$OUT" | cut -f1)
    ok "Compressed to $OUT ($SIZE)"
fi

# ---- 5. if a remote was given, scp + load there --------------------------
if [ -n "$REMOTE" ]; then
    log "Copying $OUT to $REMOTE:$REMOTE_DIR/"
    scp "$OUT" "$REMOTE:$REMOTE_DIR/"
    ok "Transfer complete"

    BASENAME=$(basename "$OUT")
    log "Loading images on $REMOTE"
    if [[ "$OUT" == *.gz ]]; then
        ssh "$REMOTE" "sudo gunzip -c $REMOTE_DIR/$BASENAME | sudo docker load"
    else
        ssh "$REMOTE" "sudo docker load -i $REMOTE_DIR/$BASENAME"
    fi
    ok "Images loaded on $REMOTE"

    cat <<EOF

${GREEN}Now on the client server, finish the bootstrap WITHOUT pulling:${NC}

  cd $REMOTE_DIR
  sudo SKIP_LOGIN=1 docker compose up -d

(SKIP_LOGIN bypasses the Harbor login step in bootstrap-client.sh.
 Pulls are not needed — images are already loaded locally.)

EOF
else
    cat <<EOF

${GREEN}Tarball ready:${NC} $OUT  ($SIZE)

${YELLOW}Next steps — transfer and load on the client server:${NC}

  scp $OUT user@client-server:$REMOTE_DIR/
  ssh user@client-server
  cd $REMOTE_DIR
  sudo docker load -i $(basename "$OUT")
  sudo SKIP_LOGIN=1 docker compose up -d

EOF
fi
