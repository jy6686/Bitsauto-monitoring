---
name: Trust Center build sequencing decision
description: When to build Trust Center, what to build first, and the configuration_inventory design change over tc_baselines.
---

# Trust Center — Roadmap Decision (LOCKED)

## Build Order

**Do NOT start Trust Center UI** until these three are complete and stable:
1. Priority 0.2 — P&L Extraction (vendor cost from Sippy profit_loss_report.php)
2. Priority 0.3 — Billing Verification
3. Priority 0.5 — Governance Validation (run cleanly for 5–7 days)

**Why:** Financial truth (revenue/cost/margin accuracy) outranks governance automation. Trust Center is a governance layer — billing verification is a financial truth layer. Always finish financial truth first.

## What IS allowed before Trust Center UI

Backend-only prerequisites, no UI, no drift detection engine:
- `configuration_inventory` table (see below) — auth rules with managed_by + last_change_source
- `managed_by` and `last_change_source` ownership fields on auth rule rows

This is inventory-only. It supports future Trust Center without distracting from billing work.

## Trust Center Phase 1 (after Governance Validation passes)

Build exactly as designed — 8 tabs:
Overview · Protected Environments · Authentication Protection · Drift Detection · Incidents · Alert Policies · Emergency Overrides · Audit Trail

**Phase 1 ships Monitor-Only:**
- No deletion
- No enforcement
- No alerts
- No WhatsApp
- No voice calls
- Just visibility

Run Monitor-Only for 2–4 weeks to validate before Phase 2 (alerts) or Phase 3 (enforcement).

## Critical Design Change: configuration_inventory NOT tc_baselines

**Do NOT create `tc_baselines` as a one-time frozen snapshot.**

Create `configuration_inventory` instead — a continuously updated table.

| Frozen snapshot | Continuously updated inventory |
|---|---|
| Useful once | Useful forever |
| Can't answer "what changed last month?" | Full history available |
| Stale after first change | Always current |

Think **"Git for Telecom Configurations"** — every state change is recorded, not just the initial baseline.

Columns: environment, account, ip, cld_rule, routing_group, cps, managed_by, last_change_source, last_seen, created_at, updated_at

## Phase 1 Success Definition

NOT "auto-delete unauthorized IP."

SUCCESS = BitsAuto knows every auth rule, knows where it came from, knows when it changed, can explain the difference.

## Phase Sequence After Trust Center Phase 1

- Phase 2: Email + WhatsApp alerts, automatic incident creation
- Phase 3: Auto-revert, Emergency Override window (30 min, manager-approved)
- Phase 4: Voice escalation (Asterisk AMI, same stack as Voice OTP), Config Governance (Routing Groups, Destination Sets, Vendor Connections, Rate Sheets)

**Why:** Financial Truth First → Governance Second → Automation Third.
