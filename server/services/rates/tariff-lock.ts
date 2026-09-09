/**
 * tariff-lock.ts
 *
 * Makes "one tariff is written by one operation at a time" true ACROSS batches, not just within one.
 *
 * WHY THIS EXISTS. The planner puts every operation for a tariff into a single serial lane, which
 * is correct and provable — but the guarantee only covers operations inside one batch. On
 * 2026-09-09 two batches ran against tariff 65 at once: job 46 (submitted from the UI at 17:07:53,
 * prefixes 19370 and 19371) and job 47 (the authorised acceptance at 17:08:04, prefix 19370). They
 * overlapped for about 44 seconds, both writing 19370 on the same tariff. Neither applied anything,
 * so nothing was damaged, but the collision was real and nothing prevented it.
 *
 * That is the same shape as the self-lock cascade of jobs #37–#45: Sippy locks a tariff while it
 * processes an uploaded file, and a second writer arriving during that window either trips the lock
 * or writes on top of something it cannot see. An in-memory planner cannot know about a batch
 * running in another request, so the exclusion has to live where both can see it — the database.
 *
 * A Postgres SESSION-level advisory lock is used rather than a lease table with a TTL, for one
 * reason that matters here: this process restarts often, and a session lock is released by Postgres
 * when the connection drops. A lease would leave a dead holder blocking the tariff until its TTL
 * expired, and picking that TTL means guessing how long a push can legitimately take.
 *
 * WHAT THIS DOES NOT DO. It prevents two writers OVERLAPPING. It does not decide whether a tariff
 * whose state is unknown should accept a new write at all — an operation that ended `indeterminate`
 * leaves the tariff unresolved after the lock is released. That is a separate policy question, and
 * `tariffHasUnresolvedOperations()` below answers the fact without imposing the policy.
 */

/** Namespace for the two-int advisory lock key, so these cannot collide with another feature's. */
export const TARIFF_LOCK_NAMESPACE = 0x52544d47; // 'RTMG'

export type ReleaseLock = () => Promise<void>;

export interface TariffLockProvider {
  /**
   * Claim `iTariff` if it is free. Returns a release function, or null if another holder has it.
   * Must never block.
   */
  tryAcquire(iTariff: number): Promise<ReleaseLock | null>;
}

/** Minimal shape of a `pg` Pool, so this module does not import the driver. */
export interface PoolLike {
  connect(): Promise<{
    query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
    release(): void;
  }>;
}

/**
 * Advisory-lock provider backed by a dedicated pooled connection.
 *
 * The connection is held for as long as the lock is, because a session lock belongs to the session
 * that took it — releasing the client back to the pool first would make the unlock land on a
 * different connection and silently do nothing. Callers therefore hold this for ONE operation, not
 * for a whole batch: at the configured lane concurrency that is a handful of connections out of the
 * pool's 25, whereas holding one per batch for a 19,000-prefix run would starve it.
 */
export function createPostgresTariffLock(pool: PoolLike): TariffLockProvider {
  return {
    async tryAcquire(iTariff: number): Promise<ReleaseLock | null> {
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          'SELECT pg_try_advisory_lock($1, $2) AS acquired',
          [TARIFF_LOCK_NAMESPACE, iTariff],
        );
        if (rows[0]?.acquired !== true) {
          client.release();
          return null;
        }
      } catch (e) {
        client.release();
        throw e;
      }

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [TARIFF_LOCK_NAMESPACE, iTariff]);
        } finally {
          // Returned to the pool either way. If the unlock failed, dropping the connection is what
          // makes Postgres release the lock, so this must not be skipped.
          client.release();
        }
      };
    },
  };
}

/** In-memory provider for tests and single-process use. Same contract, no database. */
export function createInMemoryTariffLock(): TariffLockProvider {
  const held = new Set<number>();
  return {
    async tryAcquire(iTariff: number): Promise<ReleaseLock | null> {
      if (held.has(iTariff)) return null;
      held.add(iTariff);
      let released = false;
      return async () => { if (!released) { released = true; held.delete(iTariff); } };
    },
  };
}

export interface AcquireOptions {
  /** Give up after this long and let the caller report the tariff as busy. */
  timeoutMs?: number;
  /** How often to retry while waiting. */
  pollMs?: number;
  /** Injected for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 180_000;   // a push takes ~50s; three of them is a fair wait
export const DEFAULT_LOCK_POLL_MS    = 500;

/**
 * Wait for the tariff to become free, up to a timeout. Returns null if it never did — the caller
 * then reports the operation as not attempted, which is honest: nothing was sent.
 */
export async function acquireTariff(
  provider: TariffLockProvider,
  iTariff: number,
  opts: AcquireOptions = {},
): Promise<ReleaseLock | null> {
  const now     = opts.now ?? Date.now;
  const sleep   = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const timeout = opts.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const poll    = opts.pollMs ?? DEFAULT_LOCK_POLL_MS;
  const started = now();

  for (;;) {
    const release = await provider.tryAcquire(iTariff);
    if (release) return release;
    if (now() - started >= timeout) return null;
    await sleep(poll);
  }
}

/** Minimal query surface, matching the other modules in this folder. */
export interface LockQueryable {
  execute(query: any): Promise<any>;
}

/**
 * Whether this tariff holds an operation whose outcome was never established AND that nobody has
 * since settled. An operation an operator has read Sippy for and resolved no longer counts.
 *
 * Reported, not enforced. Writing to a tariff in this state is not a concurrency problem — the
 * advisory lock is free — it is an unknown-state problem, and whether to refuse is a policy the
 * caller owns. Job #43 is why the fact is worth surfacing at all: the tariff had been rewritten
 * while the job reported that nothing had been applied.
 */
export async function tariffHasUnresolvedOperations(
  db: LockQueryable,
  iTariff: number,
  sql: any,
): Promise<{ unresolved: boolean; operationKeys: string[] }> {
  const res = await db.execute(sql`
    SELECT job_id, operation_key
      FROM rate_push_operations
     WHERE i_tariff = ${iTariff}
       AND status = 'indeterminate'
       AND resolution IS NULL
     ORDER BY id`);
  const rows = Array.isArray(res) ? res : (res?.rows ?? []);
  return {
    unresolved: rows.length > 0,
    operationKeys: rows.map((r: any) => `${r.job_id}/${r.operation_key}`),
  };
}
