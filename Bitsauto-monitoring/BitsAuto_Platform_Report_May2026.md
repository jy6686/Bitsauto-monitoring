# BitsAuto Platform — Feature Status Report
**Date:** May 28, 2026 | **Environment:** Production (vo-ip-watcher--junaid70.replit.app) | **Version:** Post-Architecture-Refactor

---

## Executive Summary

The BitsAuto platform is a production-grade VoIP monitoring dashboard with live Sippy XML-RPC integration. It currently has **110+ page components**, **120+ registered routes**, a **PostgreSQL schema with 100+ tables**, and a full **DB-driven portal workspace system** (9 portals, 14 sections, 53 module assignments). The architectural refactor (May 2026) formally separated the old hardcoded navigation system from the new DB-driven portal engine.

This report audits: (1) implementation completeness across all feature areas, (2) routing gaps (pages without routes, routes without handlers), (3) Sippy integration coverage vs. the Sippy support knowledge base, and (4) **new rate/send feature recommendations** derived from Sippy's advanced feature set.

---

## Section 1 — Implementation Status by Feature Area

### 1.1 Live Network & NOC Operations

| Feature | Route | Status | Notes |
|---|---|---|---|
| Live Calls Monitor | `/calls` | ✅ Production | WebSocket, XML-RPC |
| NOC Dashboard | `/noc-dashboard` | ✅ Production | Portal: NOC |
| NOC Incident Command | `/noc-incidents` | ✅ Production | Portal: NOC |
| NOC Command Centre | `/noc-command` | ✅ Production | |
| Live Traffic | `/live-traffic` | ✅ Production | WebSocket stream |
| Live Traffic Map | `/live-traffic-map` | ✅ Production | Geographic |
| BitsEye 2 (Topology) | `/bitseye2` | ✅ Production | |
| BitsEye (Legacy) | `/bitseye` | ✅ Production | |
| Graphs | `/graphs` | ✅ Production | |
| Multi-Switch View | `/multi-switch` | ✅ Production | |
| Server Monitoring | `/server-monitoring` | ✅ Production | |
| SBC Monitor | `/sbc-monitor` | ✅ Production | |
| Network Topology | `/network-topology` | ✅ Production | |
| Ops Console | `/ops-console` | ✅ Production | |
| Debug Console | `/console` | ✅ Production | |
| Alerts | `/alerts` | ✅ Production | |
| Route Intelligence | `/route-intelligence` | ✅ Production | isNew |
| SIP Trace | `/sip-trace` | ✅ Production | isNew |
| Replay Engine | `/replay` | ✅ Production | isNew |
| Traffic Map | `/traffic-map` | ✅ Production | |
| Traffic Forecast | `/traffic-forecast` | ✅ Production | isNew |
| Traffic Steering | `/traffic-steering` | ✅ Production | |
| SLA Breaches | `/sla-breaches` | ✅ Production | |
| SMS / A2P Monitor | `/sms-monitor` | 🟡 **Planned** | Page exists, marked `status: 'planned'` in nav — not functional |
| STIR/SHAKEN | `/stir-shaken` | 🟡 **Partial** | Page exists, route registered, depth unknown |

### 1.2 Company & Account Management

| Feature | Route | Status | Notes |
|---|---|---|---|
| Accounts List | `/clients` | ✅ Production | |
| Company List | `/company/list` | ✅ Production | |
| Company Profile | `/company-profile` | ✅ Production | |
| Company Create | `/company/create` | ✅ Production | |
| Onboarding Wizard | `/company/onboarding` | ✅ Production | isNew |
| Create Account Wizard | `/client/wizard` | ✅ Production | |
| Client Portal | `/client-portal` | ✅ Production | |
| DID Management | `/dids` | ✅ Production | |
| Call Recordings | `/call-recordings` | ✅ Production | |
| Products | `/products` | ✅ Production | |
| Account Names | `/account-names` | ✅ Production | |
| Reseller Management | `/reseller` | ✅ Production | |
| Client Identity Map | `/client-identity` | ✅ Production | |
| Number Intelligence | `/number-intelligence` | ✅ Production | |
| Client Config | `/client/config` | ✅ Production | |
| **Vendor / Carrier Profile** | `/vendors/:name` | 🟡 **Partial** | Route registered, `vendor-profile.tsx` exists but not in main route map |

### 1.3 Operations & Routing

| Feature | Route | Status | Notes |
|---|---|---|---|
| Vendor List | `/vendors` | ✅ Production | |
| Routing Manager | `/routing-manager` | ✅ Production | Groups, conns, dest-sets, translations |
| LCR Analyser | `/lcr-analyser` | ✅ Production | |
| Route Simulator | `/call-flow-simulator` | ✅ Production | |
| Balance Monitor | `/balance` | ✅ Production | |
| SLA Scorecard | `/vendor-sla-scorecard` | ✅ Production | |
| Carrier Scoring | `/carrier-scoring` | ✅ Production | isNew |
| Stability Timeline | `/vendor-stability-timeline` | ✅ Production | isNew |
| Failover / Self-Heal | `/self-heal` | ✅ Production | isNew |
| Route Test Call | `/test-call` | ✅ Production | |
| Test Campaigns | `/test-campaigns` | ✅ Production | |
| Tools | `/tools` | ✅ Production | |
| Routing Intelligence | `/routing-intelligence` | ✅ Production | |
| Route Optimisation | `/route-optimisation` | ✅ Production | |
| Vendor RCA | `/vendor-rca` | ✅ Production | isNew |
| Vendor Prefix Intelligence | `/vendor-prefix-intelligence` | ✅ Production | |
| **Vendor Profile Deep Page** | `/vendors/:name` | 🟡 **Partial** | `vendor-profile.tsx` exists but main route not consistent |

### 1.4 Analytics & Reports

| Feature | Route | Status | Notes |
|---|---|---|---|
| Traffic Analytics | `/analytics` | ✅ Production | |
| ASR / ACD | `/asr-acd` | ✅ Production | Sippy portal scrape |
| QoS Heatmap | `/qos-heatmap` | ✅ Production | |
| Codec Analytics | `/codec-analytics` | ✅ Production | isNew |
| RTP Analytics | `/rtp-analytics` | ✅ Production | |
| Revenue Heatmap | `/revenue-heatmap` | ✅ Production | isNew |
| Reports | `/reports` | ✅ Production | |
| CDR Viewer | `/cdrs` | ✅ Production | Portal scrape fallback |
| Executive Reports | `/executive-reports` | ✅ Production | |
| Call Detail | `/calls/:id` | ✅ Production | |
| Margin Intelligence | `/margin-intelligence` | ✅ Production | isNew |
| **ASR/ACD Report Page** | `asr-acd-report.tsx` | 🔴 **Unrouted** | Page file exists, not registered in App.tsx |

### 1.5 Intelligence & AI

| Feature | Route | Status | Notes |
|---|---|---|---|
| AI Ops Center | `/ai-ops` | ✅ Production | isNew |
| Intelligence Hub | `/intelligence` | ✅ Production | isNew |
| Intelligence Validation | `/intelligence-validation` | ✅ Production | isNew |
| AI Assurance | `/ai-assurance` | ✅ Production | |
| Carrier Intelligence | `/carrier-intelligence` | ✅ Production | isNew |
| Simulation Sandbox | `/simulation-sandbox` | ✅ Production | |
| Cost Optimisation | `/cost-optimisation` | ✅ Production | |

### 1.6 Security & Fraud

| Feature | Route | Status | Notes |
|---|---|---|---|
| Fraud Engine | `/fraud` | ✅ Production | FAS/IRSF |
| Approval Queue | `/approvals` | ✅ Production | |
| Approval Settings | `/approval-settings` | ✅ Production | |
| Audit Log | `/audit-log` | ✅ Production | isNew |
| Firewall | `/firewall` | ✅ Production | |
| Compliance | `/compliance` | ✅ Production | |
| MFA / 2FA Setup | `/mfa-setup` | ✅ Production | isNew |
| Security Ops | `/security-ops` | ✅ Production | isNew |
| RBAC Matrix | `/rbac` | ✅ Production | |
| **Approval Queue Page** | `approval-queue.tsx` | 🟡 **Duplicate** | Separate file vs `/approvals` route — may be legacy |

### 1.7 Finance & Billing

| Feature | Route | Status | Notes |
|---|---|---|---|
| Finance Cockpit | `/finance-cockpit` | ✅ Production | Portal: Finance |
| Billing | `/billing` | ✅ Production | |
| Invoices | `/invoices` | ✅ Production | |
| Invoice Jobs | `/invoice-jobs` | ✅ Production | |
| Invoice Templates | `/invoice-templates` | ✅ Production | |
| Credit Notes | `/credit-notes` | ✅ Production | |
| Credit Control | `/credit-control` | ✅ Production | |
| DMR (Daily Minutes Report) | `/dmr` | ✅ Production | |
| Billing Disputes | `/billing-disputes` | ✅ Production | |
| Dispute Cases | `/dispute-cases` | ✅ Production | |
| Dispute Defense | `/dispute-defense` | ✅ Production | |
| Client Reconciliation | `/client-reconciliation` | ✅ Production | |
| Carrier Reconciliation | `/carrier-reconciliation` | ✅ Production | |
| Partner Profiles | `/partner-profiles` | ✅ Production | |
| **Rate Cards** | `/rate-cards` | ✅ Production | Read-only display |
| **Rate Editor** | — | 🔴 **Unrouted** | `rate-editor.tsx` exists, no route in App.tsx |
| Tariff Versions | `/tariff-versions` | ✅ Production | |
| Rating Verification | `/rating-verification` | ✅ Production | |
| Rating Snapshots | `/rating-snapshots` | ✅ Production | |

### 1.8 Platform Administration

| Feature | Route | Status | Notes |
|---|---|---|---|
| Platform Settings | `/settings` | ✅ Production | |
| Team & KAM | `/team` | ✅ Production | |
| API Keys | `/api-keys` | ✅ Production | |
| VPN Config | `/vpn-config` | ✅ Production | |
| Email Centre | `/email-centre` | ✅ Production | |
| Notification Centre | `/notification-centre` | ✅ Production | |
| WhatsApp Alerts | `/whatsapp-alerts` | ✅ Production | |
| Sender Profiles | `/sender-profiles` | ✅ Production | |
| Communication Policies | `/communication-policies` | ✅ Production | |
| Commercial Notifications | `/commercial-notifications` | ✅ Production | |
| Workspace Settings | `/workspace-settings` | ✅ Production | **NEW — May 2026** |
| Governance Console | `/governance` | ✅ Production | **NEW — May 2026 (super_admin)** |
| Sidebar Settings | `/sidebar-settings` | ✅ Production | Maintenance-only |
| KAM Dashboard | `/kam-dashboard` | ✅ Production | Portal: KAM |
| My Account | `/account` | ✅ Production | |
| **Workspace Home** | — | 🔴 **Unrouted** | `workspace-home.tsx` exists, not in App.tsx |

### 1.9 Client-Facing Portal

| Feature | Route | Status | Notes |
|---|---|---|---|
| Portal Dashboard | `/portal/dashboard` | ✅ Production | |
| Portal Invoices | `/portal/invoices` | ✅ Production | |
| Portal Credit Notes | `/portal/credit-notes` | ✅ Production | |
| Portal Disputes | `/portal/disputes` | ✅ Production | |
| Portal Reconciliation | `/portal/reconciliation` | ✅ Production | |
| Portal Login | `/portal/login` | ✅ Production | |

---

## Section 2 — Routing Gaps (Action Required)

### 2.1 Page Files with NO Route in App.tsx

These components exist and are developed but are not accessible because they are not registered as routes.

| Page File | Suggested Route | Priority | Action |
|---|---|---|---|
| `rate-editor.tsx` | `/rate-editor` | 🔴 **High** | Add route — this is the write surface for rate management |
| `workspace-home.tsx` | `/workspace/:domain` or `/` | 🟡 **Medium** | Add route or merge into dashboard — may be the domain landing page |
| `asr-acd-report.tsx` | `/asr-acd-report` | 🟡 **Medium** | Add route or confirm it is the same page as `/asr-acd` |
| `replay-engine.tsx` | `/replay-engine` | 🟡 **Medium** | Confirm if `/replay` points to this or to `replay.tsx` |
| `rbac-matrix.tsx` | `/rbac` | 🟢 **Low** | Confirm `/rbac` points to this (route exists but file is `rbac-matrix.tsx`) |
| `balance-monitor.tsx` | `/balance` | 🟢 **Low** | Confirm `/balance` imports `balance-monitor.tsx` — naming mismatch |
| `approval-queue.tsx` | `/approvals` | 🟢 **Low** | Confirm `/approvals` uses `approval-queue.tsx` — naming mismatch |
| `call-detail.tsx` | `/calls/:id` | 🟢 **Low** | Confirm `/calls/:id` uses `call-detail.tsx` — naming mismatch |
| `calls-list.tsx` | `/calls` | 🟢 **Low** | Naming mismatch to verify |
| `vendor-profile.tsx` | `/vendors/:name` | 🟡 **Medium** | Route `/vendors/:name` exists but may not be importing this file |
| `incident-detail.tsx` | `/incidents/:id` | 🟢 **Low** | Route exists — naming mismatch to verify |
| `client-config.tsx` | `/client/config` | 🟢 **Low** | Route exists — naming mismatch to verify |

### 2.2 SMS/A2P — Only Planned Feature Remaining

The `sms-monitor.tsx` page exists. It is marked `status: 'planned'` in the sidebar and has a route at `/sms-monitor`. This is the only fully planned (not yet implemented) feature in the navigation.

**Recommendation:** Either implement the SMS/A2P monitoring or remove the nav entry until it is ready.

---

## Section 3 — Sippy Integration Coverage vs. Knowledge Base

Based on the Sippy support knowledge base (https://support.sippysoft.com/support/solutions):

### 3.1 Sippy System Elements — Coverage

| Sippy Feature | KB Article | BitsAuto Coverage | Status |
|---|---|---|---|
| Accounts Overview | `77461` | `/clients`, `/client/wizard` | ✅ Covered |
| Customers | `77463` | `/clients`, `/company/*` | ✅ Covered |
| Tariffs and Rates | `77467` | `/rate-cards`, `/tariff-versions` | 🟡 **Read-Only** — no push to Sippy |
| Balance and Credit Limit | `77468` | `/balance`, `/credit-control` | ✅ Covered |
| Low Balance Notifications | `77472` | `/whatsapp-alerts`, `/email-centre` | 🟡 **Partial** — platform alerts only, not Sippy-native config |
| Call Process | `77544` | `/calls`, `/sip-trace` | ✅ Covered |
| Understanding Authentication | `77553` | `/firewall`, `/mfa-setup` | ✅ Covered |
| Understanding Rating and Billing | `77554` | `/billing`, `/rate-cards` | 🟡 **Partial** — see Rate gaps below |
| General Method for Uploading Data | `78257` | — | 🔴 **Missing** — no bulk upload UI |
| Understanding Routing | `77556` | `/routing-manager`, `/lcr-analyser` | ✅ Covered |

### 3.2 Sippy Advanced Features — Coverage

| Sippy Feature | KB Article | BitsAuto Coverage | Status |
|---|---|---|---|
| On-Net Routing | `77871` | `/routing-manager` | 🟡 **Partial** |
| Charging On-Net Calls | `77881` | `/billing` | 🟡 **Partial** |
| Automatic Database Backup | `77882` | Not in scope | ➖ Out of scope |
| Quality Based Routing (QBR) | `77903` | `/routing-manager?tab=qbr` | ✅ Covered |
| Internal/External CDR Result Codes | `3000107425` | `/cdrs` | 🟡 **Partial** |
| Disallow Loops Feature | `3000056758` | `/routing-manager` | 🟡 **Partial** |
| Sippy FAX Signaling | `3000080322` | — | 🔴 **Not Covered** |
| Commission Models | `3000058549` | `/partner-profiles` | 🔴 **Not Configurable** — display only |
| Bulk Rate Uploader | `134679` | — | 🔴 **Missing** — no bulk rate import/export |
| Customizing User Interface | `157555` | `/workspace-settings`, `/governance` | ✅ Covered (platform-side) |
| Invoice Templates | `3000014179` | `/invoice-templates` | ✅ Covered |
| How to Invoice Customers | `3000058961` | `/invoices`, `/invoice-jobs` | ✅ Covered |
| IP to IP Authentication | `3000055802` | `/firewall` | 🟡 **Partial** |
| STIR/SHAKEN | (TLS section) | `/stir-shaken` | 🟡 **Partial** — page exists |
| SSL/TLS Management | `3000117551` | `/settings` | ✅ Covered |

---

## Section 4 — Rate/Send Feature Recommendations (Sippy-Native)

Based on the Sippy support documentation and the current platform gaps, the following **rate and distribution features** are recommended for implementation. These are grounded in what Sippy's XML-RPC and portal APIs support.

---

### R1 — Rate Card Push to Sippy ⬆️
**Priority:** 🔴 High | **Effort:** Medium

**What is missing:** The current `/rate-cards` page displays rates pulled from Sippy but provides no way to push updates back. The `rate-editor.tsx` page exists but is unrouted.

**Recommendation:**
- Route `rate-editor.tsx` at `/rate-editor`
- Add "Edit Rates" button in the rate-cards page linking to the editor
- Editor should support: add destination, set buy/sell rate, set effective date, set expiry
- On save: call Sippy XML-RPC `updateRate` or portal upload endpoint
- **Note:** Sippy documentation confirms rate upload is possible via the bulk file uploader API (article `134679`)

---

### R2 — Bulk Rate Import from Sippy / Upload to Sippy 📥📤
**Priority:** 🔴 High | **Effort:** Medium-High

**What is missing:** No bulk import/export UI for rates. Sippy supports a bulk CSV/XLS uploader for routes, rates, and tariffs.

**Recommendation — New page:** `/rate-bulk-manager`
- **Download from Sippy:** Pull current tariff as CSV, display diff vs local version
- **Upload to Sippy:** Accept a rate CSV, validate format, preview changes, push with approval gate
- **Sippy XML-RPC endpoints to use:** `listRates`, `uploadRates` (or portal scrape `/b1/rate_list.php?upload=1`)
- **Integration with Approval Engine:** Route bulk rate uploads through the existing approval workflow before Sippy push

---

### R3 — Rate Card Distribution Engine 📧
**Priority:** 🟠 High | **Effort:** Medium

**What is missing:** No way to distribute rate cards to clients from within the platform. Carriers typically send rate sheets to customers via email when rates change.

**Recommendation — New feature within `/rate-cards`:**
- "Send to Client" button per rate card
- Select one or multiple client accounts
- Generate PDF rate card (using existing PDF generator in `server/manual-generator.ts`)
- Send via the existing email delivery system (`/api/notifications/send`)
- Log send history (who received which rate card, when)
- Optional: auto-send when a rate card is published/approved

---

### R4 — Rate Change Notification & Expiry Alerts 🔔
**Priority:** 🟠 Medium-High | **Effort:** Low-Medium

**What is missing:** No automated alerting when carrier rates change or when a rate is about to expire.

**Recommendation — Extension to `/alerts` and `/whatsapp-alerts`:**
- Add alert type: `rate_change` — triggered when Sippy returns a different rate for a destination vs. last snapshot
- Add alert type: `rate_expiry` — triggered 7/3/1 days before a rate's `valid_to` date
- Add alert type: `margin_breach` — triggered when buy rate exceeds sell rate for a destination (i.e. negative margin)
- Configure delivery per alert type: WhatsApp, email, or in-platform notification
- **Data source:** Compare against `tariff_versions` snapshots already being stored in DB

---

### R5 — Rate Comparison & Margin Calculator 📊
**Priority:** 🟠 Medium-High | **Effort:** Medium

**What is missing:** No structured comparison between what you pay carriers (buy rate) and what you charge clients (sell rate) at the destination level.

**Recommendation — New sub-tab in `/rate-cards` or new page `/margin-calculator`:**
- Input: destination prefix
- Output: table showing — all carriers offering that prefix → their buy rate → your sell rate → margin % → traffic volume (from CDRs)
- Color-coded margin bands: green (>15%), amber (5-15%), red (<5%), black (<0%)
- Export to CSV / PDF
- **Integration:** Feed into existing `/margin-intelligence` page as the source drill-down

---

### R6 — Low Balance Auto-Alert via Sippy Native Config 💰
**Priority:** 🟡 Medium | **Effort:** Low

**What is missing:** BitsAuto has its own alert system but does not expose or mirror Sippy's native low-balance notification configuration (Sippy article `77472`).

**Recommendation — New section in `/settings` or `/credit-control`:**
- Display each account's Sippy-configured low-balance threshold
- Allow threshold to be set from BitsAuto (write back to Sippy via XML-RPC `updateAccount`)
- Show which accounts have no low-balance threshold configured (risk exposure list)
- Send a BitsAuto alert when a balance crosses the threshold (independent of Sippy's own email)

---

### R7 — Commission Model Manager 🤝
**Priority:** 🟡 Medium | **Effort:** Medium

**What is missing:** Sippy supports configurable commission models (article `3000058549`) but BitsAuto only displays partner profiles without commission configuration.

**Recommendation — Extension to `/partner-profiles`:**
- Add "Commission Settings" section per partner
- Show current commission model type (flat, %, tiered)
- Allow editing commission parameters and pushing to Sippy via XML-RPC `updateAccount`
- Show projected commission based on current traffic volumes
- **Integration:** Link to `/revenue-heatmap` and `/margin-intelligence` for impact modelling

---

### R8 — Rate Proposal Generator with PDF Export 📄
**Priority:** 🟡 Medium | **Effort:** Medium

**What is missing:** KAMs cannot generate a rate proposal document for a prospective or existing client from within the platform.

**Recommendation — New feature accessible from `/kam-dashboard` and `/clients`:**
- Select client (or "New Prospect")
- Select destinations to include
- Apply markup % or fixed margin per destination
- Generate PDF rate proposal with BitsAuto/company branding (use existing `manual-generator.ts`)
- Options: download PDF, email directly to client contact
- Log in client history

---

### R9 — Tariff Version Comparison & Diff View 🔄
**Priority:** 🟢 Medium | **Effort:** Low

**What is partially done:** `/tariff-versions` page exists but depth is unknown.

**Recommendation — Enhance `/tariff-versions`:**
- Side-by-side diff view between two tariff versions
- Highlight: rates added, rates removed, rates changed (with before/after)
- Show affected traffic volume for changed destinations (from CDR history)
- Export diff as PDF or CSV for audit trail

---

### R10 — Sippy Bulk Rate Uploader Integration (Admin) 🗃️
**Priority:** 🟢 Low | **Effort:** High

**What is missing:** Sippy's bulk file uploader (article `134679`) supports mass-creating/updating routes, rates and tariffs via structured CSV. BitsAuto has no integration with this endpoint.

**Recommendation — Long-term feature `/rate-bulk-manager`:**
- Upload a rate sheet CSV → validate against Sippy's expected format
- Preview what will change (diff against current Sippy state)
- Submit through the approval workflow before applying
- Log all bulk uploads in the audit log
- **Note:** Some Sippy versions do not expose a rate push XML-RPC endpoint — use portal scrape as fallback

---

## Section 5 — Missing Features Summary (Priority Matrix)

| # | Feature | Area | Priority | Effort | Dependency |
|---|---|---|---|---|---|
| 1 | Route `rate-editor.tsx` at `/rate-editor` | Finance | 🔴 High | Low | None |
| 2 | Route `workspace-home.tsx` at `/workspace/:domain` or `/` | UX | 🔴 High | Low | None |
| 3 | SMS/A2P Monitor — implement or remove from nav | NOC | 🔴 High | High | Sippy SMS API |
| 4 | Rate Card Push to Sippy (write-back) | Finance | 🔴 High | Medium | Sippy XML-RPC |
| 5 | Bulk Rate Import/Export | Finance | 🔴 High | Medium | Sippy portal scrape |
| 6 | Rate Card Distribution Engine (email to clients) | Finance/KAM | 🟠 High | Medium | Existing email system |
| 7 | Rate Change & Expiry Alerts | Finance/NOC | 🟠 High | Low-Med | Tariff snapshots |
| 8 | Confirm routing of page naming mismatches (see §2.1) | Platform | 🟠 Medium | Low | Code audit |
| 9 | Rate Comparison & Margin Calculator | Finance | 🟠 Medium | Medium | CDR + rate data |
| 10 | Low Balance Sippy Config from BitsAuto | Finance | 🟡 Medium | Low | Sippy XML-RPC |
| 11 | Commission Model Manager | Finance/KAM | 🟡 Medium | Medium | Sippy XML-RPC |
| 12 | Rate Proposal Generator (PDF) | KAM | 🟡 Medium | Medium | PDF generator |
| 13 | Tariff Version Diff View | Finance | 🟢 Low | Low | Tariff snapshots |
| 14 | FAX Signaling Support | NOC | 🟢 Low | High | Sippy SIP |
| 15 | Commission Model per Partner | Finance | 🟢 Low | Medium | Sippy XML-RPC |
| 16 | Sippy Bulk Uploader Integration | Finance | 🟢 Low | High | Sippy portal |

---

## Section 6 — Architecture Health (May 2026)

### What Was Fixed This Session

| Item | Before | After |
|---|---|---|
| Portal switching | Changed labels only | Navigates to `defaultRoute` (NOC→`/noc-dashboard`, Finance→`/finance-cockpit`, KAM→`/kam-dashboard`) |
| Workspace Settings | No dedicated page | `/workspace-settings` — clean enterprise admin card UI |
| Governance Console | Mixed with admin | `/governance` — super_admin only; old `/navigation-governance` kept as alias |
| Navigation registries | Ungoverned expansion | All three arrays (`DOMAINS`, `SIDEBAR_GROUPS`, `WORKSPACE_RAIL`) frozen with `[MAINTENANCE-ONLY]` block comments |
| Portal layout ownership | Sidebar-swap only | Root `<div>` now stamps `data-portal`, `data-portal-mode`, `data-portal-theme` — CSS scoping enabled |

### Navigation Architecture Rules (Enforced)

```
Portal features    →  portal_sections + portal_module_assignments (DB only)
Full-platform      →  DOMAINS[] in app-nav-shell.tsx (maintenance-only)
Sidebar/Rail       →  MAINTENANCE-ONLY — no new features
Admin config       →  /workspace-settings (admin)
Arch config        →  /governance (super_admin only)
```

### Known Pre-Existing TypeScript Errors (Not New)

- `App.tsx:180` — `Record<Role, string[]>` missing `destination_manager`, `routing_admin`
- `App.tsx:575,688` — `"noc"`, `"finance"`, `"kam"` not assignable to `Role` type
- `layout-shell.tsx:276` — same Role type issue
- `app-nav-shell.tsx:601`, `layout-shell.tsx:526,891,943` — `Set` iteration requires `--downlevelIteration`

None of these affect runtime. They are pre-existing and should be resolved in a dedicated TypeScript hardening pass.

---

## Section 7 — Recommended Next Steps (Ordered)

1. **Immediate (no new code):** Fix routing mismatches in §2.1 — confirm `approval-queue.tsx`, `balance-monitor.tsx`, `calls-list.tsx`, `call-detail.tsx`, `vendor-profile.tsx` are properly imported in App.tsx
2. **This week:** Route `rate-editor.tsx` and `workspace-home.tsx` — both are done pages with no route
3. **This week:** Implement Rate Card Distribution (email to client) — uses existing email infrastructure
4. **This week:** Add Rate Change and Expiry Alerts — extends existing alert engine with two new alert types
5. **Next sprint:** Rate push to Sippy (write-back) — completes the rate management loop
6. **Next sprint:** Bulk Rate Import/Export — major commercial value for carrier management
7. **Next sprint:** Margin Calculator — ties together carrier buy rates and client sell rates
8. **Backlog:** SMS/A2P Monitor — implement or formally deprecate from nav
9. **Backlog:** Commission Model Manager — extends partner profiles with Sippy write-back
10. **Backlog:** TypeScript hardening pass — resolve 9 pre-existing type errors

---

*Report generated: May 28, 2026 | Platform: BitsAuto Monitoring Dashboard | Sippy Reference: https://support.sippysoft.com/support/solutions*
