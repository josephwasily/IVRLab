#!/usr/bin/env bash
# ============================================================================
#  Menia: create the Work Order Status IVR flow (ext 2032) from "new sounds 8/".
#
#  Run on the Menia client server after `git pull`:
#    1. Copies "new sounds 8/" into the platform-api container at
#       /app/prompts/new-sounds-8/ (shared prompts volume — asterisk sees
#       the converted files at custom/new-sounds-8/).
#    2. Copies platform-api/src/db/create-menia-workorder-flow.js into the
#       container (the running image may predate it) and runs it: converts
#       the recordings to ulaw, upserts prompts, creates the flow.
#
#  Requires the Menia surveys migration to have run already (the flow
#  reuses the menia_s1_thanks recording).
#
#  Idempotent — safe to re-run. No container restart needed.
#
#  Usage:
#    sudo bash ./scripts/create-menia-workorder-flow.sh
#    sudo bash ./scripts/create-menia-workorder-flow.sh /opt/ivr-lab-src/"new sounds 8"
# ============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

SRC="${1:-/opt/ivr-lab-src/new sounds 8}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ivr-lab}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_SCRIPT="$REPO_ROOT/platform-api/src/db/create-menia-workorder-flow.js"

[ -d "$SRC" ] || die "Source folder not found: $SRC. Did you git pull?"
[ -f "$NODE_SCRIPT" ] || die "Node script not found: $NODE_SCRIPT. Did you git pull?"

cd "$INSTALL_DIR"

if ! docker compose ps platform-api 2>/dev/null | grep -q 'Up'; then
    die "platform-api isn't running. Start the stack first: cd $INSTALL_DIR && docker compose up -d"
fi

log "Copying $(basename "$SRC")/ → platform-api:/app/prompts/new-sounds-8/"
docker compose exec -T platform-api mkdir -p /app/prompts/new-sounds-8
COPIED=0
shopt -s nullglob
for f in "$SRC"/*; do
    [ -f "$f" ] || continue
    docker compose cp "$f" "platform-api:/app/prompts/new-sounds-8/$(basename "$f")"
    COPIED=$((COPIED + 1))
done
shopt -u nullglob
[ "$COPIED" -gt 0 ] || die "No files copied from $SRC"
ok "Copied $COPIED file(s)"

log "Copying flow-creation script into container"
docker compose cp "$NODE_SCRIPT" platform-api:/app/src/db/create-menia-workorder-flow.js

log "Converting audio + creating prompts + work-order flow (ext 2032)"
docker compose exec -T platform-api node src/db/create-menia-workorder-flow.js

ok "Done — dial 2032 from the trunk to test the flow."
