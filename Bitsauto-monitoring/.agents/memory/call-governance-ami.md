---
name: Call Governance AMI architecture
description: Persistent AMI listener for vendor-leg time-cap + 120s replay; key design decisions and Asterisk-side requirements.
---

## Rule
Call Governance uses a **persistent** AMI socket (not short-lived like Voice OTP originate). `amiGovernance` singleton at `server/services/asterisk/ami-governance.ts` auto-reconnects every 15s, emits `bridge` and `hangup` events consumed by `server/routes-call-governance.ts`.

## DB tables (3)
- `call_governance_rules` — one row per Sippy connection; stores cap_sec, jitter_sec, channel_pattern (regex), enabled flag.
- `governed_calls` — one row per governed call instance; tracks channelA (customer), channelB (vendor), timers, status.
- `call_governance_log` — audit log of every governance action.

## Channel identification
- `channelPattern` regex is matched against Asterisk channel name.
- Channel matching the pattern = **vendor/B-leg** (to cut).
- Other channel = **customer/A-leg** (kept alive for playback).
- Pattern example: `SIP/sippy-vendor|PJSIP/trunk-ptcl`

## Timer flow
1. Bridge event received → match rule → create `governed_calls` row → `setTimeout(capSec + jitter, ...)`.
2. At timer expiry → `AMI Hangup` on channelB → `AMI Setvar + Redirect` on channelA to `gov-playback` context.
3. Hangup event before timer → cancel timer, mark `completed`.

## Asterisk dialplan requirements (operator-side)
- `[sippy-media-anchor]` context: B2BUA entry for Sippy-routed calls, MixMonitor recording to `/var/spool/asterisk/monitor/`.
- `[gov-playback]` context: reads `GOV_PLAYBACK_FILE` channel variable, plays back 120s recording to A-leg.

## Separation from existing /call-recordings
- `/call-recordings` = Sippy recording-server proxy (external URL, CDR-based).
- `/call-governance` = Asterisk MixMonitor recordings, governance-engine-managed.
- **Never merge these two.** Different data sources, different purposes.

## Why
Jitter (random 0–N seconds added to cap) prevents vendors from detecting an exact 120s pattern and pre-cutting calls themselves to avoid billing capture. Default cap=120s, jitter=15s gives 120–135s effective cap.
