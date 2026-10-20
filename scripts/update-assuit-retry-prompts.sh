#!/usr/bin/env bash
# ============================================================================
#  Assuit: explain the failure before asking again, 3 attempts everywhere.
#
#    Surveys 2040 / 2041 — key outside the range → assuit_invalid_option
#                          ("اختيار خاطئ") → same question again
#    Billing 2010        — ListBills rejects the number → assuit_billing_account_not_found
#                          → re-enter number
#
#  Run on the Assuit client server after `git pull` and after ivr-node has
#  been rebuilt (the engine needs invalidPrompt / onHttpError support):
#    1. Copies "new sounds 11/" into the platform-api container at
#       /app/prompts/new-sounds-11/ (shared prompts volume — asterisk sees
#       the files immediately at custom/new-sounds-11/).
#    2. Runs platform-api/src/db/update-assuit-retry-prompts.js inside the
#       container, which converts the audio to ulaw, upserts the prompts
#       rows, and patches the three flows.
#
#  Idempotent — safe to re-run. No container restart needed.
#
#  Usage:
#    sudo ./scripts/update-assuit-retry-prompts.sh
#    sudo ./scripts/update-assuit-retry-prompts.sh /opt/ivr-lab-src/"new sounds 11"
# ============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

SRC="${1:-/opt/ivr-lab-src/new sounds 11}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ivr-lab}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_SCRIPT="$REPO_ROOT/platform-api/src/db/update-assuit-retry-prompts.js"

[ -d "$SRC" ] || die "Source folder not found: $SRC. Did you git pull?"
[ -f "$NODE_SCRIPT" ] || die "Node script not found: $NODE_SCRIPT. Did you git pull?"

cd "$INSTALL_DIR"

if ! docker compose ps platform-api 2>/dev/null | grep -q 'Up'; then
    die "platform-api isn't running. Start the stack first: cd $INSTALL_DIR && docker compose up -d"
fi

log "Copying $(basename "$SRC")/ → platform-api:/app/prompts/new-sounds-11/"
docker compose exec -T platform-api mkdir -p /app/prompts/new-sounds-11
COPIED=0
shopt -s nullglob
for f in "$SRC"/*; do
    [ -f "$f" ] || continue
    docker compose cp "$f" "platform-api:/app/prompts/new-sounds-11/$(basename "$f")"
    COPIED=$((COPIED + 1))
done
shopt -u nullglob
[ "$COPIED" -gt 0 ] || die "No files copied from $SRC"
ok "Copied $COPIED file(s)"

# The running image may predate this script — always ship the current copy in.
log "Copying update script into container"
docker compose cp "$NODE_SCRIPT" platform-api:/app/src/db/update-assuit-retry-prompts.js

log "Converting audio + updating prompt rows + patching survey and billing flows"
docker compose exec -T platform-api node src/db/update-assuit-retry-prompts.js

ok "Done — dial 2040/2041 and press a wrong key; dial 2010 and enter an unknown number."
