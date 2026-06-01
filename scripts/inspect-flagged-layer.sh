#!/usr/bin/env bash
# ============================================================================
#  Inspect a Docker image layer flagged by FortiGuard (or any AV)
#
#  Pulls the image, finds the layer matching the given blob sha256,
#  extracts it, lists every executable inside, and tries to scan with
#  clamav / trivy if available.
#
#  Usage (run in WSL Ubuntu or any Linux with docker):
#    ./inspect-flagged-layer.sh <image-ref> <blob-sha256>
#
#  Example:
#    ./inspect-flagged-layer.sh \
#      185.163.125.167:8888/ivr-lab/ivr-balance-api:latest \
#      579a84b28b0991d90d490a5151066e71c1e5755036b8fa4463aa1b6e3df328bc
# ============================================================================
set -euo pipefail

IMAGE="${1:?usage: $0 <image-ref> <blob-sha256>}"
BLOB="${2:?usage: $0 <image-ref> <blob-sha256>}"

# strip any "sha256:" prefix
BLOB="${BLOB#sha256:}"

WORK="$(mktemp -d -t inspect-XXXXXX)"
trap "rm -rf '$WORK'" EXIT

echo "==> Workdir: $WORK"

# ---- 1. pull image -------------------------------------------------------
echo "==> Pulling $IMAGE"
docker pull "$IMAGE" >/dev/null

# ---- 2. save image to tarball --------------------------------------------
echo "==> Saving image to tarball"
docker save "$IMAGE" -o "$WORK/image.tar"

# ---- 3. extract the image tar so we can poke at individual layers --------
mkdir "$WORK/image" "$WORK/layer"
tar -xf "$WORK/image.tar" -C "$WORK/image"

# ---- 4. find the layer file matching the blob ---------------------------
# Docker save layout (OCI-ish): blobs/sha256/<digest> for each layer.
# Older saves: <layer-id>/layer.tar. Handle both.
LAYER_TAR=""
if [ -f "$WORK/image/blobs/sha256/$BLOB" ]; then
    LAYER_TAR="$WORK/image/blobs/sha256/$BLOB"
    echo "==> Matched blob (OCI layout): $LAYER_TAR"
else
    # Legacy layout: each layer is a dir; the dir name may be the digest
    LEGACY_DIR=$(find "$WORK/image" -maxdepth 1 -type d -name "${BLOB}*" 2>/dev/null | head -1)
    if [ -n "$LEGACY_DIR" ] && [ -f "$LEGACY_DIR/layer.tar" ]; then
        LAYER_TAR="$LEGACY_DIR/layer.tar"
        echo "==> Matched layer (legacy layout): $LAYER_TAR"
    else
        echo "!! Blob $BLOB not found directly. Listing all layer blobs by size:"
        find "$WORK/image" -path '*blobs/sha256/*' -type f -exec ls -lhS {} +  | head -20
        echo ""
        echo "!! Tip: the FortiGuard URL shows the *compressed* blob digest."
        echo "!! The matching file above should have the same sha256."
        echo "!! Computing sha256 of each blob to find a match..."
        find "$WORK/image" -path '*blobs/sha256/*' -type f | while read -r f; do
            actual=$(sha256sum "$f" | cut -d' ' -f1)
            if [ "$actual" = "$BLOB" ]; then
                echo "MATCH: $f"
                echo "$f" > "$WORK/.match"
            fi
        done
        [ -f "$WORK/.match" ] && LAYER_TAR=$(cat "$WORK/.match")
    fi
fi

if [ -z "$LAYER_TAR" ] || [ ! -f "$LAYER_TAR" ]; then
    echo ""
    echo "!! Could not locate the exact blob. Showing the manifest so you can map it:"
    docker manifest inspect "$IMAGE" 2>/dev/null || \
        cat "$WORK/image/manifest.json" 2>/dev/null
    exit 1
fi

# ---- 5. cross-reference layer to Dockerfile instruction -----------------
echo ""
echo "==> docker history (which Dockerfile step produced this layer):"
docker history --no-trunc --format 'table {{.ID}}\t{{.Size}}\t{{.CreatedBy}}' "$IMAGE" \
    | head -30
echo ""
echo "(Layer order in 'docker history' is REVERSE of layer index in manifest.json.)"

# ---- 6. extract the offending layer --------------------------------------
echo ""
echo "==> Extracting layer contents to $WORK/layer"
tar -xf "$LAYER_TAR" -C "$WORK/layer" 2>/dev/null || true

# ---- 7. summarize what's inside ------------------------------------------
echo ""
echo "==> Top 30 largest files in the layer:"
find "$WORK/layer" -type f -exec ls -lS {} + 2>/dev/null | head -30

echo ""
echo "==> All ELF executables in the layer (most-likely AV trigger):"
find "$WORK/layer" -type f -exec file {} \; 2>/dev/null \
    | grep -E 'ELF|executable|shared object' \
    | head -50

echo ""
echo "==> All .node native modules (Node.js compiled addons):"
find "$WORK/layer" -name '*.node' -type f -exec ls -lh {} \;

echo ""
echo "==> Any postinstall/prebuild artefacts (where a package may have fetched binaries):"
find "$WORK/layer" -path '*/node_modules/*' -name 'package.json' -exec grep -l -E '"(post|pre)install"|"install":' {} \; 2>/dev/null | head -20

# ---- 8. try a second-opinion AV scan if available -----------------------
echo ""
if command -v clamscan >/dev/null 2>&1; then
    echo "==> Running clamscan on the extracted layer (this can take a minute)..."
    clamscan -r --no-summary "$WORK/layer" | grep -v ': OK$' || true
else
    echo "==> clamscan not installed. To install:  sudo apt-get install -y clamav && sudo freshclam"
fi

if command -v trivy >/dev/null 2>&1; then
    echo ""
    echo "==> Running trivy on the full image..."
    trivy image --severity HIGH,CRITICAL --no-progress "$IMAGE" | head -60
else
    echo ""
    echo "==> trivy not installed. To install:"
    echo "    sudo apt-get install -y wget apt-transport-https gnupg lsb-release"
    echo "    wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -"
    echo "    echo deb https://aquasecurity.github.io/trivy-repo/deb \$(lsb_release -sc) main | sudo tee /etc/apt/sources.list.d/trivy.list"
    echo "    sudo apt-get update && sudo apt-get install -y trivy"
fi

echo ""
echo "==> Layer contents preserved at: $WORK/layer"
echo "    (Workdir will be cleaned up on exit. Copy out before script ends if needed.)"
