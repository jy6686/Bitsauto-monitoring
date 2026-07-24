# NOC Portal — Workspace Acceptance Specification

**Status:** SEALED — Phase 3 migration ready; execution queued behind Phase 2A  
**Date:** 2026-07-24  
**Author:** Portal Architecture (pre-NAV-C discovery pass)  
**Feeds into:** Phase 3 migration — `portal_domain_assignments` additions + `portal_module_overrides` seed

This document is the structured output of the Portal Acceptance Review (Discovery) for the NOC portal.
It classifies every domain, group, and module against one question:
**"Does a Level-1 NOC engineer use this in daily network operations?"**

Final tally: **52 keep / 22 exclude / 0 pending** across 6 assigned domains.
Phase 3 content is sealed. The exact SQL is at the bottom of this file.

---

## Test 1 — Top Menu Review (Domain-Level)

**Question per domain:** Should this domain appear in the NOC portal top menu?

| # | Domain ID | Label | Decision | Rationale |
|---|---|---|---|---|
| 1 | `live-network` | Live Network | ✅ KEEP | Core NOC domain — live calls, alerting, command centre, infra health |
| 2 | `company` | Clients | 🚫 REMOVE | Client account management; KAM/Sales scope, not NOC |
| 3 | `operations` | Operations | ✅ KEEP | Carrier monitoring, routing diagnostics, SIP trace — all NOC-daily |
| 4 | `telemetry` | BitsEye | ✅ KEEP | Primary telemetry platform; NOC lives in BitsEye for quality monitoring |
| 5 | `analytics` | Analytics | ✅ KEEP (partial) | Traffic analytics + CDR lookup needed; finance-flavored reports excluded |
| 6 | `intelligence` | Intelligence | ✅ ADD | AI anomaly detection, carrier RCA, traffic steering signals — NOC response tool |
| 7 | `security` | Security | ✅ ADD (partial) | Fraud engine + firewall are NOC-operated; access/compliance groups excluded |
| 8 | `finance` | Finance | 🚫 REMOVE | Billing, AP, treasury — Finance team scope; no NOC use case |
| 9 | `products` | Products | 🚫 REMOVE | Rate management and product catalog — Products/Commercial scope |
| 10 | `trading` | Voice Trading | 🚫 REMOVE | Deal lifecycle — Commercial scope only |
| 11 | `platform` | Platform | 🚫 REMOVE | Admin/system configuration — Platform Engineering scope |

**Domain assignment delta:**

| Action | Domain | `display_order` |
|---|---|---|
| Already assigned | `live-network` | 1 |
| Already assigned | `operations` | 2 |
| Already assigned | `telemetry` | 3 |
| Already assigned | `analytics` | 4 |
| **ADD** | `intelligence` | 5 |
| **ADD** | `security` | 6 |

---

## Tests 2+3 — Cascade & Module Review (Sealed)

All 9 review items answered. No open questions remain.

> **Module key note:** The 031 migration seeds `navigation_modules` with underscore-style
> keys (`live_calls`, `noc_dashboard`, etc.). Migration 032 renames ALL underscore keys to
> kebab-case in one UPDATE. The classification tables below show pre-032 module_key values
> for reference; the **Phase 3 SQL uses the canonical post-032 kebab form** and must run
> after both 031 and 032 have been applied.
>
> Two keys in the 031 seed differ from the DOMAINS[] constant names — actual 031 key → kebab:
> `comm_policies → comm-policies` (not `communication-policies`),
> `balance_monitor → balance-monitor` (not `balance`),
> `sla_scorecard → sla-scorecard` (not `vendor_sla_scorecard`),
> `route_tester → route-tester` (not `test_call`),
> `route_simulator → route-simulator` (not `call_flow_simulator`),
> `replay_engine → replay-engine` (not `replay`).

**Q1–Q9 final answers:**

| # | `module_key` | Decision | Visibility | Rationale |
|---|---|---|---|---|
| Q1 | `multi_switch` | ✅ KEEP | operational | Multi-site switch view useful for NOC consolidated view |
| Q2 | `routing_manager` | ✅ KEEP | **read-only** | NOC needs routing group visibility; edit authority stays with Operations team |
| Q3 | `codec_analytics` | 🚫 EXCLUDE | hidden | Not daily NOC; quality RCA covered by BitsEye 2.0 and RTP/MOS |
| Q4 | `intelligence_validation` | 🚫 EXCLUDE | hidden | Data quality/trust scoring is a data-engineering tool, not L1 NOC |
| Q5 | `route_optimisation` | 🚫 EXCLUDE | hidden | Advisory carrier recommendations; Ops team acts on these, not NOC |
| Q6 | `simulation_sandbox` | 🚫 EXCLUDE | hidden | Traffic shift modelling is analyst scope, not L1 NOC daily task |
| Q7 | `number_intelligence` | 🚫 EXCLUDE | hidden | Number-level analysis is not a core NOC operation |
| Q8 | `stir_shaken` | 🚫 EXCLUDE | hidden | STIR/SHAKEN attestation is compliance scope, not daily NOC touchpoint |
| Q9 | `call_recordings` | ✅ KEEP | **read-only** | NOC uses recordings for disputed-call verification; manage authority stays with Compliance |

---

### Domain: `live-network` — Live Network

| Group | `module_key` | Label | Visibility | Note |
|---|---|---|---|---|
| Live Operations | `live-calls` | Live Calls | operational | ⚠ kebab key (post-029) |
| Live Operations | `alerts` | Alerts | operational | |
| Live Operations | `live-traffic` | Live Traffic | operational | ⚠ kebab key (post-029) |
| Live Operations | `traffic-map` | Traffic Map | operational | ⚠ kebab key (post-029) |
| Live Operations | `call_governance` | Call Governance | **hidden** | Owner confirmed: not for NOC portal |
| Command Centre | `noc-dashboard` | NOC Dashboard | operational | ⚠ kebab key (post-029) — home module |
| Command Centre | `noc_incidents` | Incident Command | operational | |
| Command Centre | `noc-command` | NOC Command | operational | ⚠ kebab key (post-029) |
| Command Centre | `ops-console` | Ops Console | operational | ⚠ kebab key (post-029) |
| Infrastructure | `server_monitoring` | Server Monitor | operational | |
| Infrastructure | `sbc_monitor` | SBC Monitor | operational | |
| Infrastructure | `network_topology` | Network Topology | operational | |
| Infrastructure | `live_traffic_map` | Live Traffic Map | operational | |
| Infrastructure | `graphs` | Graphs | operational | |
| Infrastructure | `multi_switch` | Multi-Switch | operational | Q1 → KEEP |

---

### Domain: `operations` — Operations

| Group | `module_key` | Label | Visibility | Note |
|---|---|---|---|---|
| Carriers | `vendors` | Vendor List | operational | |
| Carriers | `balance` | Balance Monitor | operational | |
| Carriers | `vendor_sla_scorecard` | SLA Scorecard | operational | |
| Carriers | `carrier_scoring` | Carrier Scoring | operational | |
| Carriers | `vendor_health` | Health Engine | operational | |
| Routing | `routing_manager` | Routing Manager | **read-only** | Q2 → KEEP read-only |
| Routing | `auth_studio` | Auth Studio | **hidden** | Provisioning tool; not a NOC task |
| Routing | `lcr_analyser` | LCR Analyser | operational | |
| Routing | `test_call` | Route Tester | operational | |
| Routing | `call_flow_simulator` | Route Simulator | operational | |
| Routing | `self_heal` | Self-Heal | operational | |
| Routing | `route_testing` | Route Testing | operational | |
| Messaging | `sms_monitor` | SMS Monitor | operational | |
| Messaging | `voice_otp` | Voice OTP | operational | |
| Messaging | `communication_policies` | Comm Policies | **hidden** | Admin alert-routing config; not NOC |
| Messaging | `commercial_notifications` | Commercial Notifs | **hidden** | Billing notification queue; Finance scope |
| Messaging | `sender_profiles` | Sender Profiles | **hidden** | SMTP identity admin; not NOC |
| Messaging | `termination_chains` | Termination Chains | operational | NOC uses for call-path tracing |
| Diagnostics | `sip_trace` | SIP Trace | operational | |
| Diagnostics | `replay` | Replay Engine | operational | |
| Diagnostics | `test_campaigns` | Test Campaigns | operational | |
| Diagnostics | `tools` | Tools | operational | |

---

### Domain: `telemetry` — BitsEye

| Group | `module_key` | Label | Visibility | Note |
|---|---|---|---|---|
| Telemetry Platform | `bitseye` | BitsEye 2.0 | operational | |
| Telemetry Platform | `bitseye_classic` | BitsEye Classic | operational | |
| Historical Warehouse | `rtp_analytics` | RTP / MOS History | operational | |
| Historical Warehouse | `qos_heatmap` | QoS Heatmap | operational | |
| Historical Warehouse | `codec_analytics` | Codec Analytics | **hidden** | Q3 → EXCLUDE; covered by BitsEye 2.0 |
| Comparative & Intelligence Views | `vendor_stability_timeline` | Stability Timeline | operational | |
| Comparative & Intelligence Views | `asr_acd` | ASR / ACD | operational | |

---

### Domain: `analytics` — Analytics

| Group | `module_key` | Label | Visibility | Note |
|---|---|---|---|---|
| Traffic & Quality | `analytics` | Traffic Analytics | operational | |
| Reports & Forecasting | `reports` | Reports | operational | |
| Reports & Forecasting | `executive_reports` | Executive Reports | **hidden** | C-suite reporting; not a NOC surface |
| Reports & Forecasting | `traffic_forecast` | Traffic Forecast | operational | |
| Reports & Forecasting | `revenue_heatmap` | Revenue Heatmap | **hidden** | Revenue visualisation; Finance scope |
| CDR Records | `cdrs` | CDR Viewer | operational | |
| CDR Records | `cdr_rerate` | CDR Rerate | **hidden** | CDR re-rate engine; Finance/Revenue Assurance scope |

---

### Domain: `intelligence` — Intelligence (NEW addition)

| Group | `module_key` | Label | Visibility | Note |
|---|---|---|---|---|
| AI Operations | `ai_ops` | AI Ops Center | operational | |
| AI Operations | `intelligence_hub` | Intelligence Hub | operational | |
| AI Operations | `intelligence_validation` | Validation Console | **hidden** | Q4 → EXCLUDE; data-engineering tool |
| Carrier Intelligence | `carrier_intelligence` | Carrier Intelligence | operational | |
| Carrier Intelligence | `vendor_rca` | Vendor RCA | operational | |
| Carrier Intelligence | `prefix_intelligence` | Prefix Intelligence | operational | |
| Carrier Intelligence | `route_intelligence` | Route Intelligence | operational | |
| Carrier Intelligence | `routing_intelligence` | Routing Engine | operational | |
| Optimisation | `cost_optimisation` | Cost Optimisation | **hidden** | Commercial scope, not NOC |
| Optimisation | `route_optimisation` | Route Optimisation | **hidden** | Q5 → EXCLUDE; Ops scope |
| Optimisation | `traffic_steering` | Traffic Steering | operational | |
| Optimisation | `simulation_sandbox` | Simulation Sandbox | **hidden** | Q6 → EXCLUDE; analyst scope |
| Optimisation | `number_intelligence` | Number Intel | **hidden** | Q7 → EXCLUDE; not core NOC |

---

### Domain: `security` — Security (NEW addition)

| Group | `module_key` | Label | Visibility | Note |
|---|---|---|---|---|
| Fraud & Detection | `fraud` | Fraud Engine | operational | |
| Fraud & Detection | `firewall` | Firewall | operational | |
| Fraud & Detection | `security_ops` | Security Ops | operational | |
| Fraud & Detection | `sla_breaches` | SLA Breaches | operational | |
| Fraud & Detection | `stir_shaken` | STIR/SHAKEN | **hidden** | Q8 → EXCLUDE; compliance scope |
| Approvals & Access | `approvals` | Approval Queue | **hidden** | Governance admin, not NOC |
| Approvals & Access | `approval_settings` | Approval Rules | **hidden** | Admin scope |
| Approvals & Access | `rbac` | Permission Matrix | **hidden** | Platform admin scope |
| Approvals & Access | `mfa_setup` | MFA / 2FA | **hidden** | Platform admin scope |
| Compliance & Audit | `compliance` | Compliance | **hidden** | Legal/Compliance scope |
| Compliance & Audit | `audit_log` | Audit Log | **hidden** | Admin audit scope |
| Compliance & Audit | `call_recordings` | Recordings | **read-only** | Q9 → KEEP read-only; disputed-call verification |

---

## Test 4 — Search

**Expected behaviour:** Search returns only modules with `visibility != 'hidden'` within the 6 assigned NOC domains.

Spot checks:
- "fraud" → Fraud Engine ✅
- "billing" → 0 results ✅ (finance domain not assigned)
- "executive" → 0 results ✅ (executive_reports hidden)
- "vendor" → Vendor List, Vendor RCA, Vendor Health, Vendor SLA, etc. ✅
- "routing" → Routing Manager ✅ (read-only, still in nav), Routing Engine, Route Intelligence ✅
- "codec" → 0 results ✅ (codec_analytics hidden)

---

## Test 5 — Breadcrumb

Format: `{Domain Label} > {Module Label}`, resolved from `workspace.navigation`.

Examples:
- `/noc/noc-dashboard` → `Live Network > NOC Dashboard`
- `/noc/fraud` → `Security > Fraud Engine`
- `/noc/bitseye2` → `BitsEye > BitsEye 2.0`
- `/noc/sip-trace` → `Operations > SIP Trace`
- `/noc/carrier-intelligence` → `Intelligence > Carrier Intelligence`
- `/noc/routing-manager` → `Operations > Routing Manager`

`portalRoute` is always computed server-side as `/noc/{moduleKey}`. The frontend never constructs portal routes.

---

## Test 6 — Dashboard

**Home module:** `noc-dashboard` (at `/noc/noc-dashboard`)

Proposed dashboard cards (composition via `portal_module_assignments` — separate sprint):

| Priority | Module | Card Type | Rationale |
|---|---|---|---|
| 1 | `live-calls` | Live count widget | Active calls — most-watched NOC metric |
| 2 | `alerts` | Alert count + severity | Active incidents requiring action |
| 3 | `vendor_health` | Health score gauge | Unified 0–100 health per top-5 carriers |
| 4 | `fraud` | Fraud alert count | Active FAS/IRSF detections |
| 5 | `balance` | Critical balance list | Carriers approaching zero balance |
| 6 | `noc_incidents` | Incident list | Open NOC incidents |

---

## Test 9 — Workflow Test

**Workflow A — Carrier quality degradation**
NOC Dashboard → Live Calls (filter carrier X) → BitsEye 2.0 (entity drill-down) → Vendor RCA → SIP Trace → Health Engine → Traffic Steering → Self-Heal.
✅ All 8 steps within NOC portal.

**Workflow B — Fraud detection response**
Fraud Engine → Firewall (add to blacklist) → Live Traffic (confirm drop) → Security Ops (log event) → Alerts (create incident).
✅ All 5 steps within NOC portal.

**Workflow C — Carrier balance emergency**
Balance Monitor → Vendor List (carrier contact) → SLA Scorecard (confirm SLA impact) → Incident Command (escalate).
✅ All 4 steps within NOC portal.

**Workflow D — Failed call investigation**
CDR Viewer → SIP Trace → Replay Engine → Route Tester → Prefix Intelligence → Termination Chains.
✅ All 6 steps within NOC portal.

**Leave-portal assessment:** No critical L1 workflow requires the main platform. Q2 (routing_manager kept read-only) closes the last gap.

---

## Test 10 — NOC Operator Verdict

**YES** — a Level-1 NOC engineer can perform their complete daily work from the NOC portal, given:
1. Intelligence and Security domains added to `portal_domain_assignments`
2. `portal_module_overrides` applied (22 modules hidden, 2 read-only)
3. `routing_manager` visible read-only (Q2 resolution)

---

## Phase 3 Deliverable — Sealed SQL

### Domain additions
```sql
-- migration 032 will include this; do not run standalone before 2A lands
INSERT INTO portal_domain_assignments (portal_slug, domain_id, display_order) VALUES
  ('noc', 'intelligence', 5),
  ('noc', 'security',     6)
ON CONFLICT (portal_slug, domain_id) DO NOTHING;
```

### `portal_module_overrides` seed (23 rows)

**Table:** `portal_module_overrides (portal_slug, module_key, visibility, reason)`  
**Visibility values:** `read-only` | `hidden` (no row = `operational` default)

```sql
-- All module_key values are post-032 kebab-case. Run migration 031, then 032,
-- then this seed. The join-check query at the bottom of this file verifies
-- every key resolves to a navigation_modules row before seeding.

INSERT INTO portal_module_overrides (portal_slug, module_key, visibility, reason) VALUES
  -- ── read-only: visible in nav and search; edit controls deferred to IAM/permissions program ──
  ('noc', 'routing-manager',          'read-only', 'NOC needs routing group visibility; edit authority stays with Operations team'),
  ('noc', 'call-recordings',          'read-only', 'NOC uses for disputed-call verification; manage authority stays with Compliance'),
  -- ── hidden: absent from nav tree AND search index ──
  -- live-network
  ('noc', 'call-governance',          'hidden', 'Owner confirmed: not for NOC portal'),
  -- operations
  ('noc', 'auth-studio',              'hidden', 'Provisioning tool; not a NOC task'),
  ('noc', 'comm-policies',            'hidden', 'Admin alert-routing config; not NOC'),
  ('noc', 'commercial-notifications', 'hidden', 'Billing notification queue; Finance/Billing scope'),
  ('noc', 'sender-profiles',          'hidden', 'SMTP identity admin; not NOC'),
  -- analytics
  ('noc', 'executive-reports',        'hidden', 'C-suite reporting; not a NOC surface'),
  ('noc', 'revenue-heatmap',          'hidden', 'Revenue visualisation; Finance scope'),
  ('noc', 'cdr-rerate',               'hidden', 'CDR re-rate engine; Finance/Revenue Assurance scope'),
  -- telemetry
  ('noc', 'codec-analytics',          'hidden', 'Not daily NOC; quality RCA covered by BitsEye 2.0 and RTP/MOS'),
  -- intelligence
  ('noc', 'cost-optimisation',        'hidden', 'Route cost engine; commercial scope, not NOC'),
  ('noc', 'intelligence-validation',  'hidden', 'Data quality/trust scoring; data-engineering scope, not L1 NOC'),
  ('noc', 'route-optimisation',       'hidden', 'Advisory carrier recommendations; Ops scope'),
  ('noc', 'simulation-sandbox',       'hidden', 'Traffic shift modelling; analyst scope'),
  ('noc', 'number-intelligence',      'hidden', 'Number-level analysis; not core NOC'),
  -- security
  ('noc', 'stir-shaken',              'hidden', 'STIR/SHAKEN attestation; compliance scope, not daily NOC'),
  ('noc', 'approvals',                'hidden', 'Approval queue; governance admin, not NOC'),
  ('noc', 'approval-settings',        'hidden', 'Approval rule config; admin scope'),
  ('noc', 'rbac',                     'hidden', 'Permission matrix; Platform admin scope'),
  ('noc', 'mfa-setup',                'hidden', 'MFA setup; Platform admin scope'),
  ('noc', 'compliance',               'hidden', 'Regulatory compliance; Legal/Compliance scope'),
  ('noc', 'audit-log',                'hidden', 'Platform audit trail; admin scope')
ON CONFLICT (portal_slug, module_key) DO UPDATE SET
  visibility = EXCLUDED.visibility,
  reason     = EXCLUDED.reason;
```

---

## Module Key Note — Kebab Standardization (Phase 3 Execution)

Migration 029 canonicalized six module keys to kebab-case. The 031 identity merge absorbs
the conflict for those six keys (underscore row → deleted; kebab row → canonical).

The six kebab keys are: `live-calls`, `live-traffic`, `traffic-map`, `noc-dashboard`,
`noc-command`, `ops-console`. None of these appear in the `portal_module_overrides` seed
above — all override rows use underscore-style keys (`call_governance`, `routing_manager`,
etc.) which are correct as-is.

However: when Phase 3 is executed and NAV-C builds registry bindings for all 52 kept
modules, **every module key in `portal_module_overrides` must match the key in
`navigation_modules` exactly.** The Phase 3 execution team should run this pre-seed check:

```sql
-- Pre-seed validation: every override key must resolve to a navigation_modules row.
-- Run this AFTER 031 and 032. If it returns rows, fix the keys before seeding.
SELECT o.module_key, 'dangling key — not in navigation_modules' AS problem
FROM (VALUES
  ('routing-manager'), ('call-recordings'), ('call-governance'), ('auth-studio'),
  ('comm-policies'), ('commercial-notifications'), ('sender-profiles'),
  ('executive-reports'), ('revenue-heatmap'), ('cdr-rerate'), ('codec-analytics'),
  ('cost-optimisation'), ('intelligence-validation'), ('route-optimisation'),
  ('simulation-sandbox'), ('number-intelligence'), ('stir-shaken'),
  ('approvals'), ('approval-settings'), ('rbac'), ('mfa-setup'),
  ('compliance'), ('audit-log')
) AS o(module_key)
LEFT JOIN navigation_modules m ON m.module_key = o.module_key
WHERE m.module_key IS NULL;
-- Must return 0 rows before the INSERT proceeds.
```

The remaining ~46 underscore-keyed modules (all except the six above) remain underscore in
the DB post-031. Whether to standardize those to kebab is a separate decision, to be
settled when Phase 3 or NAV-C writes registry bindings — not before 2A.

---

## Certification Checklist (§9 — to be executed post-Phase 6)

- [ ] Top menu shows: Live Network, Operations, BitsEye, Analytics, Intelligence, Security — nothing else
- [ ] All 6 domain cascades render correctly with no hidden-module leakage
- [ ] Search returns only non-hidden NOC-scoped modules; no Finance/Products/Platform results
- [ ] "executive" search returns 0 results; "codec" returns 0 results; "routing manager" returns 1 result
- [ ] Favorites and Quick Actions are portal-scoped
- [ ] Home module `noc-dashboard` reachable at `/noc/noc-dashboard`
- [ ] `certify-portal-workspace.mjs` exits 0 (DB mode)
- [ ] `certify-portal-workspace.mjs` exits 0 (HTTP mode, post Phase 6)
- [ ] No sidebar rendered
- [ ] Breadcrumb format `{Domain} > {Module}` resolves from workspace tree
- [ ] All 4 Level-1 workflows (A/B/C/D) completable without leaving the portal
- [ ] `routing_manager` visible in nav (read-only flag passed to UI)
- [ ] `call_recordings` visible in nav (read-only flag passed to UI)
