# NOC Portal — Framework Certification

**Status:** **Framework Baseline v1.0 (Build Verified)** — tag `portal-framework-v1.0`.
Promote to **Framework v1.0 Certified** only after every Phase-A gate below is ✅ at runtime.
**Branch:** `feature/portal-framework`. **Prereq:** apply `migrations/022_seed_portal_assignments.sql`.

## Build-verified (static, done — this is what "Baseline v1.0" attests)
| Check | Result |
|-------|--------|
| `vite build` | ✅ exit 0 |
| Typecheck adds 0 new errors | ✅ (baseline 289 pre-existing) |
| Registry keys == seed keys (exact) | ✅ |
| All 6 target page files exist | ✅ |
| No `/noc/*` route collision (generic owns them) | ✅ |
| Nav links portal-relative `/:portal/:moduleKey` | ✅ (TopNav, Sidebar, PortalHome) |

## Phase A — Deploy validation (the certification; exactly these gates)
Deploy `feature/portal-framework` to staging, apply `022`. No new work items — these gates are the certification.

### Environment
- ☐ Migration `022` applied
- ☐ Portal configuration seeded
- ☐ Application starts successfully

### Navigation (each opens in-portal, not the main-platform route)
- ☐ `/noc`  ☐ `/noc/live-calls`  ☐ `/noc/live-traffic`  ☐ `/noc/traffic-map`
- ☐ `/noc/noc-dashboard`  ☐ `/noc/noc-command`  ☐ `/noc/ops-console`

### Portal behaviour
- ☐ Portal context preserved  ☐ Refresh works  ☐ Deep links work
- ☐ Browser Back works  ☐ Browser Forward works
- ☐ Top menu remains NOC  ☐ Dashboard remains NOC  ☐ No redirect to main platform

### Framework
- ☐ Portal Configuration Service resolves correctly
- ☐ Module Registry resolves correctly
- ☐ No duplicate routes
- ☐ No console errors

### Regression
- ☐ Existing BitsAuto routes still function
- ☐ Existing dashboard unaffected
- ☐ Existing APIs unaffected

## Defect handling
| Defect class | Action | Baseline tag |
|--------------|--------|--------------|
| **Framework** | Fix framework → retest | **Move tag** to corrected commit |
| **Seed** (migration) | Fix migration → retest | Tag stays |
| **Data** (configuration) | Fix config → retest | Tag stays |

## Promotion
- [ ] All Phase-A gates ✅ → promote `portal-framework-v1.0` status to **Framework v1.0 Certified** (date / who).

## Rollout phases
- **A** Deploy validation (this doc) → certify.
- **B** Push branch + tag · open PR · review · merge. **No feature additions, no refactoring, no "while we're here."**
- **C** Commercial = 2nd tenant. *Acceptance test:* needs config only = framework succeeded; needs routing/nav code = framework defect (fix the framework, not Commercial).
- **D** Finance — configuration only.
- **E** Admin — configuration only.
- **F** Cleanup release (only after all four live): remove `noc.config.ts`, legacy portal-home/DashboardTemplate components, the `workspaces` navigation model + tables, and compatibility APIs.
