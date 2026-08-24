/**
 * sippy-invoice-scheduler.service.ts
 *
 * Invoice Delivery Automation Engine
 *
 * Manages the full invoice delivery lifecycle:
 *   PENDING → GENERATED → REVIEW → APPROVED → SENT
 *                                            ↘ FAILED → RETRYING
 *
 * Key operations:
 *   createJob()          — schedule a new invoice job for a client + period
 *   generateDraft()      — links to an existing invoice or creates placeholder
 *   moveToReview()       — queue for finance approval
 *   approveAndDispatch() — mark approved + trigger SMTP send
 *   retryJob()           — re-attempt a failed send
 *   cancelJob()          — cancel a job
 *   detectBillingCycles()— scan for closed billing periods needing jobs
 *
 * SMTP dispatch uses existing sender profiles infrastructure.
 * All operations are snapshot-safe — no live tariff lookups.
 */

import { storage } from '../../storage';
import type { InvoiceJob, InsertInvoiceJob } from '@shared/schema';

const MAX_RETRIES = 3;

// ── Create a new invoice job ──────────────────────────────────────────────────

export async function createInvoiceJob(
  clientName:    string,
  billingPeriod: string,
  opts: { clientId?: string; iTariff?: string; scheduledAt?: Date; createdBy?: string; notes?: string } = {},
): Promise<InvoiceJob> {
  // Check for duplicate (non-cancelled) job for this client + period
  const existing = await storage.listInvoiceJobs({ clientName, billingPeriod });
  const active = existing.filter(j => j.status !== 'CANCELLED');
  if (active.length > 0) {
    throw new Error(`Invoice job already exists for ${clientName} / ${billingPeriod} (status: ${active[0].status})`);
  }

  // Auto-resolve tariff from companies if not provided
  let iTariff = opts.iTariff;
  if (!iTariff) {
    try {
      const allCompanies = await storage.getCompanies();
      const match = allCompanies.find(c =>
        c.name?.toLowerCase() === clientName.toLowerCase() ||
        (c as any).billingName?.toLowerCase() === clientName.toLowerCase()
      );
      if (match?.sippyITariff) iTariff = String(match.sippyITariff);
    } catch { /* non-fatal */ }
  }

  const job = await storage.createInvoiceJob({
    clientName,
    billingPeriod,
    clientId:    opts.clientId,
    iTariff:     iTariff ?? null,
    scheduledAt: opts.scheduledAt ?? null,
    createdBy:   opts.createdBy ?? 'operator',
    notes:       opts.notes ?? null,
    status:      'PENDING',
  } as any);

  console.log(`[invoice-scheduler] Created job #${job.id} — ${clientName} / ${billingPeriod}${iTariff ? ` tariff=${iTariff}` : ' (no tariff resolved)'}`);
  return job;
}

// ── Link invoice and move to GENERATED ───────────────────────────────────────

export async function linkInvoiceAndGenerate(
  jobId:     number,
  invoiceId: number,
): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['PENDING', 'GENERATED']);
  return storage.updateInvoiceJob(job.id, {
    invoiceId,
    status:      'GENERATED',
    generatedAt: new Date(),
  });
}

// ── Generate the invoice for a job (the missing bridge) ───────────────────────
//
// The F2 batch creates jobs, and jobs could be approved and dispatched — but
// nothing ever CREATED the invoice in between, so every chain died at "no
// linked invoice" (measured: 10 jobs, jobs_with_invoice = 0, invoices = 0).
// This calls the certified generator — snapshot-sourced header + line items —
// links the result, and moves the job to REVIEW where Finance takes over.

export async function generateInvoiceForJob(
  jobId:       number,
  generatedBy: string = 'operator',
): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['PENDING', 'GENERATED']);

  if (job.invoiceId) {
    // Already linked (e.g. a retry after a partial run) — just advance.
    return moveToReview(job.id);
  }

  const m = /^(\d{4})-(\d{2})$/.exec(job.billingPeriod ?? '');
  if (!m) {
    throw new Error(`Job #${job.id} has billing period "${job.billingPeriod}" — expected YYYY-MM.`);
  }
  const year  = Number(m[1]);
  const month = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodStart = `${job.billingPeriod}-01`;
  const periodEnd   = `${job.billingPeriod}-${String(lastDay).padStart(2, '0')}`;

  const { generateInvoice } = await import('./sippy-invoice.service');
  const { invoice, lineCount } = await generateInvoice({
    iTariff:      job.iTariff ?? undefined,
    iAccount:     job.clientId && /^\d+$/.test(job.clientId) ? Number(job.clientId) : undefined,
    periodStart,
    periodEnd,
    customerName: job.clientName,
    notes:        `Generated from invoice job #${job.id} by ${generatedBy}`,
  });

  await linkInvoiceAndGenerate(job.id, invoice.id);
  console.log(`[invoice-scheduler] Job #${job.id}: invoice ${invoice.invoiceNumber} generated (${lineCount} line item(s)) and linked`);
  return moveToReview(job.id);
}

// ── Move to REVIEW (finance approval queue) ───────────────────────────────────

export async function moveToReview(jobId: number): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['GENERATED', 'PENDING']);
  return storage.updateInvoiceJob(job.id, { status: 'REVIEW' });
}

// ── Approve (dispatch is a SEPARATE, explicit step) ───────────────────────────
//
// Approval used to email immediately (approveAndDispatch was one fused call),
// which made bulk approval unshippable: one click would have mass-mailed
// through a dispatcher that fabricated recipients. Finance's flow is
// Approve → Queue → Send, so approval now only marks the job — and the linked
// invoice — approved. Nothing leaves the building until dispatchApprovedJob.

export async function approveJob(
  jobId:      number,
  approvedBy: string,
): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['REVIEW']);

  // sendInvoiceEmail refuses non-approved invoices; approving the job approves
  // its invoice so the later dispatch step does not dead-end.
  if (job.invoiceId) {
    try {
      const inv = await storage.getInvoice(job.invoiceId);
      if (inv && ['draft', 'review'].includes(inv.status)) {
        await storage.updateInvoice(inv.id, { status: 'approved' } as any);
      }
    } catch { /* non-fatal — dispatch will surface it */ }
  }

  return storage.updateInvoiceJob(job.id, {
    status:     'APPROVED',
    approvedAt: new Date(),
    approvedBy,
  });
}

/** @deprecated approval no longer dispatches — kept so existing callers compile. */
export async function approveAndDispatch(jobId: number, approvedBy: string): Promise<InvoiceJob> {
  return approveJob(jobId, approvedBy);
}

// ── Dispatch an approved job (the explicit send step) ─────────────────────────

export async function dispatchApprovedJob(jobId: number, sentBy = 'dispatcher'): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['APPROVED', 'QUEUED']);
  const queued = await storage.updateInvoiceJob(job.id, { status: 'QUEUED' });
  return dispatchJob(queued, sentBy);
}

// ── Recipient resolution — the client master is the only source ───────────────
//
// companies.invoiceEmail first (comma-separated allowed), then billing-type
// company_contacts. NEVER fabricated: a client without a billing address on
// file is a hard, explained failure, not a guessed domain.

export async function resolveBillingRecipients(
  clientName: string,
): Promise<{ recipients: string[]; source: string }> {
  const all = await storage.getCompanies();
  const company = all.find(c =>
    c.name?.toLowerCase() === clientName.toLowerCase() ||
    (c as any).billingName?.toLowerCase() === clientName.toLowerCase()
  );
  if (!company) return { recipients: [], source: `no company matches "${clientName}"` };

  const direct = (company as any).invoiceEmail?.trim();
  if (direct) {
    const list = direct.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (list.length) return { recipients: list, source: `companies.invoiceEmail (company #${company.id})` };
  }

  const contacts = await storage.getCompanyContacts(company.id);
  const billing = contacts.filter(c =>
    (c.contactType ?? '').toLowerCase().includes('billing') && c.email?.trim());
  if (billing.length) {
    return { recipients: billing.map(c => c.email.trim()), source: `company_contacts(billing) (company #${company.id})` };
  }

  return { recipients: [], source: `company #${company.id} "${company.name}" has no invoiceEmail and no billing contact` };
}

// ── Retry a failed job ────────────────────────────────────────────────────────

export async function retryJob(jobId: number): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['FAILED', 'RETRYING']);
  if (job.retryCount >= MAX_RETRIES) {
    throw new Error(`Job #${jobId} has reached max retries (${MAX_RETRIES}).`);
  }
  const retrying = await storage.updateInvoiceJob(job.id, { status: 'RETRYING' });
  return dispatchJob(retrying, 'retry');
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelJob(jobId: number, reason?: string): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['PENDING', 'GENERATED', 'REVIEW', 'FAILED', 'RETRYING']);
  return storage.updateInvoiceJob(job.id, {
    status:    'CANCELLED',
    lastError: reason ?? null,
  });
}

// ── Reject back to REVIEW (finance rejection with note) ──────────────────────

export async function rejectApproval(jobId: number, reason: string): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['REVIEW', 'APPROVED']);
  return storage.updateInvoiceJob(job.id, {
    status:    'REVIEW',
    lastError: `Rejected: ${reason}`,
    approvedAt: null,
    approvedBy: null,
  });
}

// ── Detect billing cycles — find clients whose period just closed ─────────────

export interface DetectResult {
  detected:  string[];
  created:   number;
  skipped:   number;
}

export async function detectBillingCycles(): Promise<DetectResult> {
  // Get all clients from Sippy accounts (via storage)
  let clients: Array<{ name: string; id?: string }> = [];
  try {
    const accounts = await storage.listSippyAccounts?.() ?? [];
    clients = accounts.map((a: any) => ({ name: a.name ?? a.companyName ?? String(a.id), id: String(a.id) }));
  } catch {
    // If Sippy accounts not available, use existing invoice clients
    const invoices = await storage.listInvoices({});
    const seen = new Set<string>();
    for (const inv of invoices) {
      const n = (inv as any).clientName ?? (inv as any).accountName ?? '';
      if (n && !seen.has(n)) { seen.add(n); clients.push({ name: n }); }
    }
  }

  // Current billing period = previous month
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const period = prevMonth.toISOString().slice(0, 7); // YYYY-MM

  const detected: string[] = [];
  let created = 0;
  let skipped = 0;

  for (const client of clients.slice(0, 50)) { // cap at 50
    detected.push(client.name);
    try {
      const existing = await storage.listInvoiceJobs({ clientName: client.name, billingPeriod: period });
      if (existing.some(j => j.status !== 'CANCELLED')) { skipped++; continue; }
      // Auto-resolve tariff from companies
      let iTariff: string | undefined;
      try {
        const allCompanies = await storage.getCompanies();
        const match = allCompanies.find(c =>
          c.name?.toLowerCase() === client.name.toLowerCase() ||
          (c as any).billingName?.toLowerCase() === client.name.toLowerCase()
        );
        if (match?.sippyITariff) iTariff = String(match.sippyITariff);
      } catch { /* non-fatal */ }

      await storage.createInvoiceJob({
        clientName:    client.name,
        clientId:      client.id,
        billingPeriod: period,
        iTariff:       iTariff ?? null,
        status:        'PENDING',
        createdBy:     'auto-detect',
      } as any);
      created++;
    } catch { skipped++; }
  }

  console.log(`[invoice-scheduler] detect-cycles: period=${period}, detected=${detected.length}, created=${created}, skipped=${skipped}`);
  return { detected, created, skipped };
}

// ── Internal: dispatch via the ONE invoice sender ─────────────────────────────
//
// Reuses sendInvoiceEmail — the settings.invoice_smtp_* transporter (SMTP
// freeze decision), the real invoice attachment, and the
// invoice_email_deliveries audit row all come with it. This service adds only
// recipient resolution from the client master and job-state bookkeeping.
// The old inline transport read three phantom columns off sender profiles and
// mailed a fabricated <client>@client.com address; none of that survives.

async function dispatchJob(job: InvoiceJob, sentBy = 'dispatcher'): Promise<InvoiceJob> {
  try {
    if (!job.invoiceId) {
      throw new Error('Job has no linked invoice — generate the invoice before dispatch.');
    }

    const { recipients, source } = await resolveBillingRecipients(job.clientName);
    if (recipients.length === 0) {
      throw new Error(`No billing recipient on file (${source}). Set the company's Invoice Email or add a billing contact.`);
    }

    const invoice = await storage.getInvoice(job.invoiceId);
    const totalActual = (invoice as any)?.totalActual;
    const amountLine = totalActual != null ? ` Total: $${Number(totalActual).toFixed(2)} USD.` : '';

    const { sendInvoiceEmail } = await import('../email/invoice-email.service');
    const result = await sendInvoiceEmail({
      invoiceId:  job.invoiceId,
      recipients,
      cc:         [],
      subject:    `Invoice ${job.billingPeriod} — ${job.clientName}`,
      body:       `Dear ${job.clientName},\n\nPlease find attached your invoice for billing period ${job.billingPeriod}.${amountLine}\n\nIchibaan Logic Billing`,
      sentBy,
    });
    if (!result.ok) throw new Error(result.error ?? 'Email delivery failed');

    const updated = await storage.updateInvoiceJob(job.id, {
      status: 'SENT',
      sentAt: new Date(),
      lastError: null,
    });
    console.log(`[invoice-scheduler] Job #${job.id} sent → ${recipients.join(', ')} (${source})`);
    return updated;

  } catch (err: any) {
    console.error(`[invoice-scheduler] Dispatch failed for job #${job.id}:`, err.message);
    return storage.updateInvoiceJob(job.id, {
      status:     'FAILED',
      failedAt:   new Date(),
      lastError:  err.message,
      retryCount: (job.retryCount ?? 0) + 1,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireJob(id: number, allowedStatuses: string[]): Promise<InvoiceJob> {
  const job = await storage.getInvoiceJob(id);
  if (!job) throw new Error(`Invoice job #${id} not found`);
  if (!allowedStatuses.includes(job.status)) {
    throw new Error(`Job #${id} is in status ${job.status} — expected one of: ${allowedStatuses.join(', ')}`);
  }
  return job;
}
