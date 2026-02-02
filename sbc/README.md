Purpose

This folder contains a minimal scaffold and instructions to place a SIP SBC (Kamailio) + RTP proxy (rtpengine) in front of your Asterisk docker service. The SBC will rewrite/correct bad SDP (for example instances where a client advertises 127.0.0.1) or anchor media via rtpengine so media is always reachable.

Files

- `docker-compose.template.yml` – template compose file for Kamailio + rtpengine. Replace image names or versions if needed.
- `kamailio_snippet.cfg` – guidance / example snippet to integrate into your Kamailio `kamailio.cfg` routing logic. This is an integration example; adapt to your Kamailio version.

Notes

- This scaffold intentionally uses placeholders for images/control ports so you can adapt to the rtpengine image you prefer. If you want, I can fully test and pin images and supply a working compose tuned to your environment.

Quick steps (high-level)

1. Start `rtpengine` and `kamailio` (via the compose template).  
2. Point your SIP clients (or DNS / NAT rules) at Kamailio's SIP port instead of Asterisk directly.  
3. Configure Kamailio to proxy INVITEs to Asterisk and to call `rtpengine` to anchor media or rewrite SDP.  
4. Verify with a call: Kamailio should replace any SDP connection address of `127.0.0.1` with the caller source IP (or rtpengine will be used to proxy media).

Verification checklist

- SIP signaling flows correctly through Kamailio to Asterisk (INVITE→200→ACK).  
- INVITE/200 SDPs no longer contain `c=IN IP4 127.0.0.1`.  
- RTP flows between the client IP <-> Asterisk (or rtpengine) rather than 127.0.0.1.

If you'd like, I can turn this template into a tested `docker-compose.yml` with pinned images and a fully working `kamailio.cfg` that integrates `rtpengine` and rewrites 127.0.0.1 SDP automatically. Request that and I'll implement and test it next.

How to run the scaffold locally (assumes your main project compose already created the `ivrnet` network)

1. From the project root run:

```bash
cd sbc
docker compose up -d
```

2. Point a SIP client to your host IP on port `5062` (UDP) instead of Asterisk's `5060`.

3. Place a call to your IVR (e.g. dial 6000) and observe the flows. Kamailio will forward signaling to `asterisk:5060` on the `ivrnet` network and `rtpengine` will anchor media.

Notes and caveats

- The compose maps Kamailio to host `5062` to avoid colliding with the Asterisk host port `5060`. Change as needed.
- `rtpengine` in this scaffold uses RTP ports `12000-12100`; if you need a different range, update both `rtpengine` and any firewall rules.
- This scaffold is for testing and development; review security and hardening before production use.