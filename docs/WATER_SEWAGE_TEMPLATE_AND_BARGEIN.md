# Water/Sewage Template + Barge-In Notes

This document captures the tested behavior for the Water and Sewage IVR (`extension 2009`) and how to reproduce it from the template on another machine.

## 1) Template/Flow Parity

The source template script is:

- `platform-api/src/db/seed-new-sounds-2-template.js`

The live tested flow is:

- `ivr_flows.extension = 2009`

Parity can be checked with:

```bash
docker compose exec platform-api npm run verify:new-sounds-2-parity
```

If parity fails, re-seed the template:

```bash
docker compose exec platform-api npm run seed:new-sounds-2
```

## 2) Recreate on Another Machine

1. Start the stack and initialize DB.
2. Seed base data (`migrate`, `seed`).
3. Seed the Water/Sewage template:

```bash
docker compose exec platform-api npm run seed:new-sounds-2
```

4. In Admin Portal (`http://localhost:8082`), create a new IVR from template:
   - Template: `Water and Sewage Complaint`

## 3) Barge-In Behavior (DTMF Interrupt)

Implemented in:

- `ivr-node/dynamic-ivr.js`
- `platform-api/src/routes/ivr.js` (default normalization on create/update/clone)
- `admin-portal-v2/src/components/flow/FlowBuilder.jsx` (new node defaults)

Behavior rules:

1. Global default: `play`, `play_sequence`, `play_digits`, and `collect` are interruptible by default (`bargeIn: true`) unless explicitly disabled with `bargeIn: false`.
2. Digit carry behavior:
   - Next node `branch`: pressed digit is queued and consumed by branch.
   - Next node `collect` with prompt: prompt is interrupted, but digit is not queued.
   - Next node `collect` without prompt: digit is queued into collect.
3. Per-node overrides:
   - `bargeIn: true|false`
   - `queueDtmf: true|false`

## 4) Tested Path

For `2009`, the following were verified:

1. `service_menu` (`play_sequence`) interrupts on digit and routes immediately.
2. `location_1_or_3` (`play`) interrupts on digit and moves to `collect_account`.
