---
name: "#339 Consumer Layer — corrected scope"
description: Which governance config values #339 should consume first, and which to exclude
---

## Rule
The FIRST consumers of the governance framework in #339 Phase 1 are:
- `Commercial.Bulk Client Threshold` (require_approval_above_clients)
- `Commercial.Bulk Destination Threshold` (require_approval_above_dests)
- `Commercial.Require Approval For Exceptional Pricing` (future key — not yet seeded)

NOT Initial Rate Approval — that key (`require_approval_initial_rates`) is already set to FALSE and excluded from #339 Phase 1 entirely.

**Why:** Initial rates are not a commercial decision at onboarding time. The approval already happened during Product Creation and Destination Catalogue Maintenance. Adding another gate before the first rate sheet creates duplication, not governance. Initial Rate Lifecycle = Pending → Template Created → Rate Sheet Sent → Activated (full audit, no approval gate).

**How to apply:** When wiring #336 to governance, read bulk thresholds ONLY. Do not read `require_approval_initial_rates`. Approval gates that DO apply:
- Rate below margin floor (exceptional pricing)
- Bulk push > client threshold
- Bulk push > destination threshold  
- Catalogue change / product default rate change
- Financial actions (credit limit, refund, payment adjustment)

## Frozen sprints (do not touch until governance is locked)
- #329 Initial Rate Job Creation
- #336 Initial Rate Lifecycle & Approval
- #337 Configuration Values
- #338 Validation Rules Engine
- #338A Governance Review Dashboard
