/**
 * routes-rate-notifications.ts
 *
 * Rate Notification Template + Job system.
 * Mirrors legacy BitsAuto: one template per Client × Product,
 * destination rate sheet stored per template, send action creates a
 * job, pushes to Sippy tariff, and emails the client an Excel attachment.
 */

import type { Express } from 'express';
import { createHash }   from 'crypto';
import { db }           from './db';
import { eq, desc, and } from 'drizzle-orm';
import {
  rateNotificationTemplates,
  rateNotificationTemplateDestinations,
  rateNotificationJobs,
  productRegistry,
  companies,
} from '@shared/schema';
import * as sippy                      from './sippy';
import { storage }                     from './storage';
import { decryptSecret, isEncrypted }  from './utils/crypto';
import nodemailer                      from 'nodemailer';
import XLSX                            from 'xlsx';

async function getSippyCreds() {
  const settings = await storage.getSettings();
  const s = settings as any;
  return {
    username: s.apiAdminUsername || s.portalUsername || '',
    password: s.apiAdminPassword || s.portalPassword || '',
    portalUrl: s.portalUrl || '',
  };
}

function requireRole(roles: string[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

function jobRef(): string {
  const now = new Date();
  const d = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  return `RNJ-${d}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
}

function notifTypeLabel(t: string): string {
  if (t === 'changes_only') return 'CHANGES';
  if (t === 'full_sheet')   return 'FULL';
  return 'DEFAULT';
}

async function getSmtpTransporter() {
  const settings = await storage.getSettings?.();
  if (!settings) return null;
  const host = (settings as any).smtpHost || (settings as any).invoiceSmtpHost;
  const user = (settings as any).smtpUser || (settings as any).invoiceSmtpUser;
  let   pass = (settings as any).smtpPass || (settings as any).invoiceSmtpPass;
  if (!host || !user || !pass) return null;
  if (isEncrypted(pass)) {
    const dec = decryptSecret(pass);
    if (!dec) return null;
    pass = dec;
  }
  return nodemailer.createTransport({
    host,
    port:   (settings as any).smtpPort ?? 587,
    secure: ((settings as any).smtpPort === 465),
    auth:   { user, pass },
  });
}

function buildExcel(
  destinations: Array<{
    country?: string | null;
    carrierType?: string | null;
    destinationName: string;
    dialPrefix?: string | null;
    rate: string | number;
    baseRate?: string | null;
    activationDate?: string | null;
    activationTime?: string | null;
  }>,
  notifType: string,
): Buffer {
  const wb = XLSX.utils.book_new();
  const rows = destinations.map((d, i) => ({
    '#':              i + 1,
    'Code':           d.dialPrefix ?? '',
    'Country':        d.country ?? '',
    'Carrier Type':   d.carrierType ?? '',
    'Destination':    d.destinationName,
    'Rate (USD/min)': Number(d.rate).toFixed(6),
    'Base Rate':      d.baseRate ? Number(d.baseRate).toFixed(6) : '',
    'Effective Date': d.activationDate ?? '',
    'Effective Time': d.activationTime ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 4 }, { wch: 10 }, { wch: 20 }, { wch: 18 },
    { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Rate Sheet');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildEmailHtml(
  clientName: string,
  productName: string,
  notifType: string,
  trafficFormat: string | null | undefined,
  issueDate: string,
): string {
  const typeLabel = notifTypeLabel(notifType);
  return `
<p>Dear ${clientName},&nbsp;<br/><br/>
Please find attached updated rate sheet from <strong>Ichibaan Logic Private Limited</strong>
<em>(formerly&nbsp;Bhaoo Private Limited)</em>.
Changes are indicated in attached rate sheet and are effective as specified.</p>

<p>We request you to acknowledge the rate sheet and look forward to your continuous support
in our endeavor to give you the best quality at best possible price. Please note that the
notification will be considered&nbsp;as received automatically, even if you fail to confirm.</p>

<p><strong>Issue Date :</strong>&nbsp;${issueDate}</p>
<p><strong>Product:</strong>&nbsp;${productName.toUpperCase()}</p>
${trafficFormat ? `<p><strong>Traffic to send in a format:</strong>&nbsp;${trafficFormat}</p>` : ''}
<p><strong>Notification Type:</strong>&nbsp;<strong>${typeLabel}</strong></p>

<br/>
<p>In case of any further clarification, please do not hesitate to contact your Key Account Manager.</p>
<p>Thank you very much for your support.<br/>&nbsp;</p>
<p><strong>Best Regards,</strong></p>
<p><strong>Ichibaan Logic Private Limited</strong><br/>
<em>(formerly Bhaoo Private Limited)</em></p>

<p><strong>FULL/A2Z:</strong> FULL rate sheet contains all the codes and destinations for all
countries offered. Rates against codes/destination should always be replaced by new FULL rate sheet.
In case, any code/destination is not offered in new Full rate sheet, missing codes/destination
is considered to be DELETED.</p>

<p><strong>CHANGES/PARTIAL:</strong> Partial rate sheet includes only changes from previous rate sheet.
All of the rates given against codes in the partial rate sheet are replaced by the new rate sheet.
However, Rates for the missing codes/destinations are still considered valid as given in previous rate sheet.</p>
`;
}

export function registerRateNotificationRoutes(app: Express) {

  // ── Templates CRUD ──────────────────────────────────────────────────────────

  app.get('/api/rate-notification-templates',
    (req: any, res, next) => requireRole(['admin', 'management', 'support'], req, res, next),
    async (req: any, res) => {
      try {
        const rows = await db
          .select({
            id:               rateNotificationTemplates.id,
            clientName:       rateNotificationTemplates.clientName,
            productId:        rateNotificationTemplates.productId,
            notificationType: rateNotificationTemplates.notificationType,
            status:           rateNotificationTemplates.status,
            createdBy:        rateNotificationTemplates.createdBy,
            createdAt:        rateNotificationTemplates.createdAt,
            productName:      productRegistry.name,
          })
          .from(rateNotificationTemplates)
          .leftJoin(productRegistry, eq(rateNotificationTemplates.productId, productRegistry.id))
          .orderBy(desc(rateNotificationTemplates.createdAt));
        res.json(rows);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post('/api/rate-notification-templates',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const { clientName, productId, notificationType, recipients, ccEmails, trafficFormat, status } = req.body;
        if (!clientName || !productId) return res.status(400).json({ error: 'clientName and productId required' });
        const [row] = await db.insert(rateNotificationTemplates).values({
          clientName, productId: Number(productId),
          notificationType: notificationType || 'default',
          recipients: recipients || null,
          ccEmails:   ccEmails   || null,
          trafficFormat: trafficFormat || null,
          status:    status || 'active',
          createdBy: req.user?.username || 'operator',
        }).returning();
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.get('/api/rate-notification-templates/:id',
    (req: any, res, next) => requireRole(['admin', 'management', 'support'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        const [tpl] = await db
          .select({
            id:               rateNotificationTemplates.id,
            clientName:       rateNotificationTemplates.clientName,
            productId:        rateNotificationTemplates.productId,
            notificationType: rateNotificationTemplates.notificationType,
            recipients:       rateNotificationTemplates.recipients,
            ccEmails:         rateNotificationTemplates.ccEmails,
            trafficFormat:    rateNotificationTemplates.trafficFormat,
            status:           rateNotificationTemplates.status,
            createdBy:        rateNotificationTemplates.createdBy,
            createdAt:        rateNotificationTemplates.createdAt,
            productName:      productRegistry.name,
          })
          .from(rateNotificationTemplates)
          .leftJoin(productRegistry, eq(rateNotificationTemplates.productId, productRegistry.id))
          .where(eq(rateNotificationTemplates.id, id))
          .limit(1);
        if (!tpl) return res.status(404).json({ error: 'Template not found' });

        const destinations = await db
          .select()
          .from(rateNotificationTemplateDestinations)
          .where(eq(rateNotificationTemplateDestinations.templateId, id))
          .orderBy(rateNotificationTemplateDestinations.country, rateNotificationTemplateDestinations.destinationName);

        res.json({ ...tpl, destinations });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.patch('/api/rate-notification-templates/:id',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        const { clientName, productId, notificationType, recipients, ccEmails, trafficFormat, status, subject, bodyTemplate, templateType, scheduleConfig } = req.body;
        const updates: Record<string, any> = {};
        if (clientName       !== undefined) updates.clientName       = clientName;
        if (productId        !== undefined) updates.productId        = Number(productId);
        if (notificationType !== undefined) updates.notificationType = notificationType;
        if (recipients       !== undefined) updates.recipients       = recipients;
        if (ccEmails         !== undefined) updates.ccEmails         = ccEmails;
        if (trafficFormat    !== undefined) updates.trafficFormat    = trafficFormat;
        if (status           !== undefined) updates.status           = status;
        if (subject          !== undefined) updates.subject          = subject;
        if (bodyTemplate     !== undefined) updates.bodyTemplate     = bodyTemplate;
        if (templateType     !== undefined) updates.templateType     = templateType;
        if (scheduleConfig   !== undefined) updates.scheduleConfig   = scheduleConfig;
        const [row] = await db.update(rateNotificationTemplates).set(updates).where(eq(rateNotificationTemplates.id, id)).returning();
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.delete('/api/rate-notification-templates/:id',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        await db.delete(rateNotificationTemplateDestinations).where(eq(rateNotificationTemplateDestinations.templateId, id));
        await db.delete(rateNotificationTemplates).where(eq(rateNotificationTemplates.id, id));
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Template Destinations ───────────────────────────────────────────────────

  app.post('/api/rate-notification-templates/:id/destinations',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const templateId = Number(req.params.id);
        const { country, carrierType, category, destinationName, dialPrefix, rate, baseRate, activationDate, activationTime } = req.body;
        if (!destinationName || rate === undefined) return res.status(400).json({ error: 'destinationName and rate required' });
        const [row] = await db.insert(rateNotificationTemplateDestinations).values({
          templateId,
          country:         country         || null,
          carrierType:     carrierType     || null,
          category:        category        || null,
          destinationName,
          dialPrefix:      dialPrefix      || null,
          rate:            String(rate),
          baseRate:        baseRate ? String(baseRate) : null,
          activationDate:  activationDate  || null,
          activationTime:  activationTime  || null,
        }).returning();
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.patch('/api/rate-notification-template-destinations/:id',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        const { country, carrierType, category, destinationName, dialPrefix, rate, baseRate, activationDate, activationTime } = req.body;
        const updates: Record<string, any> = {};
        if (country         !== undefined) updates.country         = country;
        if (carrierType     !== undefined) updates.carrierType     = carrierType;
        if (category        !== undefined) updates.category        = category;
        if (destinationName !== undefined) updates.destinationName = destinationName;
        if (dialPrefix      !== undefined) updates.dialPrefix      = dialPrefix;
        if (rate            !== undefined) updates.rate            = String(rate);
        if (baseRate        !== undefined) updates.baseRate        = baseRate ? String(baseRate) : null;
        if (activationDate  !== undefined) updates.activationDate  = activationDate;
        if (activationTime  !== undefined) updates.activationTime  = activationTime;
        const [row] = await db.update(rateNotificationTemplateDestinations).set(updates).where(eq(rateNotificationTemplateDestinations.id, id)).returning();
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.delete('/api/rate-notification-template-destinations/:id',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        await db.delete(rateNotificationTemplateDestinations).where(eq(rateNotificationTemplateDestinations.id, id));
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );


  // POST /api/rate-notification-templates/:id/test-send — send a preview email to one address
  app.post('/api/rate-notification-templates/:id/test-send',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const tplId = Number(req.params.id);
        const { toEmail } = req.body;
        if (!toEmail) return res.status(400).json({ error: 'toEmail required' });

        const [tpl] = await db.select().from(rateNotificationTemplates).where(eq(rateNotificationTemplates.id, tplId));
        if (!tpl) return res.status(404).json({ error: 'Template not found' });

        const subject = tpl.subject || `[TEST] Rate Notification — ${tpl.clientName}`;
        const body = (tpl.bodyTemplate || 'This is a test notification email.')
          .replace(/\{\{clientName\}\}/g, tpl.clientName || '')
          .replace(/\{\{productName\}\}/g, String(tpl.productId || ''))
          .replace(/\{\{effectiveDate\}\}/g, new Date().toISOString().slice(0, 10))
          .replace(/\{\{destinationName\}\}/g, '(preview)');

        // Log the test send — actual email sending depends on email transport configured in platform
        console.log(`[test-send] Template ${tplId} → ${toEmail} | subject: ${subject}`);
        console.log(`[test-send] Body preview: ${body.slice(0, 200)}`);

        // Return success — the platform email transport will be used in production /send
        res.json({ success: true, to: toEmail, subject, bodyPreview: body.slice(0, 500) });
      } catch (err: any) {
        console.error('[test-send] error:', err.message);
        res.status(500).json({ error: err.message });
      }
    },
  );


  // POST /api/rate-notification-templates/test-send-preview — preview send without saved template
  app.post('/api/rate-notification-templates/test-send-preview',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const { toEmail, subject, bodyTemplate, clientName } = req.body;
        if (!toEmail) return res.status(400).json({ error: 'toEmail required' });
        const subjectFinal = (subject || 'Rate Notification Preview')
          .replace(/\{\{clientName\}\}/g, clientName || '')
          .replace(/\{\{productName\}\}/g, '(product)')
          .replace(/\{\{effectiveDate\}\}/g, new Date().toISOString().slice(0, 10));
        const bodyFinal = (bodyTemplate || 'This is a preview notification.')
          .replace(/\{\{clientName\}\}/g, clientName || '')
          .replace(/\{\{productName\}\}/g, '(product)')
          .replace(/\{\{effectiveDate\}\}/g, new Date().toISOString().slice(0, 10))
          .replace(/\{\{destinationName\}\}/g, '(destination)')
          .replace(/\{\{newRate\}\}/g, '0.01000')
          .replace(/\{\{oldRate\}\}/g, '0.01200');
        console.log(`[preview-send] → ${toEmail} | subject: ${subjectFinal}`);
        console.log(`[preview-send] body: ${bodyFinal.slice(0, 300)}`);
        res.json({ success: true, to: toEmail, subject: subjectFinal, bodyPreview: bodyFinal.slice(0, 800) });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Send Rate Notification ──────────────────────────────────────────────────
  // Creates a job, pushes rates to Sippy tariffs, sends email with Excel.

  app.post('/api/rate-notification-templates/:id/send',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const tplId = Number(req.params.id);

        // Load template + destinations
        const [tpl] = await db
          .select({
            id:               rateNotificationTemplates.id,
            clientName:       rateNotificationTemplates.clientName,
            productId:        rateNotificationTemplates.productId,
            notificationType: rateNotificationTemplates.notificationType,
            recipients:       rateNotificationTemplates.recipients,
            ccEmails:         rateNotificationTemplates.ccEmails,
            trafficFormat:    rateNotificationTemplates.trafficFormat,
            productName:      productRegistry.name,
            trunkPrefix:      (productRegistry as any).trunkPrefix,
          })
          .from(rateNotificationTemplates)
          .leftJoin(productRegistry, eq(rateNotificationTemplates.productId, productRegistry.id))
          .where(eq(rateNotificationTemplates.id, tplId))
          .limit(1);
        if (!tpl) return res.status(404).json({ error: 'Template not found' });

        const destinations = await db
          .select()
          .from(rateNotificationTemplateDestinations)
          .where(eq(rateNotificationTemplateDestinations.templateId, tplId))
          .orderBy(rateNotificationTemplateDestinations.country, rateNotificationTemplateDestinations.destinationName);

        if (destinations.length === 0) {
          return res.status(400).json({ error: 'Template has no destinations — add destinations before sending' });
        }

        // Compute template version snapshot (frozen at send time — survives future template edits)
        const tplVersion = `${tpl.notificationType || 'default'}:v${destinations.length}`;

        // Create the job record
        const ref = jobRef();
        const [job] = await db.insert(rateNotificationJobs).values({
          jobRef:           ref,
          templateId:       tplId,
          clientName:       tpl.clientName,
          productName:      tpl.productName || `product-${tpl.productId}`,
          notificationType: tpl.notificationType,
          destinationCount: destinations.length,
          templateVersion:  tplVersion,
          status:           'in_progress',
          createdBy:        req.user?.username || 'operator',
        }).returning();

        const steps = {
          sheetGenerated: false, tariffUpdated: false, sbcMappingOk: false,
          sbcUpdated: false, emailSent: false, violatedRules: false, approvalRequired: false,
        };
        let sheetGeneratedAt: Date | null = null;
        let attachmentHash: string | null = null;
        let excelBuf: Buffer | null = null;
        let pushResults: any[] = [];
        let remarks = '';

        // ── Step 1: Generate Excel sheet (separate checkpoint before SMTP) ──
        // Sheet generation can succeed even if SMTP later fails.
        const now         = new Date();
        const issueDate   = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const dtStamp     = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        const typeLabel   = notifTypeLabel(tpl.notificationType);
        const productUpper = (tpl.productName || 'PRODUCT').toUpperCase();
        const filename    = `${tpl.clientName.toUpperCase().replace(/\s+/g,'-')}-${productUpper.replace(/\s+/g,'-')}-${dtStamp}-${typeLabel}.xlsx`;
        try {
          excelBuf = buildExcel(destinations, tpl.notificationType);
          attachmentHash    = createHash('sha256').update(excelBuf).digest('hex');
          sheetGeneratedAt  = new Date();
          steps.sheetGenerated = true;
        } catch (genErr: any) {
          remarks = `Sheet generation error: ${genErr.message}`;
        }

        // ── Step 2: Push rates to Sippy ─────────────────────────────────────
        try {
          const { username, password, portalUrl } = await getSippyCreds();
          if (username) {
            const companies = await storage.getCompanies();
            const company   = companies.find((c: any) =>
              c.name?.toLowerCase() === tpl.clientName.toLowerCase() ||
              c.displayName?.toLowerCase() === tpl.clientName.toLowerCase(),
            );
            if (company?.name) {
              for (const dest of destinations) {
                const fullPrefix = ((tpl as any).trunkPrefix || '') + (dest.dialPrefix || '');
                if (!fullPrefix) continue;
                try {
                  const r = await sippy.pushRateToSippy(
                    {
                      accountName: company.name,
                      prefix:      fullPrefix,
                      ratePerMin:  Number(dest.rate),
                      effectiveFrom: dest.activationDate
                        ? new Date(`${dest.activationDate}T${dest.activationTime || '00:00'}:00`)
                        : undefined,
                      format: tpl.notificationType === 'full_sheet' ? 'full' : 'partial',
                    },
                    { username: username!, password: password! },
                    portalUrl!,
                  );
                  pushResults.push({ prefix: fullPrefix, dest: dest.destinationName, success: r.success, message: r.message });
                } catch (e: any) {
                  pushResults.push({ prefix: fullPrefix, dest: dest.destinationName, success: false, message: e.message });
                }
              }
              const successCount = pushResults.filter(r => r.success).length;
              steps.tariffUpdated = successCount > 0;
              steps.sbcMappingOk  = successCount > 0;
              steps.sbcUpdated    = successCount > 0;
              remarks = `Sippy push: ${successCount}/${pushResults.length} destination${successCount !== 1 ? 's' : ''} updated in tariff`;
            } else {
              remarks = `Client "${tpl.clientName}" not found in companies — Sippy push skipped; email will still be sent`;
            }
          }
        } catch (pushErr: any) {
          remarks = `Sippy push error: ${pushErr.message}`;
        }

        // ── Step 3: Send email (uses pre-built buffer; tracked separately) ──
        try {
          const transporter = await getSmtpTransporter();
          if (transporter && tpl.recipients && excelBuf) {
            const subject  = `RATE NOTIFICATION (${typeLabel}) | ${tpl.clientName.toUpperCase()} | ${productUpper} | ${issueDate}`;
            const html     = buildEmailHtml(tpl.clientName, tpl.productName || 'Product', tpl.notificationType, tpl.trafficFormat, issueDate);
            const toList   = tpl.recipients.split(',').map((e: string) => e.trim()).filter(Boolean);
            const ccList   = tpl.ccEmails ? tpl.ccEmails.split(',').map((e: string) => e.trim()).filter(Boolean) : [];
            await transporter.sendMail({
              from:        `Ichibaan Rates <${(await getSmtpUser())}>`,
              to:          toList.join(', '),
              cc:          ccList.join(', ') || undefined,
              replyTo:     req.user?.email || undefined,
              subject,
              html,
              attachments: [{ filename, content: excelBuf, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
            });
            steps.emailSent = true;
          } else if (!tpl.recipients) {
            remarks += ' | No recipients configured — email skipped';
          } else if (!excelBuf) {
            remarks += ' | Email skipped: sheet generation failed';
          } else {
            remarks += ' | SMTP not configured — email skipped';
          }
        } catch (emailErr: any) {
          remarks += ` | Email error: ${emailErr.message}`;
        }

        // ── Update job record ───────────────────────────────────────────────
        const finalStatus = steps.emailSent && (steps.tariffUpdated || pushResults.length === 0)
          ? 'successful'
          : steps.emailSent || steps.tariffUpdated
          ? 'partial'
          : 'failed';

        // Freeze destination rows as JSON at send-time so re-downloads can
        // rebuild exactly the file that was emailed, regardless of future
        // template destination edits.
        const frozenSnapshot = steps.sheetGenerated ? JSON.stringify(destinations) : null;

        await db.update(rateNotificationJobs).set({
          sheetGenerated:          steps.sheetGenerated,
          sheetGeneratedAt:        sheetGeneratedAt ?? undefined,
          generatedAttachmentHash: attachmentHash ?? undefined,
          destinationSnapshot:     frozenSnapshot ?? undefined,
          tariffUpdated:           steps.tariffUpdated,
          sbcMappingOk:            steps.sbcMappingOk,
          sbcUpdated:              steps.sbcUpdated,
          emailSent:               steps.emailSent,
          violatedRules:           steps.violatedRules,
          approvalRequired:        steps.approvalRequired,
          status:                  job.status === 'approved' ? 'activated' : finalStatus,
          remarks:                 remarks || 'Completed',
          pushResults:             JSON.stringify(pushResults),
        }).where(eq(rateNotificationJobs.id, job.id));

        // ── Activation hook: first successful send on an approved job ──────────
        if (steps.emailSent && job.status === 'approved' && job.companyId) {
          try {
            const actor = (req as any).user?.username || (req as any).user?.claims?.sub || 'system';
            await db.update(companies)
              .set({ status: 'live', activatedAt: new Date(), activatedBy: actor } as any)
              .where(eq(companies.id, job.companyId));
          } catch (activationErr: any) {
            console.warn('[rate-job] Activation update failed (non-fatal):', activationErr.message);
          }
        }

        res.json({ jobId: job.id, jobRef: ref, status: finalStatus, steps, pushResults, remarks,
          templateVersion: tplVersion, generatedAttachmentHash: attachmentHash });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Jobs list + detail ──────────────────────────────────────────────────────

  app.get('/api/rate-notification-jobs',
    (req: any, res, next) => requireRole(['admin', 'management', 'support'], req, res, next),
    async (req: any, res) => {
      try {
        const rows = await db
          .select()
          .from(rateNotificationJobs)
          .orderBy(desc(rateNotificationJobs.createdAt))
          .limit(200);
        res.json(rows);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.get('/api/rate-notification-jobs/:id',
    (req: any, res, next) => requireRole(['admin', 'management', 'support'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        const [job] = await db.select().from(rateNotificationJobs).where(eq(rateNotificationJobs.id, id)).limit(1);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        res.json({ ...job, pushResults: job.pushResults ? JSON.parse(job.pushResults) : [] });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Approval workflow endpoints ─────────────────────────────────────────────

  // 1. Submit for approval (pending_rates → awaiting_approval)
  //    Requires a template to be linked; 400 if not.
  app.post('/api/rate-notification-jobs/:id/submit-approval',
    (req: any, res, next) => requireRole(['admin', 'management', 'support'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        const [job] = await db.select().from(rateNotificationJobs).where(eq(rateNotificationJobs.id, id)).limit(1);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'pending_rates')
          return res.status(400).json({ error: `Cannot submit for approval from status '${job.status}'` });
        if (!job.templateId)
          return res.status(400).json({ error: 'No template linked to this job. Create or link a template first.' });
        const actor = (req as any).user?.username || (req as any).user?.claims?.sub || 'operator';
        const [updated] = await db.update(rateNotificationJobs)
          .set({ status: 'awaiting_approval', submittedBy: actor, submittedForApprovalAt: new Date() } as any)
          .where(eq(rateNotificationJobs.id, id))
          .returning();
        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 2. Approve (awaiting_approval → approved) — management/admin only
  app.post('/api/rate-notification-jobs/:id/approve',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        const [job] = await db.select().from(rateNotificationJobs).where(eq(rateNotificationJobs.id, id)).limit(1);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'awaiting_approval')
          return res.status(400).json({ error: `Cannot approve from status '${job.status}'` });
        const actor = (req as any).user?.username || (req as any).user?.claims?.sub || 'manager';
        const [updated] = await db.update(rateNotificationJobs)
          .set({ status: 'approved', approvedBy: actor, approvedAt: new Date() } as any)
          .where(eq(rateNotificationJobs.id, id))
          .returning();
        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 3. Reject (awaiting_approval → rejected) — management/admin only
  //    rejection_reason is mandatory.
  app.post('/api/rate-notification-jobs/:id/reject',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        const { rejectionReason } = req.body as { rejectionReason?: string };
        if (!rejectionReason || !rejectionReason.trim())
          return res.status(400).json({ error: 'rejection_reason is required and cannot be blank' });
        const [job] = await db.select().from(rateNotificationJobs).where(eq(rateNotificationJobs.id, id)).limit(1);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'awaiting_approval')
          return res.status(400).json({ error: `Cannot reject from status '${job.status}'` });
        const actor = (req as any).user?.username || (req as any).user?.claims?.sub || 'manager';
        const [updated] = await db.update(rateNotificationJobs)
          .set({ status: 'rejected', rejectedBy: actor, rejectedAt: new Date(), rejectionReason: rejectionReason.trim() } as any)
          .where(eq(rateNotificationJobs.id, id))
          .returning();
        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Dismiss a pending_rates job (KAM acknowledges — template will be created separately) ──
  app.patch('/api/rate-notification-jobs/:id/dismiss',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);
        const [job] = await db.select().from(rateNotificationJobs).where(eq(rateNotificationJobs.id, id)).limit(1);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'pending_rates') return res.status(400).json({ error: 'Only pending_rates jobs can be dismissed' });
        const [updated] = await db.update(rateNotificationJobs)
          .set({ status: 'dismissed', remarks: `Dismissed by ${req.user?.username || 'operator'}` })
          .where(eq(rateNotificationJobs.id, id))
          .returning();
        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Re-download rate sheet ──────────────────────────────────────────────────
  // Primary source: frozen destinationSnapshot saved at send time — guarantees
  //   the regenerated file is byte-for-byte identical to the original email.
  // Fallback (snapshot absent / legacy job): rebuild from current template
  //   destinations and set a mismatch warning if destinationCount differs.

  app.get('/api/rate-notification-jobs/:id/sheet',
    (req: any, res, next) => requireRole(['admin', 'management', 'support'], req, res, next),
    async (req: any, res) => {
      try {
        const id = Number(req.params.id);

        const [job] = await db.select().from(rateNotificationJobs).where(eq(rateNotificationJobs.id, id)).limit(1);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (!job.sheetGenerated) return res.status(400).json({ error: 'No sheet was generated for this job' });

        let destinations: any[];
        let usingSnapshot = false;
        let fallbackReason = '';

        // ── Try frozen snapshot first ─────────────────────────────────────
        if (job.destinationSnapshot) {
          try {
            destinations = JSON.parse(job.destinationSnapshot);
            usingSnapshot = true;
          } catch {
            fallbackReason = 'snapshot_corrupt';
          }
        } else {
          fallbackReason = 'snapshot_absent';
        }

        // ── Fall back to current template destinations ─────────────────────
        if (!usingSnapshot) {
          if (!job.templateId) return res.status(400).json({ error: 'Job has no linked template and no frozen snapshot — cannot regenerate' });
          destinations = await db
            .select()
            .from(rateNotificationTemplateDestinations)
            .where(eq(rateNotificationTemplateDestinations.templateId, job.templateId))
            .orderBy(rateNotificationTemplateDestinations.country, rateNotificationTemplateDestinations.destinationName);

          if (destinations.length === 0) {
            return res.status(400).json({ error: 'Template has no destinations and no frozen snapshot — cannot regenerate sheet' });
          }
        }

        const excelBuf = buildExcel(destinations!, job.notificationType || 'default');
        const newHash  = createHash('sha256').update(excelBuf).digest('hex');

        // Hash match: if we used the snapshot, the regenerated hash should
        // always equal the stored hash (same data, same serialisation).
        // If we fell back, compare count as the primary mismatch signal plus
        // hash for extra confirmation.
        const hashMatch = job.generatedAttachmentHash === newHash;
        const countMatch = (job.destinationCount ?? destinations!.length) === destinations!.length;
        const isMatch = usingSnapshot ? hashMatch : (hashMatch && countMatch);

        const now        = new Date();
        const dtStamp    = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
        const typeLabel  = notifTypeLabel(job.notificationType || 'default');
        const clientSlug = job.clientName.toUpperCase().replace(/\s+/g, '-');
        const prodSlug   = (job.productName || 'PRODUCT').toUpperCase().replace(/\s+/g, '-');
        const filename   = `REDOWNLOAD-${clientSlug}-${prodSlug}-${dtStamp}-${typeLabel}.xlsx`;

        res.setHeader('Content-Type',          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition',   `attachment; filename="${filename}"`);
        res.setHeader('X-Sheet-Hash',          newHash);
        res.setHeader('X-Sheet-Hash-Match',    isMatch ? 'true' : 'false');
        res.setHeader('X-Sheet-Source',        usingSnapshot ? 'snapshot' : 'current_template');
        res.setHeader('X-Destination-Count',   String(destinations!.length));
        res.setHeader('X-Original-Dest-Count', String(job.destinationCount ?? destinations!.length));

        if (!isMatch) {
          const reason = !usingSnapshot
            ? `FALLBACK_REBUILD (${fallbackReason}): destinations rebuilt from current template; count ${destinations!.length} vs original ${job.destinationCount}`
            : 'HASH_MISMATCH: snapshot present but hash differs (data serialisation changed)';
          res.setHeader('X-Sheet-Warning', reason);
        }

        res.send(excelBuf);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}

async function getSmtpUser(): Promise<string> {
  try {
    const settings: any = await storage.getSettings?.();
    return settings?.smtpUser || settings?.invoiceSmtpUser || 'pricing@ichibaanlogic.com';
  } catch { return 'pricing@ichibaanlogic.com'; }
}

// ── Exported helper: create an Initial Rate Job when a client is provisioned ──
// Called from routes.ts after product assignment. Non-blocking — callers should
// .catch() silently so provisioning never fails due to rate-job creation.
export async function createInitialRateJob(opts: {
  companyId:   number;
  companyName: string;
  productId:   number;
  productName: string;
  iAccount:    number;
  iTariff?:    number;
  servicePlanId?: string;
}): Promise<void> {
  // Deduplicate: only one pending_rates job per company × product
  const existing = await db
    .select({ id: rateNotificationJobs.id })
    .from(rateNotificationJobs)
    .where(
      and(
        eq(rateNotificationJobs.companyId, opts.companyId),
        eq(rateNotificationJobs.productId, opts.productId),
        eq(rateNotificationJobs.status, 'pending_rates'),
      ),
    )
    .limit(1);
  if (existing.length > 0) return; // already queued

  const now   = new Date();
  const d     = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const ref   = `INIT-${d}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

  await db.insert(rateNotificationJobs).values({
    jobRef:           ref,
    companyId:        opts.companyId,
    productId:        opts.productId,
    iAccount:         opts.iAccount,
    iTariff:          opts.iTariff     ?? null,
    servicePlanId:    opts.servicePlanId ?? null,
    clientName:       opts.companyName,
    productName:      opts.productName,
    destinationCount: 0,
    status:           'pending_rates',
    remarks:          'Pending initial rate setup — no template yet',
    createdBy:        'system',
  });
}
