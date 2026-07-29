# Deployment runbook — v1

Applies to every deployment that can change the database schema, which is every deployment: `runFileMigrations()` runs at each startup. See [MIGRATIONS.md](MIGRATIONS.md) for how the runner itself works.

**Status: v1, frozen.** Change this document only when the deployment sequence changes, not when a particular deployment goes badly.

---

## Sequence

Steps 1–6 happen automatically. Step 7 is the operator's.

| # | Step | Where to observe it |
|---|---|---|
| 1 | Application starts | `[start-prod]` in the deploy logs |
| 2 | `runSafeMigrations()` — **legacy bootstrap only** | `[db] Safe migrations applied.` |
| 3 | `runFileMigrations()` begins | `boot 6a runFileMigrations() starting` |
| 4 | Baseline validation | `[migrate] BASELINE INVALID` / `[migrate] baseline warning` — silence means every check passed |
| 5 | Pending migrations execute | `[migrate] applied NNN_*.sql (Nms)` |
| 6 | Migration status published | `GET /healthz` → `migrations` |
| 7 | **Operator checks `/schema-migrations` if anything is not `ok`** | admin / super_admin only |

Step 2 will disappear at Phase 3 (task #15). Until then it runs first, and `runFileMigrations()` is deliberately called outside it — see [MIGRATIONS.md](MIGRATIONS.md#retiring-runsafemigrations).

## Success criteria

The deployment is healthy **only if all five hold**:

- [ ] Baseline validation passes, or has **non-fatal warnings only**
- [ ] Pending migrations = **0**
- [ ] Failed migrations = **0**
- [ ] Modified migrations = **0**
- [ ] `/healthz` → `migrations: "ok"`

If any fail, **the deployment is incomplete until investigated** — not "mostly fine". The application will still be serving traffic; that is deliberate (a schema problem should not pull a live platform out of service) and it is exactly why this check is a required step rather than an automatic gate.

Every one of the five is visible in the summary header on `/schema-migrations`.

### If a criterion fails

| Symptom | Meaning | Action |
|---|---|---|
| Baseline **fatal** | This database has not been through migrations ≤ `BASELINE_THROUGH`. Nothing was applied or recorded. | Do not lower the baseline to make it pass. Establish what the database actually has, then decide. |
| Baseline **warn** | Tables exist, seed data does not. | Non-blocking. Apply the named migration; the dependent one retries on next boot. |
| Pending > 0 | Files exist that the runner did not apply — usually it halted earlier. | Read the failure above it. |
| Failed = 1 | A migration errored. Its own `BEGIN`/`COMMIT` rolled it back; everything after it was skipped. | Fix the file, redeploy. The runner resumes from that file. |
| Modified > 0 | Someone changed an already-applied migration. | Compare both checksums against git. A legitimate edit belongs in a **new** migration; never edit an applied one. |

## Evidence to archive — first deployment with the new runner

Capture all four and keep them. They are the known-good reference a future deployment gets compared against.

**1. `/schema-migrations` screenshot** — full page, including the summary header and the Baseline validation panel.

**2. `/healthz`** — unauthenticated, so plain:

```bash
curl -s https://<deployment-host>/healthz
```

**3. Startup logs** — everything from `[start-prod]` through `boot 6b runFileMigrations() done`, including all `[migrate]` lines.

**4. The `schema_migrations` table.** The admin endpoint needs a session, so run this in the browser console while signed in as admin — it downloads the full ledger as JSON:

```js
const d = await (await fetch('/api/admin/migrations', { credentials: 'include' })).json();
const a = Object.assign(document.createElement('a'), {
  href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })),
  download: `migration-ledger-${new Date().toISOString().slice(0, 10)}.json`,
});
a.click();
```

Store the four together, labelled with the commit SHA and the date.

---

## After a clean deployment

The migration framework is feature-complete and frozen. The next work is provisioning certification, in this order — the foundation is proven before it is extended.

**A. Confirm the deployment database**

1. `/schema-migrations`: all five success criteria green.
2. Migrations **038–048** present and `applied` (not `baselined`) in the ledger.

**B. First provisioning certification** — a **disposable** test customer, end to end:

- [ ] Company created
- [ ] Tariff created
- [ ] Service Plan created
- [ ] Account created
- [ ] Authentication / IP configured
- [ ] Capacity applied (where Sippy supports it — codec and media relay are `UNSUPPORTED (current API)`)
- [ ] **Read-back verification succeeds at every stage**
- [ ] Job completes with the expected status

Run the dry run first (`dryRun` defaults to `true`), then `{"dryRun": false}`. Both need an authenticated admin session:

```js
await fetch('/api/provisioning/companies/<ID>/jobs', {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ dryRun: true }),
}).then(r => r.json())
```

Then poll `GET /api/provisioning/jobs/<jobId>` for per-stage progress.

**C. Only then, extend the engine** — routing → products → rates → traffic enable → final verification.

Tag the certified commit as the provisioning baseline. Never tag un-exercised code.
