#!/usr/bin/env bash
# ============================================================================
#  Migrate Assuit surveys (audio + IVR flows + report labels + campaigns).
#
#  Run on the client server after `git pull`.
#
#  What it does:
#    1. Copies host folders into /app/prompts/assuit-surveys/ in the
#       platform-api container:
#         - "new sounds 6/"  → Assuit welcome audio + assuit-manifest.json
#         - "new sounds 5/"  → question + thanks audio (shared with Menia)
#       Both land in the same flat directory; the manifest references
#       files by basename, so no name collisions matter.
#    2. Runs platform-api/src/db/migrate-assuit-surveys.js inside the
#       container, which:
#         a. converts each referenced source file to ulaw
#         b. inserts a prompts row per file (idempotent)
#         c. upserts 2 ivr_flows rows (ext 2040, 2041) with reportLabelAr/En
#         d. upserts 2 campaigns rows in 'draft' status
#
#  Idempotent — re-runs skip prompts already in the DB and update
#  existing flows/campaigns in place.
#
#  Usage:
#    sudo ./scripts/migrate-assuit-surveys.sh
#    sudo ./scripts/migrate-assuit-surveys.sh /opt/ivr-lab-src/"new sounds 6"
# ============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC}  %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

PRIMARY_SRC="${1:-/opt/ivr-lab-src/new sounds 6}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ivr-lab}"
SRC_ROOT="$(dirname "$PRIMARY_SRC")"

[ -d "$PRIMARY_SRC" ] || die "Source folder not found: $PRIMARY_SRC"
[ -f "$PRIMARY_SRC/assuit-manifest.json" ] || die "assuit-manifest.json missing from $PRIMARY_SRC. Did you git pull?"

# Assuit reuses Menia's question/thanks audio for the body of each survey;
# only the welcomes are Assuit-specific (in "new sounds 6/"). Stage Menia's
# folder too — no harm if the files already exist on disk.
EXTRA_SRCS=()
for extra in "new sounds 5"; do
    candidate="$SRC_ROOT/$extra"
    [ -d "$candidate" ] && EXTRA_SRCS+=("$candidate")
done

cd "$INSTALL_DIR"

if ! docker compose ps platform-api 2>/dev/null | grep -q 'Up'; then
    die "platform-api isn't running. Start the stack first: cd $INSTALL_DIR && docker compose up -d"
fi

log "Preparing /app/prompts/assuit-surveys/ inside platform-api"
docker compose exec -T platform-api sh -c 'mkdir -p /app/prompts/assuit-surveys'

copy_folder() {
    local src="$1"
    local count=0
    shopt -s nullglob
    for f in "$src"/*; do
        [ -f "$f" ] || continue
        name=$(basename "$f")
        docker compose cp "$f" "platform-api:/app/prompts/assuit-surveys/$name"
        count=$((count + 1))
    done
    shopt -u nullglob
    echo "$count"
}

COPIED=$(copy_folder "$PRIMARY_SRC")
[ "$COPIED" -gt 0 ] || die "No files copied from $PRIMARY_SRC"
ok "Copied $COPIED files from $(basename "$PRIMARY_SRC")"

for extra in "${EXTRA_SRCS[@]}"; do
    EXTRA_COUNT=$(copy_folder "$extra")
    if [ "$EXTRA_COUNT" -gt 0 ]; then
        ok "Copied $EXTRA_COUNT files from $(basename "$extra")"
    fi
done

log "Running migration (audio → ulaw + prompts + flows + campaigns)"
docker compose exec -T platform-api node src/db/migrate-assuit-surveys.js

log "Done. Verify in the admin portal:"
echo "    • Prompts tab — entries with category='assuit' (9 prompts)"
echo "    • IVR Flows  — 'استطلاع حل الشكاوى - أسيوط' (ext 2040)"
echo "                   'استطلاع رضا الخدمة - أسيوط' (ext 2041)"
echo "    • Campaigns  — 2 new campaigns in DRAFT status"
echo ""
echo "  Activate the campaigns from the UI before they dial."
echo "  Dial 2040 / 2041 to test the flows directly."
