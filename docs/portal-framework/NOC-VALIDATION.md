# NOC Portal — Framework v1.0 Certification Checklist

**Framework:** Portal Framework **v1.0** (FROZEN — no framework changes; validation only).
**Branch:** `feature/portal-framework`. **Prereq:** apply `migrations/022_seed_portal_assignments.sql`.
**Certify:** mark *NOC Portal Framework — Certified* only when every row is ✅ at runtime.

## Legend
- **Code** — verified statically in this branch (build/tsc/route-map/link-generation).
- **Runtime** — must be observed once against a running app with `022` applied.
- Status: ☐ pending · ✅ pass · ❌ fail.

## Static pre-checks (done)
| Check | Result |
|-------|--------|
| Build (`vite build`) | ✅ exit 0 |
| Typecheck adds 0 new errors | ✅ (baseline 289 pre-existing) |
| Registry keys == seed keys (exact) | ✅ |
| All 6 target page files exist | ✅ |
| No `/noc/*` route collision (generic owns them) | ✅ |
| Nav links are portal-relative `/:portal/:moduleKey` | ✅ (TopNav, Sidebar, PortalHome) |
| Portal chrome via LayoutShell (no page-specific code) | ✅ (ProtectedRoute wraps in portal mode) |

## Certification checklist
| # | Test | Expected | Kind | Status |
|---|------|----------|------|:--:|
| 1 | `/noc` opens | NOC portal home (DB-driven landing) | Runtime | ☐ |
| 2 | Home landing module | NOC Dashboard is `is_home` (from 022) | Runtime | ☐ |
| 3 | Live Calls click | → `/noc/live-calls` (not `/calls`) | Runtime | ☐ |
| 4 | Live Traffic click | → `/noc/live-traffic` | Runtime | ☐ |
| 5 | Traffic Map click | → `/noc/traffic-map` | Runtime | ☐ |
| 6 | NOC Dashboard click | → `/noc/noc-dashboard` | Runtime | ☐ |
| 7 | NOC Command click | → `/noc/noc-command` | Runtime | ☐ |
| 8 | Ops Console click | → `/noc/ops-console` | Runtime | ☐ |
| 9 | Refresh on any `/noc/*` | stays in portal | Runtime | ☐ |
| 10 | Browser Back | stays in portal | Runtime | ☐ |
| 11 | Browser Forward | stays in portal | Runtime | ☐ |
| 12 | Deep link (paste `/noc/live-calls`) | opens in portal, chrome intact | Runtime | ☐ |
| 13 | Copy URL / share | same portal state restores | Runtime | ☐ |
| 14 | Portal branding (NOC header/theme) | preserved on every module | Runtime | ☐ |
| 15 | Top menu (sections) | preserved, DB-driven | Runtime | ☐ |
| 16 | Dashboard | shared template, NOC config | Runtime | ☐ |
| 17 | Quick Actions | NOC config (pinned modules) | Runtime | ☐ |
| 18 | Workflows | NOC config | Runtime | ☐ |
| 19 | Main-platform routes (`/calls`, …) | still work unchanged | Runtime | ☐ |
| 20 | No page asks "which portal am I in?" | framework resolves it pre-render | Code ✅ / Runtime ☐ |

## How to run
```bash
psql "$DATABASE_URL" -f migrations/022_seed_portal_assignments.sql
# start the app, sign in, then walk rows 1–20
```

## Sign-off
- [ ] All rows ✅ → **NOC Portal Framework — Certified** (date / who)
- Then: onboard Commercial → Finance → Admin as **configuration only** (no new routing/nav code).
  If a later portal needs new routing code, the framework failed its purpose — stop and fix here.
