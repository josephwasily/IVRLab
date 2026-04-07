#!/bin/sh
set -e

PJSIP_CONF="/etc/asterisk/pjsip.conf"
PJSIP_TEMPLATE="/etc/asterisk/pjsip.conf.template"

# In dev mode, pjsip.conf.template is volume-mounted from the host.
# Copy it so we can modify the running copy without touching the source file.
if [ -f "$PJSIP_TEMPLATE" ]; then
  cp "$PJSIP_TEMPLATE" "$PJSIP_CONF"
  echo "[entrypoint] Using mounted pjsip.conf template (dev mode)"
fi

# ── Config from environment ──────────────────────────────────────────────────
SIP_TRUNK_IP="${SIP_TRUNK_IP:-}"
SIP_TRUNK_PORT="${SIP_TRUNK_PORT:-5060}"
EXTERNAL_IP="${EXTERNAL_IP:-}"

# ── Apply external IP ───────────────────────────────────────────────────────
if [ -n "$EXTERNAL_IP" ]; then
  sed -i "s|^external_media_address=.*|external_media_address=${EXTERNAL_IP}|" "$PJSIP_CONF"
  sed -i "s|^external_signaling_address=.*|external_signaling_address=${EXTERNAL_IP}|" "$PJSIP_CONF"
  sed -i "s|^from_domain=.*|from_domain=${EXTERNAL_IP}|" "$PJSIP_CONF"
  echo "[entrypoint] Set external address to ${EXTERNAL_IP}"
fi

# ── Apply SIP trunk IP (backwards compatible default trunk) ─────────────────
if [ -n "$SIP_TRUNK_IP" ]; then
  sed -i "s|^contact=sip:.*|contact=sip:${SIP_TRUNK_IP}:${SIP_TRUNK_PORT}|" "$PJSIP_CONF"
  sed -i "s|^match=.*|match=${SIP_TRUNK_IP}|" "$PJSIP_CONF"
  echo "[entrypoint] Configured default SIP trunk: ${SIP_TRUNK_IP}:${SIP_TRUNK_PORT}"
else
  echo "[entrypoint] WARNING: SIP_TRUNK_IP not set — using default IP in pjsip.conf"
fi

# ── Symlink dynamic trunk config from shared volume ─────────────────────────
# platform-api writes pjsip_trunks.conf to /asterisk-config/
# Asterisk reads it via #tryinclude pjsip_trunks.conf
if [ -d /asterisk-config ]; then
  ln -sf /asterisk-config/pjsip_trunks.conf /etc/asterisk/pjsip_trunks.conf 2>/dev/null || true
  echo "[entrypoint] Linked dynamic trunk config from /asterisk-config/"
fi

# Create CDR CSV directory to prevent log errors
mkdir -p /var/log/asterisk/cdr-csv

# ── Start Asterisk ──────────────────────────────────────────────────────────
exec /usr/sbin/asterisk -fvvv
