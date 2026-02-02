# Softphone Setup Guide (Zoiper)

## Quick Setup

### Connection Settings
- **Server/Domain:** `192.168.1.5` (your host machine's LAN IP)
- **Port:** `5060`
- **Username:** `1001`
- **Password:** `1001pass`
- **Transport:** UDP

### Test Extensions
- **6000** - Legacy Balance IVR
- **2001** - Dynamic IVR (Balance Inquiry)
- **2XXX** - Dynamic IVR extensions (configured via Admin Portal)

---

## Troubleshooting

### 403 Forbidden Error

**Root Cause:** The PJSIP `identify` section was matching the softphone's IP to the wrong endpoint.

When Docker forwards traffic to Asterisk, it appears to come from the Docker gateway IP (e.g., `172.21.0.1`). If the `identify` section includes broad IP ranges like `172.16.0.0/12`, the softphone traffic gets matched to the `anonymous` endpoint instead of going through proper username/password authentication.

**Solution:** Only match specific hostnames (like `kamailio`) in the identify section, NOT broad IP ranges that include Docker gateway IPs:

```ini
; WRONG - This matches Docker gateway and breaks softphone auth
[identify-sbc]
type=identify
endpoint=anonymous
match=172.16.0.0/12    ; <-- This matches 172.21.0.1 (Docker gateway)

; CORRECT - Only match the SBC container hostname
[identify-sbc]
type=identify
endpoint=anonymous
match=kamailio         ; <-- Only matches the Kamailio container
```

### Request Timeout

**Possible Causes:**
1. Windows Firewall blocking UDP 5060
2. Wrong IP address (check with `ipconfig`)
3. Docker not forwarding UDP properly

**Solutions:**
1. Add firewall rule: `New-NetFirewallRule -DisplayName "Asterisk SIP" -Direction Inbound -Protocol UDP -LocalPort 5060 -Action Allow`
2. Verify your IP: `ipconfig | Select-String "IPv4"`
3. Check Docker port mapping: `docker ps`

### No Audio / One-Way Audio

Ensure these settings in `pjsip.conf`:
```ini
direct_media=no
rtp_symmetric=yes
force_rport=yes
```

---

## Configuration Reference

### pjsip.conf Endpoint Template

```ini
[endpoint-defaults](!)
type=endpoint
context=from-internal
disallow=all
allow=ulaw
allow=opus
direct_media=no
dtmf_mode=auto
rtp_symmetric=yes
rewrite_contact=yes
force_rport=yes
rtp_timeout=0
rtp_timeout_hold=0
timers=no              ; Prevents 32-second call timeout
timers_min_se=90
timers_sess_expires=1800
```

### Adding New Softphone Users

1. Add endpoint (inherits from template):
```ini
[1002](endpoint-defaults)
type=endpoint
auth=1002
aors=1002

[1002]
type=auth
auth_type=userpass
username=1002
password=1002pass

[1002]
type=aor
max_contacts=1
qualify_frequency=30
qualify_timeout=10
```

2. Reload PJSIP:
```bash
docker exec asterisk asterisk -rx "module reload res_pjsip.so"
```

---

## Key Lessons Learned

1. **Docker Gateway IP Matching:** Traffic from the host through Docker appears as `172.x.x.x` (Docker gateway). Don't include these ranges in `identify` sections meant for SBC traffic only.

2. **Session Timers:** Set `timers=no` to prevent calls from being dropped after 32 seconds.

3. **DTMF Mode:** Use `dtmf_mode=auto` for best compatibility with IVR digit collection.

4. **External Address:** Update `external_media_address` and `external_signaling_address` in the transport section when your host IP changes.
