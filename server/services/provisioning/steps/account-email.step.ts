/**
 * account-email.step.ts — send the account details to the customer, and SAY SO.
 *
 * The email itself is not new. account-details-email.ts already reads the contacts the
 * Create Company wizard captured, filters them to technical / support / noc / commercial
 * with technical first, and refuses to send account credentials to finance, billing, rates
 * or invoicing. That design is settled and this step does not touch it.
 *
 * WHAT WAS MISSING WAS THE REPORTING. The send fired in a detached `.then()` after the run
 * resolved, so its outcome reached a console line and an audit row and nothing an operator
 * reads. The card listed six stages and none of them was the email. Whether a customer had
 * been handed their credentials — or whether delivery had failed, and to whom — was not
 * answerable from the run. That is the same shape as every other defect found this week: a
 * real outcome, recorded once somewhere nobody looks, presented as an absence.
 *
 * WHY A STEP AT ORDER 100 IS THE SAME GATE AS BEFORE. The old code sent only when the run
 * ended 'completed' or 'completed_with_warnings'. A last-ordered step gets that for free:
 * the runner halts on a blocking failure, so this never runs when the account is not live,
 * and a non-blocking failure earlier does not stop it — which is exactly the previous rule,
 * now expressed by the framework rather than by a status string.
 *
 * NON-BLOCKING, and it must stay so. A customer with a working account and an undelivered
 * email is recoverable in one click. Failing the run over it would mark a live, verified,
 * traffic-carrying account as failed.
 */
import { sendAccountDetailsEmail } from "../account-details-email";
import type { ProvisioningStep, StepContext, StepOutcome } from "../types";

export const accountEmailStep: ProvisioningStep = {
  key:   'account_email',
  label: 'Send Account Details',
  order: 100,
  blocking: false,

  async execute(ctx: StepContext): Promise<StepOutcome> {
    // Nothing to hand over if no account exists. Reaching here without one means a
    // blocking stage was made non-blocking; say that plainly rather than emailing
    // credentials for an account that is not there.
    const iAccount = (ctx.results.account as any)?.iAccount;
    if (!iAccount) {
      return {
        status: 'skipped',
        detail: ['No account was created, so there are no details to send.'],
        metrics: { requested: 0, skipped: 1 },
      };
    }

    const sent = await sendAccountDetailsEmail(ctx.companyId);

    if (!sent.ok) {
      // Reported as a failed stage, not a silent absence — but non-blocking, so the run
      // still completes with warnings. The error from the email service already explains
      // itself ("no support or commercial contact has an email address…"), so it is passed
      // through rather than restated.
      return {
        status: 'failed',
        reasonCode: 'ACCOUNT_EMAIL_NOT_SENT',
        error: sent.error ?? 'Account details could not be sent.',
        detail: [
          'The account is provisioned and will carry traffic — only the handover email failed.',
          sent.error ?? 'unknown error',
          'Fix the contact or SMTP and resend from the company card; nothing needs re-provisioning.',
        ],
        metrics: {
          requested: 1, created: 0, failed: 1,
          failures: [{ cause: 'account details email not sent', count: 1 }],
        },
      };
    }

    const to = sent.recipients ?? [];
    return {
      status: 'success',
      result: { recipients: to },
      detail: [
        `Account details sent to ${to.length} recipient(s): ${to.join(', ')}`,
        // Named because it is a deliberate exclusion an operator should be able to see
        // rather than discover from a finance contact who never received anything.
        'Technical, support, NOC and commercial contacts only — finance, billing, rates and invoicing are never sent credentials.',
      ],
      metrics: { requested: 1, created: 1, verified: 1, recipients: to.length },
    };
  },
};
