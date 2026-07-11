# Test Lab — Coverage Matrix

| Field | Value |
|-------|-------|
| Purpose | Engineering dashboard for executable-test coverage per module |
| Status | ACTIVE (living) — grows as tests are added (framework frozen v1.0) |
| Last verified | 2026-07-11 |

Legend: ✅ present · ⚠ partial · ❌ none · — n/a. "Status": Complete / Partial /
Planned. Update this row whenever a `registerSelfTest({...})` is added.

## Commercial → Vendor Rates
| Module | Unit | Integration | External | Manual | Status |
|--------|:--:|:--:|:--:|:--:|--------|
| Vendor Parser | ✅ | — | — | — | Complete (7 unit + fixtures) |
| Vendor Import | ✅ | ⚠ (declared, not run) | — | ⚠ (real files) | Partial |
| Repository | ❌ | ❌ | — | ❌ | Planned |
| Margin | ❌ | ❌ | — | ❌ | Planned |
| Impact | ❌ | ❌ | — | ❌ | Planned |
| Approval | ❌ | ❌ | — | ❌ | Planned |
| Push | ⚠ (declared) | ⚠ | ⚠ (Sippy) | ⚠ | Planned |

## Other subsystems (all Planned)
| Module | Unit | Integration | External | Manual | Status |
|--------|:--:|:--:|:--:|:--:|--------|
| Destination Catalog / Product Mapping / Sync | ❌ | ❌ | — | ❌ | Planned |
| Routing (LCR / Route Groups / Simulator) | ❌ | ❌ | — | ❌ | Planned |
| Finance (Margin / Billing / Revenue) | ❌ | ❌ | — | ❌ | Planned |
| Product Registry | ❌ | ❌ | — | ❌ | Planned |
| Analytics / BitsEye / QoS / Reports | ❌ | ❌ | — | ❌ | Planned |
| Sippy Integration | ❌ | — | ❌ | ❌ | Planned |

> Coverage grows by **adding tests** (Test Lab v1.0 is frozen). See
> [001-framework.md](001-framework.md) §Extension guide.
