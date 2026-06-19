/**
 * Canonical ITU-T G.107 E-Model MOS computation — single source of truth.
 *
 * References:
 *   ITU-T G.107  — The E-model: a computational model for use in planning
 *   ITU-T G.114  — One-way delay requirements for voice
 *   ITU-T G.113  — Appendix I — Equipment impairment factors
 *   RFC 3611     — RTCP XR
 */

export type Codec = 'G.711' | 'G.729' | 'G.723.1' | 'GSM' | 'opus';

// Equipment impairment factor (Ie) per codec — ITU-T G.113 Appendix I
const IE_FACTORS: Record<Codec, number> = {
  'G.711':   0,   // PCM A-law / µ-law — reference codec
  'G.729':  11,   // CS-ACELP 8 kbps
  'G.723.1':19,   // ACELP 5.3/6.3 kbps
  'GSM':    10,   // Full-Rate GSM 06.10
  'opus':    7,   // Opus (conservative LB for narrowband VoIP mode)
};

// Burst loss tolerance for G.711 — ITU-T G.107 §B.7
const BPL = 17;

/**
 * Piecewise delay impairment Id from one-way delay Ta (ms) — ITU-T G.107 §B.5.
 *
 *   Ta < 150 ms  → 0
 *   150 ≤ Ta < 400 ms → linear with Heaviside at 177.3 ms
 *   Ta ≥ 400 ms  → 25 (hard cap per G.114)
 */
function delayImpairment(taMsOneWay: number): number {
  if (taMsOneWay < 150) return 0;
  if (taMsOneWay < 400)
    return 0.024 * taMsOneWay + 0.11 * (taMsOneWay > 177.3 ? taMsOneWay - 177.3 : 0);
  return 25;
}

/**
 * ITU-T G.107 R-factor → MOS polynomial.
 * Returns MOS clamped to [1.0, 4.5].
 */
export function rFactorToMOS(R: number): number {
  if (R <= 0)   return 1.0;
  if (R >= 100) return 4.5;
  const mos = 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6;
  return parseFloat(Math.max(1.0, Math.min(4.5, mos)).toFixed(2));
}

export interface ComputeMOSParams {
  /** One-way network delay in ms — use RTT ÷ 2 from probe measurements */
  oneWayDelayMs: number;
  /** Peak jitter in ms — jitter buffer ≈ half of peak is added to effective Ta */
  jitterMs?: number;
  /** Packet loss percentage in range 0–100 */
  packetLossPct?: number;
  /** VoIP codec — defaults to G.711 (Ie = 0) */
  codec?: Codec;
}

/**
 * Full ITU-T G.107 E-Model MOS computation.
 *
 * Formula:
 *   Ta = oneWayDelayMs + jitterMs × 0.5   (effective delay incl. jitter buffer)
 *   Id = delayImpairment(Ta)
 *   Ie = codec equipment impairment
 *   Ie,eff = Ie + (95 − Ie) × Ppl / (Ppl + Bpl)   (Markopoulou burst-loss model)
 *   R  = 93.2 − Id − Ie,eff
 *   MOS = 1 + 0.035R + R(R−60)(100−R) × 7×10⁻⁶
 *
 * Returns null when inputs are out of range (i.e. unusable measurement).
 */
export function computeMOS(params: ComputeMOSParams): number | null {
  const { oneWayDelayMs, jitterMs = 0, packetLossPct = 0, codec = 'G.711' } = params;
  if (oneWayDelayMs < 0 || oneWayDelayMs > 2000) return null;

  const Ta    = oneWayDelayMs + jitterMs * 0.5;
  const Id    = delayImpairment(Ta);
  const Ie    = IE_FACTORS[codec] ?? 0;
  const Ppl   = Math.max(0, Math.min(100, packetLossPct));
  const Ie_eff = Ppl > 0 ? Ie + (95 - Ie) * Ppl / (Ppl + BPL) : Ie;
  const R      = Math.max(0, Math.min(100, 93.2 - Id - Ie_eff));

  return rFactorToMOS(R);
}

/**
 * Estimate MOS from PDD (Post Dial Delay) as a signalling-delay proxy.
 *
 * ⚠️  PDD is a signalling metric, not an RTP metric.
 *     This estimate is appropriate only when no RTCP data is available.
 *     All callers should label the result as "est." in the UI.
 *
 * Uses the same ITU-T G.107 piecewise delay impairment curve as computeMOS(),
 * treating PDD as a proxy for one-way delay Ta.
 */
export function estimateMOSFromPDD(pddMs: number): number {
  if (pddMs <= 0) return 4.3; // No PDD → assume nominal conditions
  const Id = delayImpairment(pddMs);
  const R  = Math.max(0, Math.min(100, 93.2 - Id));
  return rFactorToMOS(R);
}

/**
 * Letter grade for a MOS value — consistent across all display surfaces.
 */
export function mosToGrade(mos: number): string {
  return mos >= 4.0 ? 'A' : mos >= 3.5 ? 'B' : mos >= 3.0 ? 'C' : mos >= 2.5 ? 'D' : 'F';
}
