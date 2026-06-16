---
name: Sippy account→tariff chain
description: Sippy accounts are assigned tariffs via Service Plans (billing plans), not direct i_tariff. Resolution requires a 3-step chain.
---

## Rule
Never try to resolve a Sippy account's tariff from `iTariff` directly — all accounts on this instance use Service Plans. The correct chain is:

1. `getAccountInfo(iAccount)` → `iBillingPlan` (service plan ID, extracted at sippy.ts line ~8940)
2. `listSippyBillingPlans(username, password, portalUrl)` → `SippyBillingPlan[]` with `{ id, name, iTariff }`
3. `planToTariff.get(iBillingPlan)` → `iTariff`
4. `tariffNames.get(iTariff)` → tariff name string (from `getTariffsList`)

**Why:** `getAccountInfo` returns `iBillingPlan` but `iTariff` is 0/undefined when the account uses a service plan. Keyword-matching tariff names to FC/BC/SB/SC products also fails — tariff names are customer-specific (ASTERISK-TARIFF, JUNAID-TARIFF, calling, etc.) and have no FC/BC/SB/SC naming convention.

**How to apply:** Any time you need to display or use a client's tariff name (Rate Manager carrier dropdown, account info pages, product assignment), use the 3-step chain above. The `_tariffProductCache.labels` Map in routes.ts (iAccount → tariffName) is pre-built 20s after startup and refreshed every 30 min.

## Result on this Sippy instance
- 8 service plans found: Junaid(#1), Test-2(#7), Test-8(#8), TEST-9(#9), Test-10(#10), calling(#11), Asterisk(#12), internal-ptcl(#13)
- All 21 accounts resolved to tariff names in a single sync run (0 errors)
- Most accounts are on the "Junaid" service plan → "Junaid" tariff
- Notable exceptions: asterisk→ASTERISK-TARIFF, calling→calling, internal-ptcl→internal-ptcl

## accounts-by-product endpoint design decision
The `/api/sippy/accounts-by-product/:productId` endpoint returns **ALL** accounts regardless of productId. Product selection controls which rate card (FC/BC/SB/SC) gets sent — not which clients appear in the carrier dropdown. Filtering accounts by product was the original design intent but was dropped because tariff names don't map to FC/BC/SB/SC.
