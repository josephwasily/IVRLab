#!/bin/bash
# =============================================================================
# Build and push all IVR-Lab images to a container registry.
#
# Usage:
#   ./scripts/build-push-images.sh                          # defaults to ghcr.io/your-org, tag=latest
#   ./scripts/build-push-images.sh myregistry.azurecr.io    # custom registry
#   ./scripts/build-push-images.sh myregistry.azurecr.io v1.3  # custom registry + tag
#
# For self-hosted registries (Harbor, Nexus, etc.):
#   docker login myregistry.example.com
#   ./scripts/build-push-images.sh myregistry.example.com/ivr-lab v1.3
# =============================================================================
set -euo pipefail

REGISTRY="${1:-ghcr.io/your-org}"
TAG="${2:-latest}"

IMAGES=(
  "ivr-asterisk:./asterisk"
  "ivr-node:./ivr-node"
  "ivr-platform-api:./platform-api"
  "ivr-admin-portal-v2:./admin-portal-v2"
  "ivr-balance-api:./balance-api"
)

echo "=== Building and pushing to ${REGISTRY} with tag ${TAG} ==="

for entry in "${IMAGES[@]}"; do
  NAME="${entry%%:*}"
  CONTEXT="${entry#*:}"
  FULL="${REGISTRY}/${NAME}:${TAG}"

  echo ""
  echo "--- Building ${FULL} from ${CONTEXT} ---"
  docker build -t "$FULL" "$CONTEXT"

  echo "--- Pushing ${FULL} ---"
  docker push "$FULL"
done

echo ""
echo "=== All images pushed to ${REGISTRY} ==="
echo ""
echo "Clients can now run:"
echo "  REGISTRY=${REGISTRY} IMAGE_TAG=${TAG} docker compose -f docker-compose.prod.yml pull"
echo "  REGISTRY=${REGISTRY} IMAGE_TAG=${TAG} docker compose -f docker-compose.prod.yml up -d"
