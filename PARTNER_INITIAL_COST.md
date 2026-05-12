# Bitsauto — White-Label Partner Deployment: Initial Cost Estimate

**Prepared by:** Bitsauto Platform Team  
**Date:** May 2026  
**Purpose:** Reference document for internal records — estimated cost to begin the first white-label partner deployment end-to-end.

---

## 1. Background

This document captures the recommended first-step cost estimate for formalising a white-label partner deployment of the Bitsauto Monitoring Platform. The goal is to manually validate the full process with one partner before building automation or a self-service portal.

The four recommended first steps are:

1. Formalise one white-label partner deployment manually to validate the process end-to-end
2. Document the exact steps into a runbook — this becomes the deployment playbook
3. Build a simple partner admin page (super admin only) to manage tenant records, feature flags, and demo account expiry
4. Set up a shared demo environment with synthetic data for pre-sales trials

An additional prerequisite before any commercial partner goes live: run a basic security scan.

---

## 2. What Step 1 Requires

| Item | Description | Estimated Cost |
|---|---|---|
| Second Replit deployment | A separate always-on live instance of the platform, rebranded for Partner #1 | $25 / month |
| Custom domain (optional) | e.g. partner1.bitsauto.net — professional and branded | ~$10–15 / year |
| Internal development time | Configure branding, credentials, demo data, and produce the runbook | 4–8 hours (staff time) |
| Security scan (pre go-live) | Replit built-in security scan — runs in minutes | $0 (included) |

---

## 3. Required Subscription Plan

**Replit Core — $25 / month per deployment**

This plan provides:
- Always-on hosting (no sleep on inactivity)
- Custom domain support
- Persistent PostgreSQL database
- Production-grade deployment infrastructure

The current platform is already hosted on a compatible plan. Adding one partner instance means one additional Core deployment at **$25 / month**.

---

## 4. Total Initial Cost Summary

| Cost Item | Amount |
|---|---|
| Existing platform hosting | Current plan (no change) |
| + 1 partner white-label deployment | +$25 / month |
| + Custom domain name (optional) | ~$1 / month (amortised annually) |
| **Total additional monthly cost** | **~$25–26 / month** |

There are no setup fees, no per-seat charges, and no additional database costs for the first partner instance. All development work (runbook, partner admin page, demo environment) is delivered within the existing platform using staff time only — no new tooling or licences required.

---

## 5. Suggested Sequence Before Incurring Any Cost

To minimise risk and avoid spending before readiness:

1. **Run the security scan first** — free, takes minutes, must happen before any partner sees a production URL
2. **Deploy one partner instance** — work through the full onboarding manually and document every step; this produces the runbook at no extra risk
3. **Build the partner admin page** — implemented inside the existing app, no new deployment required, no extra cost
4. **Set up the demo environment** — reuse the partner instance with synthetic data; no third deployment needed at this stage

---

## 6. Scaling Beyond the First Partner

For reference, as the partner programme grows:

| Partner Count | Additional Monthly Cost |
|---|---|
| 1 partner | +$25 / month |
| 3 partners | +$75 / month |
| 5 partners | +$125 / month |
| 10 partners | +$250 / month |

Each partner instance is isolated (separate deployment, separate database) unless a shared multi-tenant architecture is adopted later — which would reduce per-partner hosting cost significantly.

---

## 7. Notes & Assumptions

- All cost figures are based on Replit Core plan pricing as of May 2026. Prices are subject to change — verify at [replit.com/pricing](https://replit.com/pricing) before committing.
- Domain costs vary by registrar and TLD. Figures above are approximate for `.net` / `.com` domains via standard registrars.
- Staff time estimates (4–8 hours for Step 1) assume familiarity with the platform and Replit deployment workflow.
- A professional third-party penetration test (if required by a partner's compliance team) would cost $500–$2,000+ and is not included above. The built-in scan covers standard vulnerability checks sufficient for initial launch.

---

*Bitsauto Monitoring Platform — Internal Reference Document*  
*Generated from the Bitsauto Settings › Downloads section*
