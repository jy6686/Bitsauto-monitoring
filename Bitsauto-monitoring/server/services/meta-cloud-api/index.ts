/**
 * Meta WhatsApp Cloud API — Direct Messages + Authentication Templates
 * API v23.0 — https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const META_API_BASE = 'https://graph.facebook.com/v23.0';

interface MetaApiError {
  error?: { message?: string; type?: string; code?: number; fbtrace_id?: string; error_data?: unknown };
}

async function metaPost(
  phoneNumberId: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<{ messages: Array<{ id: string }> }> {
  const url = `${META_API_BASE}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json().catch(() => ({}))) as MetaApiError & { messages?: Array<{ id: string }> };

  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Meta Cloud API error: ${msg}`);
  }

  return json as { messages: Array<{ id: string }> };
}

/**
 * Send a plain text WhatsApp message via Meta Cloud API.
 * Use for alerts and non-OTP messages within an open 24h conversation window.
 */
export async function sendMetaDirectText(
  to: string,
  body: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<{ wamid: string }> {
  const result = await metaPost(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  });
  return { wamid: result.messages?.[0]?.id ?? '' };
}

/**
 * Send an OTP via a pre-approved Meta Authentication Template.
 * Required for first-contact messages; works regardless of conversation window.
 *
 * The template must be pre-registered in Meta Business Manager under
 * category = AUTHENTICATION. The body component uses a single variable
 * (the OTP code). An optional button component copies the code on tap.
 *
 * Template body text (Meta preset, non-customisable):
 *   "<OTP_CODE> is your verification code."
 */
export async function sendMetaOtpTemplate(
  to: string,
  otpCode: string,
  templateName: string,
  languageCode: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<{ wamid: string }> {
  const result = await metaPost(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: otpCode }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: otpCode }],
        },
      ],
    },
  });
  return { wamid: result.messages?.[0]?.id ?? '' };
}
