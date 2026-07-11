# Capability Dossiers

One authoritative document per business **capability** — aggregating everything about
it (purpose, features, technical, tests, bugs, decisions, roadmap) so a capability can
be understood and reviewed as a whole, not feature-by-feature.

## Stable ID scheme (permanent — names evolve, IDs don't)
- **`DOM-NNN`** — Top-Menu business domain (`DOMAINS` order): DOM-001 Live Network ·
  DOM-002 Clients · DOM-003 Operations · DOM-004 BitsEye · DOM-005 Analytics ·
  DOM-006 Intelligence · DOM-007 Security · DOM-008 Finance · **DOM-009 Products** ·
  DOM-010 Voice Trading · DOM-011 Platform.
- **`CAP-NNN`** — capability (owned by a domain).
- **`FEAT-NNNN`** — feature (belongs to a capability, maps to a page/route).

Everything else references IDs: `BUG-014 affects FEAT-0002`, `VR-002 touches CAP-001`,
`ADR-005 changes CAP-001`. IDs are assigned once, here, and never reused/renumbered.

## Feature maturity
| Status | Meaning |
|--------|---------|
| Live | production |
| Beta | functional, stabilising |
| Partial | in progress |
| Frozen | locked architecture |
| Deprecated | planned removal |
| Planned | roadmap |

## Ownership (business context)
| Capability domain | Owner |
|---|---|
| Vendor Rates / Products | Commercial |
| Margin / Billing / Finance | Finance |
| Routing / Voice Trading | Voice Trading |
| AI Ops / NOC | NOC |
| Security | Security |

## Dossier template (every capability follows this)
Header (IDs, domain, owner, maturity) · Business purpose · Feature inventory (with
IDs + maturity) · Technical inventory (pages/APIs/services/tables) · Dependencies
(blast radius) · Test coverage · Bug Register links · Verification Register links ·
ADRs · Backlog · Roadmap · Duplicate analysis · Screens · Acceptance criteria ·
Open questions.

## Index
| ID | Capability | Domain | Owner | Status |
|----|-----------|--------|-------|--------|
| [CAP-001](CAP-001-vendor-rate-management.md) | Vendor Rate Management | DOM-009 Products | Commercial | Active (Sprint 1) |

> Reviews operate at the **capability** level (review CAP-001 as a whole, then its
> features), per the Platform Architecture Review methodology.
