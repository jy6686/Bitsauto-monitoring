/**
 * post-push-obligation.ts - recording that a client is owed a rate-change notice.
 *
 * Creation only. Nothing here sends, and nothing here touches a switch.
 *
 * THE RECOVERY STORY IS THE DESIGN.
 *
 * A push can certify its operations and then die before writing its obligations. What survives is
 * the operation records, which are durable and were written before the first mutation. So
 * recovery does not need a journal or a retry queue: it re-derives the obligation from those
 * records and inserts it, and the UNIQUE (job_id, client_name, product_code) index makes the
 * insert a no-op if it already exists.
 *
 * That gives "the completion ran twice" and "the completion died and was recovered" the SAME safe
 * answer, because neither depends on anything being remembered between attempts. Idempotence is a
 * property of the schema rather than of the code being careful.
 *
 * ONLY CERTIFIED SUCCESS BECOMES AN OBLIGATION. `partial`, `failed`, `indeterminate` and
 * `needs_review` justify no commercial success notice: a client must not be told a rate is live
 * on the strength of an outcome nobody established.
 */
import { sql } from 'drizzle-orm';
import {
  deriveNotificationsFromPush, type AppliedOperation, type DerivationReport,
} from './post-push-notification';

export interface ObligationDb {
  execute(query: any): Promise<any>;
}

const rows = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

export interface CreateResult {
  created: number;
  /** Already present, so not created again. The recovery and double-processing answer. */
  alreadyPresent: number;
  /** Operations that justified no notice, with the reason each was left out. */
  excluded: DerivationReport['excluded'];
}

/**
 * Rate types whose pushes never owe a customer notification.
 *
 * `change-client-rate` is the Rate Analysis path. It mutates Sippy, and since it now records operation
 * rows it would otherwise be indistinguishable from a Send Rate push — a certified operation with
 * no notification row is exactly what a completion that died before recording looks like. It is
 * not that: the route carries no product, performs no eligibility check and resolves no change
 * policy, so there is nothing for an announcement to be derived FROM.
 *
 * Enforced at `createObligationsForPush`, which is the ONLY writer of rate_push_notifications and
 * therefore the only place an operation can become an obligation. Guarding the recovery query
 * alone would not be enough: push-batch calls the creator directly, so a future shared completion
 * path — or the obvious copy-paste of push-batch's completion block into the change route — would
 * walk straight past a recovery-only check. The boundary has to sit where the row is written.
 *
 * Adding a rate type here is how a route declares "my pushes are not announceable". Removing one
 * is a decision to START announcing them, and belongs with the eligibility and product work, not
 * with whoever happens to wire recovery.
 */
export const NON_NOTIFYING_RATE_TYPES = ['change-client-rate'] as const;

/**
 * The exclusion as a SQL PREDICATE — present only when there is something to exclude.
 *
 * An empty list omits the clause rather than rendering `NOT IN ()`, which is a syntax error: it
 * would take down the entire recovery sweep, not merely stop excluding. That case is not
 * hypothetical. Emptying NON_NOTIFYING_RATE_TYPES is exactly how this route is documented to
 * START announcing, so the next decision anyone makes here must not arrive as a broken query.
 *
 * An empty list means "every rate type is notification-eligible", and this renders precisely
 * that. Exported and parameterised so the test can exercise the empty case against a real
 * database — a test asserting on a re-written copy of this SQL would prove only that the copy
 * behaves as the copy says.
 */
export function rateTypeExclusion(types: readonly string[]) {
  if (types.length === 0) return sql``;
  // COALESCE, because a NULL rate_type is an ordinary push from before the column had a value —
  // absence of a declaration is not a declaration of non-eligibility.
  return sql`AND COALESCE(j.rate_type, '') NOT IN (${sql.join(types.map(t => sql`${t}`), sql`, `)})`;
}

/**
 * What kind of push a job declared itself to be.
 *
 * Returns the declared type, '' for a row that exists and declared none, or NULL when the job
 * could not be established at all — no row, or a read that failed. Those last two are NOT the
 * same as '' and must not collapse into it: an existing row with a NULL rate_type is an ordinary
 * push from before the column carried a value, while an absent row is a question nobody answered.
 */
async function rateTypeOf(db: ObligationDb, jobId: string): Promise<string | null> {
  try {
    const [row] = rows(await db.execute(sql`
      SELECT COALESCE(rate_type, '') AS rate_type FROM rate_push_jobs WHERE job_id = ${jobId}`));
    // No row: the job this obligation would belong to cannot be shown to exist.
    if (row === undefined || row === null) return null;
    return String(row.rate_type ?? '');
  } catch (e: any) {
    // A failed read establishes nothing. Swallowed here and reported as "unknown" so the caller
    // makes ONE decision about unknown states, rather than this throwing past the guard and
    // leaving the fail-closed property resting on where the exception happens to land.
    console.error(`[post-push-obligation] rate_type lookup failed for ${jobId}:`, e?.message || e);
    return null;
  }
}

/**
 * Record what a certified push owes.
 *
 * `createdVia` distinguishes the completing push from a later recovery. Worth keeping: a rising
 * recovery count means completions are dying before they record, which is a real operational
 * signal rather than noise.
 */
export async function createObligationsForPush(
  db: ObligationDb,
  input: {
    jobId: string;
    operations: AppliedOperation[];
    productLabelFor?: (code: string) => string;
    dialFormatFor?: (productCode: string, trunkPrefix: string) => string;
    createdVia?: 'push' | 'recovery';
  },
): Promise<CreateResult> {
  // The notification boundary, enforced before anything is derived. Whoever called — a push
  // completing, recovery sweeping, or a path that does not exist yet — a job whose route declared
  // itself non-notifying produces no obligation. Refusing here rather than at the caller is the
  // point: there is one writer of rate_push_notifications, so there is one place to hold the line.
  const rateType = await rateTypeOf(db, input.jobId);

  // FAILS CLOSED. Two different refusals, one rule: an obligation is created only when the job
  // is shown to be notification-eligible, never merely when nothing proved it ineligible.
  //
  //   null  — no job row, or the read failed. Nothing was established, so nothing is announced.
  //   listed — the route declared itself non-notifying.
  //
  // The direction matters because this is a customer-facing boundary: the cost of refusing an
  // announcement that was owed is a recovery sweep finding it later; the cost of sending one that
  // was not owed is a wrong price in a customer's inbox, and that is not recoverable.
  const eligibilityUnknown = rateType === null;
  if (eligibilityUnknown || (NON_NOTIFYING_RATE_TYPES as readonly string[]).includes(rateType)) {
    return {
      created: 0,
      alreadyPresent: 0,
      // Reported as excluded operations, not as silence: the caller logs this count, so a
      // refusal is visible in the same line that would have reported an announcement.
      excluded: input.operations.map(o => ({
        fullPrefix:  o.fullPrefix,
        accountName: o.accountName,
        status:      o.status,
        reason:      eligibilityUnknown
          ? `Job ${input.jobId} could not be established as notification-eligible (no job row, or `
          + `the rate_type read failed); refusing to announce on an unverified job.`
          : `Rate type '${rateType}' is not notification-eligible — the route carries no `
          + `product, eligibility check or change policy, so nothing can be announced.`,
      })),
    };
  }

  const derivation = deriveNotificationsFromPush(input.operations, {
    productLabelFor: input.productLabelFor,
  });

  let created = 0;
  let alreadyPresent = 0;

  for (const n of derivation.notifications) {
    const trunk = n.rows[0]?.productDigit ?? '';
    const dialFormat = input.dialFormatFor?.(n.productCode, trunk)
      ?? `${trunk}[Country Code][Number]`;

    // ON CONFLICT DO NOTHING is the whole idempotence guarantee. It is not an optimisation.
    const res = await db.execute(sql`
      INSERT INTO rate_push_notifications
        (job_id, client_name, product_code, product_label, notification_type,
         rows_json, row_count, dial_format, created_via)
      VALUES (${input.jobId}, ${n.accountName}, ${n.productCode}, ${n.productLabel}, 'CHANGES',
              ${JSON.stringify(n.rows)}::jsonb, ${n.rows.length}, ${dialFormat},
              ${input.createdVia ?? 'push'})
      ON CONFLICT (job_id, client_name, product_code) DO NOTHING
      RETURNING id`);

    if (rows(res).length > 0) created++; else alreadyPresent++;
  }

  return { created, alreadyPresent, excluded: derivation.excluded };
}

/**
 * Pushes that certified operations and have no obligation recorded.
 *
 * This is what a completion dying mid-way looks like from the outside, and it is discoverable
 * because the operation records were written before the first mutation. No journal is needed —
 * the evidence of what was owed is the same evidence that proves what happened.
 *
 * Excludes NON_NOTIFYING_RATE_TYPES: a route that owes nothing cannot be missing what it owes.
 */
export async function findPushesMissingObligations(
  db: ObligationDb,
  /**
   * `excluding` defaults to the production list. It is a parameter rather than a closed-over
   * constant so the empty case — the state the list's contract invites — can be exercised against
   * THIS statement, not a copy of it re-typed in a test.
   */
  opts: { limit?: number; excluding?: readonly string[] } = {},
): Promise<string[]> {
  return rows(await db.execute(sql`
    SELECT DISTINCT o.job_id
      FROM rate_push_operations o
      -- The job says what kind of push it was. An operation cannot: it records a prefix and an
      -- outcome, and a rate change looks identical whoever asked for it.
      --
      -- An INNER join, deliberately: an operation whose job row cannot be established is not
      -- swept. The creator would refuse to announce on such a job anyway, so sweeping it would
      -- only produce a refusal on every pass.
      JOIN rate_push_jobs j ON j.job_id = o.job_id
     WHERE o.status = 'succeeded'
       ${rateTypeExclusion(opts.excluding ?? NON_NOTIFYING_RATE_TYPES)}
       AND NOT EXISTS (
             SELECT 1 FROM rate_push_notifications n WHERE n.job_id = o.job_id)
     ORDER BY o.job_id
     LIMIT ${opts.limit ?? 50}`)).map((r: any) => String(r.job_id));
}

/** The certified operations of one push, in the shape the derivation needs. */
export async function loadOperationsForPush(
  db: ObligationDb,
  jobId: string,
): Promise<AppliedOperation[]> {
  return rows(await db.execute(sql`
    SELECT account_name, product_name, trunk_prefix, dial_prefix, full_prefix,
           destination_name, requested_rate, status, refused_before_write,
           -- The customer's effective date. Omitting it here is what made every notification
           -- quote its own send date: the obligation never saw the fact, so the renderer
           -- defaulted. It exists only on the operation, so it must be read here or lost.
           effective_from
      FROM rate_push_operations
     WHERE job_id = ${jobId}`)).map((r: any) => ({
    accountName: String(r.account_name),
    productName: r.product_name ?? null,
    trunkPrefix: r.trunk_prefix ?? null,
    dialPrefix: r.dial_prefix ?? null,
    fullPrefix: String(r.full_prefix),
    destinationName: r.destination_name ?? null,
    requestedRate: r.requested_rate === null || r.requested_rate === undefined
      ? null : Number(r.requested_rate),
    status: String(r.status),
    refusedBeforeWrite: r.refused_before_write === null || r.refused_before_write === undefined
      ? null : Boolean(r.refused_before_write),
    effectiveFrom: r.effective_from ?? null,
  }));
}

/**
 * Re-derive and record obligations for pushes that certified but recorded none.
 *
 * Safe to run repeatedly and safe to run alongside a completing push: every insert is idempotent,
 * so the worst case is that recovery discovers a job the completion is about to record and one of
 * them does nothing.
 */
export async function recoverMissingObligations(
  db: ObligationDb,
  opts: {
    limit?: number;
    productLabelFor?: (code: string) => string;
    dialFormatFor?: (productCode: string, trunkPrefix: string) => string;
  } = {},
): Promise<{ jobsRecovered: string[]; created: number; alreadyPresent: number }> {
  const jobs = await findPushesMissingObligations(db, { limit: opts.limit });
  const recovered: string[] = [];
  let created = 0, alreadyPresent = 0;

  for (const jobId of jobs) {
    const operations = await loadOperationsForPush(db, jobId);
    const r = await createObligationsForPush(db, {
      jobId, operations,
      productLabelFor: opts.productLabelFor,
      dialFormatFor: opts.dialFormatFor,
      createdVia: 'recovery',
    });
    created += r.created;
    alreadyPresent += r.alreadyPresent;
    if (r.created > 0) recovered.push(jobId);
  }

  return { jobsRecovered: recovered, created, alreadyPresent };
}

/** Obligations still owed, for the delivery worker. Delivery itself lives elsewhere. */
export async function pendingRateNotifications(
  db: ObligationDb,
  limit = 100,
  /**
   * Skip obligations that have already been attempted this many times. Without it, one
   * permanently failing obligation sits at the front of `ORDER BY created_at` forever and
   * starves everything behind it on every run. Optional and unbounded by default, so existing
   * callers see no change; the automatic drain passes 5. An exhausted obligation stays
   * `failed` with its `last_error` — surfaced, not lost.
   */
  maxAttempts?: number,
  /**
   * Only this push's obligations. Without it the list is the whole backlog, oldest first — which
   * is what a push-triggered drain must NEVER see: on 2026-09-22 a First Class push for one
   * account delivered another account's four-day-old Business Class notice, because the drain
   * that ran after the push had no idea which push it was running for. A push is scoped to
   * itself; only the boot drain is allowed the backlog, and it says so in its log.
   */
  jobId?: string,
): Promise<Array<{
  id: number; jobId: string; clientName: string; productLabel: string;
  notificationType: string; rows: any[]; dialFormat: string | null; attempts: number;
  /** When the obligation was frozen — so a backlog send can be seen for what it is. */
  createdAt: string | null;
}>> {
  return rows(await db.execute(sql`
    SELECT id, job_id, client_name, product_label, notification_type, rows_json, dial_format, attempts, created_at
      FROM rate_push_notifications
     WHERE status IN ('pending', 'failed')
       ${maxAttempts != null ? sql`AND attempts < ${maxAttempts}` : sql``}
       ${jobId != null ? sql`AND job_id = ${jobId}` : sql``}
     ORDER BY created_at
     LIMIT ${limit}`)).map((r: any) => ({
    id: Number(r.id), jobId: String(r.job_id), clientName: String(r.client_name),
    productLabel: String(r.product_label), notificationType: String(r.notification_type),
    rows: typeof r.rows_json === 'string' ? JSON.parse(r.rows_json) : r.rows_json,
    dialFormat: r.dial_format ?? null, attempts: Number(r.attempts),
    createdAt: r.created_at == null ? null
      : (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
  }));
}
