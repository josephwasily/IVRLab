#!/bin/bash
# =============================================================================
# Build and push all IVR-Lab images to a container registry.
#
# Usage:
#   ./scripts/build-push-images.sh                                    # defaults, tag=latest
#   ./scripts/build-push-images.sh 185.163.125.167:8888/ivr-lab       # custom registry
#   ./scripts/build-push-images.sh 185.163.125.167:8888/ivr-lab v1.3  # custom registry + tag
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REGISTRY="${1:-185.163.125.167:8888/ivr-lab}"
TAG="${2:-latest}"

echo "=== Building and pushing to ${REGISTRY} with tag ${TAG} ==="

# ── Build prompts image ─────────────────────────────────────────────────────
# Prompts image needs a staging directory because "new sounds *" folders have
# spaces in their names which Dockerfile COPY cannot handle.
echo ""
echo "--- Building prompts image ---"
PROMPTS_BUILD=$(mktemp -d)
trap "rm -rf $PROMPTS_BUILD" EXIT

cp -a "$REPO_ROOT/prompts/"* "$PROMPTS_BUILD/" 2>/dev/null || true
rm -f "$PROMPTS_BUILD/Dockerfile"

for DIR in "new sounds" "new sounds 2" "new sounds 3"; do
  if [ -d "$REPO_ROOT/$DIR" ]; then
    DEST="$PROMPTS_BUILD/$(echo "$DIR" | tr ' ' '-')"
    mkdir -p "$DEST"
    cp -a "$REPO_ROOT/$DIR/"* "$DEST/"
  fi
done

cat > "$PROMPTS_BUILD/Dockerfile" << 'DEOF'
FROM alpine:3.20
COPY . /data/
RUN rm -f /data/Dockerfile
COPY init.sh /init.sh
RUN chmod +x /init.sh
CMD ["/init.sh"]
DEOF

cat > "$PROMPTS_BUILD/init.sh" << 'IEOF'
#!/bin/sh
set -e
mkdir -p /out/custom /out/ar
cd /data
find . -maxdepth 1 ! -name ar ! -name . -exec cp -a {} /out/custom/ \;
cp -a /data/ar/. /out/ar/ 2>/dev/null || true
echo '[prompts-init] Done'
IEOF

FULL="${REGISTRY}/ivr-prompts:${TAG}"
docker build -t "$FULL" "$PROMPTS_BUILD"
docker push "$FULL"

# ── Build remaining images ──────────────────────────────────────────────────
IMAGES=(
  "ivr-asterisk:./asterisk"
  "ivr-node:./ivr-node"
  "ivr-platform-api:./platform-api"
  "ivr-admin-portal-v2:./admin-portal-v2"
  "ivr-balance-api:./balance-api"
)

for entry in "${IMAGES[@]}"; do
  NAME="${entry%%:*}"
  CONTEXT="${entry#*:}"
  FULL="${REGISTRY}/${NAME}:${TAG}"

  echo ""
  echo "--- Building ${FULL} from ${CONTEXT} ---"
  docker build -t "$FULL" "$REPO_ROOT/$CONTEXT"

  echo "--- Pushing ${FULL} ---"
  docker push "$FULL"
done

echo ""
echo "=== All images pushed to ${REGISTRY} ==="
echo ""
echo "On client servers, run:"
echo "  docker compose pull && docker compose up -d"
