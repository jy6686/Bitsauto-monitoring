# NAV Baseline Snapshots — Pre-Phase-6 Gate (Task #46)

**Status:** MANDATORY before any Phase 6 consumer migration.
**Captured:** _(fill date when complete)_
**Environment:** deployed app (`vo-ip-watcher--junaid70.replit.app`), NOC portal, logged in.

## Frozen runtime invariants (post-Phase-3, deployment 0484ea16)

| Invariant | Value |
|---|---|
| navigationChecksum | `c3760592395da687` |
| workspaceVersion | `1` |
| domains | `6` — live-network, operations, telemetry, analytics, intelligence, security |
| search.index length | `55` |
| hidden modules | absent from nav AND search (21 keys per NOC-WORKSPACE-SPEC seed) |
| read-only modules | `routing-manager`, `call-recordings` (`visibility: "read-only"`) |

After **every** Phase 6 consumer step, re-verify all six. A consumer migration may
change how the workspace is consumed — never what it contains. Any checksum drift
without an intentional workspace configuration change is a stop-ship.

## Snapshot set (flag OFF — legacy Model B, the behavior being preserved)

1. `01-top-menu.png` — full domain tab row on /noc/dashboard
2. `02-cascade-<domain>.png` — one per domain with cascade open (6 screenshots)
3. `03-search-routing.png` — search results for "routing"
4. `04-search-executive.png` — results for "executive" (baseline shows legacy leakage, if any)
5. `05-search-codec.png` — results for "codec"
6. `06-breadcrumb-sip-trace.png` — module page breadcrumb (/noc/sip-trace)
7. `07-sidebar-state.png` — sidebar as rendered in portal mode
8. `08-workspace-response.json` — raw response:
   `fetch('/api/portals/noc/workspace').then(r=>r.json()).then(d=>copy(JSON.stringify(d,null,2)))`
   then paste into the file.

Store all files in `docs/portal-framework/baselines/`.

## Phase 6 comparison rule

For each consumer (Search → Top Menu → Cascade → Breadcrumb → Dashboard shortcuts →
Quick Actions → Favorites):

1. Capture the same views with the flag ON after the consumer migrates.
2. Diff against this baseline. Expected differences must be limited to the
   consumer's own intentional changes (e.g. Search: hidden modules disappear from
   results; "executive"/"codec" return 0; "routing manager" returns 1, tagged read-only).
3. Re-run the six invariant checks above.
4. Only then move to the next consumer.
