# NOC Portal — Framework Certification

**Status:** **Framework Baseline v1.0 (Build Verified)** — tag `portal-framework-v1.0`.
Promote to **Framework v1.0 Certified** only after every Phase-A gate below is ✅ at runtime.
**Branch:** `feature/portal-framework`. **Prereq:** apply `migrations/029_seed_portal_assignments.sql`.

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
Deploy `feature/portal-framework` to staging, apply `029`. No new work items — these gates are the certification.

### Environment
- ☐ Migration `029` applied
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

## Status definitions
- **Build Verified** — framework compiles, static validation passes, architecture frozen. *(Current — tag `portal-framework-v1.0` @ 98758d4f.)*
- **Runtime Validated** — every item in the Release Gate below is green on the deployed runtime. Only then does the tag advance.
- **Certified / merged** — Runtime Validated + owner sign-off → merge to `main`.

## Runtime Validation Checklist (Release Gate)
The tag does **not** advance automatically, and its target is **not** predetermined: it moves from
`98758d4f` to **the exact commit that was validated in production** (the branch tip that passed this
gate) — only when the owner confirms **all** of these are green on the deployed runtime:

**Backend**
- ☐ `/api/portal/definitions` returns the expected portal set
- ☐ `/api/portal/modules/noc` returns 6 modules
- ☐ `/api/portal/sections/noc` returns the expected sections

**UI**
- ☐ `/noc` shows the portal top nav (Live Operations / Command Center), **not** platform DOMAINS
- ☐ Sidebar contains the six Phase-1 modules
- ☐ `/noc/live-calls` renders inside the NOC portal shell

**Routing continuity (exercises the router, not just pages)**
- ☐ Browser **Back/Forward** across `/noc/*` stays in the portal
- ☐ **Refresh** on `/noc/live-calls` still renders the portal shell (no drop to platform)
- ☐ **Deep link** — pasting `/noc/live-traffic` directly opens it in-portal

**Regression**
- ☐ Existing non-portal routes still work
- ☐ Existing authentication/authorization still works
- ☐ Build succeeds with no new TypeScript errors

## Promotion rule (only two paths exist)
```
Framework Baseline v1.0 (Build Verified)
              │
              ▼
      Deploy Validation (Phase A)
        │                 │
    all gates green?      no
        │                 │
        ▼                 ▼
 Framework v1.0      Fix ONLY the validated
 Certified          defect → retest
```
- [ ] All Phase-A gates ✅ → promote `portal-framework-v1.0` to **Framework v1.0 Certified** (date / who).

## Hard gates
- **`feature/portal-framework` is a release branch (RC).** No new capability work enters it — Dashboard Engine (v1.1), CAP-002 IAM, and Commercial/Finance/Security portals are developed in **separate capability branches** and merged only after v1.0 is complete. Only a defect fix found during the release gate may land here.
- **No merge to `main` until NOC Certification is complete** — protects the framework from promotion before runtime validation.
- Phase B is **push → PR → review → merge** only. No feature additions, no refactoring, no architectural changes.
- Phase A **requires staging/runtime validation by the owner** — it cannot be completed from the engineering environment (no deploy / no live runtime here).

## Phases
| Phase | Status | Outcome |
|-------|--------|---------|
| Engineering Foundation | ✅ Complete | Frozen |
| Portal Framework v1.0 | ✅ Complete (Build Verified) | Frozen |
| A — NOC Certification | 🔄 Pending deployment validation | Requires staging/runtime validation |
| B — Merge | ⏳ Ready after successful Phase A | Push → PR → Review → Merge |
| C — Commercial | ⏳ Configuration only | First production tenant after NOC |
| D — Finance | ⏳ Configuration only | Second tenant |
| E — Admin | ⏳ Configuration only | Third tenant |
| F — Legacy Cleanup | ⏳ After all portals live | Remove `noc.config.ts`, legacy portal-home/DashboardTemplate, workspaces model + tables + compat APIs |

## Commercial acceptance test — defines "framework success"
**Commercial Portal must be implemented without modifying the Router, Portal Configuration Service,
Module Registry, or Dashboard Template.** If Commercial needs only: portal assignments · menu config ·
dashboard config · permissions · hierarchy → **Framework v1.0 achieved its objective.** If Commercial
requires framework code changes → treat it as a **framework defect discovered during rollout** (fix the
framework), **not** as Commercial feature work.
