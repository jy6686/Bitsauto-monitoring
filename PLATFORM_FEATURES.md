# Bitsauto VoIP Monitoring Platform — Full Feature Reference

> **Version**: Current build (May 2026)  
> **Stack**: React + Vite (frontend) · Express + TypeScript (backend) · PostgreSQL / Drizzle ORM · Replit Auth  
> **Live URL**: https://vo-ip-watcher--junaid70.replit.app

---

## Table of Contents

1. [Dashboard](#1-dashboard)
2. [Team Chat](#2-team-chat)
3. [Live Operations](#3-live-operations)
   - 3.1 Live Calls
   - 3.2 Alerts
   - 3.3 SBC Monitor
   - 3.4 AI Ops Center
   - 3.5 NOC View
   - 3.6 Multi-Switch View
4. [Routing & LCR](#4-routing--lcr)
   - 4.1 Routing Manager
   - 4.2 LCR Analyser
   - 4.3 Approval Queue
5. [Analytics](#5-analytics)
   - 5.1 BitsEye
   - 5.2 Revenue Analytics
   - 5.3 CDR Viewer
   - 5.4 Graphs
   - 5.5 QoS Heatmap
   - 5.6 Reports
   - 5.7 Traffic Map
6. [Intelligence](#6-intelligence)
   - 6.1 SIP Trace Viewer
   - 6.2 Carrier Scoring
   - 6.3 Network Topology (3D)
   - 6.4 Replay Engine
   - 6.5 RTP Analytics
   - 6.6 Number Intelligence
   - 6.7 Server Monitoring
7. [Security & Finance](#7-security--finance)
   - 7.1 Fraud / FAS Detection
   - 7.2 SLA Management
   - 7.3 Firewall Manager
   - 7.4 Compliance
   - 7.5 Balance Monitor
   - 7.6 Cost Optimisation
   - 7.7 Billing Disputes
8. [Platform](#8-platform)
   - 8.1 Settings
   - 8.2 Team & KAM
   - 8.3 Vendors
   - 8.4 Accounts (Clients)
   - 8.5 DID Management
   - 8.6 Rate Cards
   - 8.7 Products
   - 8.8 Rate Plan
   - 8.9 Client Portal
   - 8.10 Reseller Management
   - 8.11 API Keys
   - 8.12 VPN Config
   - 8.13 Call Flow Simulator
   - 8.14 Test Suite
   - 8.15 Notifications
   - 8.16 Tools
   - 8.17 SMS / A2P
9. [Global UX Systems](#9-global-ux-systems)
10. [Animation & Visual Effects Reference](#10-animation--visual-effects-reference)

---

## 1. Dashboard

**Route**: `/`  
**Access**: All authenticated roles

### How It Works

The dashboard is the command centre. On load it queries six parallel data sources:

| Data Source | API Endpoint | Purpose |
|-------------|-------------|---------|
| Sippy reachability | `/api/sippy/status` | Determines whether live-data widgets are shown or greyed out |
| Live call summary | `/api/sippy/live-calls/summary` | Populates active call count, ASR, ACD |
| KPI widget order | `/api/user-preferences` | Persists per-user widget layout across sessions |
| Alert count | `/api/alerts/summary` | Feeds the header badge |
| 7-day CDR volume | `/api/sippy/cdr/graphs?hours=168` | Powers the weekly stacked bar chart |
| Carrier scores (24h) | `/api/carrier-scores?window=24` | Powers carrier health sparklines |

**KPI Widget System**  
Users can drag-and-drop up to 12 KPI cards (Active Calls, ASR, ACD, PDD, Jitter, Latency, Packet Loss, MOS, Revenue, Margin, FAS Events, Alert Count). The order is saved per user via the preferences API and restored on next login. Each card animates into position using dnd-kit with pointer and touch sensors.

**Four Analytics Widgets** (below the KPI row):
1. **7-Day Traffic Volume** — stacked bar chart (recharts ComposedChart) showing daily call volume split by outcome (connected vs failed) over the rolling 168-hour window.
2. **Top Clients by Volume** — donut PieChart built from CDR data, colour-coded per client, with a legend showing share percentage.
3. **Carrier Health** — horizontal sparkline bars per carrier, colour-coded green/amber/red by stability score (0–100). Bars animate width on load with a 500ms CSS transition.
4. **Top Destinations** — ranked horizontal bar chart of the most-dialled country/prefix combinations in the current window.

**Fix Button** — every page including the dashboard has a floating "Fix" button (bottom-right). It runs page-specific diagnostics and offers one-click remediation (reconnect Sippy, flush cache, restart polling, etc.).

### Impact

- Single pane of glass: operations staff can assess the entire network health in under 10 seconds.
- Widget personalisation reduces cognitive load: each team member (NOC operator, KAM, management) sees only the KPIs they care about, in the order they prefer.
- The weekly trend + carrier health widgets surface pattern degradation that point-in-time metrics miss.

---

## 2. Team Chat

**Route**: `/chat`  
**Access**: All roles

### How It Works

A real-time internal messaging panel built with WebSocket (same NOC WebSocket connection). Messages are persisted to the PostgreSQL `chat_messages` table. Supports:
- Per-user display names and role badges
- Message timestamps
- Scroll-to-bottom auto-follow on new message

### Impact

Eliminates the need to switch to WhatsApp or Slack during an incident. Operators can coordinate directly inside the platform where all the relevant data is visible.

---

## 3. Live Operations

### 3.1 Live Calls

**Route**: `/calls`  
**Sub-tabs**: Call Summary · Call Details · Quality Monitor · Call History

#### How It Works

Polls Sippy's `listActiveCalls` XML-RPC method. To reduce server load, a **push-based NOC WebSocket** pushes updates every 10 seconds instead of each browser tab polling independently.

**Cache-first architecture**: the backend caches the last valid Sippy response. If Sippy is temporarily unreachable, the frontend shows stale data with a "last updated at" timestamp rather than an error screen.

**Mutex guard**: a server-side mutex prevents multiple concurrent XML-RPC calls from piling up during slow Sippy responses.

**Call Summary tab**: aggregate metrics — total active calls, connected, failed, average PDD, average MOS.

**Call Details tab**: live table of every active call with CLD, CLI, carrier, duration, SIP code, and a colour-coded MOS badge (Excellent / Good / Fair / Poor).

**Quality Monitor tab**: real-time Jitter, Latency, Packet Loss, and MOS charts using recharts. Values update on each WebSocket push.

**Call History tab**: last N completed calls pulled from Sippy CDRs, filterable by date range, client, and vendor.

#### Impact

- NOC operators detect call quality degradation within seconds rather than waiting for client complaints.
- WebSocket push model reduces Sippy XML-RPC load by ~65–70% versus per-tab polling.
- MOS badges provide at-a-glance quality triage without reading raw jitter/latency values.

---

### 3.2 Alerts

**Route**: `/alerts`  
**Access**: Admin, Management

#### How It Works

Alerts are generated by:
- Threshold breach rules (ASR drops below X%, PDD exceeds Y ms, MOS below 3.5)
- AI Ops anomaly engine detecting sigma deviations
- Manual escalation from Approval Queue

Alert records are stored in PostgreSQL with severity (critical / high / medium / low), affected entity, status (open / acknowledged / resolved), and a notes field for operator comments.

The sidebar badge shows the live open alert count, updating every 30 seconds via background query.

#### Impact

Transforms reactive firefighting into proactive incident management. Alert rules can be tuned per carrier or client to reduce noise while ensuring critical events are never missed.

---

### 3.3 SBC Monitor

**Route**: `/sbc-monitor`  
**Access**: Admin, Management

#### How It Works

Tracks Session Border Controller health metrics: registration counts, active sessions, CPU/memory utilisation (where exposed by the SBC API), and SIP OPTIONS heartbeat status.

#### Impact

Gives the network team early warning of SBC overload before it causes call failures.

---

### 3.4 AI Ops Center

**Route**: `/ai-ops`  
**Access**: Admin, Management

#### How It Works

Four integrated subsystems on one page:

**1. Anomaly Detection**  
Continuously compares live metrics (ASR, PDD, failure rate) against a rolling 168-hour baseline. Uses standard-deviation (sigma) scoring — events deviating >2σ are surfaced as anomalies with a root-cause narrative and recommended action. Each anomaly card shows: affected entity, current vs baseline value, sigma deviation, recommendation, and thumbs-up/thumbs-down feedback.

**2. Incident Correlation**  
Groups related anomaly signals into incidents. An incident record includes: title, entity, severity, start time, last-seen time, signal count, anomaly count, narrative, and a timeline JSON used to reconstruct the event sequence.

**3. Routing Suggestions**  
The engine evaluates carrier stability scores and current ASR trends, then produces actionable routing suggestions (e.g., "deprioritise Carrier X — ASR dropped from 74% to 41% in the last 2 hours"). Each suggestion shows confidence % and can be approved or dismissed.

**4. AI Copilot Panel**  
A natural-language query panel. The user types a question; the system matches it against 8 rule patterns and pulls live data to answer:

| Query Pattern | What It Does |
|---------------|-------------|
| "show active calls" | Returns current call count and breakdown |
| "which carrier has worst ASR" | Ranks carriers by rolling ASR ascending |
| "top failing destinations" | Lists destinations by failure rate |
| "MOS below 3" | Filters live calls with MOS < 3.0 |
| "open incidents" | Lists currently open AI Ops incidents |
| "carrier score for [name]" | Looks up stability score for named carrier |
| "revenue today" | Pulls today's CDR revenue sum |
| "anomalies in last hour" | Filters anomalies detected in past 60 min |

Responses animate in with a typing effect. The copilot does not use an external LLM — it is fully deterministic and works offline.

**5. Audio Alert Hook**  
Web Audio API synthesises three tones on anomaly detection:
- Low severity: 440 Hz soft tone
- Medium severity: 660 Hz medium tone  
- Critical: 880 Hz urgent tone

An opt-in toggle (Volume icon) in the top-right of the page controls whether audio fires. Preference is stored in localStorage.

#### Impact

- Anomaly detection catches degradation patterns that humans miss during quiet overnight periods.
- The copilot lets non-technical managers query network health in plain English without reading charts.
- Audio alerts allow NOC operators to work across multiple monitors and be notified without watching this tab.
- Routing suggestions translate raw data into actionable decisions, reducing the skill requirement for on-call staff.

---

### 3.5 NOC View

**Route**: `/noc-command`  
**Access**: Admin, Management

#### How It Works

A fullscreen cinematic dashboard designed for wall-mounted screens in a Network Operations Centre. On entering, the layout switches to a dark full-bleed mode hiding the sidebar.

**Incident Ticker**: a horizontally scrolling marquee strip at the top showing all active incidents in real time. If no incidents are open, it displays "All systems nominal" in green.

**Live KPI Header**: Active Calls, ASR, MOS, open incident count — updated every 10 seconds via the NOC WebSocket.

**Carrier Grid**: each tracked carrier displayed as a card showing stability score, rolling ASR, average PDD, and trend direction. Cards are colour-coded (green ≥75, amber 50–74, red <50) with an animated pulsing dot indicating live/degraded/critical status.

**Pulse Animation**: carrier status dots use a Framer Motion `scale + opacity` loop (scale 1→2.5→1, opacity 0.6→0→0.6 over 2.2s, infinite) creating a live heartbeat effect.

**Framer Motion sweep transitions**: KPI cards fade and translate in on load; the incident ticker entrance uses a horizontal slide animation.

#### Impact

- Gives the operations floor a passive, always-on network health view that requires no interaction.
- Incident ticker means any engineer walking past the NOC wall can immediately see if something is wrong.
- Removes dependency on individual workstation monitoring tools.

---

### 3.6 Multi-Switch View

**Route**: `/multi-switch`  
**Access**: Admin, Management

#### How It Works

Consolidates live metrics across multiple Sippy softswitch instances. Each switch is listed with its reachability status, active call count, and last-sync timestamp. Useful for organisations running primary + backup softswitches or multi-region deployments.

#### Impact

Eliminates the need to log into multiple Sippy admin panels to check cross-switch status.

---

## 4. Routing & LCR

### 4.1 Routing Manager

**Route**: `/routing-manager`  
**Sub-tabs**: Routing Groups · Destination Sets · Connections · On-Net Routing · QBR Dashboard · Policy Sim

#### How It Works

A direct interface to Sippy's routing layer, synced via XML-RPC and cached in PostgreSQL.

**Cache sync metadata** is displayed in the header: last sync time, sync status (ok / error / syncing), and counts for routing groups, destination sets, and connections.

**Routing Groups tab**: view and manage Sippy routing groups. Shows policy type, media relay setting, on-net flag, and member count. Supports creating new groups and editing existing ones — all write operations go through the **Approval Queue** if the approval engine is enabled.

**Destination Sets tab**: list all destination sets with currency, description, and connect fee. Click to drill into the rate entries within each set.

**Connections tab**: all vendor connections (trunk connections to carriers) with status and routing parameters.

**On-Net Routing tab**: special routing rules for on-network calls (calls that stay within the Sippy platform between customers).

**QBR Dashboard tab**: Quality of Business Review metrics — a periodic summary of routing performance by group and destination.

**Policy Simulator tab**: enter a test CLD and CLI and simulate which routing group and carrier the LCR engine would select, without placing a real call.

**Approval flow**: all create/edit/delete operations generate a `PendingApproval` record if the approval engine is active. The change is not applied to Sippy until an authorised approver accepts it. A toast notification with a deep-link to the specific approval request appears immediately after submission.

#### Impact

- Teams can review and adjust routing logic directly from the monitoring platform without switching to the Sippy admin UI.
- Approval workflow enforces a four-eyes principle on routing changes, preventing accidental misconfiguration in production.
- Policy Simulator validates routing decisions before real traffic is affected.

---

### 4.2 LCR Analyser

**Route**: `/lcr-analyser`  
**Access**: Admin, Management

#### How It Works

Analyses Sippy's Least-Cost Routing decisions. Displays which carriers are selected for which destinations, the rate applied, and whether a cheaper alternative exists. Highlights destinations where the LCR engine is not choosing the lowest-cost option due to quality filters.

#### Impact

Directly surfaces margin optimisation opportunities — destinations where a rate renegotiation or policy adjustment could reduce cost without impacting quality.

---

### 4.3 Approval Queue

**Route**: `/approvals`  
**Access**: Admin, Management, Super Admin, NOC Operator, Team Lead

#### How It Works

All write operations that touch Sippy (routing changes, account creation, rate updates, vendor modifications) can be routed through the approval engine. The queue shows:

- Pending request title and description
- Requesting user and timestamp
- The exact change (diff view where applicable)
- Approve / Reject actions with optional note

A **live count badge** on the sidebar nav item shows the number of pending requests, updated every 30 seconds. The badge pulses red when count > 0.

#### Impact

- Critical for multi-operator environments where junior staff need oversight.
- Creates an immutable audit log of every platform change.
- Prevents accidental production changes during off-hours by requiring management approval.

---

## 5. Analytics

### 5.1 BitsEye

**Route**: `/bitseye`  
**Sub-views**: Clients · Vendors · Destinations · Countries

#### How It Works

BitsEye is the primary drill-down analytics engine. It presents CDR-derived metrics through four lenses:

- **Clients view**: per-client breakdown of call volume, ASR, ACD, revenue, and margin. Click a client to drill into their traffic by destination.
- **Vendors view**: per-vendor breakdown of connected calls, failure rate, PDD, and cost.
- **Destinations view**: per-destination (prefix/country) breakdown of volume, ASR, and average rate.
- **Countries view**: geographic aggregation of the above.

KAM filtering: if a logged-in user is a KAM (Key Account Manager), BitsEye automatically restricts the client view to only their assigned accounts.

#### Impact

Replaces the need to run custom Sippy CDR reports. Management can answer "which client generated the most revenue this week?" in two clicks.

---

### 5.2 Revenue Analytics

**Route**: `/analytics`  
**Access**: Admin, Management

#### How It Works

30-day rolling P&L. Shows:
- Gross revenue (billed to clients)
- Gross cost (charged by vendors)
- Margin (absolute and percentage)
- Daily revenue/cost/margin line chart (recharts ComposedChart with Area)
- Per-client revenue table
- Per-vendor cost table

#### Impact

Finance and management can track profitability trends without exporting CDRs. Day-over-day margin drops are immediately visible.

---

### 5.3 CDR Viewer

**Route**: `/cdrs`  
**Sub-tabs**: Client CDRs · Vendor CDRs

#### How It Works

Paginated CDR table pulled directly from Sippy's CDR API. Supports filtering by:
- Date range (timezone-aware using the platform timezone context)
- CLI / CLD search
- SIP response code filter
- Duration filter

Any phone number in the CLI or CLD columns is clickable and opens the **Number Intelligence** panel as a slide-in Sheet.

#### Impact

Eliminates the need to log into Sippy's own CDR portal for routine lookups. The integrated Number Intelligence click-through saves time during call investigation.

---

### 5.4 Graphs

**Route**: `/graphs`  
**Access**: Admin, Management

#### How It Works

Pre-built time-series charts for ASR, ACD, PDD, and call volume trends. Time range selector (1h, 6h, 24h, 7d, 30d). Data sourced from aggregated CDR records in PostgreSQL.

#### Impact

Trend visibility for capacity planning and SLA reporting without building custom queries.

---

### 5.5 QoS Heatmap

**Route**: `/qos-heatmap`  
**Access**: Admin, Management

#### How It Works

A time-of-day × day-of-week heatmap (7 × 24 grid) showing average MOS, ASR, or PDD for each hour block. Colour intensity represents metric value — dark green = excellent, dark red = poor. Click a cell to see the underlying calls.

#### Impact

Reveals recurring quality degradation patterns (e.g., "every weekday at 14:00–15:00 PDD spikes on Carrier X"). This is impossible to spot in tabular CDR data.

---

### 5.6 Reports

**Route**: `/reports`  
**Access**: Admin, Management

#### How It Works

Scheduled and on-demand report generation. Report types include:
- Daily/weekly/monthly traffic summaries
- Carrier performance report
- Client billing summary
- SLA compliance report

Reports can be exported as Excel (.xlsx) using the `xlsx` library.

#### Impact

Provides management-ready documents without manual data assembly.

---

### 5.7 Traffic Map

**Route**: `/traffic-map`  
**Access**: Admin, Management

#### How It Works

Geographic visualisation of call traffic. Countries are colour-shaded by call volume (darker = more traffic). Hover a country to see volume, ASR, and revenue for that destination. Data sourced from CDR country-code aggregation.

#### Impact

Visually highlights which geographies drive revenue and which have quality issues, useful for sales targeting and routing investment decisions.

---

## 6. Intelligence

### 6.1 SIP Trace Viewer

**Route**: `/sip-trace`  
**Access**: Admin, Management

#### How It Works

Displays SIP message traces for calls. Parses the SIP INVITE → 100 Trying → 180 Ringing → 200 OK / 4xx/5xx/6xx sequence and renders it as a sequence diagram. Supports filtering by Call-ID, CLI, or CLD.

#### Impact

Network engineers can diagnose call setup failures (wrong codec negotiation, authentication failures, routing loops) without SSH access to the SBC.

---

### 6.2 Carrier Scoring

**Route**: `/carrier-scoring`  
**Access**: Admin, Management

#### How It Works

Each carrier is assigned a **Stability Score** (0–100) computed from:

| Component | Weight |
|-----------|--------|
| Rolling ASR (24h) | 40% |
| Average PDD | 20% |
| Failure rate | 25% |
| P95 PDD (tail latency) | 15% |

Scores are stored in the `carrier_scores` table with a `windowHours` field (24h and 168h snapshots).

**What Changed? Delta Panel**  
Compares each carrier's 24h score against their 168h baseline. For each metric (ASR, PDD, stability), shows:
- A coloured arrow: ↑ green (improving) / ↓ red (degrading) / → grey (stable)
- The absolute delta value and percentage change
- A micro sparkline of the trend

**Route Trace Table**  
Below the scores, shows the recent routing decisions for each carrier: which calls were sent, what the outcome was, PDD achieved, SIP code received, and failure category if applicable.

**Sorting & Filtering**: sort by stability score, ASR, PDD, or failure rate. Filter by trend direction (improving / stable / degrading).

#### Impact

- Transforms carrier management from anecdotal ("Carrier X feels slow") to data-driven ("Carrier X stability dropped 18 points in 24h, primarily driven by PDD P95 increasing from 1.2s to 3.8s").
- The delta panel makes the morning stand-up conversation precise: what changed overnight and by how much.
- Enables proactive re-routing before client-impacting failures.

---

### 6.3 Network Topology (3D)

**Route**: `/network-topology`  
**Access**: Admin, Management

#### How It Works

A fully interactive **3D force-directed graph** built with Three.js and React Three Fiber.

**Node placement**: carriers are arranged in a circular orbit at radius 5 units. Node size scales with sample count (more data = larger node). Each node material uses:
- `color`: green (score ≥75) / amber (50–74) / red (<50) — `THREE.Color`
- `emissive`: darker shade of the same hue for a glowing halo effect
- `PointLight` positioned at each node to cast local illumination

**Edges**: `Line` components from @react-three/drei connect every pair of carriers. Line colour matches the lower-scoring carrier's health colour.

**Traffic Particles**: animated `TrafficParticle` meshes flow along each edge. Each particle:
- Starts at a random position along the edge (staggered start via `Math.random()`)
- Moves from source to destination at `speed * 0.35` units/second
- Follows a gentle arc (sine wave offset on Y-axis, peak at midpoint)
- Disappears and restarts from the source when it reaches the destination

**Background**: `Stars` component from drei provides a deep-space starfield.

**Orbit Controls**: full pan, zoom, and rotate via `OrbitControls`. Reset button returns camera to default position.

**Click-to-detail**: clicking a carrier node opens a Framer Motion animated detail panel (slide in from right) showing stability score, ASR, PDD, failure rate, trend, and sample count.

#### Impact

- Makes carrier relationships and relative health immediately intuitive — no table reading required.
- The 3D traffic animation shows which carrier pairs are exchanging the most traffic at a glance.
- Useful for presenting network architecture to clients or stakeholders in meetings.

---

### 6.4 Replay Engine

**Route**: `/replay`  
**Access**: Admin, Management

#### How It Works

Reconstructs the LCR routing decision sequence for any historical call or test campaign run as an **animated step-by-step timeline**.

**Data source**: reads from the `route_traces` table. Traces are grouped by `runId` (a test campaign execution) or by `callId` (individual calls).

**Step builder**: from the raw trace records, the engine constructs a sequence of typed steps:

| Step Type | Meaning |
|-----------|---------|
| `engine` | LCR engine initialised for this destination |
| `evaluate` | Candidate routes evaluated (list shown) |
| `select` | A specific carrier was chosen (with decision reason) |
| `transmit` | Call was sent to the carrier |
| `pdd` | Post-Dial Delay measured |
| `success` | Call connected (200 OK) |
| `fail` | Carrier rejected (4xx/5xx/6xx) |
| `fallback` | Fallback triggered — moving to next candidate |

**Timeline UI**: steps are laid out vertically with connector lines. The currently active step is highlighted with an animated glow ring. A horizontal playhead moves through the timeline.

**Playback controls**: Play / Pause / Reset / Step-forward buttons. Playback speed: 1 step per 800ms by default.

**CDR fallback mode**: if no route traces exist, the engine falls back to CDR records and reconstructs a best-effort timeline from the CDR data.

**Run grouping**: the left panel lists all available run IDs. Selecting a run loads its full trace sequence.

#### Impact

- Turns opaque LCR decisions ("why did this call go to Carrier X and fail?") into a readable story.
- Engineers can replay failed test campaigns step by step to identify exactly where the routing logic broke.
- Reduces mean time to diagnosis for complex routing failures from hours to minutes.

---

### 6.5 RTP Analytics

**Route**: `/rtp-analytics`  
**Access**: Admin, Management

#### How It Works

Analyses Real-time Transport Protocol (RTP) stream metrics: jitter, packet loss, round-trip time, and MOS per active call. Data is polled from the Sippy RTP stats API.

#### Impact

Distinguishes between SIP-layer failures (call setup) and media-layer failures (audio quality during established calls), which require different remediation paths.

---

### 6.6 Number Intelligence

**Route**: `/number-intelligence`  
**Access**: Admin, Management

#### How It Works

A unified phone number enrichment panel. Enter any E.164 number and the system:

1. **Parses and normalises** the number, resolving the country code.
2. **Queries internal CDR history** to derive:
   - Line type (Mobile / Fixed / VoIP) — inferred from call routing behaviour
   - Porting status — detected from routing anomalies
   - Roaming status — inferred from country mismatch in CDR routing
   - STIR/SHAKEN attestation level — from P-Attestation headers in CDR data
3. **Runs reputation scoring** — cross-references against FAS event log, fraud flags, and CDR call patterns to produce a 0–100 risk score.
4. **Caches results for 24 hours** — subsequent lookups are instant.

**Deep integration**: any phone number anywhere on the platform (CDR Viewer CLI/CLD columns, Live Calls caller/callee, Fraud/FAS flagged numbers, DID Management, Test Call Launcher) is clickable and opens this panel as a slide-in Sheet.

**External HLR integration** (optional): connecting Telnyx, Neustar, or a private HLR gateway provides live carrier name and authoritative porting data.

**Recent Lookups** sidebar: history of the last 10 numbers looked up in this session.

#### Impact

- One-click enrichment during incident investigation eliminates manual number lookups across external tools.
- Reputation scoring surfaces high-risk callers before they generate FAS events.
- STIR/SHAKEN visibility helps predict which calls will fail robocall filtering at downstream carriers.

---

### 6.7 Server Monitoring

**Route**: `/server-monitoring`  
**Sub-tabs**: Reachability · Bandwidth (RTP) · Disk & Memory · Carrier ASR · Alert Rules · Reg Storm

#### How It Works

**Reachability tab**: pings all configured Sippy endpoints and SBCs, displaying latency (ms) and up/down status. Reachability history charted over 24h.

**Bandwidth (RTP) tab**: current and historical RTP bandwidth consumption. Useful for capacity planning.

**Disk & Memory tab**: server resource utilisation — disk I/O, RAM usage, CPU %. Alerts when thresholds are breached.

**Carrier ASR tab**: real-time per-carrier ASR monitoring with configurable alert thresholds. When a carrier's ASR drops below the threshold, an alert is generated and the carrier is highlighted.

**Alert Rules tab**: configure which metrics trigger alerts, at what thresholds, and with what notification methods (email, WhatsApp).

**Reg Storm tab**: monitors SIP registration rates. A sudden spike in registrations from a single IP can indicate a SIP scanner or botnet attack. The tab shows registration events per minute with source IP breakdown.

#### Impact

Infrastructure and network teams can monitor server health and detect attack traffic from within the same platform they use for call monitoring, eliminating tool-switching.

---

## 7. Security & Finance

### 7.1 Fraud / FAS Detection

**Route**: `/fraud`  
**Access**: Admin, Management

#### How It Works

**False Answer Supervision (FAS) Detection**  
FAS occurs when a vendor falsely signals call answer (200 OK) before the called party actually picks up, billing for ringing time. The system detects FAS by analysing:

- **Bill duration vs PDD ratio**: very short bill durations with high PDD are FAS indicators.
- **Zero-billed calls**: answered but zero-second calls suggest immediate hangup after fake answer.
- **Early answer rate**: 200 OK responses arriving faster than humanly possible (< 1-2 seconds).

**Per-vendor fraud scoring**: each vendor receives a composite fraud score (0–100) and a risk level (green / yellow / red) based on weighted FAS, short-call, zero-billed, and early-answer rates.

**Auto-Blacklist**: when a vendor's fraud score exceeds the configured threshold, the system can automatically add their traffic to a blacklist rule in Sippy, requiring manual review to reinstate.

**IRSF Detection**: International Revenue Share Fraud detection flags calls to known IRSF destination prefixes.

**FAS Event Log**: every detected FAS event is logged with caller, callee, client, vendor, PDD, bill seconds, SIP code, fraud score, and whether an alert was sent.

**Analysis Engine**: the "Analyze" button triggers a fresh scan of the CDR window, computing updated fraud scores for all vendors.

#### Impact

- FAS fraud can silently drain margins by 5–15% on affected routes. Early detection limits exposure.
- Auto-blacklist removes the human delay between detection and remediation, cutting fraud window from hours to minutes.
- Per-vendor scoring builds an objective evidence base for dispute conversations with carriers.

---

### 7.2 SLA Management

**Route**: `/vendor-sla-scorecard`  
**Access**: Admin, Management

#### How It Works

Unified view combining SLA scorecard and breach tracking. For each vendor, tracks SLA KPIs (ASR floor, PDD ceiling, MOS floor, uptime %) against contractual targets. Shows:
- Current vs target for each KPI
- RAG status (green / amber / red) per KPI
- Breach history (when a KPI fell below SLA threshold and for how long)
- SLA credit calculation based on breach duration and contractual credit terms

#### Impact

Provides objective, data-backed evidence for SLA credit claims against carriers. Prevents disputes from becoming subjective ("your call quality was bad" vs "your ASR was 41% against a contracted 65% for 47 minutes on March 12th").

---

### 7.3 Firewall Manager

**Route**: `/firewall`  
**Access**: Admin, Management

#### How It Works

Manages SIP-layer firewall rules: IP whitelist/blacklist, rate limiting rules, and SIP method filters. Rules can be pushed directly to Sippy via XML-RPC or managed as a platform-level overlay. Logs show which IPs were blocked and why.

#### Impact

First line of defence against SIP scanning, brute-force authentication attacks, and toll fraud originating from unauthorised IPs.

---

### 7.4 Compliance

**Route**: `/compliance`  
**Access**: Admin, Management

#### How It Works

Tracks regulatory compliance requirements: STIR/SHAKEN attestation rates, GDPR data retention policies, call recording consent flags, and audit log completeness. Generates a compliance health score.

#### Impact

Gives compliance and legal teams a dashboard view rather than requiring manual audit log reviews.

---

### 7.5 Balance Monitor

**Route**: `/balance`  
**Access**: Admin, Management

#### How It Works

Monitors credit balances for all clients and vendors on the Sippy platform. Pulls balances from Sippy's account API and alerts when a client balance drops below a configurable threshold (to prevent service interruption) or a vendor prepaid balance runs low (to prevent outbound call failures).

A sidebar badge can be configured to show when any balance is in a critical state.

#### Impact

Prevents unexpected service interruptions due to balance depletion. For post-paid clients, low-balance alerts trigger the billing team to issue invoices before usage limits are hit.

---

### 7.6 Cost Optimisation

**Route**: `/cost-optimisation`  
**Access**: Admin, Management

#### How It Works

Analyses CDR data to identify:
- Destinations where the current LCR carrier is not the cheapest option available
- Routes where traffic volume justifies renegotiating rates
- Underperforming routes where higher cost is not accompanied by higher quality
- Idle carriers consuming monthly minimum commitments with low traffic

Produces a prioritised list of optimisation opportunities with estimated monthly saving for each.

#### Impact

Directly actionable margin improvement. A single route renegotiation identified by this engine can save thousands per month on high-volume international traffic.

---

### 7.7 Billing Disputes

**Route**: `/billing-disputes`  
**Access**: Admin, Management

#### How It Works

Manages the lifecycle of billing disputes with vendors. Dispute records track: vendor, billing period, disputed amount, evidence (CDR export, FAS analysis), dispute status (open / submitted / resolved / rejected), and resolution amount.

#### Impact

Centralises dispute management. The ability to attach CDR exports and fraud analysis reports directly to a dispute record makes the evidence presentation to carriers more efficient.

---

## 8. Platform

### 8.1 Settings

**Route**: `/settings`  
**Sub-tabs**: General · Sippy Watcher

#### How It Works

**General tab**: platform-wide configuration — timezone, default date format, notification preferences, display name, session timeout.

**Sippy Watcher tab**: configure the background polling service:
- Sippy endpoint URL, XML-RPC credentials, and portal credentials
- Polling intervals for live calls, CDRs, and carrier scores
- Enable/disable individual polling jobs
- View last-sync timestamps and error counts per job
- Circuit breaker status (open / closed / half-open) per polling job — when a job fails 10 consecutive times, it opens its circuit breaker to protect Sippy from excessive retry load

#### Impact

Centrally controls how aggressively the platform queries Sippy. Tuning intervals reduces Sippy server load while maintaining the data freshness required for operations.

---

### 8.2 Team & KAM

**Route**: `/team`  
**Access**: Admin only

#### How It Works

**Team tab**: manage platform users. Assign roles (Super Admin / Admin / NOC Operator / Team Lead / Management / Viewer). Each role controls which sidebar sections and features are visible:

| Role | Access Level |
|------|-------------|
| Super Admin | Everything including approval override |
| Admin | Full platform access |
| Management | Analytics, Intelligence, Finance — no platform config |
| NOC Operator | Live Operations, Alerts, Approval Queue |
| Team Lead | Live Operations + Analytics |
| Viewer | Dashboard and read-only Live Calls |

**KAM tab**: manage Key Account Managers and their client assignments. KAMs see only their assigned clients in BitsEye and other KAM-filtered views. The org hierarchy supports nested KAM teams.

**Role Assignment tab**: bulk role assignment interface for teams with many users.

#### Impact

Role-based access prevents junior staff from accessing sensitive financial or configuration data. KAM scoping ensures account managers see only their book of business, reducing data leakage risk.

---

### 8.3 Vendors

**Route**: `/vendors`  
**Access**: Admin, Management

#### How It Works

Displays all vendor (carrier) accounts from Sippy. Supports creating new vendors, editing vendor details, and viewing per-vendor call statistics. Vendor creation requires: name, SIP gateway IP, authentication credentials, codec preferences, and rate currency. Changes go through the Approval Queue if enabled.

#### Impact

Single point of vendor record management without needing Sippy admin UI access.

---

### 8.4 Accounts (Clients)

**Route**: `/clients`  
**Access**: Admin, Management

#### How It Works

Manages client (customer) accounts on the Sippy platform. Shows account balance, allocated routing group, products, rate card assignment, and credit limit. Supports creating accounts, editing parameters, and viewing per-account CDR summaries.

#### Impact

Account managers can view and modify client accounts without Sippy portal access, with all changes subject to the approval workflow.

---

### 8.5 DID Management

**Route**: `/dids`  
**Access**: Admin, Management

#### How It Works

Lists all DIDs (Direct Inward Dialling numbers) provisioned on the platform. Shows assignment status (free / assigned to account), routing destination, and country. Supports bulk DID import and assignment. DID numbers are clickable to open the Number Intelligence panel.

#### Impact

Reduces DID provisioning time and prevents double-assignment errors that cause call routing failures.

---

### 8.6 Rate Cards

**Route**: `/rate-cards`  
**Sub-tabs**: Client Rate Cards · Vendor Rate Cards

#### How It Works

Manages the rate tables used to calculate revenue (client rates) and cost (vendor rates). Rate cards are organised by destination prefix. The rate editor supports:
- Bulk rate import via CSV/Excel
- Effective date (rate changes scheduled for future activation)
- Currency selection per rate card
- Prefix hierarchy (more specific prefixes override broader ones)

#### Impact

Rate card accuracy directly determines billing accuracy. A misconfigured rate card can overbill or underbill clients and distort margin calculations.

---

### 8.7 Products

**Route**: `/products`  
**Access**: Admin, Management

#### How It Works

Manages the product catalogue — the set of service offerings (e.g., "UK Termination Premium", "US Toll-Free") that clients subscribe to. Each product maps to a rate card, routing group, and set of quality parameters. Products use a **leading-digit prefix encoding** for classification (client vs vendor, destination region).

#### Impact

Products allow account managers to quickly assign a standardised service bundle to a new client rather than manually configuring each parameter individually.

---

### 8.8 Rate Plan

**Route**: `/company-profile`  
**Access**: Admin, Management

#### How It Works

The rate plan view shows the complete pricing structure — how client rates map to vendor costs for each destination, producing the margin per route. Supports exporting the full rate plan as an Excel file for sharing with clients or for internal review.

#### Impact

Finance and sales teams can immediately answer "what is our margin on UK calls for Client X?" without building custom queries.

---

### 8.9 Client Portal

**Route**: `/client-portal`  
**Access**: Admin, Management

#### How It Works

Manages the self-service client portal. Clients can log into the portal to view their own CDRs, check their balance, and download invoices. This page controls portal access settings, branded login page configuration, and which features are exposed to clients.

#### Impact

Reduces support ticket volume by enabling clients to self-serve routine queries (call records, balance checks).

---

### 8.10 Reseller Management

**Route**: `/reseller`  
**Access**: Admin, Management

#### How It Works

Manages reseller partners — third-party companies that sell the platform's termination services to their own clients. Resellers have their own rate cards (marked up from wholesale) and may have their own branded portal. This page manages reseller accounts, their assigned rate cards, and their client portfolios.

#### Impact

Enables a wholesale+resell business model without requiring separate platform instances per reseller.

---

### 8.11 API Keys

**Route**: `/api-keys`  
**Access**: Admin only

#### How It Works

Manages API keys for programmatic access to the platform. Keys are scoped by permission (read-only / read-write) and optionally IP-restricted. All API key operations are logged.

#### Impact

Enables third-party integrations (billing systems, CRM, custom dashboards) to consume platform data via a secure, audited API.

---

### 8.12 VPN Config

**Route**: `/vpn-config`  
**Access**: Admin only

#### How It Works

Manages VPN tunnel configurations for connecting to carrier networks or remote Sippy instances over encrypted tunnels. Shows tunnel status, negotiated parameters, and last-handshake time.

#### Impact

Ensures carrier interconnections are encrypted in transit, which is a requirement for certain regulatory environments (e.g., financial services customers).

---

### 8.13 Call Flow Simulator

**Route**: `/call-flow-simulator`  
**Access**: Admin, Management

#### How It Works

An interactive call flow diagram builder. Users define a call scenario (origination → routing → termination) with configurable parameters (CLI, CLD, routing group, codec) and the simulator traces the expected path through the system, predicting which carrier will be selected and what the expected quality metrics are.

Does not place a real call — it is a pure simulation using the current routing configuration.

#### Impact

Allows pre-deployment validation of routing changes. Engineers can confirm that a new routing policy will behave as expected before activating it in production.

---

### 8.14 Test Suite

**Route**: `/test-call` and `/test-campaigns`  
**Access**: Admin, Management

#### How It Works

**Test Call tab**: places a single real test call from a specified CLI to a CLD through a chosen routing group. Shows real-time call progress (ringing, connected, call quality metrics) and logs the result as a route trace.

**Test Campaigns tab**: batch test execution. Define a campaign as a set of (CLI, CLD, routing group) triplets and the system executes them sequentially or in parallel, collecting route traces for all. Campaign results feed the Replay Engine.

#### Impact

Provides an objective, repeatable way to validate carrier quality before and after routing changes. Campaigns can be run after every routing configuration change as a regression test.

---

### 8.15 Notifications

**Sub-menu**: Email Centre · WhatsApp Alerts  
**Access**: Admin only

#### How It Works

**Email Centre** (`/email-centre`): configures SMTP settings and email alert templates. Alerts (anomalies, balance warnings, SLA breaches, fraud events) are dispatched as formatted HTML emails to configured recipient lists.

**WhatsApp Alerts** (`/whatsapp-alerts`): configures WhatsApp Business API integration for real-time alert delivery. Critical and high-severity alerts are sent as WhatsApp messages to on-call numbers. Supports message templates compliant with WhatsApp's pre-approved format requirement.

#### Impact

Ensures critical events reach on-call engineers immediately via the channels they already monitor, without requiring them to have a browser tab open on the platform.

---

### 8.16 Tools

**Route**: `/tools`  
**Sub-tabs**: Carrier Quality · SIP Capacity · Bandwidth Plan · Burst Simulator · Route Tester · Translation

#### How It Works

**Carrier Quality**: enter a carrier name or gateway IP and get an instant quality report derived from CDR history (ASR, ACD, PDD, failure reasons).

**SIP Capacity**: calculate how many concurrent calls a given SIP trunk can handle based on codec, packet size, and available bandwidth.

**Bandwidth Plan**: given a target concurrent call count and codec mix, calculate the required bandwidth (uplink + downlink).

**Burst Simulator**: model the impact of a traffic burst (e.g., a campaign with 500 simultaneous outbound calls) on carrier capacity and cost.

**Route Tester**: enter a CLD and get the routing decision without placing a real call — similar to Policy Sim in Routing Manager but available as a standalone tool.

**Translation**: test number translation rules (regex-based prefix manipulation) — enter an input number and a translation rule and see the output.

#### Impact

Engineering tools that support capacity planning, pre-sales sizing, and routing configuration validation without requiring external tools or spreadsheets.

---

### 8.17 SMS / A2P

**Route**: `/sms-monitor`  
**Access**: Admin, Management  
**Status**: Planned

#### How It Works

Will monitor SMS and Application-to-Person messaging traffic through the platform. Currently a placeholder for a future feature.

#### Impact

Will extend the platform's monitoring capability beyond voice to SMS/messaging traffic.

---

## 9. Global UX Systems

### Command Palette

Triggered by `⌘K` (Mac) or `Ctrl+K` (Windows). Fuzzy-searches all nav items, recent CDR searches, and quick actions. Keyboard-navigable with arrow keys and Enter.

**Impact**: power users can navigate the entire platform without touching the mouse.

---

### Fix Button

A floating "Fix" button (bottom-right of every page) opens a diagnostic panel. The panel:
1. Runs page-specific health checks (Sippy reachability, cache freshness, API latency)
2. Lists detected issues with severity
3. Offers one-click remediation for each (reconnect, flush cache, restart polling job, clear stale data)

**Impact**: NOC operators can self-heal common issues without filing a ticket with the infrastructure team.

---

### Sippy Health Badge

A persistent indicator in the sidebar header showing the current Sippy connection state (Connected / Degraded / Unreachable) with a colour dot and latency reading. Updates every 30 seconds.

**Impact**: at a glance, any operator can see if the data they are looking at is live or potentially stale.

---

### Dark / Light Mode

Toggle available in the sidebar footer. Preference stored in localStorage and applied immediately without page reload. All components have explicit dark: variants via Tailwind.

---

### Mobile Responsive Layout

On narrow viewports, the sidebar collapses to a Sheet (slide-in drawer) triggered by a hamburger menu. All tables gain horizontal scroll. KPI cards reflow to a single column.

**Impact**: NOC operators can monitor the platform from a phone during off-hours without needing laptop access.

---

### Timezone Context

A platform-wide timezone context ensures all date/time values displayed and entered are converted correctly between the user's local timezone and UTC (which Sippy stores internally). The active timezone is shown in the Settings page and can be changed per-user.

**Impact**: teams operating across time zones see correct timestamps without mental arithmetic.

---

### Org Scope Context

A global context that loads the current user's KAM assignments and role on mount. All data-fetching hooks respect org scope — a KAM sees only their clients, an admin sees everything.

---

## 10. Animation & Visual Effects Reference

| Feature | Technology | Effect Description |
|---------|-----------|-------------------|
| **Network Topology nodes** | Three.js / React Three Fiber | Carrier spheres with emissive glow material, PointLight per node casting local illumination |
| **Network Topology edges** | @react-three/drei `Line` | Coloured connection lines between all carrier pairs |
| **Traffic particles** | Three.js `useFrame` | Mesh spheres flowing along carrier edges with sine-wave arc and staggered start positions |
| **Background starfield** | @react-three/drei `Stars` | Rotating star particle field in deep-space backdrop |
| **Orbit controls** | @react-three/drei `OrbitControls` | Full pan, zoom, and rotate of 3D scene |
| **Replay Engine timeline** | Framer Motion | Step-by-step animated playhead advancing through routing decision sequence |
| **Replay step transitions** | Framer Motion AnimatePresence | Steps fade/slide in as playhead advances |
| **NOC incident ticker** | Framer Motion `motion.div` | Horizontal marquee scroll of active incident titles |
| **NOC pulse dots** | Framer Motion `animate` | Scale 1→2.5→1, opacity 0.6→0→0.6, 2.2s infinite loop on carrier status indicators |
| **NOC KPI card entrance** | Framer Motion | Fade + translate-Y on mount |
| **Sidebar group accordion** | Framer Motion spring | Height 0→auto, opacity 0→1, spring stiffness 420 / damping 36 / mass 0.7 |
| **Sidebar submenus** | Framer Motion spring | Same spring parameters applied to nested sub-item lists |
| **Sidebar ChevronDown** | CSS transition | `rotate-180` on open, 150ms ease-in-out |
| **Sidebar group header** | CSS transition | Background + border fade in/out on open state, 150ms |
| **KPI card drag-and-drop** | dnd-kit | PointerSensor + TouchSensor (200ms delay), `rectSortingStrategy`, cards animate position during drag |
| **Carrier Health bars** | CSS | `transition-all duration-500` — bar width animates from 0 to score value on data load |
| **Dashboard Pie chart** | recharts | PieChart with animated mount, inner/outer radius donut |
| **AI Copilot response** | CSS + JS | Character-by-character typing animation on response reveal |
| **Audio alerts** | Web Audio API | Synthesised sine-wave tones at 440 / 660 / 880 Hz by severity — no audio files required |
| **MOS badges** | CSS transition | Smooth colour transition on value change |
| **Approval Queue badge** | CSS animation | Pulsing red dot on sidebar nav item when count > 0 |
| **Number Intelligence Sheet** | Shadcn Sheet | Slides in from right edge with spring transition |
| **Fix Button panel** | Framer Motion | Slide-up panel from bottom-right with fade |

---

*Document generated: May 2026. Reflects all features implemented and live on the current build.*
