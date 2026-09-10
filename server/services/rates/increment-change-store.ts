/**
 * increment-change-store.ts — accepting a billing-increment change, and owing clients an email.
 *
 * THE ORDER IS THE SAFETY PROPERTY.
 *
 *   validate  -> nothing exists yet, so a change that cannot be delivered never becomes a promise
 *   ONE TRANSACTION:
 *     persist the change
 *     persist one notification row per recipient
 *   commit    -> the promise and the obligation to announce it become true together
 *   worker    -> delivers, later, and separately
 *
 * Nothing is sent from here. Sending inside the transaction that writes the record produces the
 * worst state available: the client receives "30/6 effective 20 September", the transaction then
 * rolls back, and the platform has no memory of the commitment the customer now holds. An email
 * cannot be rolled back, so it must not be inside anything that can roll back.
 *
 * The mirror failure is guarded by the same shape. A delivery that fails cannot take the change
 * with it — the change is already committed. The failure lives on the notification row as an
 * observable status with an attempt count and the last error, so "we owe this client an email"
 * stays a durable fact with a retry path instead of an exception in a log.
 */
import { sql } from 'drizzle-orm';
import { validateIncrementChange, describeChangeForNotification } from './increment-change';

export interface ChangeStoreDb {
  execute(query: any): Promise<any>;
  transaction?<T>(fn: (tx: ChangeStoreDb) => Promise<T>): Promise<T>;
}

const rows = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

export type RecipientSource = 'rate_notification_template' | 'company_invoice_email';

export interface Recipient {
  clientName: string;
  email: string;
  source: RecipientSource;
}

/**
 * Who gets told, and from which setting.
 *
 * TWO SOURCES, IN A DELIBERATE ORDER. `rate_notification_templates.recipients` is the address
 * somebody configured FOR RATE NOTIFICATIONS, so it wins. `companies.invoice_email` is the
 * fallback: it is an address for this customer, but it was configured for invoices, and using it
 * silently in preference would send commercial rate announcements to an accounts-payable inbox.
 *
 * A client with NEITHER is skipped, not failed. "This customer has no rate contact" is a
 * configuration gap to report, not a reason to abandon a change every other client should hear
 * about.
 *
 * De-duplicated by address: one person configured on two templates is one human being, and
 * telling them twice about one change is a defect, not thoroughness.
 */
export async function resolveRecipients(db: ChangeStoreDb, productId: number): Promise<{
  recipients: Recipient[];
  skipped: string[];
}> {
  const fromTemplates = rows(await db.execute(sql`
    SELECT client_name, recipients, cc_emails
      FROM rate_notification_templates
     WHERE product_id = ${productId} AND status = 'active'`));

  const seen = new Set<string>();
  const out: Recipient[] = [];
  const clientsWithAddress = new Set<string>();

  const add = (clientName: string, raw: string | null, source: RecipientSource) => {
    for (const part of String(raw ?? '').split(',')) {
      const email = part.trim().toLowerCase();
      // A bare sanity check, not validation theatre: an entry with no @ is a note somebody left
      // in the field, and sending to it would fail for every change forever.
      if (!email || !email.includes('@')) continue;
      clientsWithAddress.add(clientName);
      if (seen.has(email)) continue;
      seen.add(email);
      out.push({ clientName, email, source });
    }
  };

  for (const t of fromTemplates) {
    add(String(t.client_name), t.recipients, 'rate_notification_template');
    add(String(t.client_name), t.cc_emails,  'rate_notification_template');
  }

  // Every active company, so a customer with no rate-notification template still hears about a
  // change to what they are charged.
  const companies = rows(await db.execute(sql`
    SELECT name, invoice_email FROM companies WHERE status = 'active'`));

  const skipped: string[] = [];
  for (const c of companies) {
    const name = String(c.name);
    if (clientsWithAddress.has(name)) continue;
    const before = out.length;
    add(name, c.invoice_email, 'company_invoice_email');
    if (out.length === before && !clientsWithAddress.has(name)) skipped.push(name);
  }

  return { recipients: out, skipped };
}

export type AcceptOutcome =
  | { ok: true; changeId: number; notified: number; skippedClients: string[]; message: string }
  | { ok: false; code: string; message: string };

/**
 * Validate, then commit the change and every notification it owes, together.
 *
 * `today` and `actor` are injected rather than read here: a commercial record must say who made
 * the claim, and the date rule must not depend on the clock of whichever machine ran it.
 */
export async function acceptIncrementChange(
  db: ChangeStoreDb,
  input: {
    productId: number;
    destinationId: number;
    catalogueVersionId: number;
    destinationName: string;
    currentIncrement: string | null;
    newIncrement: string;
    effectiveDate: string;
    today: string;
    actor: string;
    notes?: string | null;
  },
): Promise<AcceptOutcome> {
  if (!input.actor || !String(input.actor).trim()) {
    return { ok: false, code: 'not_attributable', message: 'A billing increment change must say who made it.' };
  }

  const validation = validateIncrementChange({
    currentIncrement: input.currentIncrement,
    newIncrement: input.newIncrement,
    effectiveDate: input.effectiveDate,
    today: input.today,
  });
  // Refused before anything exists: no record, and therefore no email owed to anyone.
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const message = describeChangeForNotification({
    destinationName: input.destinationName,
    previousIncrement: input.currentIncrement,
    newIncrement: validation.normalised,
    effectiveDate: input.effectiveDate,
  });

  const run = async (tx: ChangeStoreDb): Promise<AcceptOutcome> => {
    const [change] = rows(await tx.execute(sql`
      INSERT INTO billing_increment_changes
        (product_id, destination_id, catalogue_version_id, previous_increment, new_increment,
         effective_date, status, created_by, notes)
      VALUES (${input.productId}, ${input.destinationId}, ${input.catalogueVersionId},
              ${input.currentIncrement}, ${validation.normalised}, ${input.effectiveDate},
              'accepted', ${input.actor}, ${input.notes ?? null})
      RETURNING id`));
    const changeId = Number(change.id);

    const { recipients, skipped } = await resolveRecipients(tx, input.productId);

    // Committed with the change, never sent from here.
    for (const r of recipients) {
      await tx.execute(sql`
        INSERT INTO billing_increment_notifications
          (change_id, client_name, recipient_email, recipient_source, status, message)
        VALUES (${changeId}, ${r.clientName}, ${r.email}, ${r.source}, 'pending', ${message})
        ON CONFLICT (change_id, recipient_email) DO NOTHING`);
    }

    return { ok: true, changeId, notified: recipients.length, skippedClients: skipped, message };
  };

  try {
    return db.transaction ? await db.transaction(run) : await run(db);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // The unique index doing its job: one live change per destination per date, or "what is in
    // force" is ambiguous and clients get two emails about one date.
    if (/bic_one_per_date_ux/.test(msg)) {
      return {
        ok: false, code: 'duplicate_change',
        message: `A billing increment change for this destination on ${input.effectiveDate} already exists. `
               + `Cancel it before recording a different one.`,
      };
    }
    if (/bic_actually_changes/.test(msg)) {
      return { ok: false, code: 'no_change', message: 'That is the increment already in force.' };
    }
    return { ok: false, code: 'write_failed', message: msg };
  }
}

/** What the delivery worker should attempt: owed, and not yet delivered. */
export async function pendingNotifications(db: ChangeStoreDb, limit = 200): Promise<Array<{
  id: number; changeId: number; clientName: string; email: string; message: string; attempts: number;
}>> {
  return rows(await db.execute(sql`
    SELECT n.id, n.change_id, n.client_name, n.recipient_email, n.message, n.attempts
      FROM billing_increment_notifications n
     WHERE n.status IN ('pending', 'failed')
     ORDER BY n.created_at
     LIMIT ${limit}`)).map((r: any) => ({
    id: Number(r.id), changeId: Number(r.change_id), clientName: String(r.client_name),
    email: String(r.recipient_email), message: String(r.message), attempts: Number(r.attempts),
  }));
}

/** Record a delivery outcome. The change is untouched either way — it is already committed. */
export async function recordDelivery(
  db: ChangeStoreDb,
  notificationId: number,
  outcome: { sent: true } | { sent: false; error: string },
): Promise<void> {
  if (outcome.sent) {
    await db.execute(sql`
      UPDATE billing_increment_notifications
         SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW(),
             attempts = attempts + 1, last_error = NULL
       WHERE id = ${notificationId}`);
    return;
  }
  // Stays owed. A failed delivery is a durable, retryable fact, not a lost one.
  await db.execute(sql`
    UPDATE billing_increment_notifications
       SET status = 'failed', last_attempt_at = NOW(),
           attempts = attempts + 1, last_error = ${outcome.error}
     WHERE id = ${notificationId}`);
}

/**
 * Mark a change as announced, once every notification it owes has been delivered.
 *
 * Deliberately NOT called per delivery: a change is not "notified" while some clients still have
 * not been told, and reporting it as such would hide an outstanding obligation.
 */
export async function markNotifiedWhenComplete(db: ChangeStoreDb, changeId: number): Promise<boolean> {
  const [row] = rows(await db.execute(sql`
    SELECT count(*) FILTER (WHERE status <> 'sent' AND status <> 'suppressed')::int AS outstanding,
           count(*)::int AS total
      FROM billing_increment_notifications WHERE change_id = ${changeId}`));
  if (!row || Number(row.total) === 0 || Number(row.outstanding) > 0) return false;
  await db.execute(sql`
    UPDATE billing_increment_changes
       SET status = 'notified', notified_at = NOW(),
           notified_count = (SELECT count(*) FROM billing_increment_notifications
                              WHERE change_id = ${changeId} AND status = 'sent')
     WHERE id = ${changeId} AND status = 'accepted'`);
  return true;
}

/**
 * Persist the outcome of an application attempt.
 *
 * THE INVARIANT THIS ENFORCES: `applied_at` is earned only by authoritative read-back. A client
 * notification and a commercial commitment are not proof that the switch changed, so nothing
 * here sets `applied` except an `applied` verdict — which the apply path only produces after
 * every affected prefix read back with the intended increment.
 *
 * A REFUSAL DOES NOT CHANGE STATUS. Nothing was sent, so the change is exactly as due as it was
 * before; only the attempt is counted. Marking it failed would retire a commitment that is still
 * owed to a customer.
 */
export async function recordApplyOutcome(
  db: ChangeStoreDb,
  changeId: number,
  outcome:
    | { verdict: 'applied'; increment: string; prefixesVerified: number; appliedBy: string }
    | { verdict: 'needs_review'; message: string }
    | { verdict: 'refused'; code: string; message: string },
): Promise<void> {
  if (outcome.verdict === 'applied') {
    await db.execute(sql`
      UPDATE billing_increment_changes
         SET status = 'applied', applied_at = NOW(), applied_by = ${outcome.appliedBy},
             applied_increment = ${outcome.increment}, prefixes_verified = ${outcome.prefixesVerified},
             last_attempt_at = NOW(), attempts = attempts + 1, failure_reason = NULL
       WHERE id = ${changeId}`);
    return;
  }

  if (outcome.verdict === 'needs_review') {
    // Sent, unproven. Durable and visible, and deliberately NOT retried by the worker: a second
    // write of something that may already be there is how a rate gets applied twice.
    await db.execute(sql`
      UPDATE billing_increment_changes
         SET status = 'needs_review', failure_reason = ${outcome.message},
             last_attempt_at = NOW(), attempts = attempts + 1
       WHERE id = ${changeId}`);
    return;
  }

  // Refused: nothing was sent. The commitment stands and stays due; only the attempt is recorded.
  await db.execute(sql`
    UPDATE billing_increment_changes
       SET last_attempt_at = NOW(), attempts = attempts + 1,
           failure_reason = ${`${outcome.code}: ${outcome.message}`}
     WHERE id = ${changeId} AND status NOT IN ('applied', 'cancelled')`);
}

/**
 * Changes a person must look at: a mutation was sent and the result could not be established.
 * Separated from everything else because it is the only state that must never be retried
 * automatically.
 */
export async function changesNeedingReview(db: ChangeStoreDb): Promise<Array<{
  id: number; destinationId: number; newIncrement: string; effectiveDate: string; reason: string;
}>> {
  return rows(await db.execute(sql`
    SELECT id, destination_id, new_increment, effective_date, failure_reason
      FROM billing_increment_changes
     WHERE status = 'needs_review'
     ORDER BY effective_date`)).map((r: any) => ({
    id: Number(r.id), destinationId: Number(r.destination_id),
    newIncrement: String(r.new_increment), effectiveDate: String(r.effective_date).slice(0, 10),
    reason: String(r.failure_reason ?? ''),
  }));
}
