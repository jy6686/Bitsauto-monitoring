# VoIP Watcher — Feature Roadmap & Proposals
**Prepared:** April 14, 2026  
**Platform:** Sippy Softswitch / VoIP NOC Dashboard  
**App URL:** https://vo-ip-watcher--junaid70.replit.app

---

## What's Already Live

| Module | Status |
|--------|--------|
| Real-time NOC Dashboard (ASR, ACD, PDD, MOS) | ✅ Live |
| Live Calls — Summary / Details / Quality / History | ✅ Live |
| BitsEye Per-Entity Live Graphs (Client / Vendor / KAM / Destinations) | ✅ Live |
| CDR Viewer with Country & Breakout enrichment | ✅ Live |
| Graphs — By Breakout, By Country, Time-Series | ✅ Live |
| Traffic Map (Geographic Visualization) | ✅ Live |
| FAS / Fraud Detection Engine | ✅ Live |
| Server & Host Monitoring (Latency, Bandwidth, Disk) | ✅ Live |
| Account Balance Monitor | ✅ Live |
| DID Management | ✅ Live |
| KAM Portfolio Management | ✅ Live |
| Watcher Recipients Alert System | ✅ Live |
| RBAC (Admin / Management / Viewer roles) | ✅ Live |
| Sippy Change-Detection Alerts | ✅ Live |
| Telecom Calculators (Tools page) | ✅ Live |
| Dial-Code Lookup with Country + Breakout | ✅ Live |

---

## Proposed New Features

---

### TIER 1 — High Impact, Directly Operational

---

#### 1. IRSF Detection Engine (International Revenue Share Fraud)
**What it is:** Beyond the existing FAS detector, IRSF targets premium-rate numbers in exotic destinations (Pacific Islands, Caribbean, satellite numbers). Fraudsters hijack accounts and blast calls to premium numbers that pay them a share.

**How it works:**
- Flag CDRs terminating to known IRSF-prone prefixes (a curated prefix list of ~3,000 high-risk codes)
- Alert when a single account makes >N calls to the same high-risk prefix within a rolling 15-minute window
- Auto-suggest blocking the account or prefix from within the alert

**Value:** Prevents runaway billing incidents that can cost thousands of dollars per hour.

---

#### 2. Auto-Blacklist System
**What it is:** A dynamic rule engine that automatically blocks calling numbers or destination prefixes based on live behavior triggers.

**How it works:**
- Define rules: "If a caller ID generates >X calls in Y minutes → auto-block"
- Rules push directly to Sippy via XML-RPC to set account access rules
- Whitelist override to protect legitimate high-volume callers
- Full audit trail of all automatic blocks with one-click unblock

**Value:** Closes the gap between fraud detection and remediation — currently a manual step.

---

#### 3. Revenue & Margin Analytics Dashboard
**What it is:** Financial overlay on top of traffic data — showing cost vs. sell rates per route, per client, and per destination.

**Proposed Sections:**
- **Margin per Client:** Revenue (sell rate × minutes) minus cost (buy rate × minutes)
- **Margin per Destination/Breakout:** Which routes are losing money?
- **Daily P&L Summary:** Revenue, cost, and gross margin for the rolling 30-day period
- **Worst-Performing Routes:** Destinations where margin is negative or below threshold
- **Rate Card Import:** Upload CSV rate sheets for clients and vendors; auto-reconcile against CDRs

**Value:** Turns the NOC dashboard into a business intelligence tool. Identifies unprofitable routes before the invoice cycle ends.

---

#### 4. MOS Score Trending & Quality Reports
**What it is:** Currently MOS scores are shown per-call in the Live view. This adds historical trending, averaging, and alerting on MOS degradation over time.

**Proposed Sections:**
- MOS trend chart over the last 24h / 7d / 30d, broken down by carrier and destination
- "Quality Events" log: any 15-minute window where average MOS drops below 3.5
- Carrier Quality League Table: rank vendors by average MOS
- Automatic alert when a carrier's rolling 1-hour MOS drops below configurable threshold

**Value:** Proactively catches codec or network degradation before clients complain.

---

#### 5. SIP OPTIONS Keepalive Monitor
**What it is:** Many SIP trunks send periodic SIP OPTIONS pings to verify trunk availability. This module tracks responses to detect silent trunk failures.

**How it works:**
- Configure SIP trunk endpoints (IP + port) to monitor
- Send SIP OPTIONS every 30 seconds; track response code (200 OK = healthy, timeout = down)
- Display trunk status (Up / Degraded / Down) on Server Monitoring page
- Alert when a trunk goes silent for >2 consecutive pings

**Value:** Catches trunk outages that TCP ping alone cannot — a trunk can accept TCP connections but reject SIP.

---

#### 6. Carrier Rate Card Management
**What it is:** Import and manage buy-rate sheets from carriers, making it possible to compute per-CDR cost and margin.

**How it works:**
- Upload CSV/Excel rate card per vendor (prefix, rate per minute, effective date)
- System matches each CDR's destination prefix (using the existing dial-code lookup) to the rate card
- Cost is calculated and stored alongside each CDR record
- Feeds into the Revenue & Margin Dashboard (#3 above)

**Value:** Foundational prerequisite for billing, margin analysis, and route optimization decisions.

---

### TIER 2 — Advanced Monitoring & Alerting

---

#### 7. Traffic Anomaly Detector (CPS / Concurrent Call Spike Alerts)
**What it is:** A statistical baseline engine that learns normal traffic patterns and alerts when spikes deviate significantly.

**How it works:**
- Build a per-hour baseline for CPS and concurrent calls (rolling 14-day average)
- Alert when current value is >2 standard deviations above the baseline
- Distinguish between "expected business-hours peak" and "3 AM spike" automatically
- Display anomaly timeline on the Graphs page with baseline overlay

**Value:** Catches traffic hijacking and toll fraud in the early stages, before it escalates.

---

#### 8. Capacity Planning Module
**What it is:** Forward-looking analysis to predict when the switch will hit its concurrent call or CPS limit.

**How it works:**
- Analyze 90-day traffic growth trend using linear regression
- Project when peak concurrent calls will reach the configured switch capacity limit
- Show "Days until capacity breach" indicator on Dashboard
- Exportable capacity report for procurement/engineering decisions

**Value:** Shifts operations from reactive to proactive; supports infrastructure budgeting.

---

#### 9. SIP Signaling Trace Integration (Homer / HEP)
**What it is:** Integration with Homer (the open-source SIP capture server) to display SIP ladder diagrams directly inside the app.

**How it works:**
- Configure Homer API endpoint in Settings
- On the Call Detail page, a "SIP Trace" tab fetches the full SIP dialog (INVITE → 200 OK → BYE) from Homer
- Render as a visual ladder diagram showing each message, timestamp, and hop
- Highlight error responses (4xx/5xx) in red

**Value:** Eliminates the need to open Homer separately; provides full-stack call diagnostics in one place.

---

#### 10. Registration Storm Detection & KAM Alert
**What it is:** Server Monitoring already detects registration storms. This expands it with root-cause attribution and KAM-level alerting.

**How it works:**
- When a registration storm is detected, correlate the source IPs against the Client/Vendor database
- Identify which account is responsible
- Notify the assigned KAM via email/Telegram immediately
- Provide one-click option to rate-limit or block the offending source IP

**Value:** Reduces MTTR (Mean Time to Resolve) for registration attacks from hours to minutes.

---

#### 11. WhatsApp / Telegram Push Alerts
**What it is:** Extend the existing email-based Watcher Recipients system to send alerts via WhatsApp Business API or Telegram Bot.

**How it works:**
- Add "Telegram Chat ID" and "WhatsApp number" fields to Watcher Recipient profiles
- All existing alert types (balance low, ASR drop, fraud event, host down) are dispatched to all configured channels simultaneously
- Rich message formatting: inline charts/tables in Telegram markdown

**Value:** NOC teams respond faster to phone notifications than email; critical for after-hours oncall coverage.

---

### TIER 3 — Reporting & Business Tools

---

#### 12. Interconnect Billing Report Generator
**What it is:** Generate client-ready invoice reports from CDR data, formatted as PDF or Excel.

**How it works:**
- Select client, billing period (date range), and rate card
- System aggregates CDRs by destination, applies rates, and produces:
  - Summary invoice (total minutes, total cost per destination group)
  - Itemized CDR attachment
- Export as PDF (with company logo) or Excel
- Send directly to client email from within the app

**Value:** Eliminates manual invoice generation; creates a closed loop from CDR → billing → client delivery.

---

#### 13. Scheduled Report Delivery
**What it is:** Automate the delivery of daily/weekly/monthly traffic and quality reports to stakeholders.

**Proposed Report Types:**
- Daily Traffic Summary (sent 06:00 every morning)
- Weekly Quality Report (ASR, ACD, MOS trends)
- Monthly Billing Summary per client
- Fraud / FAS Incident Digest

**Configuration:** Each report type has a recipient list (from Watcher Recipients), schedule (cron-style), and format (PDF / inline email).

**Value:** Keeps management informed without them having to log in; standard enterprise expectation.

---

#### 14. CDR Export with Enrichment
**What it is:** Export CDRs to CSV/Excel with all enriched fields already attached — Country, Breakout, Carrier, Cost, KAM name.

**How it works:**
- Filter CDRs by date range, client, vendor, country, or breakout
- Click "Export" → downloads enriched CSV instantly
- Background export for large date ranges (>100K records) with email notification when ready

**Value:** Removes the need for separate BI tools; enables easy reconciliation with carrier invoices.

---

#### 15. Route Quality Analysis Heatmap
**What it is:** A visual heatmap showing ASR, ACD, and MOS across all destination countries for a selected time period.

**How it works:**
- X-axis: Time (hours or days)
- Y-axis: Destination country or breakout
- Color intensity: ASR value (green = good, red = poor)
- Click any cell to drill into the specific CDRs for that country/hour
- Complements the existing By Country chart in Graphs

**Value:** Quickly identifies time-of-day quality degradation patterns — e.g., a carrier performing poorly to Pakistan between 18:00–22:00 UTC.

---

### TIER 4 — Compliance & Security

---

#### 16. STIR/SHAKEN Compliance Dashboard
**What it is:** Track attestation levels (A/B/C) reported in CDRs to monitor call authentication compliance.

**How it works:**
- Parse STIR/SHAKEN PASSporT data from SIP headers (via Sippy CDR fields if available)
- Show percentage of calls with full (A), partial (B), or gateway (C) attestation
- Flag calls with no attestation that originate from US/Canada destinations (regulatory requirement)
- Trend chart showing attestation rates over time

**Value:** Required for US-terminating traffic; demonstrates regulatory compliance to enterprise clients.

---

#### 17. CLI/ANI Spoofing Detector
**What it is:** Identifies calls where the caller ID is technically valid but statistically suspicious.

**Detection Signals:**
- Same caller ID used to call >50 unique destinations in 1 hour
- Caller ID belongs to a geographic region that doesn't match the account's country
- Sequential caller IDs (e.g., +1-555-0001, +1-555-0002...) — robocall indicator
- Known spoofed number blacklist (FCC/Ofcom published lists)

**Value:** Complements IRSF and FAS detection to form a comprehensive fraud intelligence layer.

---

#### 18. Audit Log Viewer
**What it is:** A searchable, tamper-evident log of all administrative actions taken in the platform.

**Logged Events:**
- User logins, failed logins, password changes
- Configuration changes (settings, thresholds, rate cards)
- Manual call disconnections
- Account blocks/unblocks
- Alert rule changes
- Watcher recipient changes

**Display:** Filterable table by user, action type, and date range. Exportable to CSV.

**Value:** Essential for multi-user teams; supports incident post-mortems and security audits.

---

#### 19. Two-Factor Authentication (2FA)
**What it is:** Add TOTP-based 2FA (Google Authenticator / Authy compatible) as an optional or mandatory layer on top of existing Replit Auth.

**How it works:**
- Admin can require 2FA for all users with Admin or Management roles
- QR code enrollment flow on first login after 2FA is enabled
- Recovery codes generated at enrollment
- 2FA status shown in Team Management page

**Value:** Security hardening for a platform that has access to live switch controls and billing data.

---

### TIER 5 — UX & Workflow Improvements

---

#### 20. Customizable Dashboard Widgets
**What it is:** Allow each user (especially Viewers) to configure which KPI cards, charts, and alerts appear on their personal Dashboard.

**How it works:**
- Drag-and-drop widget editor (similar to Grafana panels)
- Widget library includes: ASR card, live calls count, balance ticker, MOS trend, BitsEye mini-graph, fraud event count, host status summary
- Settings saved per-user; Viewers see only their assigned entities

**Value:** Makes the Viewer role genuinely useful — NOC operators see exactly what they need, nothing more.

---

#### 21. Dark / Light Mode Toggle
**What it is:** Currently the app is dark-mode only. A toggle would make it usable in bright office environments.

**How it works:**
- Theme toggle button in the top bar
- All chart colors, backgrounds, and text adapt automatically
- Preference saved in localStorage

**Value:** Improves usability for management/finance users reviewing reports in office settings.

---

#### 22. Mobile-Responsive NOC View
**What it is:** A simplified, touch-friendly layout for monitoring on mobile (phone/tablet).

**Proposed Mobile Layout:**
- Dashboard: stacked stat cards + alert banner
- Live Calls: horizontal scroll table with color-coded rows
- Push notifications when alerts fire (browser notification API)

**Value:** On-call engineers can monitor the switch from their phone without needing a laptop.

---

#### 23. Quick Actions Command Bar
**What it is:** A keyboard-shortcut-driven command palette (like VS Code's `Ctrl+P` or Linear's `Cmd+K`) for power users.

**Actions Available:**
- Jump to any page instantly
- Look up a phone number (dial-code lookup)
- Disconnect a live call by ID
- View balance of a specific account
- Search CDRs by call ID or phone number

**Value:** Dramatically speeds up NOC workflows for engineers who manage high call volumes.

---

#### 24. API Key Management for External Integrations
**What it is:** Generate API keys that allow external systems (billing platforms, CRMs, monitoring tools) to query VoIP Watcher data.

**Proposed Endpoints Exposed:**
- `GET /ext/api/live-calls` → current active calls
- `GET /ext/api/balance/{vendor}` → current vendor balance
- `GET /ext/api/asr-acd` → current ASR/ACD stats
- Webhook push: send alerts to external systems as JSON POST

**Value:** Transforms the app from a standalone tool into an integration hub; enables automation workflows.

---

## Feature Priority Summary

| Priority | Feature | Effort | Value |
|----------|---------|--------|-------|
| 🔴 Critical | IRSF Detection Engine (#1) | Medium | Very High |
| 🔴 Critical | Auto-Blacklist System (#2) | Medium | Very High |
| 🟠 High | Revenue & Margin Analytics (#3) | High | Very High |
| 🟠 High | Carrier Rate Card Management (#6) | Medium | Very High |
| 🟠 High | WhatsApp / Telegram Alerts (#11) | Low | High |
| 🟠 High | Traffic Anomaly Detector (#7) | Medium | High |
| 🟡 Medium | MOS Score Trending (#4) | Medium | High |
| 🟡 Medium | Scheduled Report Delivery (#13) | Medium | High |
| 🟡 Medium | Billing Report Generator (#12) | High | High |
| 🟡 Medium | SIP OPTIONS Monitor (#5) | Low | Medium |
| 🟡 Medium | CDR Export with Enrichment (#14) | Low | Medium |
| 🟡 Medium | Audit Log Viewer (#18) | Low | Medium |
| 🟢 Nice to Have | Route Quality Heatmap (#15) | Medium | Medium |
| 🟢 Nice to Have | Capacity Planning Module (#8) | Medium | Medium |
| 🟢 Nice to Have | CLI/ANI Spoofing Detector (#17) | Medium | Medium |
| 🟢 Nice to Have | Homer SIP Trace Integration (#9) | High | High |
| 🟢 Nice to Have | Customizable Dashboard (#20) | High | Medium |
| 🟢 Nice to Have | STIR/SHAKEN Dashboard (#16) | Low | Medium |
| 🟢 Nice to Have | Two-Factor Authentication (#19) | Medium | Medium |
| 🟢 Nice to Have | API Key Management (#24) | High | Medium |

---

## Implementation Notes

- All features are designed for **Sippy XML-RPC only** — no VOS3000 dependencies
- Features #1, #2, #7 build on the existing FAS detection engine already in production
- Features #3, #6, #12, #13 form a natural billing workflow cluster — best built together
- Feature #11 (Telegram/WhatsApp) requires only the Watcher Recipients system already live — low hanging fruit
- Features #14 (CDR Export) is essentially a backend-only enhancement — quick win
- Homer (#9) requires a separate Homer server to be deployed; app-side effort is moderate

---

*Document prepared for internal review. All features are backwards-compatible with the existing schema and do not require breaking changes.*
