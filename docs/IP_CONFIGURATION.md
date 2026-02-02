# IP Address Configuration Guide

This document lists all locations where the external IP address needs to be updated when your network changes.

## Quick Update

Use the automated script in the project root:

```bash
# Auto-detect current IP
node update-ip.js

# Set a specific IP
node update-ip.js 192.168.1.100
```

## Configuration Locations

### 1. Asterisk PJSIP Configuration
**File:** `asterisk/pjsip.conf`

```ini
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_media_address=YOUR_IP_HERE
external_signaling_address=YOUR_IP_HERE
```

**Why:** These settings tell Asterisk to advertise this IP in SIP/SDP messages, allowing external phones to reach the RTP streams.

---

### 2. SBC/RTPEngine Configuration
**File:** `sbc/docker-compose.yml`

```yaml
command: >
  rtpengine
  --interface=internal/eth0
  --interface=external/eth0
  --external-ip=YOUR_IP_HERE
  ...
```

**Why:** RTPEngine needs to know the external IP to properly NAT traverse RTP packets.

---

### 3. Environment Variables
**Files:** `.env` and `.env.example`

```env
EXTERNAL_IP=YOUR_IP_HERE
```

**Why:** Used by various scripts and can be referenced in docker-compose files.

---

### 4. Database - SIP Trunks
**Table:** `sip_trunks` in SQLite database

The `host` field in each SIP trunk record must match the Asterisk server IP for internal trunks.

**Update via:**
- Admin Portal → SIP Trunks → Edit
- API: `PUT /api/trunks/:id` with `{"host": "YOUR_IP_HERE"}`
- Script: `node update-ip.js` (auto-updates via API)

---

### 5. Setup Scripts
**File:** `platform-api/src/scripts/setup-survey.js`

```javascript
await upsertTrunk('Internal Asterisk', 'YOUR_IP_HERE', 5060, ...)
```

**Why:** When re-running setup, it will create/update the default SIP trunk with this IP.

---

## When to Update

You need to update the IP address when:

1. **Network changes** - Your router assigns a different DHCP address
2. **Moving to production** - Deploying to a server with a static IP
3. **VPN connection** - Network interface changes
4. **After restart** - If your DHCP lease expires

## Verification Steps

After updating, verify the configuration:

### 1. Check Asterisk
```bash
docker compose exec asterisk asterisk -rx "pjsip show transport transport-udp"
```
Should show the new external addresses.

### 2. Check SIP Trunk in Database
```bash
curl -s http://localhost:3001/api/trunks -H "Authorization: Bearer TOKEN" | jq
```
Verify the `host` field matches your IP.

### 3. Test SIP Registration
Configure your softphone to connect to `YOUR_IP:5060` and verify registration.

### 4. Test a Call
Make a test call to verify audio (RTP) works correctly.

## Troubleshooting

### One-Way Audio
- **Cause:** External IP not set correctly in pjsip.conf
- **Fix:** Ensure `external_media_address` matches your LAN IP

### Registration Fails
- **Cause:** Firewall blocking port 5060
- **Fix:** Ensure UDP 5060 and UDP 10000-20000 are open

### Phone Can't Find Server
- **Cause:** IP mismatch between softphone and pjsip.conf
- **Fix:** Run `node update-ip.js` and update softphone settings

## Docker Commands Reference

```bash
# Restart Asterisk after IP change
docker compose restart asterisk

# Rebuild and restart all services
docker compose up -d --build

# Check Asterisk logs
docker compose logs -f asterisk

# Enter Asterisk CLI
docker compose exec asterisk asterisk -rvvv
```

## Related Documentation

- [Asterisk PJSIP NAT](https://wiki.asterisk.org/wiki/display/AST/Configuring+res_pjsip+to+work+through+NAT)
- [RTPEngine Configuration](https://github.com/sipwise/rtpengine#command-line-options)
