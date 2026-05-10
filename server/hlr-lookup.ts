/**
 * HLR / CNAM lookup module
 *
 * Supported providers
 *   telnyx — Telnyx Number Lookup API (https://developers.telnyx.com/docs/api/v2/numbers/Number-Lookup)
 *            Returns carrier, line-type, portability, CNAM and roaming in one call.
 *
 * Falls back to { hlrSource: 'not_configured' } when no provider / key is set.
 */

export interface HLRResult {
  carrier:     string | null;
  lineType:    'mobile' | 'fixed' | 'voip' | 'toll_free' | 'unknown' | null;
  active:      boolean | null;
  ported:      boolean | null;
  roaming:     boolean | null;
  cnam:        string | null;
  networkCode: string | null;
  hlrSource:   string;
  rawJson:     Record<string, unknown> | null;
}

const EMPTY: Omit<HLRResult, 'hlrSource'> = {
  carrier: null, lineType: null, active: null, ported: null,
  roaming: null, cnam: null, networkCode: null, rawJson: null,
};

export async function performHlrLookup(
  number: string,
  provider: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<HLRResult> {
  const e164 = number.startsWith('+') ? number : `+${number}`;

  if (provider === 'telnyx' && apiKey) {
    try {
      return await telnyxLookup(e164, apiKey);
    } catch (err: any) {
      console.error('[HLR] Telnyx lookup failed:', err?.message ?? err);
      return { ...EMPTY, hlrSource: 'telnyx_error' };
    }
  }

  return { ...EMPTY, hlrSource: 'not_configured' };
}

// ── Telnyx ────────────────────────────────────────────────────────────────────

const TELNYX_LINE_TYPE_MAP: Record<string, HLRResult['lineType']> = {
  mobile:        'mobile',
  landline:      'fixed',
  'fixed line':  'fixed',
  fixed_line:    'fixed',
  voip:          'voip',
  'toll free':   'toll_free',
  toll_free:     'toll_free',
};

async function telnyxLookup(e164: string, apiKey: string): Promise<HLRResult> {
  const url = `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(9000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telnyx HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json() as Record<string, any>;
  const d: Record<string, any> = json.data ?? json;

  const rawLt = ((d.line_type ?? '') as string).toLowerCase().replace(/-/g, '_');
  const lineType = TELNYX_LINE_TYPE_MAP[rawLt] ?? (rawLt ? 'unknown' : null);

  const mcc = d.mobile_country_code ?? null;
  const mnc = d.mobile_network_code ?? null;
  const networkCode = mcc && mnc ? `${mcc}${mnc}` : null;

  const carrier =
    d.carrier?.name ??
    d.portability?.spid_carrier_name ??
    null;

  const ported: boolean | null =
    d.portability?.ported != null
      ? Boolean(d.portability.ported)
      : d.portability?.line_type === 'ported'
        ? true
        : null;

  const roaming: boolean | null =
    d.roaming?.is_roaming != null ? Boolean(d.roaming.is_roaming) : null;

  const cnam: string | null =
    d.caller_name?.caller_name ??
    d.caller_name?.name ??
    null;

  const active: boolean | null =
    d.valid_number != null
      ? Boolean(d.valid_number)
      : null;

  return {
    carrier,
    lineType,
    active,
    ported,
    roaming,
    cnam,
    networkCode,
    hlrSource: 'telnyx',
    rawJson: d,
  };
}
