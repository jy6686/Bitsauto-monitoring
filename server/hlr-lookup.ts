/**
 * HLR / CNAM lookup module
 *
 * Supported providers
 *   telnyx     — Telnyx Number Lookup API (https://developers.telnyx.com/docs/api/v2/numbers/Number-Lookup)
 *                Returns carrier, line-type, portability, CNAM and roaming in one call.
 *
 *   hlrlookup  — HLR Lookup API v2 (https://www.hlrlookup.com/knowledge/url-structure)
 *                Needs api_key + api_secret.  Makes two calls: HLR (live status / carrier)
 *                + MNP (porting status).  Does NOT return CNAM — use CDR fallback for that.
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
  number:    string,
  provider:  string | null | undefined,
  apiKey:    string | null | undefined,
  apiSecret: string | null | undefined = undefined,
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

  if (provider === 'hlrlookup' && apiKey && apiSecret) {
    try {
      return await hlrLookupV2(e164, apiKey, apiSecret);
    } catch (err: any) {
      console.error('[HLR] HLRLookup lookup failed:', err?.message ?? err);
      return { ...EMPTY, hlrSource: 'hlrlookup_error' };
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

// ── HLR Lookup v2 ─────────────────────────────────────────────────────────────
// https://www.hlrlookup.com/knowledge/url-structure
// Two endpoints: /hlr (live status + carrier) and /mnp (porting).
// Does NOT provide CNAM — falls through to CDR-derived value.

const HLRLOOKUP_HLR_URL = 'https://api.hlrlookup.com/apiv2/hlr';
const HLRLOOKUP_MNP_URL = 'https://api.hlrlookup.com/apiv2/mnp';

const HLR_LINE_TYPE_MAP: Record<string, HLRResult['lineType']> = {
  MOBILE:    'mobile',
  LANDLINE:  'fixed',
  FIXED:     'fixed',
  VOIP:      'voip',
  PREMIUM:   'unknown',
  UNKNOWN:   'unknown',
};

async function hlrLookupV2(e164: string, apiKey: string, apiSecret: string): Promise<HLRResult> {
  // Strip leading '+' — API accepts E.164 without the plus
  const msisdn = e164.replace(/^\+/, '');

  const body = JSON.stringify({
    api_key:    apiKey,
    api_secret: apiSecret,
    requests: [
      {
        telephone_number: msisdn,
        get_landline_status: 'YES',
      },
    ],
  });

  // Run HLR and MNP calls in parallel
  const [hlrRes, mnpRes] = await Promise.all([
    fetch(HLRLOOKUP_HLR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(12000),
    }),
    fetch(HLRLOOKUP_MNP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(12000),
    }),
  ]);

  if (!hlrRes.ok) {
    const txt = await hlrRes.text().catch(() => '');
    throw new Error(`HLRLookup HLR HTTP ${hlrRes.status}: ${txt.slice(0, 200)}`);
  }

  const hlrJson = await hlrRes.json() as Record<string, any>;
  const hlrData = hlrJson?.body?.results?.[0] ?? hlrJson?.results?.[0] ?? {};

  // MNP result (best-effort — don't fail the whole lookup if MNP errors)
  let mnpData: Record<string, any> = {};
  if (mnpRes.ok) {
    try {
      const mnpJson = await mnpRes.json() as Record<string, any>;
      mnpData = mnpJson?.body?.results?.[0] ?? mnpJson?.results?.[0] ?? {};
    } catch (_) { /* ignore */ }
  }

  // live_status: "LIVE" | "ABSENT" | "NO_COVERAGE" | "NOT_AVAILABLE_NETWORK_ONLY" | "BAD_FORMAT"
  const liveStatus: string = (hlrData.live_status ?? '').toUpperCase();
  const active: boolean | null =
    liveStatus === 'LIVE'   ? true  :
    liveStatus === 'ABSENT' ? false :   // off/out-of-coverage — number exists but inactive
    liveStatus === 'BAD_FORMAT' ? null :
    liveStatus ? false : null;

  // Carrier — prefer current network (post-port), fall back to original
  const currentNet = hlrData.current_network_details ?? {};
  const origNet    = hlrData.original_network_details ?? {};
  const carrier: string | null =
    currentNet.name ?? origNet.name ?? null;

  // MCCMNC — "23433" style (5-6 digits)
  const mccmnc: string | null =
    currentNet.mccmnc ?? origNet.mccmnc ?? null;
  const networkCode: string | null = mccmnc ?? null;

  // Line type — telephone_number_type from HLR result
  const rawType: string = (hlrData.telephone_number_type ?? '').toUpperCase();
  const lineType: HLRResult['lineType'] = HLR_LINE_TYPE_MAP[rawType] ?? (rawType ? 'unknown' : null);

  // Roaming — HLR lookup provides this on some networks
  const roaming: boolean | null =
    hlrData.roaming === true  ? true  :
    hlrData.roaming === false ? false : null;

  // Porting — from MNP endpoint; is_ported: "YES" | "NO" | "UNKNOWN"
  const isPortedStr: string = (mnpData.is_ported ?? hlrData.is_ported ?? '').toUpperCase();
  const ported: boolean | null =
    isPortedStr === 'YES' ? true  :
    isPortedStr === 'NO'  ? false : null;

  return {
    carrier,
    lineType,
    active,
    ported,
    roaming,
    cnam: null,   // HLR Lookup does not provide CNAM — CDR-derived value will be used
    networkCode,
    hlrSource: 'hlrlookup',
    rawJson: { hlr: hlrData, mnp: mnpData },
  };
}
