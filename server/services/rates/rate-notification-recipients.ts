/**
 * rate-notification-recipients.ts - who receives a rate notification.
 *
 * ONE resolver, so the audience for a pricing document is decided in one place and can be
 * asserted. There is no new recipient model here: this is the audience
 * `rate-notification-email.ts` already documents in its own comment -
 *
 *     "Commercial + rates contacts receive rate notifications.
 *      Technical contacts are excluded - they handle credentials, not pricing."
 *
 * WHAT THE EXISTING QUERY ACTUALLY DOES, WHICH IS NOT THAT. Its predicate is
 * `IN ('commercial', 'rates', 'technical', 'support', 'noc')`, so it includes the three audiences
 * its comment excludes. A rate sheet is a commercial document naming a customer's prices; sending
 * it to a NOC or support inbox distributes pricing to people who were given an address for
 * incident handling. This module implements the stated rule rather than the drifted one.
 *
 * The Account Details email deliberately uses the OPPOSITE audience - technical, support, noc,
 * commercial - because it carries credentials, not prices. The two must not converge just because
 * they share a visual template.
 */
import { sql } from 'drizzle-orm';

export interface RecipientQueryable {
  execute(query: any): Promise<any>;
}

const rows = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/**
 * The only contact types that may receive a pricing document.
 *
 * Finance, billing and invoicing are excluded as they always have been: an invoice contact was
 * given an address for invoices. Technical, support and noc are excluded because they handle
 * connectivity, not commercial terms.
 */
export const RATE_NOTIFICATION_CONTACT_TYPES = ['commercial', 'rates'] as const;

export interface RateRecipients {
  companyName: string;
  accountPrefix: string;
  emails: string[];
  /** Present when the company has no commercial or rates contact with an address. */
  reason?: string;
}

/**
 * Resolve recipients for one company.
 *
 * An empty list is returned with a REASON rather than as a silent zero. "This customer has no
 * commercial contact" is a configuration gap somebody must fix, and it is invisible if the caller
 * only sees an empty array.
 */
export async function resolveRateNotificationRecipients(
  db: RecipientQueryable,
  companyId: number,
): Promise<RateRecipients | { error: string }> {
  const [company] = rows(await db.execute(sql`
    SELECT c.name, c.account_prefix,
           COALESCE(
             (SELECT array_agg(DISTINCT ct.email) FROM company_contacts ct
               WHERE ct.company_id = c.id
                 AND ct.email IS NOT NULL AND ct.email <> ''
                 AND LOWER(ct.contact_type) IN ('commercial', 'rates')
             ), '{}') AS contact_emails
      FROM companies c WHERE c.id = ${companyId}`));

  if (!company) return { error: `Company ${companyId} not found.` };

  const raw = Array.isArray(company.contact_emails)
    ? company.contact_emails
    : String(company.contact_emails ?? '').replace(/^\{|\}$/g, '').split(',');

  const emails = Array.from(new Set(
    raw
      .map((e: any) => String(e ?? '').trim().toLowerCase())
      // A bare sanity check: an entry with no @ is a note somebody left in the field, and every
      // send to it would fail forever.
      .filter((e: string) => e.length > 0 && e.includes('@')),
  )) as string[];

  return {
    companyName: String(company.name),
    accountPrefix: String(company.account_prefix ?? ''),
    emails,
    reason: emails.length === 0
      ? `${company.name} has no commercial or rates contact with an email address. Rate notifications are not sent to technical, support, NOC, finance or invoicing contacts, so there is no eligible recipient - add a commercial or rates contact.`
      : undefined,
  };
}

/**
 * Resolve by company NAME, which is what a push operation records.
 *
 * The push knows the Sippy account name rather than a company id, and resolving through the name
 * keeps the obligation and the recipient lookup describing the same customer.
 */
export async function resolveRateRecipientsByName(
  db: RecipientQueryable,
  companyName: string,
): Promise<RateRecipients | { error: string }> {
  const [row] = rows(await db.execute(sql`
    SELECT id FROM companies WHERE LOWER(name) = LOWER(${companyName}) LIMIT 1`));
  if (!row) return { error: `No company named "${companyName}".` };
  return resolveRateNotificationRecipients(db, Number(row.id));
}
