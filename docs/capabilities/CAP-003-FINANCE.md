# CAP-003 — Finance / Billing Capability (Dossier)

**Status:** SCOPED — owner decisions of 2026-07-15/16. Not yet in build.
**Sequencing:** after Portal Framework v1.0/v1.1 certification. Branch: `feature/finance-billing` (never the portal RC).
**Source:** legacy BitsAuto Finance module (26-screen walkthrough) + full gap analysis vs the current platform.

This dossier is the citable record of CAP-003. Cross-references from other governance
documents (e.g. the Account Wizard change policy) should cite this file.

## The layered rule (platform law — the citable principle)

> **UI = business concepts only** — Invoice, Billing Account, Period, Revenue, Margin,
> Approval, Payment, Credit/Debit Note, VAT.
> **Service layer = operational concepts** — CDR reconciliation, recalculation, rating,
> snapshots, Sippy, tariffs.
> **Infrastructure = technical concepts** — XML-RPC, uploads, retries, tokens.
>
> Finance UI shows business outcomes ("billing data ready", "variance flagged") — never
> "recalculate invoice" or "fetch CDRs from Sippy".

Relevance to provisioning (DEFERRED-CP-006): the wizard's "Billing Package" dropdown
conflates *dedicated billing* (tariff + plan per client — wholesale) with *shared
billing* (reuse a standard plan — retail). That distinction is an operator-intent
business concept and must be modeled explicitly; tariff/plan mechanics stay in the
service layer. Reconcile any CP-006 redesign with this rule before designing it.

## Approach (owner-confirmed): audit → consolidate → enhance → build-missing

NOT a greenfield rebuild. Phase 0 = **Finance Functional Certification**: rate every
existing module Exists/API/DB/Workflow/Rules/Audit/UAT → ✅ProdReady / 🟡Enhance /
🔵Partial / ❌Missing before any build.

| Area | Verdict | Notes |
|---|---|---|
| AR (receivables) | ✅ largely exists | invoices, payments, credit_notes, disputes, adjustment_ledger all present — consolidate + verify + UX cleanup |
| AP (vendor billing) | ❌ new build | no vendor invoice/verification/approval/payment lifecycle |
| Treasury | ⚠️ extend | company_bank_accounts + payment_runs exist; wallets (USDT) missing |
| VAT / Tax | ❌ new build | UAE 5% compliance; only a tax_id field exists today |
| Config | ⚠️ extend | currencies/exchange-rates/per-client email templates missing |
| Reports | ✅ mostly exists | |

## Preserve from legacy (as explicit state machines + audit)

- Client invoice lifecycle: Draft → Difference Review → Approval → (Rejected) → Sent →
  Paid. The rated-vs-CDR "Differences" step is the key billing control — keep prominent.
- Vendor settlement: Received → Draft → Verification → Approval → Payment (kept separate
  from the client side).
- Adjustments (client & vendor): governed transactions with reason codes, approval, and
  ledger impact.
- Disputes ↔ credit/debit notes as a first-class relationship.

## Data-model musts

Multi-currency USD + AED first-class · 5% UAE VAT first-class · USDT wallet as a
payment method · QuickBooks/SBC sync = integration concern (UI shows sync status only)
· AR/AP ledger foundation early.

**Do NOT bring forward from legacy (telecom leaks):** Switch Block Status (→NOC/Security),
CDR Reconciliation (backend service), Recalculate Invoice (backend-triggered, audit-only).

## Portal placement

Finance Portal = pure configuration on the portal framework (registry / workspace /
router — no new framework concepts). Sections: Dashboard · Sales (AR) · Purchasing (AP)
· Treasury · Accounting/VAT · Reports · Configuration. Finance-domain config (billing
cycles, templates, tax rules, payment terms, currencies, bank accounts) lives in
Finance → Configuration; platform/security config stays in Admin (ADR-006).
