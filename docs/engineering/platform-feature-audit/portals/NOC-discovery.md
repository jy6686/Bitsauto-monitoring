# NOC Portal — Phase 1 Discovery (inventory & classification)

| Field | Value |
|-------|-------|
| Phase | 1 — Discovery (inventory + classify). **No movement.** |
| Status | Analysis only · every Decision = **Pending** |
| Source | Business Inventory (Top Menu `DOMAINS`) `[V]` |
| Last verified | 2026-07-11 |

> Goal: list what already exists that is NOC-oriented, group by **operational
> capability**, propose NOC ownership, and note cross-portal visibility. **Nothing is
> moved or changed.** Owner approves per row before any later phase.

## Candidate features by operational capability
`Own` = proposed Primary NOC · `View`/`RO` = NOC as secondary (another portal owns).

### Live Monitoring
| Feature | Route | Current domain | Proposed | Decision |
|---------|-------|----------------|:--:|:--:|
| Live Calls | `/calls` | Live Network | Own | Pending |
| Live Traffic | `/live-traffic` | Live Network | Own | Pending |
| Traffic Map | `/traffic-map` | Live Network | Own | Pending |
| Live Traffic Map | `/live-traffic-map` | Live Network | Own | Pending |
| Graphs | `/graphs` | Live Network | Own | Pending |

### Command Centre
| NOC Dashboard | `/noc-dashboard` | Live Network | Own | Pending |
|---|---|---|---|---|
| Incident Command | `/noc-incidents` | Live Network | Own | Pending |
| NOC Command | `/noc-command` | Live Network | Own | Pending |
| Ops Console | `/ops-console` | Live Network | Own | Pending |

*(Command-Centre overlap already tracked in REVIEW-DUP-002; keep separate until decided.)*

### Routing Operations
| Routing Manager (tabs: Routing Groups · Destination Sets · Vendors & Connections · Connections · QBR · On-Net Viewer · Policy Simulator · Impact Simulator) | `/routing-manager` | Operations | Own (operational) / Commercial owns config | Pending |
|---|---|---|---|---|
| Route Tester | `/test-call` | Operations | Own | Pending |
| Route Simulator | `/call-flow-simulator` | Operations | Own | Pending |
| Route Testing | `/route-testing` | Operations | Own | Pending |
| Self-Heal / Failover | `/self-heal` | Operations | Own | Pending |
| LCR Analyser | `/lcr-analyser` | Operations | View (Commercial owns) | Pending |
| Auth Studio | `/auth-studio` | Operations | View (Commercial owns) | Pending |

> The Routing Cache Manager tabs in the screenshot are **sub-tabs of
> `/routing-manager`**, not separate routes — one feature, several operational views.

### Infrastructure & Health
| Server Monitor `/server-monitoring` · SBC Monitor `/sbc-monitor` · Network Topology `/network-topology` · Multi-Switch `/multi-switch` | Live Network | Own | Pending |
|---|---|---|---|

### Diagnostics
| SIP Trace `/sip-trace` · Replay Engine `/replay` · Test Campaigns `/test-campaigns` · Tools `/tools` · RTP/MOS History `/rtp-analytics` | Operations / BitsEye | Own | Pending |
|---|---|---|---|

### Monitoring & Alerts
| Alerts `/alerts` · Call Governance `/call-governance` | Live Network | Own | Pending |
|---|---|---|---|

### Carrier / Vendor Monitoring
| Health Engine `/vendor-health` · Carrier Scoring `/carrier-scoring` · SLA Scorecard `/vendor-sla-scorecard` · Carrier Intelligence `/carrier-intelligence` · Vendor RCA `/vendor-rca` · Stability Timeline `/vendor-stability-timeline` | Operations/Intelligence | Own (monitoring) | Pending |
|---|---|---|---|
| Vendor List `/vendors` | Operations | View (Commercial owns) | Pending |
| Balance Monitor `/balance` | Operations | **Read-only** (Finance owns) | Pending |
| Vendor Rates `/rate-manager` | Products | **View** (Commercial owns) | Pending |

### Intelligence / Telemetry
| BitsEye 2.0 `/bitseye2` | BitsEye | Own — **FROZEN** (Tier-1; UX only) | Pending |
|---|---|---|---|
| Route Intelligence `/route-intelligence` · Prefix Intelligence `/vendor-prefix-intelligence` · Number Intel `/number-intelligence` | Intelligence | Own | Pending |
| AI Ops Center `/ai-ops` · Intelligence Hub `/intelligence` | Intelligence | Own | Pending |

### Quality Analytics
| QoS Heatmap `/qos-heatmap` · Codec Analytics `/codec-analytics` · ASR/ACD `/asr-acd` | BitsEye | Own | Pending |
|---|---|---|---|

### Fraud / Security monitoring
| Fraud Engine `/fraud` · Firewall `/firewall` · Security Ops `/security-ops` · SLA Breaches `/sla-breaches` · STIR/SHAKEN `/stir-shaken` | Security | Own (monitoring) / Security owns policy | Pending |
|---|---|---|---|
| Audit Log `/audit-log` | Security | **Read-only** (Admin owns) | Pending |

## Cross-portal proposals (for review)
| Capability | Primary | Also visible in (permission) |
|-----------|---------|------------------------------|
| BitsEye 2.0 | NOC | KAM (customer-scoped) · Commercial (View) |
| Vendor Rates | Commercial | NOC (View) · KAM (send-to-assigned) |
| Customer Balance | Finance | NOC (View) · KAM (Read-only) |
| Live Calls | NOC | KAM (assigned customers) |

## Notes & open questions
- **Nothing moved.** This is the NOC candidate list only.
- Frozen items (BitsEye 2, telemetry, Sippy integration) keep their freeze even if
  NOC-owned — no redesign.
- [ ] Owner confirms NOC Primary vs secondary per row — **Institutional Knowledge Required**
- [ ] Then repeat discovery for Finance · Commercial · KAM · Platform/Admin
- [ ] Only after all five inventories + approval: reconcile with the duplicate register, then (much later) build the Portal Assignment Manager.
