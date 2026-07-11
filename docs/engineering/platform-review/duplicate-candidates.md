# Duplicate Candidates — for owner review `[V surface / needs business review]`

**These are CANDIDATES, not decisions.** Nothing is hidden, disabled, or deleted.
Each needs a business-purpose review before any consolidation is even proposed.
Surface overlap ≠ functional duplication — some may be intentionally distinct.

## A. Traffic map surfaces (3)
- Traffic Map `/traffic-map` · Live Traffic `/live-traffic` · Live Traffic Map `/live-traffic-map`
- **Question:** distinct views (historic vs live vs geo) or overlapping? → business review.

## B. NOC / command surfaces (4)
- NOC Dashboard `/noc-dashboard` · Incident Command `/noc-incidents` · NOC Command `/noc-command` · Ops Console `/ops-console`
- **Note:** `.agents/memory/noc-sprint-architecture.md` says NOC incidents are
  network-level vs account-level — so some separation is intentional. Confirm scope.

## C. Route testing surfaces (3)
- Route Tester `/test-call` · Route Simulator `/call-flow-simulator` · Route Testing `/route-testing`
- **Question:** live test-call vs simulation vs batch testing — distinct or merge-able?

## D. Vendor / carrier quality surfaces (4)
- SLA Scorecard `/vendor-sla-scorecard` · Carrier Scoring `/carrier-scoring` · Health Engine `/vendor-health` · Balance Monitor `/balance`
- **Question:** overlapping scoring/health metrics across multiple pages.

## E. BitsEye (2)
- BitsEye 2.0 `/bitseye2` (**FROZEN Tier-1 asset**) · BitsEye Classic `/bitseye`
- **Note:** governance freezes BitsEye2. Classic may be legacy — owner decision only,
  do not touch BitsEye2.

## F. Account / company surfaces
- Accounts `/clients` · Company List `/company/list` · Org Management `/company-profile`
  · Account Wizard `/client/wizard` · Onboarding Wizard `/company/onboarding`
- **Question:** two onboarding wizards; client vs company models — reconcile?

## G. Multi-homed nav links (not duplicates — cross-links)
- `/calls`, `/graphs`, `/live-traffic-map`, `/bitseye2` appear in multiple domains.
- **Not** duplicate features — same page surfaced in several nav locations. Note for
  nav-hygiene, not consolidation.

## Next step
Owner reviews each candidate → for any confirmed overlap, a **merge proposal** is
written (separate doc), then implemented as its own governed change. Until then:
**no functional change.**

## Open Questions
- [ ] Business-purpose confirmation for A-F — **Institutional Knowledge Required**
- [ ] Complete inventory (domains 5-11) before finalizing candidates — **Pending**
