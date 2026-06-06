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
      const allCompanies = await storage.listCompanies();
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

// ── Move to REVIEW (finance approval queue) ───────────────────────────────────

export async function moveToReview(jobId: number): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['GENERATED', 'PENDING']);
  return storage.updateInvoiceJob(job.id, { status: 'REVIEW' });
}

// ── Approve + dispatch ────────────────────────────────────────────────────────

export async function approveAndDispatch(
  jobId:      number,
  approvedBy: string,
): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['REVIEW']);

  // Mark approved immediately
  const approved = await storage.updateInvoiceJob(job.id, {
    status:     'APPROVED',
    approvedAt: new Date(),
    approvedBy,
  });

  // Attempt SMTP dispatch
  return dispatchJob(approved);
}

// ── Retry a failed job ────────────────────────────────────────────────────────

export async function retryJob(jobId: number): Promise<InvoiceJob> {
  const job = await requireJob(jobId, ['FAILED', 'RETRYING']);
  if (job.retryCount >= MAX_RETRIES) {
    throw new Error(`Job #${jobId} has reached max retries (${MAX_RETRIES}).`);
  }
  const retrying = await storage.updateInvoiceJob(job.id, { status: 'RETRYING' });
  return dispatchJob(retrying);
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
        const allCompanies = await storage.listCompanies();
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

// ── Internal: dispatch via SMTP ───────────────────────────────────────────────

async function dispatchJob(job: InvoiceJob): Promise<InvoiceJob> {
  try {
    // Get sender profile for billing type
    const profiles = await storage.listSmtpSenderProfiles?.() ?? [];
    const profile = profiles.find((p: any) => p.notificationType === 'billing' || p.notificationType === 'invoice') ?? profiles[0];

    if (!profile?.smtpHost || !profile?.smtpUser) {
      throw new Error('No SMTP sender profile configured for billing. Add one in Sender Profiles first.');
    }

    // Get invoice detail for email body
    let invoiceDetail: any = null;
    if (job.invoiceId) {
      try { invoiceDetail = await storage.getInvoice?.(job.invoiceId); } catch {}
    }

    const subject = `Invoice ${job.billingPeriod} — ${job.clientName}`;
    const html = buildInvoiceEmailHtml(job, invoiceDetail);

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host:   profile.smtpHost,
      port:   profile.smtpPort ?? 587,
      secure: (profile.smtpPort === 465),
      auth:   {
        user: profile.smtpUser,
        pass: profile.smtpPass,
      },
    });

    // Determine recipient: use profile's default recipient or client email
    const toAddress = profile.defaultRecipientEmail ?? `${job.clientName.toLowerCase().replace(/\s+/g, '.')}@client.com`;

    await transporter.sendMail({
      from:    `"${profile.senderName ?? 'BitsAuto Finance'}" <${profile.smtpUser}>`,
      to:      toAddress,
      subject,
      html,
    });

    const updated = await storage.updateInvoiceJob(job.id, {
      status: 'SENT',
      sentAt: new Date(),
      lastError: null,
    });
    console.log(`[invoice-scheduler] Job #${job.id} sent → ${toAddress}`);
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

function buildInvoiceEmailHtml(job: InvoiceJob, invoice: any): string {
  const amount = invoice?.totalAmountUsd != null ? `$${Number(invoice.totalAmountUsd).toFixed(2)}` : 'See attached';
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">Invoice — ${job.billingPeriod}</h2>
  <p>Dear ${job.clientName},</p>
  <p>Please find your invoice for the billing period <strong>${job.billingPeriod}</strong>.</p>
  <table style="width:100%; border-collapse:collapse; margin: 16px 0;">
    <tr style="background:#f5f5f5;">
      <td style="padding:8px; border:1px solid #ddd;"><strong>Billing Period</strong></td>
      <td style="padding:8px; border:1px solid #ddd;">${job.billingPeriod}</td>
    </tr>
    <tr>
      <td style="padding:8px; border:1px solid #ddd;"><strong>Total Amount</strong></td>
      <td style="padding:8px; border:1px solid #ddd; color:#1a6e3c; font-weight:bold;">${amount}</td>
    </tr>
    ${invoice?.dueDate ? `<tr style="background:#f5f5f5;"><td style="padding:8px; border:1px solid #ddd;"><strong>Due Date</strong></td><td style="padding:8px; border:1px solid #ddd;">${new Date(invoice.dueDate).toLocaleDateString()}</td></tr>` : ''}
  </table>
  <p style="color:#666; font-size:12px;">This invoice was generated and approved by your account manager. Please contact us at finance@bitsauto.com for any queries.</p>
  <p style="color:#666; font-size:12px;">BitsAuto Finance Team</p>
</div>`;
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
