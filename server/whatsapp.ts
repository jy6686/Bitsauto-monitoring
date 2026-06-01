
import { storage } from './storage';
import { sendMetaDirectText, sendMetaOtpTemplate } from './services/meta-cloud-api/index';

export type WaAlertType = 'fas' | 'balance' | 'traffic' | 'auth' | 'outage' | 'quality' | 'test';

// ── Provider senders ───────────────────────────────────────────────────────

async function sendCallMeBot(phone: string, message: string, apiKey: string): Promise<void> {
  // Strip leading + for CallMeBot (expects digits only)
  const digits = phone.replace(/^\+/, '');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${digits}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await res.text();
  if (!res.ok || body.toLowerCase().includes('error')) {
    throw new Error(`CallMeBot HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendUltraMsg(phone: string, message: string, instanceId: string, token: string): Promise<void> {
  const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
  const body = new URLSearchParams({ token, to: phone, body: message });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({})) as any;
  if (!res.ok || json?.sent === 'false' || json?.error) {
    throw new Error(`UltraMsg HTTP ${res.status}: ${json?.error || JSON.stringify(json).slice(0, 200)}`);
  }
}

// ── Message formatters ─────────────────────────────────────────────────────

export function formatFasAlert(opts: {
  callId: string; caller: string; callee: string;
  vendor: string; pddSecs: number; billSecs: number; reason: string;
}): string {
  return [
    '🚨 *FAS Fraud Detected* 🚨',
    '━━━━━━━━━━━━━━━━━━',
    `📡 *Platform:* Bitsauto Monitoring`,
    `🏢 *Vendor:* ${opts.vendor}`,
    `📞 *Caller:* ${opts.caller}`,
    `📲 *Callee:* ${opts.callee}`,
    `⏱ *PDD:* ${opts.pddSecs.toFixed(1)}s  |  *Billed:* ${opts.billSecs}s`,
    `⚠️ *Reason:* ${opts.reason}`,
    `🔑 *Call ID:* ${opts.callId.slice(0, 24)}`,
    `🕒 ${new Date().toUTCString()}`,
    '━━━━━━━━━━━━━━━━━━',
    '_Review vendor routing immediately._',
  ].join('\n');
}

export function formatBalanceAlert(opts: {
  accountName: string; balance: number; creditLimit: number; threshold: number;
}): string {
  const pct = opts.creditLimit > 0 ? ((opts.balance / opts.creditLimit) * 100).toFixed(1) : 'N/A';
  return [
    '⚠️ *Low Balance Alert* ⚠️',
    '━━━━━━━━━━━━━━━━━━',
    `📡 *Platform:* Bitsauto Monitoring`,
    `🏦 *Account:* ${opts.accountName}`,
    `💰 *Balance:* $${opts.balance.toFixed(2)}`,
    `📊 *Credit Used:* ${pct}%`,
    `🔔 *Threshold:* $${opts.threshold.toFixed(2)}`,
    `🕒 ${new Date().toUTCString()}`,
    '━━━━━━━━━━━━━━━━━━',
    '_Top up account to avoid service disruption._',
  ].join('\n');
}

export function formatTrafficAlert(opts: {
  clientName: string; alertType: string; prevCalls: number; currCalls: number;
}): string {
  const icon = opts.alertType === 'traffic_gone' ? '🔴' :
               opts.alertType === 'traffic_restored' ? '🟢' : '🟡';
  const typeLabel = opts.alertType === 'traffic_gone' ? 'Traffic Gone' :
                   opts.alertType === 'traffic_restored' ? 'Traffic Restored' : 'Traffic Dropped';
  return [
    `${icon} *${typeLabel}* ${icon}`,
    '━━━━━━━━━━━━━━━━━━',
    `📡 *Platform:* Bitsauto Monitoring`,
    `👤 *Client:* ${opts.clientName}`,
    `📉 *Previous:* ${opts.prevCalls} calls`,
    `📊 *Current:* ${opts.currCalls} calls`,
    `🕒 ${new Date().toUTCString()}`,
    '━━━━━━━━━━━━━━━━━━',
    '_Check client connectivity and routing._',
  ].join('\n');
}

export function formatAuthAlert(opts: {
  accountName: string; action: 'added' | 'deleted'; ipAddress?: string;
}): string {
  const icon = opts.action === 'added' ? '🔐' : '🗑️';
  return [
    `${icon} *Auth Rule ${opts.action === 'added' ? 'Added' : 'Deleted'}*`,
    '━━━━━━━━━━━━━━━━━━',
    `📡 *Platform:* Bitsauto Monitoring`,
    `👤 *Account:* ${opts.accountName}`,
    `🔧 *Action:* ${opts.action.toUpperCase()}`,
    opts.ipAddress ? `🌐 *IP:* ${opts.ipAddress}` : '',
    `🕒 ${new Date().toUTCString()}`,
    '━━━━━━━━━━━━━━━━━━',
    '_Investigate if unexpected._',
  ].filter(Boolean).join('\n');
}

export function formatOutageAlert(opts: { event: 'down' | 'recovered'; host: string }): string {
  const icon = opts.event === 'down' ? '🔴' : '🟢';
  const label = opts.event === 'down' ? 'Sippy Switch DOWN' : 'Sippy Switch RECOVERED';
  return [
    `${icon} *${label}* ${icon}`,
    '━━━━━━━━━━━━━━━━━━',
    `📡 *Platform:* Bitsauto Monitoring`,
    `🖥 *Host:* ${opts.host}`,
    `🕒 ${new Date().toUTCString()}`,
    '━━━━━━━━━━━━━━━━━━',
    opts.event === 'down' ? '_Immediate investigation required!_' : '_Service restored._',
  ].join('\n');
}

// ── OTP code extractor ────────────────────────────────────────────────────
// Finds the first 4-8 digit numeric code in the message (e.g. "Your OTP is 482193")
function extractOtpCode(message: string): string | null {
  const m = message.match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

// ── Direct message sender (no alert-type filtering) ────────────────────────
// Used for OTP dispatch and manual sends from Messaging Intelligence Center.

export async function sendWhatsAppMessage(
  phone: string,
  message: string,
): Promise<{ success: boolean; error?: string; wamid?: string }> {
  const settings = await storage.getSettings();
  const provider   = settings.whatsappProvider ?? 'callmebot';
  const apiKey     = settings.whatsappApiKey ?? '';
  const instanceId = settings.whatsappInstanceId ?? '';

  try {
    if (provider === 'meta_cloud_api') {
      const phoneNumberId = settings.metaPhoneNumberId ?? '';
      const accessToken   = settings.metaAccessToken   ?? '';
      if (!phoneNumberId || !accessToken) {
        return { success: false, error: 'Meta Cloud API: Phone Number ID and Access Token are required' };
      }
      const useTemplate  = settings.metaUseOtpTemplate !== false;
      const otpCode      = useTemplate ? extractOtpCode(message) : null;
      if (useTemplate && otpCode) {
        const templateName = settings.metaOtpTemplateName     ?? 'otp_verification';
        const langCode     = settings.metaOtpTemplateLanguage ?? 'en_us';
        const { wamid } = await sendMetaOtpTemplate(phone, otpCode, templateName, langCode, phoneNumberId, accessToken);
        return { success: true, wamid };
      } else {
        const { wamid } = await sendMetaDirectText(phone, message, phoneNumberId, accessToken);
        return { success: true, wamid };
      }
    }

    if (!apiKey) return { success: false, error: 'WhatsApp API key not configured' };

    if (provider === 'callmebot') {
      await sendCallMeBot(phone, message, apiKey);
    } else {
      await sendUltraMsg(phone, message, instanceId, apiKey);
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) };
  }
}

// ── Core dispatcher ────────────────────────────────────────────────────────

export async function sendWhatsAppAlert(
  alertType: WaAlertType,
  message: string,
): Promise<{ sent: number; failed: number }> {
  const settings = await storage.getSettings();
  if (!settings.whatsappEnabled) return { sent: 0, failed: 0 };

  const enabledTypes = (settings.whatsappAlertTypes ?? 'fas,balance,traffic,outage,auth')
    .split(',').map(t => t.trim());
  if (alertType !== 'test' && !enabledTypes.includes(alertType)) return { sent: 0, failed: 0 };

  const phones = (settings.whatsappPhones ?? '')
    .split(',').map(p => p.trim()).filter(Boolean);
  if (phones.length === 0) return { sent: 0, failed: 0 };

  const provider   = settings.whatsappProvider ?? 'callmebot';
  const apiKey     = settings.whatsappApiKey ?? '';
  const instanceId = settings.whatsappInstanceId ?? '';

  let sent = 0; let failed = 0;
  for (const phone of phones) {
    let errorMsg: string | null = null;
    try {
      if (provider === 'meta_cloud_api') {
        const phoneNumberId = settings.metaPhoneNumberId ?? '';
        const accessToken   = settings.metaAccessToken   ?? '';
        if (!phoneNumberId || !accessToken) throw new Error('Meta Cloud API credentials not configured');
        await sendMetaDirectText(phone, message, phoneNumberId, accessToken);
      } else if (provider === 'callmebot') {
        await sendCallMeBot(phone, message, apiKey);
      } else {
        await sendUltraMsg(phone, message, instanceId, apiKey);
      }
      sent++;
    } catch (err: any) {
      errorMsg = err.message ?? String(err);
      failed++;
      console.error(`[whatsapp] Failed to send to ${phone}: ${errorMsg}`);
    }
    // Log every attempt
    await storage.logWhatsappAlert({
      alertType,
      recipient: phone,
      message,
      status: errorMsg ? 'failed' : 'sent',
      errorMsg,
    }).catch(() => {});
  }
  console.log(`[whatsapp] ${alertType} alert — sent=${sent} failed=${failed}`);
  return { sent, failed };
}
