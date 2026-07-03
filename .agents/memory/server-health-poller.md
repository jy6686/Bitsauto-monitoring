---
name: Server Health Poller
description: SSH-based server health monitoring for Asterisk/FreePBX server — architecture decisions and gotchas.
---

## Architecture

- Poller: `server/services/asterisk/server-health-poller.ts` — SSH into 159.223.32.59 every 60s via `ssh2` Client (same pattern as routes-call-governance.ts)
- Routes: `server/routes-server-health.ts` — registered via `registerServerHealthRoutes(app)` in routes.ts
- DB table: `asterisk_server_snapshots` — created via direct SQL (not db:push); 30-day retention via DELETE on each insert
- Poller started: `server/index.ts` via dynamic `await import('./services/asterisk/server-health-poller')` after routing cache sync
- Frontend: `client/src/pages/server-health.tsx` — route at `/server-health` (admin/management only)
- NOC strip: `ServerHealthStrip` component added to `noc-dashboard.tsx` — only shown when disk ≥80% or service down

## Key decisions

- Single SSH round-trip per poll: compound bash command collects all metrics, parsed line by line from `KEY:VALUE` output
- `require()` used for AMI connected check inside poller (avoids circular import at module init time)
- History API groups by hour via `date_trunc('hour', ...)` for trend charts — 48 data points max
- Cleanup is preview-first: GET `/api/server-health/cleanup-preview` (read-only SSH) before POST `/api/server-health/cleanup-execute`
- Fix Button: `server_health_poll` and `server_disk_cleanup` actions registered; labels in FIX_ACTION_LABELS

**Why:** MemoryStick icon does NOT exist in lucide-react 0.453.0 — use Gauge instead for memory cards.

## Gotchas

- `MemoryStick` is not in lucide-react 0.453.0 — causes silent Vite HMR failure; replaced with `Gauge`
- SSH timeout must be generous (12s connect + 30s exec) — server can be slow to respond
- `date-fns` IS available in this project (confirmed)
- Trend chart `YAxis domain={[0, 100]}` is fixed; log_folder_mb chart may exceed this — consider removing domain for that chart if values are large
