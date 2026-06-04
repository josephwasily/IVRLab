#!/usr/bin/env bash
# ============================================================================
#  Import a folder of audio files into IVR-Lab as selectable prompts.
#
#  Copies the host folder into the platform-api container's prompts volume,
#  then invokes the Node import script which converts each file to ulaw and
#  inserts a row in the prompts table so the file appears in the IVR flow
#  editor's prompt dropdown.
#
#  Usage:
#    sudo ./import-sounds.sh "/opt/ivr-lab-src/new sounds 4"
#    sudo ./import-sounds.sh "/opt/ivr-lab-src/new sounds 4" ar custom
#
#  Args:
#    1. <source-dir>  host path to folder containing audio files (required)
#    2. <language>    ar | en  (default: ar)
#    3. <category>    free-form group name shown in the UI  (default: custom)
#
#  Idempotent: re-running on the same folder skips prompts that are already
#  in the DB. Safe to call after adding new files to the same folder.
# ============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC}  %s\n" "$*"; }
die()  { printf "${RED}[X]${NC}  %s\n" "$*" >&2; exit 1; }

SRC="${1:-}"
LANGUAGE="${2:-ar}"
CATEGORY="${3:-custom}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ivr-lab}"

[ -n "$SRC" ] || die "usage: $0 <source-dir> [language=ar] [category=custom]"
[ -d "$SRC" ] || die "Not a directory: $SRC"

# Pick a subdir name from the basename, lowercase, no spaces
SUBDIR=$(basename "$SRC" | tr ' ' '-' | tr 'A-Z' 'a-z')
log "Importing '$SRC' → /app/prompts/$SUBDIR  (language=$LANGUAGE, category=$CATEGORY)"

cd "$INSTALL_DIR"

# Make sure platform-api is up — we can't docker cp into a stopped container
if ! docker compose ps platform-api --status running --quiet >/dev/null 2>&1; then
    if ! docker compose ps | grep -q '^platform-api.*Up'; then
        die "platform-api isn't running. Start the stack first: cd $INSTALL_DIR && docker compose up -d"
    fi
fi

# Make the target dir inside the container (idempotent)
docker compose exec -T platform-api mkdir -p "/app/prompts/$SUBDIR"

# Copy each audio source file. docker cp handles spaces in filenames.
COUNT=0
shopt -s nullglob
for f in "$SRC"/*; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    # Place the file inside the container
    docker compose cp "$f" "platform-api:/app/prompts/$SUBDIR/$name"
    COUNT=$((COUNT + 1))
done
shopt -u nullglob

[ $COUNT -gt 0 ] || die "No files copied from $SRC"
ok "Copied $COUNT files into /app/prompts/$SUBDIR"

# Invoke the Node importer
log "Running converter + DB importer"
docker compose exec -T platform-api node src/db/import-sounds.js "$SUBDIR" "$LANGUAGE" "$CATEGORY"

ok "Done. Refresh the admin portal's Prompts page — the new entries will be listed under category '$CATEGORY'."
