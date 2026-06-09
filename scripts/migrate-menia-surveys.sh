#!/usr/bin/env bash
# ============================================================================
#  Migrate Menia surveys (audio prompts + IVR flows + report labels).
#
#  Run on the Menia client server after `git pull` to fetch the latest
#  "new sounds 5/" + manifest + migration script.
#
#  What it does:
#    1. Copies the host "new sounds 5/" folder into the platform-api
#       container at /app/prompts/menia-surveys/ and copies manifest.json
#       in alongside it.
#    2. Runs platform-api/src/db/migrate-menia-surveys.js inside the
#       container, which:
#         a. converts each mp3 to ulaw (sox / ffmpeg)
#         b. inserts a prompts row per file
#         c. creates two ivr_flows rows (extension 2030 + 2031) with
#            reportLabelAr/En set on every question's collect node so the
#            Excel survey report renders them
#    3. Restarts asterisk if it was running, so any cached sound list
#       refreshes (optional — only if the user wants it).
#
#  Idempotent. Re-runs skip already-imported prompts and update existing
#  flows in place.
#
#  Usage:
#    sudo ./scripts/migrate-menia-surveys.sh
#    sudo ./scripts/migrate-menia-surveys.sh /opt/ivr-lab-src/"new sounds 5"
# ============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC}  %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

PRIMARY_SRC="${1:-/opt/ivr-lab-src/new sounds 5}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ivr-lab}"
SRC_ROOT="$(dirname "$PRIMARY_SRC")"

[ -d "$PRIMARY_SRC" ] || die "Source folder not found: $PRIMARY_SRC"
[ -f "$PRIMARY_SRC/manifest.json" ] || die "manifest.json missing from $PRIMARY_SRC. Did you git pull?"

# Additional folders to stage. The manifest references files by basename, so
# every "new sounds N" folder we want to feed the migration just dumps its
# contents into /app/prompts/menia-surveys/. As long as filenames don't
# collide, all surveys can read from the same flat directory.
EXTRA_SRCS=()
for extra in "new sounds 6"; do
    candidate="$SRC_ROOT/$extra"
    if [ -d "$candidate" ]; then
        EXTRA_SRCS+=("$candidate")
    fi
done

cd "$INSTALL_DIR"

# Verify platform-api is up — docker cp needs a running container
if ! docker compose ps platform-api 2>/dev/null | grep -q 'Up'; then
    die "platform-api isn't running. Start the stack first: cd $INSTALL_DIR && docker compose up -d"
fi

log "Preparing /app/prompts/menia-surveys/ inside platform-api"
docker compose exec -T platform-api sh -c 'mkdir -p /app/prompts/menia-surveys && rm -f /app/prompts/menia-surveys/manifest.json'

copy_folder() {
    local src="$1"
    local count=0
    shopt -s nullglob
    for f in "$src"/*; do
        [ -f "$f" ] || continue
        name=$(basename "$f")
        docker compose cp "$f" "platform-api:/app/prompts/menia-surveys/$name"
        count=$((count + 1))
    done
    shopt -u nullglob
    echo "$count"
}

# Primary folder (must have manifest.json)
COPIED=$(copy_folder "$PRIMARY_SRC")
[ "$COPIED" -gt 0 ] || die "No files copied from $PRIMARY_SRC"
ok "Copied $COPIED files from $(basename "$PRIMARY_SRC")"

# Additional source folders
for extra in "${EXTRA_SRCS[@]}"; do
    EXTRA_COUNT=$(copy_folder "$extra")
    if [ "$EXTRA_COUNT" -gt 0 ]; then
        ok "Copied $EXTRA_COUNT files from $(basename "$extra")"
    fi
done

log "Running migration (audio → ulaw + DB prompts + IVR flows)"
docker compose exec -T platform-api node src/db/migrate-menia-surveys.js

log "Done. Verify in the admin portal:"
echo "    • Prompts tab — 9 new entries under category 'menia'"
echo "    • IVR Flows  — 'Menia Survey 1' (ext 2030) and 'Menia Survey 2' (ext 2031)"
echo "    • Each question collect node will show its Arabic + English report label"
echo ""
echo "  Dial 2030 or 2031 from the trunk to test."
echo "  Pull the survey Excel report from a campaign using these flows."
