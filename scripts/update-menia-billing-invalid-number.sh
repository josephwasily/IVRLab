#!/usr/bin/env bash
# ============================================================================
#  Menia: two separate "wrong number" messages in the billing flow.
#
#    1. Not 9 digits      → menia_invalid_9_digits  → re-enter number
#    2. 9 digits, unknown → menia_account_not_found → re-enter number
#
#  Run on the Menia client server after `git pull`:
#    1. Copies "new sounds 10/" into the platform-api container at
#       /app/prompts/new-sounds-10/ (shared prompts volume — asterisk sees
#       the files immediately at custom/new-sounds-10/).
#       Expected files: menia_invalid_9_digits.<mpeg|mp3|wav>
#                       menia_account_not_found.<mpeg|mp3|wav>
#    2. Runs platform-api/src/db/update-menia-billing-invalid-number.js
#       inside the container, which converts the audio to ulaw, upserts the
#       prompts rows, and patches billing-inquiry-flow.
#
#  Idempotent — safe to re-run. No container restart needed.
#
#  Usage:
#    sudo ./scripts/update-menia-billing-invalid-number.sh
#    sudo ./scripts/update-menia-billing-invalid-number.sh /opt/ivr-lab-src/"new sounds 10"
# ============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

SRC="${1:-/opt/ivr-lab-src/new sounds 10}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ivr-lab}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_SCRIPT="$REPO_ROOT/platform-api/src/db/update-menia-billing-invalid-number.js"

[ -d "$SRC" ] || die "Source folder not found: $SRC. Did you git pull?"
[ -f "$NODE_SCRIPT" ] || die "Node script not found: $NODE_SCRIPT. Did you git pull?"

cd "$INSTALL_DIR"

if ! docker compose ps platform-api 2>/dev/null | grep -q 'Up'; then
    die "platform-api isn't running. Start the stack first: cd $INSTALL_DIR && docker compose up -d"
fi

log "Copying $(basename "$SRC")/ → platform-api:/app/prompts/new-sounds-10/"
docker compose exec -T platform-api mkdir -p /app/prompts/new-sounds-10
COPIED=0
shopt -s nullglob
for f in "$SRC"/*; do
    [ -f "$f" ] || continue
    docker compose cp "$f" "platform-api:/app/prompts/new-sounds-10/$(basename "$f")"
    COPIED=$((COPIED + 1))
done
shopt -u nullglob
[ "$COPIED" -gt 0 ] || die "No files copied from $SRC"
ok "Copied $COPIED file(s)"

# The running image may predate this script — always ship the current copy in.
log "Copying update script into container"
docker compose cp "$NODE_SCRIPT" platform-api:/app/src/db/update-menia-billing-invalid-number.js

log "Converting audio + updating prompt rows + patching billing-inquiry-flow"
docker compose exec -T platform-api node src/db/update-menia-billing-invalid-number.js

ok "Done — call the billing flow extension and try a short number and an unknown 9-digit number."
