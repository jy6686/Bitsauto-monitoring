---
name: AMI Bridge CallerIDNum field semantics + routing prefix
description: Complete picture of callee/caller field semantics in governed_calls, including product prefix on CLI and routing prefix on CLD.
---

## Field Mapping in governed_calls (CONFIRMED)
| DB column | Source AMI field | Contains | Example |
|---|---|---|---|
| `callee` | `callerIdNum1` (SIP/sippy B-leg) | CLD with routing prefix | `2060923...` (Pak), `2060291...` (Eritrea) |
| `caller` | `callerIdNum2` (PJSIP A-leg) | CLI — originating ANI with product prefix | `14085385023` (product-1 + CLI) |

## Routing Prefix on CLD
Platform routing prefix = `"2060"` (4 digits), prepended to actual E.164 destination.
- `2060923072431474` → strip `2060` → `923072431474` → Pakistan (+92) ✅
- `20602917848929` → strip `2060` → `2917848929` → Eritrea (+291) ✅
- Strip condition: `startsWith('2060') AND length >= 14` (applied in both `pickBestRule` and `resolveDestination`)

## Product Trunk Prefix on CLI
Sippy prepends trunk prefix (FC=1, BC=2, SB=6, SC=7) to outgoing CLI.
This makes CLIs LOOK like country prefixes:
- Product-1 + `4085385023` = `14085385023` → looks like NANP (+1) ← NOT a destination
- Product-2 + `49...` = `249...` → looks like Sudan (+249) ← NOT a destination
- Product-6 + `5...` = `65...` → looks like Singapore (+65) ← NOT a destination

## What the DB holds (all-time, after full remediation)
- Clean reconcile-path records: callee = `923...` (Pakistan) or `291...` (Eritrea) — correctly set by `legA.connectedLineNum`
- Bridge-event records: callee = `2060923...` or `2060291...` — routing prefix stripped by LPM/pickBestRule

## Correct destinations (confirmed from BitsEye + Sippy live data)
Only Pakistan (+92) and Eritrea (+291) are governed. Any callee resolving to another country is a product-prefixed CLI stored in the wrong field.

## DB Remediation Performed (total: 8,976 records fixed across all history)
- Swapped callee ↔ caller WHERE rule_id=1 AND caller LIKE '2060%' AND len≥14
- Excluded reconcile-corrected records (callee LIKE '92%' or '291%') = 1,939 protected
- Condition must be applied again if data is ever reimported

## WARNING
Never swap callerIdNum1/callerIdNum2 based on A/B channel logic. The Sippy-specific routing
means callerIdNum1 (B-leg) always carries the destination, callerIdNum2 (A-leg) carries the CLI.
