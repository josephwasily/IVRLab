# Softphone Connection Guide

This guide explains how to connect popular softphones to the IVR-Lab SIP trunk for testing.

---

## Quick Reference

| Setting | Value |
|---------|-------|
| **Server/Domain** | `192.168.1.208` (your host's LAN IP) |
| **Port** | `5060` |
| **Transport** | UDP |
| **Username** | `1001` |
| **Password** | `1001pass` |
| **Codec** | G.711 μ-law (PCMU) or Opus |

> **Note:** Replace `192.168.1.208` with your actual host machine's IP address. Run `ipconfig` (Windows) or `ip addr` (Linux) to find it.

---

## Test Extensions

After connecting, dial these extensions to test:

| Extension | Description |
|-----------|-------------|
| **6000** | Legacy Balance IVR |
| **2001** | Dynamic IVR (Balance Inquiry) |
| **2XXX** | Dynamic IVR extensions (configured via Admin Portal) |

---

## Zoiper (Windows, macOS, Linux, iOS, Android)

### Download
- **Desktop:** https://www.zoiper.com/en/voip-softphone/download/current
- **Mobile:** App Store / Google Play

### Configuration Steps

1. **Open Zoiper** and go to **Settings** → **Accounts** → **Add Account**

2. **Select Account Type:**
   - Choose **SIP** account

3. **Enter Credentials:**
   | Field | Value |
   |-------|-------|
   | Account name | `IVR-Lab` |
   | Host | `192.168.1.208` |
   | Username | `1001` |
   | Password | `1001pass` |

4. **Advanced Settings** (Important):
   | Setting | Value |
   |---------|-------|
   | Transport | UDP |
   | Port | 5060 |
   | Use STUN | No |
   | Use rport | Yes |
   | Use outbound proxy | No |

5. **Codec Configuration:**
   - Enable: **PCMU (G.711 μ-law)**, **Opus**
   - Disable: G.729, GSM (to avoid codec negotiation issues)

6. **DTMF Settings:**
   - DTMF Mode: **RFC 2833** (Preferred) or Auto

7. Click **Register** and verify the status shows "Ready" or "Registered"

---

## MicroSIP (Windows)

### Download
- https://www.microsip.org/downloads

### Configuration Steps

1. **Launch MicroSIP** - it will prompt to add an account on first run

2. **Account Settings:**
   | Field | Value |
   |-------|-------|
   | Account Name | `IVR-Lab` |
   | SIP Server | `192.168.1.208` |
   | SIP Proxy | *(leave empty)* |
   | Username | `1001` |
   | Domain | `192.168.1.208` |
   | Password | `1001pass` |

3. **Advanced Settings** (Menu → Account → Edit):
   | Setting | Value |
   |---------|-------|
   | Transport | UDP |
   | Port | 5060 |
   | Registration Refresh | 300 |
   | Publish | Disabled |
   | ICE | Disabled |
   | SRTP | Disabled |

4. **Audio Settings** (Menu → Settings):
   - Preferred codec: **PCMU**
   - Enable: PCMU, Opus
   - Microphone/Speaker: Select your devices

5. The status bar should show a green icon when registered

---

## Linphone (Windows, macOS, Linux, iOS, Android)

### Download
- **Desktop:** https://www.linphone.org/technical-corner/linphone
- **Mobile:** App Store / Google Play

### Configuration Steps

1. **Open Linphone** → **Use SIP Account** → **I have already a SIP Account**

2. **Enter Account Details:**
   | Field | Value |
   |-------|-------|
   | Username | `1001` |
   | SIP Domain | `192.168.1.208` |
   | Password | `1001pass` |
   | Display Name | `IVR Lab User` |
   | Transport | UDP |

3. **Advanced Configuration** (Settings → Account → Edit):
   - **Server address:** `sip:192.168.1.208:5060`
   - **Register:** Enabled
   - **Publish presence:** Disabled
   - **AVPF:** Disabled
   - **Expire:** 300 seconds

4. **Network Settings** (Settings → Network):
   | Setting | Value |
   |---------|-------|
   | STUN server | *(leave empty)* |
   | ICE | Disabled |
   | TURN | Disabled |
   | Media encryption | None |

5. **Audio Codecs** (Settings → Audio):
   - Enable: **PCMU**, **Opus**
   - Disable others for cleaner negotiation

6. Status should show "Connected" or "Registered"

---

## Bria / X-Lite (Windows, macOS, iOS, Android)

### Download
- https://www.counterpath.com/bria-solo/
- X-Lite (free): https://www.counterpath.com/x-lite/

### Configuration Steps

1. **Open Bria/X-Lite** → **Softphone** → **Account Settings**

2. **Add New SIP Account:**
   | Field | Value |
   |-------|-------|
   | Account name | `IVR-Lab` |
   | User ID | `1001` |
   | Domain | `192.168.1.208` |
   | Password | `1001pass` |
   | Authorization name | `1001` |

3. **Server Information:**
   | Setting | Value |
   |---------|-------|
   | Domain/Registrar | `192.168.1.208` |
   | Send outbound via | Domain |
   | Proxy | *(leave empty)* |
   | Register | Always |

4. **Topology:**
   | Setting | Value |
   |---------|-------|
   | FW Traversal | None |
   | Port | 5060 |
   | Transport | UDP |

5. **Voicemail & Presence:**
   - Disable Voicemail MWI
   - Disable Presence

6. **Codecs** (Preferences → Audio Codecs):
   - Prioritize: **G.711 μLaw (PCMU)**
   - Enable: Opus
   - Uncheck: G.729, GSM

7. Account status should show "Available" when registered

---

## 3CXPhone (Windows, macOS, iOS, Android)

### Download
- https://www.3cx.com/phone-system/softphone/

### Configuration Steps

1. **Open 3CXPhone** → **Set Accounts**

2. **Manual Setup** (select "New" or "Manual"):
   | Field | Value |
   |-------|-------|
   | Account name | `IVR-Lab` |
   | Caller ID | `1001` |
   | Extension | `1001` |
   | ID | `1001` |
   | Password | `1001pass` |
   | PBX IP/FQDN | `192.168.1.208` |
   | Port | `5060` |

3. **Advanced Settings:**
   | Setting | Value |
   |---------|-------|
   | Transport | UDP |
   | Use proxy | No |
   | STUN | Disabled |
   | Enable SRTP | No |

4. **Audio Configuration:**
   - Select your audio devices
   - Enable G.711 μ-law codec

5. The softphone should show "On Hook" when ready

---

## Grandstream Wave (iOS, Android)

### Download
- App Store / Google Play: Search "Grandstream Wave"

### Configuration Steps

1. **Open Wave** → **Settings** (gear icon) → **Account Settings**

2. **Add New Account:**
   | Field | Value |
   |-------|-------|
   | Account Active | Yes |
   | Account Name | `IVR-Lab` |
   | SIP Server | `192.168.1.208` |
   | SIP User ID | `1001` |
   | Authenticate ID | `1001` |
   | Authenticate Password | `1001pass` |

3. **SIP Settings:**
   | Setting | Value |
   |---------|-------|
   | Outbound Proxy | *(leave empty)* |
   | SIP Transport | UDP |
   | SIP Port | 5060 |
   | NAT Traversal | No |
   | Use SIP Proxy | No |

4. **Audio Settings:**
   | Setting | Value |
   |---------|-------|
   | Preferred Vocoder | PCMU |
   | DTMF Mode | RFC2833 |

5. The status indicator should turn green when registered

---

## Telephone (macOS)

### Download
- https://www.64characters.com/telephone/

### Configuration Steps

1. **Open Telephone** → **Preferences** → **Accounts**

2. **Click "+" to add account:**
   | Field | Value |
   |-------|-------|
   | Domain | `192.168.1.208` |
   | User Name | `1001` |
   | Password | `1001pass` |

3. **Advanced Settings:**
   - Registration: On
   - Reregister every: 300 seconds
   - Use proxy: No
   - Transport: UDP

4. The app will show your extension when registered

---

## Troubleshooting

### Registration Failed / 403 Forbidden

**Causes:**
- Wrong username or password
- Firewall blocking port 5060
- Wrong server IP address

**Solutions:**
1. Double-check credentials: `1001` / `1001pass`
2. Verify server IP with `ipconfig` / `ip addr`
3. Add firewall exception for UDP 5060:
   ```powershell
   New-NetFirewallRule -DisplayName "Asterisk SIP" -Direction Inbound -Protocol UDP -LocalPort 5060 -Action Allow
   ```

### Request Timeout / Cannot Register

**Causes:**
- Docker not running
- Asterisk container not started
- Network connectivity issues

**Solutions:**
1. Start the services:
   ```bash
   docker compose up -d
   ```
2. Check container status:
   ```bash
   docker ps
   ```
3. Verify Asterisk is listening:
   ```bash
   docker compose exec asterisk asterisk -rx "pjsip show endpoints"
   ```

### No Audio / One-Way Audio

**Causes:**
- NAT traversal issues
- Wrong external IP configured
- RTP ports blocked

**Solutions:**
1. Update external IP in `asterisk/pjsip.conf`:
   ```ini
   external_media_address=YOUR_ACTUAL_IP
   external_signaling_address=YOUR_ACTUAL_IP
   ```
2. Or use the update script:
   ```bash
   node update-ip.js
   ```
3. Disable STUN/ICE in your softphone
4. Ensure the softphone settings include:
   - Use rport: Yes
   - NAT Traversal: Disabled (let Asterisk handle it)

### DTMF Not Working (IVR doesn't respond to keypresses)

**Causes:**
- Wrong DTMF mode
- Codec issues

**Solutions:**
1. Set DTMF mode to **RFC 2833** or **RFC 4733** in softphone
2. Avoid using INFO or SIP INFO for DTMF
3. Use G.711 μ-law (PCMU) codec

### Call Drops After 32 Seconds

This issue has been fixed in the Asterisk configuration. If you still experience it:

1. Verify `timers=no` in `asterisk/pjsip.conf` under the endpoint template
2. Reload the configuration:
   ```bash
   docker compose exec asterisk asterisk -rx "module reload res_pjsip.so"
   ```

---

## Adding More Users

To add additional softphone users (e.g., user `1002`), add to `asterisk/pjsip.conf`:

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

Then reload:
```bash
docker compose exec asterisk asterisk -rx "module reload res_pjsip.so"
```

---

## Network Ports Reference

| Port | Protocol | Purpose |
|------|----------|---------|
| 5060 | UDP | SIP Signaling |
| 10000-20000 | UDP | RTP Media (audio) |

Ensure these ports are open in your firewall for full functionality.

---

## See Also

- [SOFTPHONE_SETUP.md](SOFTPHONE_SETUP.md) - Detailed troubleshooting and configuration
- [IP_CONFIGURATION.md](IP_CONFIGURATION.md) - How to update IP addresses when network changes
