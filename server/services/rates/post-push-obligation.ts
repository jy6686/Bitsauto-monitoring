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
 */
export async function findPushesMissingObligations(
  db: ObligationDb,
  opts: { limit?: number } = {},
): Promise<string[]> {
  return rows(await db.execute(sql`
    SELECT DISTINCT o.job_id
      FROM rate_push_operations o
     WHERE o.status = 'succeeded'
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
           destination_name, requested_rate, status, refused_before_write
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
): Promise<Array<{
  id: number; jobId: string; clientName: string; productLabel: string;
  notificationType: string; rows: any[]; dialFormat: string | null; attempts: number;
}>> {
  return rows(await db.execute(sql`
    SELECT id, job_id, client_name, product_label, notification_type, rows_json, dial_format, attempts
      FROM rate_push_notifications
     WHERE status IN ('pending', 'failed')
     ORDER BY created_at
     LIMIT ${limit}`)).map((r: any) => ({
    id: Number(r.id), jobId: String(r.job_id), clientName: String(r.client_name),
    productLabel: String(r.product_label), notificationType: String(r.notification_type),
    rows: typeof r.rows_json === 'string' ? JSON.parse(r.rows_json) : r.rows_json,
    dialFormat: r.dial_format ?? null, attempts: Number(r.attempts),
  }));
}
