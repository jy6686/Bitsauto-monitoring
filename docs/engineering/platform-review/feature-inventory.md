# Feature Inventory `[V @ app-nav-shell.tsx DOMAINS]`

Complete nav catalog: **11 top-nav domains, 146 feature links** (~150 pages).
Authoritative source = `client/src/components/app-nav-shell.tsx` `DOMAINS[]`.
Grouped by domain → feature group → features (route). This is factual (verified in
code); business purpose is a separate `[institutional]` pass.

## 1. Live Network (`live-network`)
- **Live Operations:** Live Calls `/calls` · Alerts `/alerts` · Live Traffic `/live-traffic` · Traffic Map `/traffic-map` · Call Governance `/call-governance`
- **Command Centre:** NOC Dashboard `/noc-dashboard` · Incident Command `/noc-incidents` · NOC Command `/noc-command` · Ops Console `/ops-console`
- **Infrastructure:** Server Monitor `/server-monitoring` · SBC Monitor `/sbc-monitor` · Network Topology `/network-topology` · Live Traffic Map `/live-traffic-map` · Graphs `/graphs` · Multi-Switch `/multi-switch`

## 2. Clients (`company`)
- **Account Management:** Accounts `/clients` · Client Portal `/client-portal` · Client Identity `/client-identity` · KAM Dashboard `/kam-dashboard` · Resellers `/reseller` · Company List `/company/list`
- **Onboarding:** Account Wizard `/client/wizard` · Onboarding Wizard `/company/onboarding` · Org Management `/company-profile`
- **Assets & Numbers:** DID Management `/dids` · Account Names `/account-names`

## 3. Operations (`operations`)
- **Carriers:** Vendor List `/vendors` · Balance Monitor `/balance` · SLA Scorecard `/vendor-sla-scorecard` · Carrier Scoring `/carrier-scoring` · Health Engine `/vendor-health`
- **Routing:** Routing Manager `/routing-manager` · Auth Studio `/auth-studio` · LCR Analyser `/lcr-analyser` · Route Tester `/test-call` · Route Simulator `/call-flow-simulator` · Self-Heal `/self-heal` · Route Testing `/route-testing`
- **Messaging:** SMS Monitor `/sms-monitor` · Voice OTP `/voice-otp` · Comm Policies `/communication-policies` · Commercial Notifs `/commercial-notifications` · Sender Profiles `/sender-profiles` · Termination Chains `/termination-chains`
- **Diagnostics:** SIP Trace `/sip-trace` · Replay Engine `/replay` · Test Campaigns `/test-campaigns` · Tools `/tools`

## 4. BitsEye (`telemetry`)
- **Telemetry Platform:** BitsEye 2.0 `/bitseye2` · BitsEye Classic `/bitseye` (+ cross-links)

## 5-11. Remaining domains
The remaining domains (Commercial / Analytics / Finance / Portals / Admin / etc.)
follow the same structure in `DOMAINS[]`. **To complete:** transcribe the rest from
`app-nav-shell.tsx` (lines ~44-420) and reconcile against `client/src/pages/*.tsx`
(~150 pages) to flag any page **not** reachable from nav (orphan pages) and any nav
link **without** a page (dead links).

> Completion tasks:
> - [ ] Transcribe domains 5-11 fully.
> - [ ] Cross-check 146 nav links ↔ ~150 pages → orphans / dead links.
> - [ ] Tag each feature Active/Frozen (BitsEye2 is Frozen; see governance §2).
