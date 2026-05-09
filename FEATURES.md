# Bitsauto Monitoring Platform — Feature Reference

> Complete reference for all implemented features across the Bitsauto VoIP Monitoring Platform.

---

## Table of Contents

1. [Real-Time Monitoring](#1-real-time-monitoring)
2. [Call Analytics & Reporting](#2-call-analytics--reporting)
3. [Routing Manager](#3-routing-manager)
4. [BitsEye — Drill-Down Analytics](#4-bitseye--drill-down-analytics)
5. [Fraud / FAS Detection](#5-fraud--fas-detection)
6. [Finance & Rate Management](#6-finance--rate-management)
7. [Multi-Switch Consolidated View](#7-multi-switch-consolidated-view)
8. [Test Call Launcher & Campaigns](#8-test-call-launcher--campaigns)
9. [SIP Trace Viewer](#9-sip-trace-viewer)
10. [Routing Intelligence Engine](#10-routing-intelligence-engine)
11. [Number Intelligence Layer](#11-number-intelligence-layer)
12. [SBC / Media Plane Monitor](#12-sbc--media-plane-monitor)
13. [Client Self-Service Portal](#13-client-self-service-portal)
14. [Reseller Management](#14-reseller-management)
15. [Compliance & Regulatory Dashboard](#15-compliance--regulatory-dashboard)
16. [SMS / A2P Messaging Monitor](#16-sms--a2p-messaging-monitor)
17. [AI Operations Center](#17-ai-operations-center)
18. [Security & Access](#18-security--access)
19. [Administration](#19-administration)

---

## 1. Real-Time Monitoring

**Route:** `/calls`  
**Roles:** Admin, Management, Viewer (with assignment)

Live call data streamed from the Sippy softswitch via WebSocket push.

### Sub-views

| View | Description |
|------|-------------|
| **Active Call Summary** | Aggregated stats — CPS, concurrent calls, ASR, ACD, PDD |
| **Active Call Details** | Per-call table with CLI, CLD, duration, codec, vendor |
| **Quality Monitoring** | MOS, Jitter, Latency, Packet Loss per active call |
| **Call History** | Last 500 calls with outcome and quality indicators |

### Architecture Notes
- Uses a NOC WebSocket for push-based updates — significantly reduces Sippy polling load
- Cache-first strategy: `/api/sippy/live-calls` serves cached data; polling runs in background with mutex guards
- Staggered polling intervals to prevent thundering herd on Sippy XML-RPC API

---

## 2. Call Analytics & Reporting

**Route:** `/reports`, `/cdrs`, `/analytics`, `/bitseye`, `/graphs`

### CDR Viewer (`/cdrs`)
- Client and Vendor CDR tabs
- Filterable by CLI, CLD, date range, outcome
- Export to CSV
- Portal scraping fallback if XML-RPC returns 401

### ASR/ACD Reports (`/reports`)
- Per-caller ASR and ACD breakdown
- Configurable highlight threshold (flag ASR below N%)
- Group by CLI or CLD
- Route quality sub-tab

### BitsEye Analytics (`/bitseye`)
- Deep drill-down analytics by: Clients, Vendors, Destinations, Countries
- Per-KAM view (Admin/Management scope management)
- Revenue & Margin analysis

---

## 3. Routing Manager

**Route:** `/routing-manager`  
**Roles:** Admin, Management

Full read/write integration with Sippy routing entities.

| Tab | Description |
|-----|-------------|
| **Routing Groups** | List, create, and configure routing group policies |
| **Destination Sets** | Manage destination sets and per-route preferences |
| **Connections** | View and configure vendor connections |
| **QBR** | Quality-Based Routing policy analysis |
| **Policy Simulator** | Simulate routing decisions before applying |

### Local Cache
Routing data is cached locally in PostgreSQL (`routing_groups_cache`, `destination_sets_cache`, `connection_vendor_cache2`) with sync metadata in `routing_cache_meta`. Enables fast reads without hammering Sippy.

---

## 4. BitsEye — Drill-Down Analytics

**Route:** `/bitseye`  
**Roles:** Admin, Management, Viewer (with assignment)

Purpose-built analytics engine for VoIP operations.

- **Clients view** — per-account traffic, revenue, quality
- **Vendors view** — per-vendor ASR, cost, margin
- **Destinations view** — per-destination traffic heatmap
- **Countries view** — geographic traffic distribution
- KAM-scoped views for account managers

---

## 5. Fraud / FAS Detection

**Route:** `/fraud`  
**Roles:** Admin, Management

### Detection Methods
- **FAS (False Answer Supervision)** — short-duration call pattern analysis
- **IRSF (International Revenue Share Fraud)** — high-cost destination volume spikes
- **Auto-Blacklist** — automatic IP/CLI blacklisting on threshold breach
- **SIP OPTIONS Monitor** — registration storm detection

### Firewall Manager (`/firewall`)
- Manage IP allowlists and blocklists
- SIP trunk access control rules
- Export firewall rules to Sippy

---

## 6. Finance & Rate Management

**Routes:** `/balance`, `/rate-cards`, `/cost-optimisation`, `/billing-disputes`

### Balance Monitor (`/balance`)
- Live balance polling for all configured Sippy accounts
- Low-balance alerts with configurable thresholds
- Balance trend sparklines

### Rate Cards (`/rate-cards`)
- Client Rate Cards — rates sold to customers
- Vendor Rate Cards — rates purchased from carriers
- Margin analysis (client vs vendor by destination)

### Cost Optimisation Engine (`/cost-optimisation`)
- Automated LCR suggestion engine
- Identifies underutilised low-cost routes
- Savings opportunity ranking

### Billing Disputes (`/billing-disputes`)
- Log, track, and resolve billing disputes with vendors
- Status workflow: open → investigating → resolved / rejected
- Linked to CDR evidence

---

## 7. Multi-Switch Consolidated View

**Route:** `/multi-switch`  
**Roles:** Admin, Management

Single-pane view across multiple Sippy softswitch instances.

- Aggregate live call counts across all switches
- Per-switch health indicators
- Consolidated ASR and ACD
- Switch failover status

---

## 8. Test Call Launcher & Campaigns

**Routes:** `/test-call`, `/test-campaigns`  
**Roles:** Admin, Management

### Test Call Launcher (`/test-call`)
- Launch live test calls via Sippy `make2WayCallback` XML-RPC
- Smart CLI selection — avoids routing the test call back to the caller's own number
- Result interpretation with amber "Your phone is ringing" banner when `cli = cld`
- CDR lookup to verify call outcome post-dial

### Scheduled Test Campaigns (`/test-campaigns`)
- Define recurring test schedules (hourly, daily, weekly)
- Multiple destination targets per campaign
- Pass/fail threshold configuration (min ASR, max PDD, min MOS)
- Campaign history with trend charts
- Alert integration on campaign failure

---

## 9. SIP Trace Viewer

**Route:** `/sip-trace`  
**Roles:** Admin, Management  
**DB Tables:** None (stateless)

Interactive SIP signalling ladder diagram from raw trace input.

### Features
- **Paste raw SIP trace** or upload a `.txt`/`.log` file
- **Automatic parser** — detects SIP requests (INVITE, BYE, ACK, CANCEL, OPTIONS, REGISTER…) and responses (100–699)
- **Interactive ladder diagram** — click any message to expand raw SIP headers
- **Call summary** — detected Call-ID, message count, connection status (connected / failed / incomplete)
- **Message type breakdown** — count per SIP method/response code

### Supported Formats
- Sippy packet dump logs (emailed via Admin → Tools → Packet Dump)
- Wireshark SIP dissector plain-text exports
- Any SIP debug log with blank-line-separated message blocks

### Sippy Integration
Sippy sends packet dumps by email — paste them directly into this viewer. Future: automatic CDR-linked capture retrieval.

---

## 10. Routing Intelligence Engine

**Route:** `/routing-intelligence`  
**Roles:** Admin, Management  
**DB Tables:** `routing_rules`  
**API:** `GET/POST /api/routing-rules`, `PATCH /api/routing-rules/:id`, `DELETE /api/routing-rules/:id`

Automated rule-based routing action engine evaluated against live Sippy metrics.

### Rule Anatomy

| Field | Options |
|-------|---------|
| **Metric** | ASR, ACD, Concurrent Calls, Cost/Min, MOS, PDD, Packet Loss |
| **Operator** | < (lt), > (gt), ≤ (lte), ≥ (gte) |
| **Threshold** | Numeric value in the metric's unit |
| **Duration** | Sustained for N minutes before firing |
| **Scope** | Optional vendor and/or destination filter |
| **Action** | Alert Only, Deprioritise Route, Flag for Approval, Block |

### Actions
- **Alert Only** — fires a platform alert without route changes
- **Deprioritise** — lowers route priority in Sippy via approval queue
- **Flag for Approval** — queues a routing change for human sign-off before applying
- **Block** — queues vendor/route block for human approval

> All write actions go through the Approval Queue — no automatic route mutations without human confirmation.

### Evaluation
Rules are evaluated every 5 minutes against live Sippy data. `triggerCount` and `lastTriggeredAt` are recorded per rule.

---

## 11. Number Intelligence Layer

**Route:** `/number-intelligence`  
**Roles:** Admin, Management  
**DB Tables:** `number_lookup_cache`  
**API:** `GET /api/number-lookup/:number`

Per-number intelligence lookup with 24-hour result caching.

### Data Points

| Field | Source |
|-------|--------|
| Country & Country Code | E.164 prefix analysis |
| Carrier | External HLR / internal |
| Line Type | mobile / fixed / VoIP / toll-free |
| Number Active | HLR query |
| Ported | Local number portability database |
| Roaming | HLR query |
| CNAM | CNAM lookup API |
| STIR/SHAKEN Level | CDR attestation data (A / B / C / unsigned) |
| Reputation Score | Internal fraud pattern analysis (0–100) |

### Quick Access
Numbers in CDR Viewer, Live Calls, Fraud, DID Management, and Test Call are designed to link directly to this lookup panel.

### External Integration
Full HLR, CNAM, and portability data requires connecting to an external provider (Telnyx, Neustar, BICS, or your own HLR gateway). Current results are derived from CDR data and E.164 prefix analysis.

---

## 12. SBC / Media Plane Monitor

**Route:** `/sbc-monitor`  
**Roles:** Admin, Management  
**DB Tables:** `sbc_hosts`  
**API:** `GET/POST /api/sbc-hosts`, `PATCH/DELETE /api/sbc-hosts/:id`, `GET /api/sbc-hosts/:id/metrics`

Session Border Controller health monitoring.

### Per-Host Metrics

| Metric | Description |
|--------|-------------|
| Active Sessions | Current concurrent media sessions |
| CPU % | SBC processor load |
| Transcoding Load % | Active transcoding operations |
| Media Bypass Rate % | Direct media (no relay) percentage |
| Registrations | Active SIP endpoint registrations |
| OPTIONS Response (ms) | SIP OPTIONS round-trip time |

### Supported Vendors
`kamailio` · `opensips` · `sonus` · `audiocodes` · `ribbon` · `generic`

### Integration Methods
- **REST API** — configure vendor API URL and API key
- **SNMP** — configure SNMP community string
- **SIP OPTIONS** — works for any vendor (no credentials needed)

---

## 13. Client Self-Service Portal

**Route:** `/client-portal`  
**Roles:** Admin, Management  
**DB Tables:** None (uses Sippy CDR data)

Per-account usage and quality dashboard for customer-facing use.

### Features
- Account selector (linked to Sippy i_account)
- **Usage Stats** — call count, minutes, ASR, balance
- **Quality Summary** — MOS, PDD, Packet Loss vs targets
- **Traffic Breakdown** — top destinations by volume
- **Security Summary** — FAS detections, blacklisted numbers, auth failures
- **CDR Table** — paginated, filterable CDRs for the selected account
- **CSV Export** — one-click CDR download

---

## 14. Reseller Management

**Route:** `/reseller`  
**Roles:** Admin, Management  
**DB Tables:** `reseller_profiles`  
**API:** `GET/POST /api/resellers`, `PATCH/DELETE /api/resellers/:id`

Wholesale reseller lifecycle management.

### Per-Reseller Configuration

| Field | Description |
|-------|-------------|
| Company Name | Reseller's legal entity name |
| Brand Name | White-label brand for invoices |
| Contact Email | Primary billing contact |
| Markup % | Applied on top of base rate for invoice generation |
| Sippy Customer ID | Links to a Sippy `i_customer` for CDR correlation |
| Notes | Internal notes |

### Use Cases
- Reseller invoice generation with markup
- White-label portal configuration
- Per-reseller traffic and revenue breakdown
- Reseller credit management via linked Sippy accounts

---

## 15. Compliance & Regulatory Dashboard

**Route:** `/compliance`  
**Roles:** Admin, Management  
**DB Tables:** None (derived from CDR and system data)

Regulatory and compliance posture overview.

### Compliance Categories

#### STIR/SHAKEN
- A-level attestation rate tracking
- Certificate expiry monitoring
- Per-call attestation breakdown from CDRs

#### Call Recording
- Encryption-at-rest status
- Retention policy compliance (configurable target, e.g. 90 days)
- Auto-purge schedule

#### GDPR / Privacy
- Consent record count
- Data deletion request tracking and SLA compliance

#### Regulatory Filings
- Report submission tracking
- E911 / E112 emergency routing verification
- Robocall / spam rate monitoring

### Export
One-click PDF/CSV compliance report export for audit purposes.

---

## 16. SMS / A2P Messaging Monitor

**Route:** `/sms-monitor`  
**Roles:** Admin, Management  
**DB Tables:** None (SMPP gateway integration)

SMPP gateway and A2P messaging route monitoring.

### Metrics Per Route

| Metric | Description |
|--------|-------------|
| Delivery Rate | Percentage of messages delivered |
| Latency (ms) | Average end-to-end delivery time |
| Active TPS | Current throughput |
| Max TPS | Configured capacity |
| Throughput Bar | Visual capacity utilisation |

### Status Levels
- **Active** — route healthy, delivering normally
- **Degraded** — delivery rate or latency outside threshold
- **Down** — route unreachable

### Overall Dashboard
- Total sent, delivered, failed (configurable time window)
- Overall delivery rate
- Average latency across all routes

### Integration
Live SMPP gateway integration requires configuring provider credentials (Twilio, Vonage, Bandwidth, or your own SMPP proxy) in Settings.

---

## 17. AI Operations Center

**Route:** `/ai-ops`  
**Roles:** Admin, Management  
**DB Tables:** None (stateless analysis layer)

AI-powered anomaly detection, root-cause inference, and natural language analytics.

### Anomaly Detection Feed

Real-time feed of detected network anomalies with:
- **Severity levels** — Critical / High / Medium / Low
- **Root Cause Analysis** — AI-inferred explanation of why the anomaly occurred
- **Affected Entities** — specific vendors, routes, accounts, or IPs involved
- **Recommendation** — suggested corrective action
- **Resolution tracking** — mark anomalies as resolved

### Predictive Alerts

Forward-looking predictions based on trend analysis:
- Capacity exhaustion warnings (vendor concurrent call limits)
- Quality degradation trajectory (MOS trend → below SLA threshold)
- Balance depletion timing

Includes confidence percentage per prediction.

### Natural Language Query

Ask questions about your network in plain English:
- "Show me all failed calls to Pakistan in the last 2 hours"
- "Which carrier had the worst ASR today?"
- "What destinations saw the most FAS flags this month?"

Queries are translated to analytical operations against your CDR data pipeline.

### Anomaly Sources
- Statistical baselines from 30 days of CDR and quality data
- Live metric deviation detection
- Pattern recognition for fraud, capacity, and quality events

---

## 18. Security & Access

### Role-Based Access Control

| Role | Access Level |
|------|-------------|
| **Admin** | Full platform access |
| **Management** | Configurable feature subset (gated by Admin) |
| **Team Lead** | Monitoring + Approval Queue |
| **NOC Operator** | Live calls + Approval Queue |
| **Viewer** | Assignment-based access (individual items) |
| **Super Admin** | Dashboard + core monitoring |

### Management Feature Gating
Admins control which features the Management role can access via **Settings → Management Permissions**. Each route maps to a configurable feature key.

### Approval Queue
All write operations (routing changes, blacklist additions, account modifications) can be routed through the Approval Queue with role-based sign-off requirements.

### KAM Scoping
Key Account Managers can be scoped to specific client accounts. Viewer-role users are scoped to their KAM's account list.

---

## 19. Administration

**Route:** `/settings`, `/team`, `/whatsapp-alerts`, `/email-centre`, `/vpn-config`, `/api-keys`  
**Roles:** Admin only

### Settings
- Sippy connection configuration (primary + fallback switches)
- Alert thresholds (ASR, ACD, MOS, PDD, Packet Loss)
- Management role feature permissions
- Timezone configuration
- Simulation mode toggle

### Team & KAM Management
- User management with role assignment
- KAM creation and account scoping
- Viewer assignment to monitoring items

### Notification Channels
- **WhatsApp Alerts** — threshold-based WhatsApp notifications
- **Email Centre** — SMTP configuration and email alert templates
- **Webhook Alerts** — HTTP webhook for external integrations

### API Keys
Platform API key management for external integrations.

### VPN Config
WireGuard VPN configuration generation for secure Sippy API access.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                   React + Vite Frontend                   │
│  TailwindCSS · Shadcn/ui · TanStack Query · Wouter       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / WebSocket
┌────────────────────────▼────────────────────────────────┐
│              Express + TypeScript Backend                  │
│  Drizzle ORM · Sippy XML-RPC · Portal Scraper            │
└──────────┬──────────────────────────┬────────────────────┘
           │                          │
┌──────────▼──────────┐   ┌──────────▼──────────────────┐
│   PostgreSQL DB      │   │   Sippy Softswitch           │
│  (Drizzle schema)    │   │  191.101.30.107 (XML-RPC)   │
│                      │   │  104.245.246.110 (Portal)   │
└──────────────────────┘   └─────────────────────────────┘
```

### Key Design Decisions
- **Read-only by default** — all background polling is read-only; writes require explicit user action
- **Cache-first** — routing data and Sippy responses are cached locally to reduce API load
- **Approval gates** — all Sippy write operations are queued for human approval
- **Credential resilience** — automatic fallback between credential pairs on 401/403 errors
- **Simulation mode** — platform can run against simulated data for testing (disabled by default)

---

*Last updated: May 2026 · Bitsauto Monitoring Platform v2.5.0*
