---
name: BytePlus Infrastructure Orchestration
description: Future Phase 4/5 feature — NOC-driven cloud node provisioning via BytePlus ECS API, deferred until billing/invoicing is fully complete.
---

# BytePlus Infrastructure Orchestration

**Status:** Deferred — implement only after billing/invoicing pipeline is fully stable.

**Why:**
User confirmed interest in BytePlus ECS as a future capability for infrastructure orchestration inside the NOC portal. Not to be built until the finance workflow (DMR, reconciliation, invoicing, client identity) is complete and stable.

**How to apply:**
When the billing/invoicing milestone is signed off, revisit this as the next major platform expansion.

## Planned Modules (NOC Portal — Infrastructure Orchestration Engine)

| Module | Purpose |
|---|---|
| Node Provisioning | Deploy SBC / RTP / VPN relay nodes via BytePlus ECS API |
| Geo Expansion | Spin up regional POPs (SG, UAE, DE, US, UK) based on traffic analytics |
| Capacity Scaling | Auto-scale relay nodes when concurrent calls / RTP load exceeds threshold |
| Disaster Recovery | Provision backup routing node on carrier POP failure; bootstrap config + VPN |
| VPN Mesh Control | OpenVPN / WireGuard orchestration for inter-node connectivity |
| SIP Edge Management | SBC lifecycle (deploy, reconfig, decommission) |
| Infrastructure Health | VM + network monitoring integrated into NOC Dashboard |
| Auto-Heal Actions | AI Ops triggers node provisioning as a remediation action |

## Architecture Rule (Security)

**Never** call BytePlus ECS API from the frontend or expose signed URLs in the UI.
Correct path: `BitsAuto Backend → Secure Infrastructure Service → BytePlus API`

Signed temporary tokens and credentials from BytePlus must be stored server-side only and never logged or surfaced in browser calls.

## Trigger Conditions (example use cases)

- Pakistan traffic > threshold → deploy Singapore RTP relay → update routing groups → rebalance
- Carrier POP failure → provision backup node → bootstrap config → attach VPN → restore SIP routing
- Enterprise client requires dedicated SBC/RTP → auto-provision on onboarding
- ASR degradation / RTP overload / concurrent call spike → AI Ops recommends provisioning additional edge node
