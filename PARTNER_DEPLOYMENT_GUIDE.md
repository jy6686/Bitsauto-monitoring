# Bitsauto VoIP Platform — Partner Deployment Guide

Complete reference for deploying, licensing, and managing the Bitsauto Monitoring Platform for commercial partners and white-label clients.

---

## 1. Multi-Domain Publishing Capability

### What is Possible

The Bitsauto platform can be published to an unlimited number of domains. Each partner deployment is an independent instance of the platform, pointed at that partner's own Sippy softswitch and served under their own domain or subdomain.

**Deployment options by domain model:**

| Model | Domain Example | Use Case |
|---|---|---|
| Hosted subdomain | noc.bitsauto.com/partnerA | Shared hosting, low cost |
| Partner subdomain | noc.partnerA.com | White-label, partner owns DNS |
| Partner root domain | monitor.partnerA.net | Full white-label, dedicated |
| Demo portal | demo.bitsauto.com | Pre-sales trials |

### How Multiple Domains Work

Each domain maps to a separate running instance (container or process) of the platform. A reverse proxy (Nginx or Caddy) routes incoming requests by hostname to the correct instance. SSL certificates are provisioned automatically per domain using Let's Encrypt. No code changes are needed between deployments — only configuration (Sippy credentials, branding, feature flags) differs per instance.

---

## 2. Partner Onboarding Process

### Step-by-Step Flow

**Step 1 — Partner Agreement**
Sign commercial agreement covering licensing tier, feature set, support SLA, and billing model.

**Step 2 — Infrastructure Provisioning**
Provision a server instance (VPS or container) for the partner. This takes 5–10 minutes with an automated deploy script.

**Step 3 — Configuration**
Supply the partner's Sippy softswitch credentials (XML-RPC user, admin web user, portal session). Configure feature flags (which modules are enabled). Set branding (logo, company name, colour scheme if white-labelled).

**Step 4 — Domain Setup**
Partner points their DNS A record to the server IP. SSL certificate is auto-provisioned via Let's Encrypt (takes 2–5 minutes after DNS propagates).

**Step 5 — Admin Account Creation**
Create the partner's first admin account. Credentials are emailed to their designated technical contact.

**Step 6 — Handover and Training**
Provide the User Manual (auto-generated from the platform). Schedule a 1-hour walkthrough call for the partner's NOC team.

**Total onboarding time:** 2–4 hours technical work, 24–48 hours DNS propagation buffer.

---

## 3. Demo Account Creation and Management

### Recommended Demo Structure

Demo accounts are time-limited, feature-capped instances designed for pre-sales trials. They use a shared demo Sippy switch (or simulated/synthetic data) so no partner Sippy credentials are needed during evaluation.

**Demo account properties:**

| Property | Value |
|---|---|
| Duration | 14 days (configurable) |
| Data source | Shared demo switch or simulation mode |
| Feature set | Live Calls, CDR Browser, Dashboard KPIs, BitsEye, Traffic Map |
| Disabled features | Fraud Engine, Rate Card Management, API Key Management, Team Management |
| User limit | 3 users per demo account |
| Auto-expiry | Account disabled automatically at day 14 |

### Demo Management Process

A demo is created in under 5 minutes: create a tenant record with demo flag and expiry date, create an admin user account, and send credentials by email. No infrastructure provisioning is needed if running on a shared demo environment. Expired demo accounts are automatically cleaned up by a scheduled job.

---

## 4. Custom Domain Setup for Partners

### DNS Configuration (Partner Side)

The partner adds one DNS record at their registrar:

```
Type: A
Name: noc (or monitor, or voip)
Value: [your server IP]
TTL: 300
```

For a root domain (e.g., monitor.partnerA.com), a CNAME to your load balancer is also acceptable.

### Server Side (Your Side)

Add a new virtual host block to Nginx or Caddy pointing to the partner's application port. SSL is provisioned automatically via Certbot or Caddy's built-in ACME client. The entire process takes under 10 minutes once DNS has propagated.

### Wildcard Domain Option

For partners using subdomains of your own domain (e.g., partnerA.bitsauto.com), a single wildcard SSL certificate (*.bitsauto.com) covers all partners at once, eliminating per-partner SSL management entirely.

---

## 5. Role-Based and Limited Feature Access

### Role Hierarchy

| Role | Who Uses It | Access Level |
|---|---|---|
| Super Admin | You (platform owner) | All tenants, all data, all config |
| Tenant Admin | Partner's IT admin | Their own users, switch config, feature config |
| Management | Partner's manager/KAM | Analytics, reports, alerts — no system config |
| NOC Viewer | Partner's NOC operator | Live calls, alerts, dashboards — read only |
| Demo User | Pre-sales prospect | Subset of features, synthetic data, time-limited |

### Feature Flags Per Partner

Every feature module can be independently enabled or disabled per partner without a code deployment. Feature flags are stored in the database against the tenant record.

**Example feature flag matrix:**

| Feature | Internal | Standard Partner | Lite Partner | Demo |
|---|---|---|---|---|
| Live Call Monitor | ON | ON | ON | ON |
| CDR Browser | ON | ON | ON | ON |
| Dashboard KPIs | ON | ON | ON | ON |
| BitsEye Analytics | ON | ON | OFF | ON |
| Traffic Map | ON | ON | OFF | ON |
| Revenue and Margin | ON | ON | OFF | OFF |
| Fraud Engine (FAS) | ON | ON | OFF | OFF |
| Rate Card Management | ON | ON | ON | OFF |
| Routing Manager | ON | ON | OFF | OFF |
| API Key Management | ON | ON | OFF | OFF |
| Test Call Launcher | ON | ON | OFF | OFF |

---

## 6. Multi-Tenant Architecture Overview

### Architecture Model

The recommended approach is a shared codebase with tenant-aware data isolation. Every database table includes a tenant_id column. All queries are automatically scoped to the requesting user's tenant. This means one running codebase serves all partners simultaneously, with zero data leakage between tenants.

```
Internet
    |
Reverse Proxy (Nginx / Caddy / Cloudflare)
    |
    |--- noc.partnerA.com -----> App Instance (Port 3001) --> DB Tenant A
    |--- noc.partnerB.com -----> App Instance (Port 3002) --> DB Tenant B
    |--- demo.bitsauto.com ----> App Instance (Port 3003) --> DB Demo
    |--- internal.bitsauto.com -> App Instance (Port 3000) --> DB Internal
```

### Two Viable Models

**Option A — One instance per tenant (current Replit model)**
Each tenant gets a fully isolated process and database. Maximum isolation, simplest mental model, easiest to debug. Higher resource cost at scale.

**Option B — Shared instance, tenant-scoped data**
One application process serves all tenants. Tenant isolation enforced at the query layer. Efficient at scale, requires careful engineering to ensure data boundaries are never crossed.

For up to 10 partners, Option A is recommended. For 10+ partners, Option B becomes cost-effective.

---

## 7. Licensing and Access Control Strategy

### Recommended Licensing Tiers

| Tier | Monthly Price | Included Features | Switch Limit | User Limit |
|---|---|---|---|---|
| Lite | $199/month | Core monitoring, CDR, dashboard | 1 switch | 5 users |
| Standard | $499/month | All analytics, rate cards, BitsEye | 3 switches | 15 users |
| Professional | $999/month | Full platform including fraud engine, routing manager | 5 switches | Unlimited |
| Enterprise | Custom | Full platform, white-label, SLA, dedicated support | Unlimited | Unlimited |

### Access Control Enforcement

Licensing is enforced at the tenant feature flag level. When a partner's subscription lapses, their feature flags are automatically downgraded (not deleted) — they retain read access to historical data but cannot use premium features until the subscription is renewed. This is a commercially friendlier approach than hard lockouts.

### Audit Trail

Every significant action (login, config change, CDR export, API key creation) is logged against the user and tenant. This protects both you and the partner in any dispute.

---

## 8. Hosting and Infrastructure Recommendations

### For Up to 5 Partners

A single VPS (4 vCPU, 8 GB RAM) running all instances is sufficient. Estimated cost: $40–60/month on DigitalOcean, Hetzner, or Vultr. Each partner runs as a separate Docker container or Node.js process on a dedicated port.

### For 5–20 Partners

Two VPS nodes behind a load balancer. One node handles application processes, one handles the shared PostgreSQL database cluster. Estimated cost: $80–120/month infrastructure.

### For 20+ Partners

Move to a managed Kubernetes cluster (DigitalOcean DOKS, AWS EKS, or GKE). Each partner tenant is a separate namespace. Auto-scaling handles traffic spikes. Estimated cost: $200–400/month infrastructure depending on region and partner load.

### Database

PostgreSQL is the right choice at all scales. For Option A (one DB per tenant), use a shared PostgreSQL server with one database per tenant. For Option B (shared DB), one database with tenant_id row-level security. Backups run nightly to object storage (S3 or equivalent) — cost is negligible (under $5/month for most partner sizes).

---

## 9. Security and SSL Management Overview

### SSL Certificate Strategy

| Approach | Best For | Cost |
|---|---|---|
| Let's Encrypt via Certbot | Self-managed VPS, per-domain certs | Free |
| Cloudflare Proxy | All domains behind Cloudflare | Free (Cloudflare plan) |
| Wildcard certificate | All subdomains of your domain | Free via Let's Encrypt DNS challenge |
| DigiCert / Sectigo EV | Enterprise partners requiring EV SSL | $100–300/year per domain |

### Security Controls

All API endpoints enforce role-based access at the middleware layer. Admin endpoints require the admin role; super admin endpoints require super admin. Secrets (Sippy credentials, API keys) are stored encrypted at rest. Partner data is never accessible across tenant boundaries. Rate limiting is applied to all authentication endpoints to prevent brute force attacks. Session tokens expire after 8 hours of inactivity.

### Penetration Testing Recommendation

Before onboarding paying partners, run a basic automated security scan (OWASP ZAP or Burp Suite Community). This is a one-day exercise and dramatically increases partner confidence.

---

## 10. Scalability and Maintenance Considerations

### Scaling Triggers

- **5 partners:** Add a dedicated database server, separate from application server
- **10 partners:** Add a second application server and load balancer
- **20 partners:** Move to container orchestration (Docker Compose or Kubernetes)
- **50+ partners:** Consider a managed cloud platform (AWS, GCP) with auto-scaling and global CDN

### Maintenance Model

Monthly maintenance tasks include dependency updates, SSL certificate renewal verification, database vacuum and index optimisation, and backup integrity checks. Estimated time: 2–4 hours per month for up to 10 partners.

For partners on the Professional or Enterprise tier, include a quarterly health report (CDR volume, uptime %, alert history) as part of the service — this is generated automatically from the platform's own data.

### Uptime SLA Targets

| Tier | SLA Target | Monitoring |
|---|---|---|
| Lite / Standard | 99.5% (3.6 hours downtime/month) | Uptime Robot (free) |
| Professional | 99.9% (44 minutes downtime/month) | Better Uptime or Pingdom |
| Enterprise | 99.95% | Dedicated monitoring, PagerDuty |

---

## 11. Per-Partner Cost Breakdown

### One-Time Setup Cost Per Partner

| Item | Estimated Cost |
|---|---|
| Server provisioning and configuration | $50–100 (1–2 hours at $50/hr) |
| Domain DNS setup and SSL provisioning | $0–50 (if self-managed) |
| Branding and white-label configuration | $100–200 (2–4 hours) |
| Initial testing and handover | $50–100 (1–2 hours) |
| **Total one-time setup** | **$200–450 per partner** |

### Monthly Operational Cost Per Partner (Shared Infrastructure Model)

| Item | Monthly Cost | Notes |
|---|---|---|
| Hosting / server share | $8–15 | Proportional share of $40–60 VPS |
| Database storage | $1–3 | PostgreSQL, typically 500 MB–2 GB per partner/month |
| Backup storage | $0.50–1 | S3-compatible object storage |
| Domain (if you provide it) | $1–2 | $12–24/year amortised |
| SSL certificate | $0 | Let's Encrypt is free |
| Email service (alerts, notifications) | $1–3 | Resend or SendGrid free tiers cover most partners |
| Monitoring and uptime checks | $0–2 | Uptime Robot free tier covers up to 50 monitors |
| Maintenance labour (shared across partners) | $5–10 | Assuming 3 hours/month across 10 partners |
| **Total monthly per partner** | **$17–36/month** |

### Monthly Operational Cost Per Partner (Dedicated Instance Model)

| Item | Monthly Cost | Notes |
|---|---|---|
| Dedicated VPS (2 vCPU, 4 GB RAM) | $20–25 | Hetzner CX21 or DigitalOcean Basic |
| Database (managed PostgreSQL) | $15–25 | DigitalOcean Managed DB smallest tier |
| Backup storage | $1–2 | |
| Domain and SSL | $1–2 | |
| Email service | $1–3 | |
| Monitoring | $2–5 | |
| Maintenance labour | $20–50 | More isolation = more management overhead |
| **Total monthly per partner** | **$60–112/month** |

### Yearly Operational Cost Summary

| Model | Monthly/Partner | Yearly/Partner | Recommended Minimum Price |
|---|---|---|---|
| Shared infrastructure (Lite) | $17–36 | $204–432 | $199/month ($2,388/year) |
| Shared infrastructure (Standard) | $20–40 | $240–480 | $499/month ($5,988/year) |
| Dedicated instance (Professional) | $60–112 | $720–1,344 | $999/month ($11,988/year) |
| Dedicated instance (Enterprise) | $100–200 | $1,200–2,400 | Custom (min $1,500/month) |

### Gross Margin at Scale

At 10 Standard partners on shared infrastructure:
- Monthly revenue: 10 x $499 = $4,990
- Monthly infrastructure cost: 10 x $30 = $300
- Monthly labour (support, maintenance): $500–800
- **Gross margin: approximately 83–85%**

At 20 Standard partners on shared infrastructure:
- Monthly revenue: 20 x $499 = $9,980
- Monthly infrastructure cost: 20 x $25 = $500 (economies of scale)
- Monthly labour: $800–1,200
- **Gross margin: approximately 87–89%**

---

## 12. Recommended First Steps

1. Formalise one white-label partner deployment manually to validate the process end-to-end
2. Document the exact steps taken into a runbook — this becomes your deployment playbook
3. Build a simple partner admin page (super admin only) to manage tenant records, feature flags, and demo account expiry
4. Set up a shared demo environment with synthetic data for pre-sales trials
5. Establish a billing relationship (Stripe) before onboarding more than 2–3 paying partners
6. Run a basic security scan before any commercial partner goes live

