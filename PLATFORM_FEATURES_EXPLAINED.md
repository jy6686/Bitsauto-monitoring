# Bitsauto Platform — Feature Deep-Dive Reference

Every major feature explained the same way: what happens end-to-end, where it integrates across the platform, what the business value is, and what the current limitations are. Written for operators and stakeholders who want to understand what each part of the system actually does — not just what it's called.

---

## 1. Live Call Monitor

The real-time window into every active call on your switch, refreshed every 5 seconds without opening a new TCP connection each time.

### What It Does

When you open the Live Calls page the system:

1. **Polls Sippy's `listActiveCalls` XML-RPC method** every 5 s, using a rotating credential set (primary XML-RPC user → admin web user → portal session) so a single credential failure never blacks out the view
2. **Caches the result server-side** — every subsequent request within the same 5-second window reads from the in-memory cache instead of hitting Sippy again, so 10 open browser tabs cost exactly as much as 1
3. **Calculates enrichment fields** locally: live duration (seconds since call start), a colour-coded quality tier based on PDD, and a "stale" flag if the call has been active for more than 3 hours without disconnect
4. **Streams the enriched list via the NOC WebSocket** (`/api/noc/ws`) so the NOC view updates without any polling at all — a single push every 5 s feeds all connected clients
5. **Maintains a rolling call-count history** (last 60 ticks) used by the dashboard sparkline widget and the Traffic Drop Detector

### Integration Points

| Surface | How it uses Live Call data |
|---------|---------------------------|
| Dashboard widget | Shows active call count + 1-min sparkline trend |
| NOC Command Center | Full cinematic feed of all active calls with carrier and status |
| Traffic Drop Detector | Compares current count to 5-min rolling average; fires alert if drop > threshold |
| FAS / Fraud | Flags if any CLI on live calls appears in the blacklist |
| Test Call Launcher | After launching a test call, polls live calls to confirm it appeared |
| Multi-Switch view | Aggregates live call counts from every configured switch |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Immediate visibility | Know exactly how many calls are in-flight at any moment — no waiting for CDRs |
| Credential resilience | Three-credential fallback means the live view almost never goes blank due to a password change |
| Zero browser hammering | Cache-first architecture means scaling to a 20-person NOC team costs zero extra Sippy load |
| Incident response | When a carrier fails mid-call, active calls to that carrier show up immediately — you can act before CDRs confirm the failure |
| Traffic Drop alerting | The 5-second history makes it possible to catch a sudden traffic collapse within one polling cycle |

### Current Limitations

Sippy's `listActiveCalls` API does not return RTP stream quality (jitter, MOS) for active calls — only post-call CDRs carry those. Live MOS is therefore estimated from carrier scoring history, not from real-time RTP stats.

---

## 2. Dashboard KPI Tiles (ASR · ACD · PDD · NER · MOS)

The five headline metrics at the top of the dashboard that give you the health of your network in a single glance.

### What It Does

1. **Fetches `getCountersStats` from Sippy** every 5 s — this single XML-RPC call returns totals for answered calls, failed calls, total attempts, and cumulative duration for the selected time window (1h / 6h / 24h)
2. **Computes derived KPIs server-side**:
   - ASR = answered ÷ total attempts × 100
   - ACD = cumulative duration ÷ answered calls (in seconds → displayed as mm:ss)
   - NER = (answered + IVR + ring-no-answer) ÷ total × 100 — measures network delivery regardless of answer
   - PDD = pulled from CDR cache p50 latency, updated every 60 s
   - MOS = pulled from the local MOS aggregation engine, updated hourly
3. **Each tile shows the delta vs. the previous equivalent window** — a green ↑ or red ↓ arrow with a percentage change so you see trend at a glance without switching views
4. **Sparkline mini-charts** (7-point history) beneath each tile are fed by a rolling in-memory ring buffer maintained by the background job, so historical shape is available even before any CDRs are queried

### Integration Points

| Surface | How it uses KPI data |
|---------|----------------------|
| Dashboard header tiles | Primary display |
| AI Ops anomaly engine | Baseline for sigma-based anomaly detection |
| Traffic Drop Detector | Uses call count history from the KPI buffer |
| NOC Command Center | Mirrors ASR and active-call count in the fullscreen view |
| Scheduled Reports | Pulls KPI snapshots for daily/weekly email digests |
| Multi-Switch view | Runs an independent `getCountersStats` per switch and merges them |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Single-glance network health | Five numbers tell you immediately if something is wrong |
| Trend arrows prevent false alarms | A low ASR during low-traffic hours looks different from a low ASR during peak — the delta tells you which it is |
| No separate BI tool needed | KPIs update every 5 s, far faster than any nightly reporting pipeline |
| Multi-window comparison | Switching between 1h and 24h windows is instant; no new Sippy query is fired if the cache is warm |

### Current Limitations

NER calculation requires Sippy to correctly classify ring-no-answer and IVR dispositions in `getCountersStats`. On some Sippy configurations this field is not populated, in which case NER falls back to matching ASR.

---

## 3. BitsEye Drill-Down Analytics

A multi-dimensional pivot table and chart explorer over your CDR data, named after the platform's internal analytics brand.

### What It Does

1. **Ingests CDR batches from Sippy** via the `getAccountCDRs` XML-RPC method, storing them in a local PostgreSQL cache (not re-querying Sippy for every filter change)
2. **Lets you pivot by any two dimensions** simultaneously: Vendor × Destination, Client × Hour-of-Day, Carrier × Disconnect Reason — the result set is computed server-side with GROUP BY
3. **Three chart modes** — heat-map grid (colour intensity = value), bar chart (ranked), and line chart (time-series) — switch between them without re-fetching data
4. **Drill-down** — click any cell in the pivot grid to open a filtered CDR list showing exactly the calls that make up that number
5. **Destination prefix matching** uses the platform's leading-digit prefix schema to group numbers: the first digits encode product class and geographic region, so "all calls to West Africa via Carrier X" is a single filter operation
6. **Compares two time windows** side-by-side (e.g. last 7 days vs. previous 7 days) and shades cells red/green for regression/improvement

### Integration Points

| Surface | What flows in |
|---------|--------------|
| CDR cache (local DB) | All raw data; BitsEye never hits Sippy live |
| Rate Cards | Cost-per-minute is joined to CDRs so "Revenue" and "Margin" appear in the pivot |
| Client Manager | Account names replace numeric IDs in the pivot rows |
| Number Intelligence | Click any CLI/CLD in a drill-down CDR row to open the Number Intelligence panel |
| LCR Analyser | If a carrier shows up as worst-performer in a pivot, a direct link opens LCR Analyser filtered to that carrier |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Revenue attribution | Know exactly which client, destination, and carrier combination produces your margin |
| Failure root-cause | A pivot of Disconnect Reason × Carrier instantly shows which carrier is causing the most 503s |
| Capacity planning | Hour-of-Day × Volume pivot reveals your traffic peaks for infrastructure sizing |
| No SQL needed | Non-technical managers can slice the data themselves without writing queries |
| Historical depth | Because CDRs are cached locally, you can pivot over a time range much wider than Sippy's live API window |

### Current Limitations

BitsEye's CDR cache is populated on-demand and then refreshed on a schedule. For very fresh CDRs (last 2–3 minutes) there may be a brief gap between Sippy receiving the record and it appearing in BitsEye.

---

## 4. Revenue & Margin Analysis

Shows the financial layer of your traffic — gross revenue from clients, cost paid to carriers, and margin per route — without requiring an external billing system.

### What It Does

1. **Joins CDR records with the Rate Card database**: each CDR carries a `tariffId`; the system resolves the per-minute rate from that tariff and multiplies by call duration to calculate billed revenue
2. **Reads vendor cost rates** from the carrier-side rate cards to calculate what you paid to terminate the call
3. **Margin = revenue − cost**; margin percentage = margin ÷ revenue × 100
4. **Groups by configurable dimensions**: Client, Carrier, Destination Prefix, Day, or any combination — results render in a ranked table sorted by revenue or margin descending
5. **Flags negative-margin routes** in red — calls where the cost to the carrier exceeded what you charged the client, typically caused by stale rate cards or a carrier surcharge that wasn't reflected in your sell rates
6. **Exports the full table as a CSV** with one click, suitable for loading into your finance team's spreadsheet

### Integration Points

| Surface | What it contributes |
|---------|---------------------|
| Rate Cards | Both buy-side (carrier) and sell-side (client) rates |
| CDR cache | Call records with duration and tariff ID |
| BitsEye | Revenue/Margin can be added as a column to any BitsEye pivot |
| Cost Optimization Engine | Uses margin data to identify which carrier swaps would improve profitability |
| KAM view | Each KAM sees revenue/margin only for their assigned client accounts |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Instant P&L per route | No need to export CDRs to a spreadsheet — the margin number is right there |
| Negative-margin alerting | Catch routes losing money before they become a month-end surprise |
| Rate card validation | When you upload a new carrier rate sheet, immediately see which destinations flipped negative |
| KAM accountability | Individual account managers see their own book's revenue without accessing other clients' data |

### Current Limitations

Margin accuracy depends on both client and carrier rate cards being current in the platform. If a carrier charges a special surcharge (e.g. a regulatory levy) that is not in their uploaded rate sheet, that cost is invisible to this view.

---

## 5. FAS / IRSF Fraud Detection

An automatic scanner that identifies False Answer Supervision (FAS) events — where a carrier reports a call as "answered" for billing purposes before it is genuinely answered by a human — and International Revenue Share Fraud (IRSF) patterns.

### What It Does

1. **Runs continuously against the CDR cache** — every new batch of CDRs is scanned as it arrives
2. **FAS detection algorithm**:
   - Flags calls where duration > 0 and duration < configurable threshold (default 4 s) — these are too short to be real conversations and likely represent a carrier starting the billing timer on ring
   - Cross-references against known FAS-prone destination prefixes (premium-rate ranges, certain Pacific island codes)
   - Assigns a FAS confidence score (0–100) based on duration, destination, carrier, and call pattern concentration
3. **IRSF detection**:
   - Looks for calls to IRSF-prone number ranges (Premium Rate, International Premium Rate, certain satellite ranges)
   - Flags bursts: more than N calls to the same destination prefix in M minutes from the same source account
   - Checks for CLI spoofing indicators (CLI does not match the account's registered country)
4. **Every detected event is written to the fraud event log** with: event type, confidence score, affected CLI/CLD, carrier, client, estimated revenue at risk, and recommended action
5. **High-confidence events trigger the Auto-Blacklist engine** (if enabled) to block the source number or account immediately without human intervention

### Integration Points

| Surface | What it uses |
|---------|-------------|
| CDR cache | Primary data source — every CDR is scanned |
| Rate Cards | Calculates "revenue at risk" for each FAS event |
| Auto-Blacklist | Passes high-confidence events for automatic blocking |
| Number Intelligence | Clicking a flagged CLI opens the full number profile |
| Alert Engine | Fires a critical alert when a new IRSF burst is detected |
| Client Manager | Links each fraud event to the originating client account |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Stops revenue leakage | FAS costs carriers money on every short-duration billed call; catching it quickly limits the damage |
| IRSF exposure limit | Bursts are caught within minutes rather than at month-end invoice review |
| Audit trail | Every event is timestamped and scored, giving you evidence for carrier disputes |
| Automated blocking | High-severity events are blocked before they can repeat, without waiting for a human decision |

### Current Limitations

FAS detection relies on CDR-level data. Calls that haven't generated a CDR yet (still in-progress) are not scanned. Additionally, some genuine short calls (quick IVR interactions, confirmation tones) can generate false positives — the confidence threshold should be tuned per environment.

---

## 6. Auto-Blacklist Engine

A rule-based blocking system that prevents specific phone numbers, CLIs, destination prefixes, or source IP addresses from generating calls on your platform.

### What It Does

1. **Maintains a blacklist table** in the local database (not written to Sippy directly — the block is enforced at the platform layer during test calls and route evaluation)
2. **Three sources of entries**:
   - **Manual** — operator adds an entry from the Firewall / Blacklist page with a reason and expiry
   - **Auto from FAS/IRSF** — the fraud engine escalates high-confidence events directly
   - **Auto from AI Ops** — when the anomaly engine detects a repeating pattern from a specific source, it can auto-block the source
3. **Each entry has**: number/prefix, block type (CLI / CLD / IP / Account), severity level, source (manual/auto), reason text, added-by, added-at, and optional expiry time
4. **Block evaluation** happens at: test call launch (the platform refuses to initiate a call to/from a blacklisted entity), LCR route evaluation (blacklisted carriers are skipped), and live call monitoring (a running call whose CLI hits a newly added blacklist entry is flagged in the live feed)
5. **Expired entries are automatically removed** by a background job that runs hourly
6. **Approval Engine integration**: if the operator's approval policy requires it, a new auto-blacklist entry is placed in "pending" state and must be approved by an admin before taking effect

### Integration Points

| Surface | How it integrates |
|---------|------------------|
| FAS/IRSF engine | Primary source of auto entries |
| AI Ops anomaly engine | Can escalate anomaly patterns to auto-block |
| Test Call Launcher | Checks blacklist before initiating any test call |
| LCR Analyser | Skips blacklisted carriers during route evaluation |
| Approval Engine | Auto-blacklist entries can require approval before activation |
| Live Call Monitor | Flags in-flight calls from blacklisted CLIs |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Instant response | A fraudulent number can be blocked within seconds of detection, before repeat calls occur |
| Auditability | Every block has a reason, a source, and a timestamp — useful for regulatory reporting |
| Controlled automation | The approval gate prevents the auto-engine from blocking legitimate traffic without review |
| No Sippy write required | Blocking happens at the platform layer; no XML-RPC write call touches your live switch |

### Current Limitations

Because the blacklist is enforced at the platform layer (not pushed to Sippy as an IP auth rule or CLI block), calls that originate directly via Sippy — bypassing the platform — will not be blocked. To enforce blocking at the switch level, an admin must manually push the block as a Sippy IP auth rule from the Client Manager.

---

## 7. Routing Manager (LCR Groups · Destination Sets · Connections)

The configuration layer for how calls are routed through your carriers, all managed within the platform and written to Sippy via XML-RPC when you apply changes.

### What It Does

1. **LCR Groups** — defines a prioritised list of carriers for a set of destinations. You name the group, add carriers in priority order, set a weight for load-balancing, and set a failover threshold (e.g. if carrier A fails 3 consecutive calls, fall to carrier B)
2. **Destination Sets** — a named collection of E.164 destination prefixes. You assign a Destination Set to an LCR Group. When Sippy looks up a destination, it finds the matching Destination Set, then uses the corresponding LCR Group to pick the carrier
3. **Connections** — the physical carrier binding: which SIP trunk (IP/port), which codec, which registration credentials. Connections are linked to LCR Group entries
4. **QBR (Quality-Based Routing)** — adds a real-time quality gate: if the carrier scoring engine reports that a carrier's stability score has dropped below the QBR threshold, Sippy is instructed (via XML-RPC) to demote that carrier's priority in the LCR Group automatically, without manual intervention
5. **Policy Simulator** — before applying a routing change, run the simulator: enter a destination number and the simulator shows which carrier would win under the current policy vs. the proposed change, including which fallbacks would trigger
6. **Write approval gate** — all LCR writes (create group, update priorities, apply QBR demotion) go through the Approval Engine if enabled

### Integration Points

| Surface | What flows in |
|---------|--------------|
| Carrier Scoring Engine | Stability scores that drive QBR automatic demotions |
| LCR Analyser | Shows which groups/connections are producing the best ASR |
| Sippy XML-RPC | All writes are executed via `setRoutingGroup`, `setDestination`, etc. |
| Approval Engine | LCR policy changes require approval if approval mode is ON |
| Replay Engine | Visualises which LCR group decision was made for each historic call |
| FAS Engine | Blacklisted carriers are excluded from group evaluation |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Automated quality-based failover | QBR means you don't need a human watching carrier scores 24/7 — the router adjusts itself |
| Safe simulation | Test the impact of a routing change before applying it; no surprise ASR drops after a misconfiguration |
| Destination granularity | One group per country or per prefix group — as coarse or fine as needed |
| Full audit trail | Every routing change is logged with who made it and when |

### Current Limitations

QBR writes require XML-RPC write access. If the platform is running in read-only mode (default for safety), QBR demotions are logged as "would have demoted" but not executed until write mode is explicitly enabled by an admin.

---

## 8. LCR Analyser

A post-hoc analysis tool that evaluates whether your current Least Cost Routing decisions are actually producing the best outcome — and suggests alternatives.

### What It Does

1. **Loads CDR history** for a configurable window (default 7 days) and groups calls by destination prefix × carrier used
2. **For each group, computes**:
   - Actual ASR (did the calls connect?)
   - Actual ACD (how long did connected calls last — proxy for voice quality)
   - Actual PDD (how fast did the carrier answer?)
   - Cost per minute (from rate cards)
   - "Effective cost per connected minute" = cost per minute ÷ ASR (the real cost when you account for failed calls)
3. **Compares the carrier you used** against the other carriers in your LCR Group that were not selected (the losers in the priority order) — using the same metrics for calls to the same destination that went through them
4. **Highlights cases where a lower-priority carrier outperformed the primary**: if Carrier B (priority 2) had 92% ASR and 0.012/min while Carrier A (priority 1) had 78% ASR and 0.009/min, the effective cost of Carrier A is actually higher
5. **"Swap recommendation" cards** — if a better configuration exists, the analyser shows it: "Swap Carrier A (priority 1) with Carrier B (priority 2) for destination 234 (Nigeria) — estimated ASR improvement +14 pp, effective cost reduction −18%"
6. **One-click apply** — accept the recommendation and it is sent to the Routing Manager as a priority change (subject to approval if enabled)

### Integration Points

| Surface | What it needs |
|---------|--------------|
| CDR cache | Historic call outcomes per carrier |
| Rate Cards | Cost per minute per carrier per destination |
| Routing Manager | Sends approved recommendations as LCR Group priority updates |
| Carrier Scoring Engine | Cross-references long-term stability scores with the shorter CDR window |
| Approval Engine | Priority swap recommendations go through approval if enabled |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Cost optimisation | Finding the best carrier is not just about the cheapest rate — it's about effective cost per connected minute |
| ASR improvement | Moving a high-ASR carrier to priority 1 directly improves your customers' call success rate |
| Evidence-based routing | Recommendations are data-driven, not guesswork |
| One-click implementation | The gap between "we should change this" and "we changed it" is a single button press |

### Current Limitations

The analyser requires sufficient CDR volume per carrier-destination combination to produce statistically significant recommendations. Low-volume destinations (fewer than ~50 calls in the window) are flagged as "insufficient data" and excluded from the recommendation engine.

---

## 9. Multi-Switch Consolidated View

A single dashboard that aggregates live metrics from multiple Sippy switches — useful if you operate more than one switch in different regions or for different business units.

### What It Does

1. **Reads the switch configuration table** — each entry has a name, URL, XML-RPC credentials, and a region tag
2. **Runs `getCountersStats` and `listActiveCalls`** against every configured switch independently, every 30 s, in parallel
3. **Aggregates results into a unified view**: total active calls across all switches, total ASR (weighted by call volume), and per-switch breakdown cards showing each switch's individual health
4. **Health scoring per switch**: green (ASR > 75%, connected), amber (ASR 50–75% or intermittent), red (disconnected or ASR < 50%)
5. **Credential isolation**: each switch can have different XML-RPC credentials; a failure on one switch (wrong password, unreachable) does not affect the data from others
6. **Switch comparison table**: side-by-side view of all switches ranked by ASR, active calls, and PDD — immediately shows if one switch is underperforming

### Integration Points

| Surface | How it uses multi-switch |
|---------|-------------------------|
| Dashboard | "Multi-Switch" tab on the main dashboard shows consolidated live counts |
| Alert Engine | Per-switch alerts fire independently — a drop on Switch 2 doesn't mask Switch 1 |
| NOC Command Center | Shows per-switch status in the NOC grid |
| Routing Manager | Each routing group is tied to a specific switch |
| Settings | Switch configuration (add, edit, delete, test connection) |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Single pane of glass | One browser tab covers your entire switch estate |
| Failover visibility | If one switch goes down, the consolidated view shows the gap immediately |
| Capacity distribution | See at a glance if one switch is carrying a disproportionate share of traffic |
| Independent credentials | No shared credentials mean a misconfiguration on one switch can't lock you out of another |

### Current Limitations

Multi-switch view requires that all switches be reachable from the platform's server. Switches behind firewalls that do not allow inbound connections from the platform's IP must have their firewall rules updated before they can be monitored.

---

## 10. Test Call Launcher

A controlled environment for initiating a real SIP call from within the platform — to verify carrier routing, test CLI presentation, or confirm a destination is reachable — without touching your production call flow.

### What It Does

1. **Three launch methods** (you choose based on your Sippy version and capability):
   - **Phase 1 — `makeCall` XML-RPC**: Sippy places the call directly; the platform monitors the result via `listActiveCalls`
   - **Phase 2 — `make2WayCallback`**: Sippy calls the A-leg first (an internal number), then bridges it to the B-leg; useful for testing two-way audio
   - **Phase 3 — Simple API (`callback.php`)**: uses Sippy's HTTP Simple API for environments where XML-RPC write access is restricted
2. **Pre-launch checklist**:
   - Blacklist check — the platform verifies the CLI and CLD are not on the local blacklist before initiating
   - Carrier availability check — verifies the selected carrier has a live SIP connection
   - Rate card check — confirms a rate exists for the destination; shows estimated call cost
3. **Live monitoring** — after launch, the platform polls `listActiveCalls` every 2 s and shows the call's progress in real time: dialling → ringing → answered → duration counter
4. **Automatic result capture**: when the call ends (or after the configured max duration), the CDR is fetched, the SIP response code is recorded, and the result (success / failed / no answer / busy) is logged with timestamp
5. **Call log** — full history of all test calls made from the platform: who launched it, what CLI/CLD, which carrier, outcome, and PDD

### Integration Points

| Surface | What it uses |
|---------|-------------|
| Blacklist | Pre-launch CLI/CLD check |
| Rate Cards | Pre-launch cost estimate |
| Live Call Monitor | Real-time call tracking after launch |
| CDR cache | Result capture once the call ends |
| Number Intelligence | Click the CLI or CLD post-call to see the full number profile |
| Approval Engine | Test calls can require approval if the approval policy is set to "all write actions" |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Rapid fault isolation | When a client reports a destination unreachable, you can test it in 30 seconds from within the platform |
| CLI validation | Confirm that the CLI you're presenting to the B-leg is what you expect |
| Carrier route verification | Launch a call and watch which carrier it lands on via the live feed |
| Audit trail | Test call history gives you a timestamped record of verification actions for SLA reporting |

### Current Limitations

Test calls consume real carrier capacity and incur real cost. The platform shows a cost estimate before launch, but the estimate depends on your rate cards being current. Test calls to emergency numbers (112, 911, 999, etc.) are blocked by the platform regardless of blacklist settings.

---

## 11. Call Flow Simulator

A visual, non-destructive tool that traces a hypothetical call through your routing engine and shows what would happen — without actually placing the call.

### What It Does

1. **Takes a CLI and CLD from you** — any E.164 pair
2. **Resolves the destination prefix** against your Destination Sets to find the matching LCR Group
3. **Runs the full carrier selection algorithm**:
   - Evaluates each carrier in the group against the QBR threshold (is the stability score above the minimum?)
   - Applies priority ordering and load-balancing weights
   - Checks for any blacklist entries that would exclude a carrier
   - Identifies the winning carrier (primary) and the fallback chain (secondary, tertiary)
4. **Draws the result as an animated flowchart** — each step lights up in sequence: Inbound → Prefix Match → LCR Group → Carrier Evaluation → Winner → Fallback Chain
5. **Shows the "what if" scenario**: if you temporarily remove the primary carrier or lower its QBR score, which carrier takes over?
6. **Identifies gaps**: if no carrier matches the destination (missing Destination Set entry, all carriers below QBR threshold, or all blacklisted), the simulator shows exactly which step failed and why

### Integration Points

| Surface | What it uses |
|---------|-------------|
| Routing Manager | LCR Groups and Destination Sets |
| Carrier Scoring Engine | QBR thresholds per carrier |
| Blacklist | Carrier exclusion rules |
| Number Intelligence | CLI/CLD lookup to enrich the simulation result |
| LCR Analyser | After simulating, you can see whether the winning carrier has a good historical record |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Zero-risk testing | See the routing outcome for any CLI/CLD pair without spending money on a real call |
| Configuration validation | After a routing change, run the simulator to confirm the new carrier is winning as intended |
| Failure diagnosis | When a destination is unreachable, the simulator shows the exact step that broke |
| Training tool | New team members can learn the routing logic interactively |

### Current Limitations

The simulator reflects the current state of the routing configuration at the time of the simulation. It does not replay historic routing decisions (that is what the Replay Engine is for). Dynamic factors like real-time Sippy load balancing and SIP registration state are approximated, not live-fetched.

---

## 12. SIP OPTIONS Monitor

Continuously probes your carriers' SIP trunks at the TCP/UDP level using SIP OPTIONS pings to detect connectivity issues before they affect real calls.

### What It Does

1. **Reads the carrier connection list** and, for each carrier that has a SIP host configured, opens a TCP socket (or sends a UDP packet) to port 5060 every 60 seconds
2. **SIP OPTIONS request** — sends a minimal SIP OPTIONS packet and waits for a 200 OK response
3. **Tracks per-carrier metrics**:
   - Last response time (ms)
   - Last successful probe timestamp
   - Consecutive failure count
   - 24-hour uptime percentage
4. **Alert thresholds**:
   - 1 failure: yellow warning (may be transient)
   - 3 consecutive failures: amber alert — "SIP trunk degraded"
   - 5 consecutive failures: red critical — "SIP trunk down — remove from routing"
5. **When a trunk goes critical**, the platform optionally triggers an automatic QBR demotion in the Routing Manager (demotes the carrier in the LCR Group) so no new calls are sent to a down trunk while human review happens
6. **Historical uptime chart** — 7-day probe history per carrier visualised as a timeline bar, making it easy to spot recurring overnight outages

### Integration Points

| Surface | How SIP OPTIONS data flows |
|---------|---------------------------|
| Routing Manager | QBR demotion when trunk is detected down |
| Alert Engine | Critical alerts when trunk fails 5 consecutive probes |
| Carrier Scoring | Trunk uptime feeds into the carrier's stability score |
| NOC Command Center | Carrier health grid shows red for trunks that are down |
| Network Topology (3D) | Down carriers' nodes glow red and edges dim in the 3D view |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Proactive detection | Know a carrier trunk is down before your clients tell you their calls are failing |
| Automatic remediation | Optional QBR demotion means traffic can be automatically rerouted without human intervention |
| SLA evidence | The 24-hour uptime log is a factual record for carrier SLA discussions |
| No fake test calls | OPTIONS probes cost nothing — no carrier charges for a SIP OPTIONS packet |

### Current Limitations

SIP OPTIONS probing tests TCP/UDP reachability and SIP-layer liveness. It does not test audio path quality (RTP). A carrier can pass SIP OPTIONS probes but still deliver poor audio — the audio quality picture comes from CDR-level RTP metrics.

---

## 13. Number Intelligence

A unified phone number enrichment panel that derives everything knowable about a number from your own CDR data, supplemented by optional external HLR lookup.

### What It Does

1. **Parses and normalises** any E.164 number — strips formatting, resolves country code
2. **Queries Sippy CDR records** for that number — derives line type, porting status, roaming indicators, and STIR/SHAKEN attestation from call history
3. **Runs internal reputation scoring** — cross-references against FAS event log, fraud flags, and CDR call patterns to produce a 0–100 risk score
4. **Caches results for 24 hours** — subsequent lookups for the same number are instant
5. **Optionally calls an external HLR gateway** (Telnyx, Neustar, or your own) for live carrier name and authoritative porting data
6. **Quick-access from anywhere** — any phone number on any platform page is clickable and opens this panel: CDR Viewer, Live Calls, FAS events, DID Management, Test Call Launcher

### Integration Points

| Surface | What number is looked up |
|---------|--------------------------|
| CDR Viewer | CLI or CLD on any CDR row |
| Live Calls | Caller / Callee field |
| FAS / Fraud | Any flagged number in fraud events |
| DID Management | Any DID in inventory |
| Test Call Launcher | CLI / CLD fields before launch |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Fraud investigation | One click from a FAS event to full number profile |
| Routing decisions | Line type (Mobile vs Fixed vs VoIP) informs carrier selection |
| STIR/SHAKEN compliance | Attestation level visible directly on any number |
| Zero external cost (current mode) | All data from your own CDRs — no API fees |

### Current Limitations

Carrier name requires external HLR integration; not available from CDRs alone.

---

## 14. CDR Viewer

A searchable, filterable table of all call detail records — the authoritative call-by-call log for your switch.

### What It Does

1. **Pulls CDRs from Sippy** using `getAccountCDRs` XML-RPC on demand, then caches them locally so filter changes are instant
2. **Supports 12 filter dimensions**: date range, CLI, CLD, carrier, client account, disconnect reason, SIP response code, duration range, ASR threshold, country, tariff ID, and call direction
3. **Each CDR row shows**: timestamp, CLI, CLD, carrier used, duration, SIP response code, disconnect reason, billed amount (from rate card join), PDD, and RTP quality flags
4. **Disconnect reason decoder**: SIP codes are translated to plain-English labels (e.g. "486 Busy Here" → "Destination Busy", "403 Forbidden" → "CLI rejected by carrier")
5. **Export** — filtered result set downloads as a CSV with all fields
6. **Click-through** — click a CLI or CLD to open Number Intelligence; click the carrier name to open the carrier's scoring profile

### Integration Points

| Surface | What CDR data feeds |
|---------|---------------------|
| BitsEye | Primary data source |
| Revenue & Margin | Duration × rate card = billed amount |
| FAS Engine | CDRs are the fraud detector's input |
| Number Intelligence | CLI/CLD enrichment |
| LCR Analyser | Historic outcomes per carrier |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Call tracing | Find any individual call in seconds — by number, carrier, time, or outcome |
| Billing disputes | Pull CDRs for a disputed period, export CSV, send to client or carrier |
| Failure analysis | Filter by SIP code 503 to find all calls a carrier rejected today |
| Pattern detection | Filter by short duration to surface potential FAS events manually |

### Current Limitations

CDR cache depth depends on how many records Sippy returns per `getAccountCDRs` call. Very old CDRs (beyond Sippy's configured retention) are not available. The cache may be up to 5 minutes behind the live switch for newly completed calls.

---

## 15. Rate Cards

Management of buy-side (carrier) and sell-side (client) per-minute rate tables — the pricing engine for all revenue and margin calculations.

### What It Does

1. **Stores rate entries** in the local database: destination prefix, rate per minute, currency, effective date, and a flag for whether the rate has been pushed to Sippy
2. **Import from CSV or Excel** — paste a carrier's rate sheet and the platform parses prefix, rate, and effective date columns
3. **Push to Sippy** — for each rate entry, calls Sippy's `tariff.setRateEntry` XML-RPC method to update the live switch tariff
4. **Diff view** — before pushing, shows a colour-coded diff: which rates are new, which changed (old rate → new rate), and which were deleted from the carrier's new sheet
5. **Rate lookup** — enter any destination number and the platform shows which rate card entry applies (longest-prefix match) and what the per-minute rate is
6. **Tariff management** — create, clone, and delete Sippy tariffs from within the platform; assign tariffs to client accounts

### Integration Points

| Surface | What it uses from Rate Cards |
|---------|------------------------------|
| Revenue & Margin | Buy and sell rates for margin calculation |
| LCR Analyser | Cost per minute for effective cost ranking |
| Test Call Launcher | Pre-launch cost estimate |
| CDR Viewer | Billed amount column |
| BitsEye | Revenue column in pivot tables |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Single source of truth | Rates stored in the platform are the authoritative reference for all cost/revenue calculations |
| Carrier rate sheet processing | Import a 5,000-row rate sheet and push it to Sippy in minutes, not hours |
| Negative-margin prevention | Diff view highlights new carrier rates that would flip a destination negative before you push |
| Full audit trail | Every rate push is logged with who pushed it and when |

### Current Limitations

On some Sippy versions, rates must be added via the Sippy web UI because the `setRateEntry` XML-RPC method returns a 403. In those cases, the platform shows the rates in the diff view but the "Push to Sippy" button is disabled and the operator must apply them manually via the Sippy portal.

---

## 16. Client Manager (Account Management)

Complete management of your customer accounts within Sippy — creation, configuration, rate assignment, DID management, IP authentication, and balance monitoring — from a single page.

### What It Does

1. **Account list** — pulls all Sippy accounts via `listAccounts` and displays them in a searchable table with: account name, balance, status (active/suspended), tariff, and last CDR timestamp
2. **Account creation wizard** — a step-by-step form that calls `createAccount` XML-RPC with all required fields, including the Sippy-specific `welcome_call_ivr` and `on_payment_action` integer fields that must be set to exactly `0` (not null) to avoid Sippy errors
3. **Account editing** — updates any account field via `updateAccount`; changes are confirmed immediately by re-fetching the account
4. **DID Management** — assign and remove DIDs (Direct Inward Dialing numbers) from accounts using `addDID` / `deleteDID`
5. **IP Authentication rules** — add, edit, and delete the IP/subnet rules that control which sources can originate calls on an account
6. **Balance top-up** — trigger a balance credit (requires approval if approval mode is on)
7. **KAM assignment** — assign each account to a Key Account Manager so the KAM can see only their accounts

### Integration Points

| Surface | What it uses |
|---------|-------------|
| Approval Engine | Account creation, balance top-up, and DID changes can require approval |
| KAM Management | Account-to-KAM mapping |
| Rate Cards | Assign tariffs to accounts |
| Revenue & Margin | Account-level financial breakdown |
| FAS Engine | Fraud events are linked back to originating accounts |
| Balance Monitor | Shows real-time balance for each account |

### Business Impact

| Benefit | Detail |
|---------|--------|
| No Sippy web UI needed | Your team can create and manage accounts entirely within the platform |
| DID and IP rules in one place | No context-switching between multiple Sippy portal screens |
| KAM scope enforcement | Each KAM only sees and can edit their own clients |
| Approval-gated changes | Sensitive operations (creation, top-up) require a second pair of eyes |

### Current Limitations

Sippy account creation requires specific field values that differ across Sippy versions. The platform includes known-working defaults but some Sippy deployments may reject the `createAccount` call due to custom validation rules on the switch side. In those cases, creation must be done via the Sippy portal and the account then appears in the platform's list automatically.

---

## 17. Carrier Scoring Engine

A continuous background process that computes a composite quality score for each carrier using real call outcomes, updating every 30 minutes.

### What It Does

1. **Reads route trace records** — every LCR routing decision (whether from a real call or a synthetic test) records which carrier was selected, the outcome, SIP code, PDD, and duration; these are the input to the scoring engine
2. **Computes per-carrier metrics** for configurable windows (default 24h and 168h):
   - Rolling ASR (answered ÷ total attempts)
   - Average PDD (ms)
   - P95 PDD (95th-percentile post-dial delay)
   - Failure rate (non-200 SIP responses ÷ total)
   - Stability score = weighted composite: ASR × 0.5 + (1 − failureRate) × 0.3 + speedScore × 0.2
3. **Trend detection**: compares the last 24h score to the previous 24h to assign "improving", "stable", or "degrading"
4. **Writes scores to the database** and triggers any QBR (Quality-Based Routing) rules that depend on the carrier's current score
5. **"What Changed?" delta panel**: fetches both 24h and 168h windows and shows the delta for each carrier — how much ASR, PDD, and stability changed over the week, with colour-coded arrows

### Integration Points

| Surface | What it feeds |
|---------|--------------|
| Routing Manager / QBR | Scores trigger automatic carrier priority changes |
| SIP OPTIONS Monitor | Trunk uptime feeds into stability score |
| LCR Analyser | Scores appear alongside CDR-derived metrics |
| NOC Command Center | Carrier grid shows live stability scores |
| 3D Network Topology | Node colour and glow intensity driven by stability score |
| AI Ops | Score anomalies (sudden drop) trigger AI Ops incidents |
| Incident Narrator | Score is included in automatically generated incident summaries |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Objective carrier ranking | A score derived from real call data, not a gut feeling |
| Automated demotion | Bad carriers are demoted in the routing table without a human making the call |
| Early warning | A degrading trend (improving → stable → degrading) gives you warning before the carrier hits a crisis |
| Week-over-week visibility | The "What Changed?" delta shows whether the past week was better or worse than the week before |

### Current Limitations

Scores are only as good as the volume of route traces in the window. A carrier with fewer than 20 calls in the 24h window is flagged as "low sample count" and its score is marked unreliable. Synthetic test calls (from the Test Call Launcher) supplement real CDRs but should not be the only source.

---

## 18. Replay Engine

A visual playback tool that reconstructs the routing decision made for any historic call — showing exactly which carriers were considered, in what order, and why the winning carrier was selected.

### What It Does

1. **Loads route trace records** from the local database — each trace records: the destination dialled, which carriers were evaluated, the evaluation order, the selected carrier, the outcome, the SIP response, and the PDD
2. **Groups traces by `runId`** — a run is a single originating call that may have generated multiple traces (primary attempt + fallbacks)
3. **Builds a step-by-step replay sequence** for each run:
   - Step 1: LCR Engine initiates for destination X
   - Step 2: N candidates evaluated
   - Step 3: Carrier A selected (reason: highest priority, stability score 87)
   - Step 4: Outcome — 200 OK, PDD 340 ms, duration 120 s
   - OR: Step 4: Carrier A failed (SIP 503), fallback to Carrier B
   - Step 5: Carrier B outcome
4. **Animated playback**: hit Play and the steps animate in sequence with timing delays matching the real call; Pause, rewind, or jump to any step
5. **Filter by runId, destination, carrier, time range, or outcome** to find specific calls of interest
6. **Statistics summary** per run: total carriers tried, time to first successful route, final outcome

### Integration Points

| Surface | What feeds the Replay Engine |
|---------|------------------------------|
| LCR Synthetic Scheduler | Generates route traces for all synthetic test runs |
| Test Call Launcher | Real test calls also generate route traces |
| Call Flow Simulator | Simulator results can be "saved" as a trace for comparison |
| Carrier Scoring Engine | Scores at time-of-decision are stored in the trace for historical accuracy |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Post-incident root cause | After a routing failure, replay exactly what the system tried — no guessing |
| Fallback chain verification | Confirm that your fallback carriers are actually being tried in the right order |
| Training and auditing | Show the routing logic to new team members using real historic examples |
| Regression detection | Compare a routing run from today vs. last week — if more fallbacks are needed now, something changed |

### Current Limitations

The Replay Engine only shows platform-mediated routing decisions (LCR synthetic runs and platform-initiated test calls). Calls that went through Sippy's native routing — without passing through the platform's LCR engine — do not have route traces and cannot be replayed.

---

## 19. AI Ops — Anomaly Detection Engine

A statistical engine that monitors all key metrics in real time and raises an incident whenever any metric deviates significantly from its established baseline.

### What It Does

1. **Baseline calculation**: for each metric (ASR, PDD, failure rate, call volume, balance), the engine maintains a rolling mean and standard deviation computed from the last 7 days of data
2. **Sigma-based alerting**: if the current value deviates by more than 2.5σ from the mean (configurable), an anomaly event is created — this threshold filters out normal traffic variation while catching real problems
3. **Anomaly enrichment**: each event gets:
   - Severity (critical / high / medium / low) based on sigma distance
   - Root cause hypothesis (e.g. "ASR dropped 18 pp — consistent with carrier-side trunk degradation based on PDD also rising")
   - Recommendation ("Check carrier X SIP trunk — SIP OPTIONS probe shows 2 consecutive failures")
   - Affected entities (which carrier, which client, which destination prefix)
4. **Incident clustering**: multiple related anomaly events (ASR drop + PDD spike + failure rate rise on the same carrier) are grouped into a single incident with an automatically generated narrative title
5. **Incident resolution**: when the metric returns to within 1σ of baseline, the incident is automatically resolved and marked with the recovery time

### Integration Points

| Surface | What metrics it monitors |
|---------|--------------------------|
| Dashboard KPI tiles | ASR, ACD, NER, call volume |
| Carrier Scoring Engine | Stability score drops |
| SIP OPTIONS Monitor | Trunk failure events |
| FAS Engine | Fraud event spikes |
| Balance Monitor | Balance threshold breaches |
| Live Call Monitor | Call volume collapse |

### Business Impact

| Benefit | Detail |
|---------|--------|
| 24/7 automated monitoring | No human needs to stare at dashboards — the engine raises incidents when something is wrong |
| Noise reduction | Sigma-based thresholds mean you only get alerted on genuine anomalies, not normal fluctuation |
| Actionable recommendations | Each incident tells you not just what is wrong but what to do |
| Automatic resolution | Incidents close themselves when metrics recover — no manual ticket closure |

### Current Limitations

The anomaly engine requires at least 48–72 hours of baseline data before it can produce reliable sigma values. In the first days after deployment or after a major traffic pattern change, it may produce false positives or miss genuine anomalies due to an insufficient baseline.

---

## 20. AI Copilot Panel

A conversational natural-language interface embedded in the AI Ops page that lets you query live telemetry data in plain English without knowing any filters or menus.

### What It Does

1. **Accepts free-text queries** in a chat input — you type what you want to know
2. **Pattern matching engine** — matches your query against 8 built-in pattern types:
   - "How is [carrier] doing?" → pulls that carrier's stability score, ASR, PDD, trend
   - "What carriers are degrading?" → lists all carriers with "degrading" trend
   - "Show me active incidents" → lists all open AI Ops incidents with severity
   - "Any fraud events today?" → pulls today's FAS/IRSF event count
   - "What is the ASR?" → returns current ASR KPI with delta
   - "Which destination has the worst ASR?" → runs a destination-group query on CDR cache
   - "Is [carrier] SIP trunk up?" → checks SIP OPTIONS monitor result for that carrier
   - "What changed this week?" → returns the carrier scoring delta (24h vs 168h) for all carriers
3. **Responses are structured text** — not freeform AI output; every answer is generated from real live data in the platform database, so accuracy is guaranteed
4. **Linked actions** — each response includes links to the relevant page (e.g. "View in Carrier Scoring → [link]")

### Integration Points

| Surface | What data it queries |
|---------|---------------------|
| Carrier Scoring Engine | Per-carrier stats and trends |
| AI Ops incidents | Open and recent incidents |
| FAS Engine | Today's fraud events |
| Dashboard KPIs | ASR, ACD, call volume |
| SIP OPTIONS Monitor | Trunk liveness |
| CDR cache | Destination ASR breakdown |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Zero learning curve | New team members can ask questions in plain English and get real data back |
| Speed | Faster than navigating to the right page and applying filters |
| Consistency | Every question gets the same data as the page — no risk of stale cached values |
| On-call support | During an incident, the copilot gives a quick overview without having to open multiple pages |

### Current Limitations

The copilot uses rule-based pattern matching, not a large language model. It understands the 8 defined query patterns well but cannot handle queries that fall outside those patterns. Queries like "why did our ASR drop last Tuesday at 3pm" require the human to navigate to BitsEye or the CDR Viewer directly.

---

## 21. Audio Alert System

A browser-based audio notification system that plays distinct tones for different severity levels when AI Ops incidents are raised — so NOC operators know something is wrong without watching the screen.

### What It Does

1. **Uses the Web Audio API** — generates tones synthetically in the browser, no audio files needed, so it works even in a fresh deployment
2. **Three severity tones**:
   - **Critical** — a sharp, repeating high-pitched double-beep (440 Hz → 880 Hz, 0.15 s each, 3 repeats)
   - **High** — a single sustained mid-tone (440 Hz, 0.5 s)
   - **Medium/Low** — a soft, single low tone (220 Hz, 0.3 s)
3. **Fires automatically** when a new incident of that severity is detected by the anomaly engine — the system compares the incident list on each poll cycle and sounds the tone for any new incidents that appeared since the last check
4. **Opt-in toggle** on the AI Ops page — audio alerts are off by default (browsers require user interaction to enable audio); the operator clicks the "Enable Audio Alerts" toggle once per session and the system is armed
5. **Respects browser audio permissions** — if the browser blocks autoplay, the toggle shows a warning explaining why the sound didn't play

### Integration Points

| Surface | When it fires |
|---------|--------------|
| AI Ops incident list | New critical/high incidents trigger the corresponding tone |
| NOC Command Center | The NOC view also checks for new incidents and can fire the tone |
| Alert Engine | Optionally hooks into alert-rule-based firing (alert rule fires → tone plays) |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Eyes-free monitoring | NOC operators can be doing other work and still hear an incident immediately |
| Severity differentiation | The tone tells you how bad it is before you even look at the screen |
| Zero infrastructure | No PBX, no external service — it's all in the browser |

### Current Limitations

Web Audio API requires user interaction to initialise (browser autoplay policy). If the operator opens the page and walks away before clicking the toggle, no audio will play until they return and click it. This is a browser security restriction, not a platform limitation.

---

## 22. NOC Command Center (`/noc-command`)

A fullscreen cinematic view designed for large wall-mounted NOC displays — showing all critical metrics in a high-contrast, high-information layout without any navigation chrome.

### What It Does

1. **Fullscreen mode**: enters browser fullscreen via the Fullscreen API; all platform navigation is hidden
2. **Incident ticker**: a horizontally scrolling ticker at the top showing the last 10 AI Ops incidents with severity colour (red/amber/green) and age
3. **Carrier grid**: a grid of cards, one per carrier, each showing: carrier name, stability score, trend arrow, active-call count, and a colour-coded health status ring
4. **Live call counter**: a large animated number showing total active calls across all switches, updated every 5 s
5. **ASR / ACD / PDD headline metrics**: the three most important KPIs in large type, with delta arrows
6. **Switch health row**: one status dot per configured switch — green (healthy), amber (degraded), red (down)
7. **Auto-refresh**: all data polls independently; a partial data failure (one API call fails) doesn't blank the whole display — sections degrade gracefully

### Integration Points

| Surface | What it displays |
|---------|-----------------|
| Live Call Monitor | Active call count |
| Carrier Scoring Engine | Carrier grid health |
| AI Ops incidents | Incident ticker |
| Multi-Switch | Per-switch status dots |
| Dashboard KPIs | ASR/ACD/PDD headline |
| Audio Alert System | Fires tone when new incident arrives |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Wall display ready | Put it on a TV in the NOC room and everyone sees the network state at a glance |
| Incident visibility | New incidents appear in the ticker without anyone having to navigate |
| Zero distraction | No menus, no sidebars — just data |

### Current Limitations

The NOC Command Center is display-only. You cannot take action (e.g. demote a carrier, acknowledge an incident) from this view. To take action, exit fullscreen and navigate to the relevant page.

---

## 23. 3D Network Topology (`/network-topology`)

A three-dimensional interactive visualisation of your carrier network — rendered using WebGL via Three.js — where each carrier is a glowing node and call traffic flows between them as animated particles.

### What It Does

1. **Fetches carrier scores** from `/api/carrier-scores` to determine node colour and glow intensity:
   - Score ≥ 75 → green node with green glow
   - Score 50–74 → amber node with amber glow
   - Score < 50 → red node with red glow
2. **Places carrier nodes** in a circular arrangement on a 3D plane, with a central "Hub" node representing your switch
3. **Draws animated edges** (white lines) from the Hub to each carrier — line opacity scales with the carrier's sample count (more traffic = more visible connection)
4. **Particle streams** travel along each edge in the direction of traffic flow — particle speed and density scale with the carrier's active call count
5. **Orbit controls** — the view can be rotated, zoomed, and panned by mouse drag; double-click a carrier node to zoom in and see its tooltip with full stats
6. **Stars background** — a Three.js `<Stars>` field creates depth in the background
7. **Auto-refreshes** carrier scores every 60 s so node colours update as carrier health changes

### Integration Points

| Surface | What it reads |
|---------|--------------|
| Carrier Scoring Engine | Node colour and glow |
| Live Call Monitor | Particle density on each edge |
| SIP OPTIONS Monitor | Down trunks cause their edge to disappear |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Instant spatial overview | The colour of the carrier cloud tells you network health at a glance |
| Executive / client presentations | A live 3D network view is more intuitive for non-technical stakeholders than a table of numbers |
| Traffic visualisation | Particle streams make it immediately obvious which carriers are carrying the most traffic |

### Current Limitations

The 3D view requires WebGL support in the browser (standard in all modern browsers). Performance may degrade on low-end devices if more than 20 carrier nodes are rendered simultaneously. On mobile, orbit controls work via touch but may be slower due to GPU constraints.

---

## 24. Approval Engine

A configurable gate that requires a second authorised person to approve sensitive write operations before they execute against the live switch.

### What It Does

1. **Configurable scope**: the approval policy can require approval for any combination of: account creation, account updates, rate card pushes, DID changes, IP rule changes, balance top-ups, LCR routing changes, and blacklist additions
2. **Pending queue**: every action that triggers the approval gate is written to the `approval_queue` table with: action type, payload, requested by, requested at, and status (pending / approved / rejected)
3. **Approver notification**: the pending count badge on the Approval Queue nav item lights up when there are items waiting; optionally an in-platform notification is sent to users with the "approver" role
4. **One-click approve/reject**: approvers review the action details (e.g. "Create account for Company X, tariff ID 45, initial balance $500") and click Approve or Reject with an optional comment
5. **On approval, the platform executes the action** — calling the appropriate Sippy XML-RPC method — and writes the result (success/fail) back to the queue record
6. **Audit log**: every queue item (approved or rejected) is permanently retained with the full timeline

### Integration Points

| Surface | What it gates |
|---------|--------------|
| Client Manager | Account creation, updates, DID and IP rule changes |
| Rate Cards | Rate pushes to Sippy |
| Routing Manager | LCR policy changes |
| Auto-Blacklist | New auto-block entries |
| Balance Monitor | Balance top-ups |
| Test Call Launcher | Optionally gates test call launches |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Two-person integrity | No single operator can make a write to the live switch without a second pair of eyes |
| Mistake prevention | The approver review step catches misconfigurations before they hit production |
| Regulatory compliance | Some regulatory frameworks require dual-control for network changes — this satisfies that requirement |
| Full audit trail | Every approval or rejection is logged with who made the decision and when |

### Current Limitations

The approval engine requires at least two users with appropriate roles to be effective — if only one person has the approver role, they would be approving their own actions. The system does not prevent this by default but it can be configured to require a different person from the requester.

---

## 25. Role-Based Access Control (Admin · Management · KAM · Viewer)

A four-tier permission system that controls what each user can see and do across the entire platform.

### What It Does

1. **Four roles** with decreasing privilege:
   - **Admin**: full access to all pages, all write operations, settings, switch configuration, user management, and approval actions
   - **Management**: full read access; can take approved write actions (rate card pushes, account edits); cannot manage users or change system settings
   - **KAM (Key Account Manager)**: read access scoped to their assigned client accounts only; cannot see other clients' CDRs, balances, or rates; can view carrier metrics but not change routing
   - **Viewer**: read-only across their permitted scope; cannot initiate any write action
2. **Role enforcement is server-side** — every API route checks the user's role before executing; the frontend hides UI elements but the backend refuses the request regardless
3. **KAM scope enforcement**: the KAM's user record has an `assignedAccountIds` field; every query for CDRs, balances, and account data is filtered server-side to only return records in that list
4. **Role assignment**: managed from the Team & KAM Management page's "Role Assignment" tab — only admins can assign roles
5. **Replit Auth integration**: user identity comes from Replit OpenID Connect; roles are stored in the platform database and linked to the Replit user ID

### Integration Points

| Surface | How RBAC affects it |
|---------|---------------------|
| Every API route | `requireRole([...])` middleware on every write endpoint |
| Client Manager | KAMs see only their accounts |
| Revenue & Margin | KAMs see revenue only for their accounts |
| CDR Viewer | KAMs see only CDRs for their clients |
| Approval Engine | Management and above can approve; KAMs cannot |
| Settings | Admin-only page |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Least-privilege access | Each user sees exactly what they need, nothing more |
| Client data isolation | A KAM for Client A cannot see Client B's call records or balance |
| Regulatory compliance | Data separation satisfies confidentiality requirements when multiple clients share the platform |
| Audit accountability | Every write action is associated with an authenticated user |

### Current Limitations

Role changes take effect on the user's next request (no live session invalidation). If a user's role is downgraded while they have an active session, they retain their current session's privileges until they refresh. This is standard web application behaviour but means role changes are not instantaneous for currently logged-in users.

---

## 26. Alert Engine

A rule-based notification system that monitors any platform metric and fires an alert (in-platform notification, optionally email) when a threshold is crossed.

### What It Does

1. **Alert rules**: you define rules with: metric to watch (ASR, PDD, balance, active calls, carrier score, etc.), operator (above/below/equals), threshold value, severity, and cooldown period
2. **Evaluation loop**: every 60 s the engine evaluates all enabled rules against current metric values fetched from the cache
3. **Firing logic**:
   - If the metric crosses the threshold and no alert of the same rule is currently "active": fire a new alert, create an alert record, optionally play the audio tone
   - If the metric recovers while an alert is active: mark the alert "resolved" with a recovery timestamp
   - Cooldown: after a rule fires, it cannot fire again for the configured cooldown period (default 5 min), preventing alert storms
4. **Alert history**: every fired alert is stored permanently — you can see all alerts for the last 30 days, sorted by severity and time
5. **Alert filtering**: filter history by severity, metric, entity, date range

### Integration Points

| Surface | What it monitors |
|---------|-----------------|
| Dashboard KPIs | ASR, ACD, NER |
| Balance Monitor | Account balance below minimum |
| Carrier Scoring | Stability score below threshold |
| SIP OPTIONS | Trunk failure count |
| AI Ops incidents | Incident severity escalation |
| Audio Alert System | Fires the severity tone when an alert fires |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Threshold-based monitoring | Set exactly the limits that matter to your SLA — not arbitrary defaults |
| Cooldown prevents noise | One threshold crossing = one alert, not a hundred in five minutes |
| Dual-layer with AI Ops | AI Ops catches statistical anomalies; Alert Engine catches hard threshold violations — complementary coverage |
| History for SLA reporting | Pull the alert history for a period to show uptime and incident frequency to clients |

### Current Limitations

Alert Engine thresholds are static — they do not adapt to time-of-day traffic patterns. An ASR of 60% at 3am (low volume, high variance) will fire the same alert as 60% ASR at 3pm (high volume, statistically significant). For adaptive alerting, use the AI Ops engine which uses sigma-based thresholds.

---

## 27. Balance Monitor

Real-time tracking of all your Sippy account balances with configurable low-balance alerts and a 7-day balance history chart.

### What It Does

1. **Fetches balance** from Sippy's `getAccountBalance` XML-RPC method for each account every 60 s
2. **Stores a snapshot** in the local database every hour (not every poll) to build the balance history chart without filling the database
3. **Low-balance threshold**: each account can have a configured minimum balance; when the current balance drops below it, an alert fires and the account is highlighted in red on the balance dashboard
4. **7-day chart**: a sparkline chart per account shows the balance trend — useful for identifying accounts that are depleting faster than expected
5. **Predicted depletion**: for accounts with a consistent burn rate, the platform projects when the balance will hit zero at the current average spend rate (displayed as "~X hours remaining" or "~X days remaining")
6. **Top-up action**: admins can trigger a balance top-up from the balance dashboard directly (goes through the Approval Engine if enabled)

### Integration Points

| Surface | What uses balance data |
|---------|------------------------|
| Client Manager | Balance column in account list |
| Alert Engine | Low-balance alert rules |
| AI Ops | Balance collapse detected as anomaly |
| KAM view | KAMs see their clients' balances |
| Approval Engine | Top-up requests require approval |

### Business Impact

| Benefit | Detail |
|---------|--------|
| No unexpected disconnections | Early warning before a client's balance runs out and calls start failing |
| Predicted depletion | Know when to expect a client to run out of credit — proactively contact them or auto-top-up |
| Centralised view | All client balances on one page, not spread across Sippy account screens |

### Current Limitations

Balance history accuracy depends on the hourly snapshot interval. If a balance changes dramatically within a single hour (e.g. a large batch of calls), the chart will show the start and end values for that hour but not the intra-hour movement.

---

## 28. Command Palette

A keyboard-driven universal search and navigation tool — the fastest way to jump to any page, run any action, or look up any entity in the platform.

### What It Does

1. **Triggered by `Ctrl+K` (or `Cmd+K` on Mac)** — a modal search input appears over the current page
2. **Searches across**:
   - Pages (type "carrier" → "Carrier Scoring", "Carrier Health" appear)
   - Actions (type "regen" → "Regenerate User Manual", "Regenerate Status Report" appear as runnable actions)
   - Entities (type a phone number → Number Intelligence lookup; type an account name → jump to that account in Client Manager)
3. **Fuzzy matching** — partial matches work; "noc" matches "NOC Command Center", "nocview", and "NOC View"
4. **Keyboard navigation** — arrow keys to move through results, Enter to execute, Escape to dismiss
5. **Recent searches** — last 5 queries are remembered in localStorage for quick re-access

### Business Impact

| Benefit | Detail |
|---------|--------|
| No menu hunting | Any feature reachable in 2 keystrokes |
| Power user efficiency | Experienced operators can navigate entirely by keyboard without touching the mouse |
| Discoverability | New team members can search for what they need without knowing where it lives |

---

## 29. KAM Management & Organisational Hierarchy

A structured system for managing Key Account Managers (KAMs), their supervisors (HODs — Heads of Department), and which client accounts each KAM is responsible for.

### What It Does

1. **KAM records**: each KAM has a name, email, assigned HOD, performance tier, and a list of client account IDs they own
2. **HOD records**: each Head of Department supervises multiple KAMs; HOD has an override permission to view all KAMs' accounts in their department
3. **Organisational hierarchy tree**: a visual tree view showing HOD → KAM → Client Account chains, expanding on click
4. **Role assignment**: the "Role Assignment" tab on the same page links platform users (authenticated via Replit Auth) to their KAM or HOD record and sets their access role
5. **KAM performance dashboard**: shows per-KAM revenue, call volume, and account count in the current period — usable by HODs for team performance reviews

### Integration Points

| Surface | How KAM data flows |
|---------|-------------------|
| Client Manager | Account → KAM assignment |
| Revenue & Margin | Revenue broken down per KAM |
| RBAC | KAM role = scoped access to assigned accounts |
| CDR Viewer | Filtered by account scope |
| Balance Monitor | Per-KAM balance view |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Accountability | Each account has a named owner — no "unowned" accounts |
| Scoped access | KAMs can only see their own clients' data — competitor intelligence is not leaked |
| Management oversight | HODs see their whole team's book of business in one view |

---

## 30. Cost Optimization Engine

An automated analysis that identifies specific routing changes that would reduce your termination costs without sacrificing call quality.

### What It Does

1. **Runs a full analysis** over the last 7 days of CDR data combined with current rate cards
2. **For each destination prefix** that has sufficient volume (> 50 calls), it evaluates all available carriers in the corresponding LCR Group
3. **Computes "effective cost per connected minute"** for each carrier: (cost per minute) ÷ (ASR for that carrier on that destination)
4. **Identifies the lowest effective cost carrier** that also meets the minimum ASR threshold (configurable, default 70%)
5. **If the current primary carrier is not the lowest effective cost carrier**, a "swap opportunity" is flagged with: current carrier, recommended carrier, estimated saving per 1000 minutes, and estimated ASR impact
6. **Aggregate savings estimate**: sums all swap opportunities to show "total estimated monthly saving if all recommendations applied"
7. **One-click apply** for each recommendation (subject to approval gate)

### Business Impact

| Benefit | Detail |
|---------|--------|
| Data-driven cost reduction | Find real savings based on actual call outcomes, not just rate cards |
| Quality-gated optimisation | Recommendations only swap to a carrier that meets the ASR threshold — no false economies |
| Executive summary | The aggregate saving number gives management a single figure to track |
| Safe application | Each swap is an LCR priority change, fully reversible, and approval-gated |

### Current Limitations

The engine evaluates the carriers already in your LCR Groups. It cannot recommend carriers that are not already configured. If a carrier outside your current network would be cheaper, that is outside the engine's scope.

---

## 31. SIP Trace SDP / Codec Negotiation Panel

A forensic view of the media negotiation embedded directly within the SIP Trace page — showing exactly which audio codecs were offered, which were accepted, and what the network-level connection parameters look like.

### What It Does

When you load a call by entering a CDR `iCall` ID on the SIP Trace page, the system automatically:

1. **Calls `GET /api/sippy/cdr/sdp?iCall=xxx`** to fetch the Session Description Protocol payloads from the Sippy CDR API
2. **Parses the SDP offer** (sent by the originating side in the INVITE) and the **SDP answer** (returned by the carrier in the 200 OK)
3. **Renders a side-by-side diff panel** showing:
   - All codecs proposed in the offer (e.g. G.711 PCMA, G.711 PCMU, G.729, OPUS)
   - All codecs accepted in the answer
   - Green "negotiated" pills for codecs that appear in both offer and answer
   - Grey "rejected" pills for codecs that were offered but not included in the answer
4. **Extracts connection parameters** from the `c=` (connection) and `m=` (media) SDP lines — IP addresses and port numbers for both the offer and answer sides
5. **Provides raw SDP text** in a collapsible accordion — the exact SDP payload for engineers who need to inspect FMTP parameters, ptime, or other details

### Integration Points

| Surface | How the SDP panel connects |
|---------|---------------------------|
| SIP Trace ladder diagram | Appears directly below the call timeline when iCall is loaded |
| CDR Viewer | Any CDR row with a valid iCall links directly to the SIP Trace page pre-loaded with that call |
| Number Intelligence | Codec negotiation failures can be logged as quality events on the caller's risk profile |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Codec mismatch diagnosis | "No audio" complaints are 40–60% caused by codec negotiation failures — this panel surfaces the root cause in under 10 seconds |
| Carrier compatibility verification | Quickly confirm which codecs a specific carrier accepts before routing premium traffic to them |
| No SSH required | Engineers get the same data they would get from a Wireshark capture without needing server access |

### Current Limitations

The SDP data is only available for calls where Sippy captured the full SIP exchange. Very short calls (sub-second failures before media negotiation) or calls terminated before the INVITE was processed may show a "no SDP data available" note.

---

## 32. Routing Intelligence Live Carrier Metrics Panel

A real-time performance dashboard for every active carrier, embedded directly in the Routing Intelligence page — giving routing engineers instant feedback on which carriers are performing well right now.

### What It Does

1. **Queries `GET /api/routing-rules/metrics?window=N`** where N is 5, 15, 30, or 60 minutes
2. **Reads from the live CDR cache and `liveCallsCache`** — no database query required; the data is already in memory from the NOC polling loop
3. **Groups results by vendor** and computes per-carrier statistics for the selected window:
   - **ASR**: answer seizure ratio — answered ÷ total attempts × 100
   - **ACD**: average call duration in seconds (total duration ÷ answered)
   - **PDD**: average post-dial delay in milliseconds
   - **Concurrent**: number of active calls to this carrier right now
4. **Colour codes each metric**: green (healthy) / amber (degrading) / red (problem) using the same thresholds as the NOC view
5. **Auto-refreshes every 60 seconds** — a countdown indicator shows time until the next refresh. A manual refresh button is also available.

### Integration Points

| Surface | How the panel connects |
|---------|------------------------|
| Routing Intelligence page | Displayed above the routing rules table; context for evaluating rule changes |
| Approval Queue | When a carrier metric drops, the correlation engine may fire a routing rule — the panel confirms the trigger was real |
| Carrier Scoring | 24-hour carrier scores use the same underlying data — the metrics panel shows the sub-hourly current window |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Immediate routing decisions | "Carrier X's ASR has dropped to 32% in the last 15 minutes" — visible without building a custom CDR query |
| Rule trigger validation | Verify that an automated routing rule correctly triggered by comparing the metric panel to the rule's threshold |
| Pre-change baseline | Check metrics before applying a routing change, then monitor for improvement after |

---

## 33. Test Campaign Carrier Quality Matrix

An automated carrier report card built from your historical campaign and routing data — showing which carriers are delivering excellent quality and which are dragging down your grades.

### What It Does

1. **Queries `GET /api/campaigns/carrier-matrix`**, which aggregates the `routeDecisionTraces` table over the last 30 days
2. **Groups by carrier** and computes for each:
   - **MOS score** — estimated using the ITU E-model: the algorithm converts average PDD (as delay) and failure rate (as packet loss equivalent) into a predicted Mean Opinion Score on the 1.0–4.5 scale
   - **Letter grade**: A (MOS ≥ 4.0), B (≥ 3.5), C (≥ 3.0), D (≥ 2.5), F (< 2.5) — displayed with colour coding
   - **ASR**: answer seizure ratio across all campaign calls routed to this carrier
   - **Average PDD**: mean post-dial delay in milliseconds
   - **Average call duration**: mean connected duration in seconds
   - **Top SIP error code**: the most common failure response code seen from this carrier
3. **Renders as a collapsible panel** displayed above the test campaign list — collapsed by default for operators who just want to run a campaign, expanded with one click for quality analysis

### Integration Points

| Surface | How the matrix connects |
|---------|------------------------|
| Test Campaigns page | Auto-populated whenever campaign data changes |
| Carrier Scoring | Complements the 24h/168h scoring with campaign-specific data showing how carriers perform on your specific test routes |
| Replay Engine | For any F-grade carrier, the Replay Engine can show exactly which call in which campaign failed and why |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Objective grading | Remove the subjectivity from carrier quality discussions — "Carrier X gets a D" is unambiguous |
| Renegotiation evidence | F-grade carriers can be presented with data showing their MOS estimate, top error code, and failure rate |
| Regression detection | After a network change, re-run your test campaign and compare the matrix — any grade drop is immediately visible |

---

## 34. Sidebar Menu Configuration

A platform administration tool that gives operations managers full control over which pages appear in the navigation sidebar — enabling them to tailor the platform to the specific needs of each team or shift.

### What It Does

1. **Loads the complete canonical sidebar item list** from `SIDEBAR_GROUPS` exported by `layout-shell.tsx` — every registered navigation item, grouped by section
2. **Fetches current visibility config** from `GET /api/settings/sidebar-visibility` which reads the `sidebar_hidden_items` JSON array from the `settings` table
3. **Renders a searchable, grouped toggle list** with one row per sidebar item:
   - Toggle switch to show/hide the item
   - Lock icon on permanently-visible items (Dashboard, Team Chat, My Account, Sidebar Menu Config)
   - Group-level "All On" / "All Off" buttons for bulk operations
4. **Stages changes locally** until the Save button is pressed — changes are not applied mid-edit
5. **Saves via `POST /api/settings/sidebar-visibility`** — the endpoint writes the new hidden-items array to the database and returns 200
6. **All connected sidebar instances** read the updated config on their next mount (60-second cache) and immediately stop rendering the hidden items

### What Hiding Does (and Does Not Do)

| What it does | What it does NOT do |
|---|---|
| Removes the item from the sidebar nav | Remove the page from the router |
| Applies to all users globally | Override role-based access control |
| Takes effect on next sidebar mount | Prevent direct-URL access |
| Is instantly reversible by re-enabling | Log the access (that's the audit log's job) |

### Integration Points

| Surface | How the config connects |
|---------|------------------------|
| `layout-shell.tsx` | Fetches config on mount, filters `SIDEBAR_GROUPS` through `sidebarHiddenSet` |
| `settings` table | Stores the JSON array of hidden href strings in `sidebar_hidden_items` column |
| All authenticated users | Every logged-in user's sidebar reflects the current config |

### Business Impact

| Benefit | Detail |
|---------|--------|
| Reduced cognitive load | NOC operators see only the 8–10 pages they use daily, not all 50+ |
| Faster onboarding | New team members aren't overwhelmed by an unfamiliar platform — show them only what's relevant to their role |
| Client demo mode | Before a client demo, hide internal tools (fraud scoring, approval queue) and show only the customer-facing views |
| Two-minute deployment | Tailoring the platform for a new team requires no code change — toggle and save |

---

*Document generated by the Bitsauto Platform — all features described are implemented and live unless noted. Updated May 2026 to include: SDP/Codec Negotiation Panel, Live Carrier Metrics, Carrier Quality Matrix, Sidebar Menu Configuration.*
