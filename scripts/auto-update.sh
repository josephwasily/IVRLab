#!/bin/bash
# =============================================================================
# Daily pull-and-rebuild for the deployed IVR-Lab stack.
#
# The host drifted ten commits behind main between June and September 2026,
# which is why a bug already fixed upstream was still live in production. This
# keeps the deployment current without anyone remembering to do it.
#
# It is deliberately cautious — it is a PBX, not a web app:
#   * does nothing when the remote has no new commits
#   * refuses to touch a working tree with local commits or staged changes
#   * skips (and retries tomorrow) while any call is up
#   * rebuilds only the services whose files actually changed
#   * rolls back to the previous commit if ivr-node fails to come up
#
# Install: see scripts/auto-update.timer / .service, or run from cron:
#   30 3 * * *  root  /opt/ivr-lab-src/scripts/auto-update.sh
# =============================================================================
set -uo pipefail

REPO="${IVR_REPO:-/opt/ivr-lab-src}"
PROJECT="${IVR_COMPOSE_PROJECT:-ivr-lab}"
LOG="${IVR_UPDATE_LOG:-/var/log/ivr-auto-update.log}"
BRANCH="${IVR_BRANCH:-main}"

exec >>"$LOG" 2>&1
echo "=== $(date -Is) auto-update start ==="

cd "$REPO" || { echo "FATAL: $REPO missing"; exit 1; }

# --- refuse to run over uncommitted source work --------------------------
# Runtime churn under asterisk/log is untracked and ignored, so anything
# reported here is a real local edit that a pull could clobber.
DIRTY=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then
  echo "SKIP: working tree has local changes:"
  echo "$DIRTY" | sed 's/^/    /'
  echo "      commit, stash or revert them, then this job resumes on its own."
  exit 0
fi

git fetch --quiet origin "$BRANCH" || { echo "FATAL: fetch failed"; exit 1; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "up to date at ${LOCAL:0:7}; nothing to do"
  echo "=== $(date -Is) auto-update end ==="
  exit 0
fi

# Local commits that were never pushed must not be silently discarded.
if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  echo "SKIP: HEAD ${LOCAL:0:7} is not an ancestor of origin/$BRANCH ${REMOTE:0:7}"
  echo "      the deployment has local commits; push or reset them first."
  exit 0
fi

# --- never interrupt a live call ----------------------------------------
ACTIVE=$(docker exec asterisk asterisk -rx 'core show channels' 2>/dev/null \
         | grep -oE '^[0-9]+ active call' | grep -oE '^[0-9]+' || echo 0)
if [ "${ACTIVE:-0}" -gt 0 ]; then
  echo "SKIP: $ACTIVE active call(s); retrying on the next run"
  exit 0
fi

echo "updating ${LOCAL:0:7} -> ${REMOTE:0:7}"
git log --oneline "$LOCAL..$REMOTE" | sed 's/^/    /'

CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
git merge --ff-only "origin/$BRANCH" || { echo "FATAL: fast-forward failed"; exit 1; }

# --- rebuild only what changed ------------------------------------------
SERVICES=""
echo "$CHANGED" | grep -q '^ivr-node/'        && SERVICES="$SERVICES ivr-node"
echo "$CHANGED" | grep -q '^platform-api/'    && SERVICES="$SERVICES platform-api"
echo "$CHANGED" | grep -q '^admin-portal-v2/' && SERVICES="$SERVICES admin-portal-v2"
echo "$CHANGED" | grep -q '^balance-api/'     && SERVICES="$SERVICES balance-api"
# Asterisk is left alone on purpose: rebuilding it drops SIP registration,
# so trunk/dialplan changes stay a deliberate manual step.
if echo "$CHANGED" | grep -q '^asterisk/'; then
  echo "NOTE: asterisk/ changed — review and restart it by hand:"
  echo "$CHANGED" | grep '^asterisk/' | sed 's/^/    /'
fi

if [ -z "$SERVICES" ]; then
  echo "no service code changed; repo updated only"
  echo "=== $(date -Is) auto-update end ==="
  exit 0
fi

echo "rebuilding:$SERVICES"
if ! docker compose -p "$PROJECT" build $SERVICES; then
  echo "FATAL: build failed; rolling back to ${LOCAL:0:7}"
  git reset --hard "$LOCAL"
  exit 1
fi

docker compose -p "$PROJECT" up -d $SERVICES

# --- verify, and roll back if the engine will not start ------------------
sleep 10
if ! docker logs ivr-node --tail 40 2>&1 | grep -q "Dynamic IVR Engine started"; then
  echo "FATAL: ivr-node did not report ready; rolling back to ${LOCAL:0:7}"
  docker logs ivr-node --tail 20 2>&1 | sed 's/^/    /'
  git reset --hard "$LOCAL"
  docker compose -p "$PROJECT" build $SERVICES && docker compose -p "$PROJECT" up -d $SERVICES
  exit 1
fi

echo "OK: now at $(git rev-parse --short HEAD); rebuilt:$SERVICES"
echo "=== $(date -Is) auto-update end ==="
