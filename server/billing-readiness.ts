/**
 * billing-readiness.ts — which customers would be silently skipped tonight?
 *
 * THE FAILURE THIS EXISTS TO PREVENT, in one sentence: on 2026-08-31 invoice
 * C-2608-0009 billed asterisk and nobody else, and finding out why took a day
 * of tracing. The customers that were missing produced no error, no warning
 * and no row — they were simply absent, and absence is invisible to every
 * check that walks what it HAS.
 *
 * That is still true today, one layer along. Collection was decoupled from
 * invoice_schedules, so all 25 accounts now collect — but INVOICING still
 * starts only from an invoice_schedules row, and production holds two of
 * those, keyed to tariffs 2 and 7. asterisk is tariff 32. internal-ptcl and
 * internal-eritrea are absent entirely. So the three accounts that carry the
 * revenue have nothing that would ever start an invoice for them, and nothing
 * anywhere says so.
 *
 * LIFECYCLE IS THE RATE MANAGER'S, NOT FINANCE'S. Corrected 2026-09-02 after
 * the owner pointed out that active / inactive / dormant already exist as
 * customer master data in `companies.status`. The first version of this file
 * DERIVED a "dormant" state from "no account and no traffic" — a second,
 * Finance-local definition of a customer's lifecycle, which is precisely the
 * duplication that lets two screens disagree about the same customer.
 *
 * The split is now clean, and it is the owner's:
 *   Rate Manager owns WHAT the customer is       — active / inactive / dormant
 *   Finance owns whether an ACTIVE one is billable TODAY — ready / blocked
 *
 * "Blocked" is therefore a runtime billing condition, never a persisted
 * status. A customer stays Active in the Rate Manager while Finance reports it
 * as blocked for a missing tariff, and fixing the tariff changes the billing
 * verdict without touching master data.
 *
 * DERIVED FROM THE COMPANY MASTER, NOT FROM A PARALLEL TABLE. Owner
 * requirement 2026-09-02, and it is the right call at 500 customers:
 * `companies.client_billing_cycle` already exists and is populated by the
 * wizard — the register records it as "UI-only", meaning nothing has ever
 * scheduled from it. A second table that must be kept in step with the
 * customer master is a table that WILL fall out of step, and every customer it
 * silently omits is unbilled revenue nobody is looking for.
 *
 * This module reports. It schedules nothing and writes nothing — the point is
 * to make the gap visible before the nightly run, not to fill it silently.
 *
 * Dependency-free; the period arithmetic is delegated to billing-periods.ts,
 * which already implements the Monday–Sunday week, the 1st-to-last-day month,
 * and the month-end split that outranks both.
 */
import { normalizeTerm, latestClosedPeriods, type BillingPeriod, type BillingTerm } from './billing-periods';

/** The company master fields billing depends on. */
export interface BillableCompany {
  id:            number;
  name:          string;
  /** Sippy account id — the canonical financial identity. */
  iAccount:      number | null;
  /** Local mirror of the tariff. Needed to RATE, not to collect. */
  iTariff:       string | null;
  /** companies.client_billing_cycle. */
  billingCycle:  string | null;
  /** Where an invoice would be sent. */
  invoiceEmail:  string | null;
  /** companies.status — the Rate Manager's master lifecycle. Read, never
   *  redefined. Anything that is not active is out of scope for billing. */
  lifecycle:     string | null;
  /** Whether the repository holds any traffic for this account in the window
   *  being judged. Used to RANK blocked customers by urgency, not to classify
   *  them — classification belongs to the lifecycle above. */
  hasTraffic:    boolean;
  /**
   * An ACTIVE invoice_schedules row exists for this company.
   *
   * The hole this closes: until 2026-09-02 this module checked whether a
   * customer COULD be invoiced and reported "ready", while `invoice_schedules`
   * is the only thing that ever STARTS an invoice. A customer with an account,
   * a cycle, a tariff and an email and no schedule row is ready in every
   * respect except the one that matters — and production holds exactly two
   * schedule rows for 49 companies. "Ready" has to mean "will be invoiced
   * when due", not "could be invoiced by hand".
   */
  hasSchedule:   boolean;
  /** The schedule's next run, when it has one. A schedule that exists but has
   *  never computed a next run will not fire — valid configuration, no effect. */
  scheduleNextRun: string | null;
}

export type ReadinessStatus =
  /** Active, fully configured, AND scheduled — will invoice when due. */
  | 'ready'
  /** Active but cannot be invoiced — the list that matters. */
  | 'blocked'
  /** Configured and scheduled, but the schedule has no next run computed, so
   *  nothing will fire. Valid configuration with no effect — distinct from
   *  blocked, because there is nothing missing to go and enter. */
  | 'warning'
  /** Not active in the Rate Manager. Finance expresses no opinion; the
   *  customer's lifecycle is master data and this module only reports it. */
  | 'not_billable';

export interface CompanyReadiness {
  id:       number;
  name:     string;
  status:   ReadinessStatus;
  /** companies.status verbatim — the Rate Manager's word, not a translation. */
  lifecycle: string | null;
  term:     BillingTerm | null;
  /** Periods that have CLOSED and would be invoiced tonight. */
  duePeriods: BillingPeriod[];
  /** Every missing prerequisite, not just the first. An operator fixing one
   *  field at a time across 500 customers needs the whole list per customer. */
  blockers: string[];
  hasTraffic: boolean;
  hasSchedule: boolean;
  scheduleNextRun: string | null;
}

export interface ReadinessReport {
  asOf: string;
  companies: CompanyReadiness[];
  /** Blocked AND carrying traffic — unbilled revenue, worst case first. */
  urgent:  CompanyReadiness[];
  dueToday: CompanyReadiness[];
  summary: {
    total: number; ready: number; blocked: number; warning: number; notBillable: number;
    dueToday: number;
    /** Straight from companies.status, so Finance and Rate Manager report the
     *  same customer the same way. */
    byLifecycle: Record<string, number>;
    /** Blocked customers that have traffic. Zero is the only acceptable value. */
    blockedWithTraffic: number;
    byTerm: Record<string, number>;
  };
}

/**
 * @param asOf YYYY-MM-DD, the day the nightly run executes. Periods ending
 *             before it are closed and therefore due.
 */
export function assessBillingReadiness(opts: {
  companies: BillableCompany[];
  asOf:      string;
}): ReadinessReport {
  const companies: CompanyReadiness[] = opts.companies.map(c => {
    const blockers: string[] = [];

    // Order matters: the FIRST blocker is the one to fix first, and an
    // account id is prerequisite to everything else.
    if (c.iAccount == null) {
      blockers.push('No Sippy account linked — nothing can be collected or invoiced.');
    }
    if (!c.billingCycle || !String(c.billingCycle).trim()) {
      blockers.push('No billing cycle set — the nightly run cannot know when this customer is due.');
    }
    if (!c.iTariff || !String(c.iTariff).trim()) {
      blockers.push('No local tariff mirror — calls collect but cannot be rated, certified or invoiced.');
    }
    if (!c.invoiceEmail || !String(c.invoiceEmail).trim()) {
      blockers.push('No billing email — an invoice could be generated but never delivered.');
    }
    // THE ONE THAT MAKES "READY" HONEST. invoice_schedules is the only thing
    // that starts an invoice; without a row this customer is invisible to the
    // engine no matter how complete its master data is.
    if (!c.hasSchedule) {
      blockers.push('No active invoice schedule — nothing will ever trigger an invoice for this ' +
                    'customer, however complete its billing data is.');
    }

    // LIFECYCLE FIRST, and it is not this module's to decide. Only an ACTIVE
    // customer gets a billing verdict; anything else is reported as the Rate
    // Manager already classifies it. Deriving a Finance-local "dormant" here
    // was the duplication this version removes.
    const lifecycle = String(c.lifecycle ?? '').trim().toLowerCase();
    const isActive = lifecycle === 'active' || lifecycle === '';
    // A schedule that exists but has never computed a next run is not a
    // missing thing an operator can go and enter — it is a scheduler that has
    // not yet acted. Separated so the work list stays actionable.
    const noNextRun = c.hasSchedule && !c.scheduleNextRun;
    const status: ReadinessStatus =
      !isActive ? 'not_billable'
      : blockers.length > 0 ? 'blocked'
      : noNextRun ? 'warning'
      : 'ready';
    // A non-active customer's missing fields are not defects to fix — an
    // inactive customer legitimately has no tariff. Reporting them as blockers
    // would fill the work list with work nobody should do.
    if (!isActive) blockers.length = 0;

    const term = c.billingCycle ? normalizeTerm(c.billingCycle) : null;
    // Only a customer that could actually be invoiced has due periods. Listing
    // periods for a blocked customer would imply work that cannot happen.
    const duePeriods = status === 'ready' && term ? latestClosedPeriods(term, opts.asOf) : [];

    return { id: c.id, name: c.name, status, lifecycle: c.lifecycle ?? null,
             term, duePeriods, blockers, hasTraffic: c.hasTraffic,
             hasSchedule: c.hasSchedule, scheduleNextRun: c.scheduleNextRun ?? null };
  });

  const byTerm: Record<string, number> = {};
  const byLifecycle: Record<string, number> = {};
  for (const c of companies) {
    const k = c.term ?? 'unset';
    byTerm[k] = (byTerm[k] ?? 0) + 1;
    const l = (c.lifecycle ?? 'unset').trim().toLowerCase() || 'unset';
    byLifecycle[l] = (byLifecycle[l] ?? 0) + 1;
  }

  // Traffic first, then name — the ranking an operator works down.
  const urgent = companies
    .filter(c => c.status === 'blocked' && c.hasTraffic)
    .sort((a, b) => a.name.localeCompare(b.name));
  const dueToday = companies.filter(c => c.duePeriods.length > 0);

  return {
    asOf: opts.asOf,
    companies,
    urgent,
    dueToday,
    summary: {
      total: companies.length,
      ready:   companies.filter(c => c.status === 'ready').length,
      blocked: companies.filter(c => c.status === 'blocked').length,
      warning:     companies.filter(c => c.status === 'warning').length,
      notBillable: companies.filter(c => c.status === 'not_billable').length,
      dueToday: dueToday.length,
      blockedWithTraffic: urgent.length,
      byTerm, byLifecycle,
    },
  };
}
