---
name: Trust Center auth rule ownership model
description: Locked design for managed_by + last_change_source fields on every protected auth rule / config object in Trust Center.
---

# Trust Center — Auth Rule Ownership Model (LOCKED)

## Two mandatory fields on every protected object

### `managed_by`
Who originally owns this rule in BitsAuto's view.

| Value | Meaning |
|---|---|
| `bitsauto` | Created through Auth Studio / Provisioning workflow |
| `legacy` | Imported during baseline seed (existed in Sippy before Trust Center activated) |
| `manual` | Added directly in Sippy after Trust Center was active — THIS is the drift signal |

### `last_change_source`
Who most recently modified the rule (can diverge from managed_by).

| Value | Meaning |
|---|---|
| `bitsauto` | Last change made via BitsAuto workflow |
| `sippy` | Last change detected as made directly in Sippy portal |
| `import` | Set during baseline seed import |
| `system` | Auto-revert or system action |

**Why two fields:** A rule may be `managed_by=bitsauto` but `last_change_source=sippy` — meaning someone modified a BitsAuto-owned rule directly in Sippy. Trust Center shows both, making investigation much cleaner than drift events alone.

## First Activation Workflow (REQUIRED before drift detection starts)

When an environment is first Protected:
1. Run Baseline Scan → `listAuthRules()` on the Sippy environment
2. Import all existing rules → `managed_by = legacy`, `last_change_source = import`
3. Baseline frozen in DB
4. Drift detection starts — ONLY from this point forward

**Without baseline seed:** every existing legacy rule triggers a false-positive drift event on day one. Thousands of meaningless incidents.

## Drift Logic
- `bitsauto` → allowed, expected
- `legacy` → allowed, expected (pre-existed Trust Center)
- `manual` → SUSPICIOUS — drift event created

## Scope
This ownership model applies to every future protected object, not just auth rules:
- Authentication Rules (Phase 1)
- Routing Groups (future)
- Destination Sets (future)
- Vendor Connections (future)
- Rate Sheets (future)
- Products / Pricing Templates (future)

**Why:** BitsAuto = Source of Truth, Sippy = Execution Layer. The ownership model is what makes that claim enforceable.
