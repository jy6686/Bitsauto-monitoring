---
name: Voice OTP AMI dial format
description: Critical env vars and dial format for Asterisk AMI Voice OTP calls via Sippy
---

## The working configuration

**Env vars (shared):**
- `ASTERISK_CHAN_TECH=DIRECT_SIP` — bypasses FreePBX trunk entirely (chan_sip has no configured outbound trunk)
- `SIPPY_SIP_IP=191.101.30.107` — Sippy's SIP server IP
- `SIPPY_CLI=2221192` — CLI (From: number) matching Sippy IP auth rule
- `SIPPY_TECH_PREFIX=22211` — prepended to destination number (4-digit prefix `2221` + `1`)

**Resulting channel string:**
`SIP/22211923219286686@191.101.30.107`
(i.e. `SIP/{SIPPY_TECH_PREFIX}{rawNumber}@{SIPPY_SIP_IP}`)

**Sippy dial pattern:** `2221` (4-digit prefix) + `1` + CC + national number
- Pakistan (92): `923219286686` → `22211923219286686`

**IP auth rule in Sippy:** `159.223.32.59/2221192/Any`
- 159.223.32.59 = Asterisk server's SIP source IP (same as AMI host)
- 2221192 = account/pattern identifier

## Why DIRECT_SIP (not SIP/peer/number)
- chan_sip runs on **port 5160** (not 5060); PJSIP runs on 5060
- FreePBX `sippy` peer had `host=(Unspecified)` — no outbound IP configured
- Apply Config in FreePBX wiped the peer entirely (0 sip peers after)
- `SIP/number@host` creates a temporary anonymous channel — no peer config needed

## Diagnosis breadcrumbs (non-obvious)
- `Reason=0` in ~200ms = local peer not found (no channel created)
- `Reason=0` in ~450ms = Sippy rejecting (403 or 404) — network exchange happening
- `Reason=5 + Cause=19` (User alerting, no answer) = call REACHING destination — correct format
- First `Newchannel` event = success signal that SIP reached Sippy

**Why:** The key fix was the tech prefix. Without `22211`, Sippy had no route for the bare number. With it, the call routes through Sippy to the carrier and the phone rings.

**How to apply:** Any future Voice OTP work must keep `SIPPY_TECH_PREFIX` set. If the Sippy trunk changes its dial plan prefix, update this env var (do not hardcode).
