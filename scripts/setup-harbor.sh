#!/bin/bash
# =============================================================================
# Install and configure Harbor registry on a Linux machine.
#
# Prerequisites:
#   - Ubuntu/Debian or RHEL/CentOS with root/sudo
#   - Docker Engine 24+ and Docker Compose v2
#   - Ports 80 and 443 available
#   - At least 4GB RAM, 40GB disk
#
# Usage:
#   chmod +x scripts/setup-harbor.sh
#   sudo ./scripts/setup-harbor.sh                           # HTTP only (local/lab)
#   sudo ./scripts/setup-harbor.sh --domain harbor.example.com  # HTTPS with Let's Encrypt
# =============================================================================
set -euo pipefail

HARBOR_VERSION="v2.11.2"
INSTALL_DIR="/opt/harbor"
DATA_DIR="/data/harbor"
HARBOR_ADMIN_PASSWORD="Harbor12345"
DOMAIN=""
USE_HTTPS=false

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) DOMAIN="$2"; USE_HTTPS=true; shift 2 ;;
    --password) HARBOR_ADMIN_PASSWORD="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Detect host IP if no domain ─────────────────────────────────────────────
if [ -z "$DOMAIN" ]; then
  HOST_IP=$(hostname -I | awk '{print $1}')
  HOSTNAME_VAL="$HOST_IP"
  echo "No --domain specified. Harbor will be available at http://${HOST_IP}"
else
  HOSTNAME_VAL="$DOMAIN"
  echo "Harbor will be available at https://${DOMAIN}"
fi

# ── Check prerequisites ─────────────────────────────────────────────────────
echo ""
echo "=== Checking prerequisites ==="

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is not installed. Install it first:"
  echo "  curl -fsSL https://get.docker.com | sh"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "ERROR: Docker Compose v2 is not available."
  exit 1
fi

echo "Docker: $(docker --version)"
echo "Compose: $(docker compose version)"

# ── Download Harbor installer ────────────────────────────────────────────────
echo ""
echo "=== Downloading Harbor ${HARBOR_VERSION} ==="

cd /tmp
INSTALLER="harbor-offline-installer-${HARBOR_VERSION}.tgz"
if [ ! -f "$INSTALLER" ]; then
  curl -fSL "https://github.com/goharbor/harbor/releases/download/${HARBOR_VERSION}/${INSTALLER}" -o "$INSTALLER"
fi

echo "Extracting..."
tar xzf "$INSTALLER"

# ── Move to install dir ─────────────────────────────────────────────────────
echo ""
echo "=== Installing to ${INSTALL_DIR} ==="

rm -rf "$INSTALL_DIR"
mv /tmp/harbor "$INSTALL_DIR"
mkdir -p "$DATA_DIR"

# ── Configure harbor.yml ────────────────────────────────────────────────────
echo ""
echo "=== Configuring Harbor ==="

cd "$INSTALL_DIR"
cp harbor.yml.tmpl harbor.yml

# Set hostname
sed -i "s|^hostname:.*|hostname: ${HOSTNAME_VAL}|" harbor.yml

# Set admin password
sed -i "s|^harbor_admin_password:.*|harbor_admin_password: ${HARBOR_ADMIN_PASSWORD}|" harbor.yml

# Set data volume
sed -i "s|^data_volume:.*|data_volume: ${DATA_DIR}|" harbor.yml

# Handle HTTP vs HTTPS
if [ "$USE_HTTPS" = false ]; then
  # Comment out the entire https block
  sed -i '/^https:/,/^[^ ]/{/^https:/s/^/#/; /^  /s/^/#/}' harbor.yml
  # Adjust the regex to properly comment out https section
  python3 -c "
import re
with open('harbor.yml', 'r') as f:
    content = f.read()
# Comment out https block
content = re.sub(
    r'^(https:.*?)(?=\n[a-z]|\nexternal_url|\n#)',
    lambda m: '\n'.join('# ' + l if l.strip() else l for l in m.group(1).split('\n')),
    content,
    flags=re.MULTILINE | re.DOTALL
)
with open('harbor.yml', 'w') as f:
    f.write(content)
" 2>/dev/null || {
    # Fallback: simple sed approach
    sed -i 's/^https:$/# https:/' harbor.yml
    sed -i '/^# https:$/,/^[a-z]/{s/^  /# &/}' harbor.yml
  }
  echo "Configured for HTTP (port 80)"
else
  # Install certbot and get certificate
  echo "Setting up HTTPS with Let's Encrypt for ${DOMAIN}..."
  if ! command -v certbot &>/dev/null; then
    apt-get update && apt-get install -y certbot
  fi
  certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email

  CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
  sed -i "s|certificate:.*|certificate: ${CERT_DIR}/fullchain.pem|" harbor.yml
  sed -i "s|private_key:.*|private_key: ${CERT_DIR}/privkey.pem|" harbor.yml
  echo "Configured for HTTPS with Let's Encrypt"
fi

# ── Run the installer ───────────────────────────────────────────────────────
echo ""
echo "=== Running Harbor installer ==="

./install.sh

# ── Print summary ───────────────────────────────────────────────────────────
echo ""
echo "==========================================="
echo " Harbor is running!"
echo "==========================================="
echo ""
if [ "$USE_HTTPS" = true ]; then
  echo "  URL:      https://${HOSTNAME_VAL}"
else
  echo "  URL:      http://${HOSTNAME_VAL}"
fi
echo "  Username: admin"
echo "  Password: ${HARBOR_ADMIN_PASSWORD}"
echo ""
echo "=== Next steps ==="
echo ""
echo "1. Log in to the Harbor web UI and create a project (e.g. 'ivr-lab')"
echo ""
if [ "$USE_HTTPS" = false ]; then
  echo "2. On EVERY machine that pushes/pulls, add Harbor as an insecure registry:"
  echo "   Edit /etc/docker/daemon.json:"
  echo '   { "insecure-registries": ["'${HOSTNAME_VAL}'"] }'
  echo "   Then: sudo systemctl restart docker"
  echo ""
  echo "3. Login and push:"
  echo "   docker login ${HOSTNAME_VAL}"
  echo "   ./scripts/build-push-images.sh ${HOSTNAME_VAL}/ivr-lab latest"
else
  echo "2. Login and push:"
  echo "   docker login ${HOSTNAME_VAL}"
  echo "   ./scripts/build-push-images.sh ${HOSTNAME_VAL}/ivr-lab latest"
fi
echo ""
echo "4. On client machines, set in .env:"
echo "   REGISTRY=${HOSTNAME_VAL}/ivr-lab"
echo "   Then: docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d"
