# ADR-003 — Send Rate: Control-Plane / Execution-Plane Boundary

**Status:** Accepted
**Sources:** `[I]` `.agents/memory/sippy-rate-push-api.md`, `sippy-rate-push-permissions.md`, `sippy-account-tariff-chain.md`

## Problem
Where does rate authority live, and how are rates applied to the switch?

## Decision
- **BitsAuto is the control/orchestration plane; Sippy is the execution plane.**
  BitsAuto decides *what* rate to push; Sippy *applies* it.
- Rate push mechanism = **Sippy portal CSV upload** (`Action=AS` multipart POST).
  Sippy has **zero XML-RPC rate-write methods**.
- `server/sippy.ts` is the integration boundary and is **frozen**.

## Alternatives considered
- XML-RPC rate write — **impossible** (no such method in Sippy).
- Editing rates directly in the Sippy UI — bypasses BitsAuto governance/audit.

## Consequences
- Rate push is the only Commercial action with **external production side-effects**
  (Class D/E; no auto-rollback — reversal is a compensating push).
- `ssp-root` is a **reseller**, portal-blocked from `/c1/rates.php`; the working path
  is `/admin/tariffs.php?action=edit_rates&i_tariff=N` with a separate rate-admin
  credential (`settings.sippy_rate_admin_user/pass`).
- Accounts resolve tariffs via **Service Plans (iBillingPlan)**, not direct iTariff.
- Prefix sent to Sippy is governed by [ADR-001](ADR-001-product-prefix.md) (see VR-001).
