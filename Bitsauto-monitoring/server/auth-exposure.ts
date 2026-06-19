/**
 * Auth Exposure Scorer (B2)
 *
 * Computes a structural vulnerability score per account by analyzing Sippy auth rules:
 * IP restriction breadth, CLI/CLD authentication presence, access breadth, and config misalignment.
 *
 * Output stored in account_state:
 *   authExposureScore   — 0–100 (higher = more exposed)
 *   exposureRiskLevel   — low | medium | high | critical
 *   authExposureSignals — breakdown of contributing sub-scores + human-readable signals
 *
 * Runs on a 6-hour interval (separate from the 15-min CDR pipeline) to minimise Sippy API load.
 */

import { db } from "./db";
import { accountState } from "@shared/schema";
import { listSippyAuthRules } from "./sippy";
import type { SippyAuthRule } from "./sippy";
import { eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthExposureSignals {
  ipRisk:             number;
  authWeakness:       number;
  accessBreadth:      number;
  configMisalignment: number;
  signals:            string[];
}

interface SippySettings {
  portalUrl?:        string | null;
  apiAdminUsername?: string | null;
  apiAdminPassword?: string | null;
  portalUsername?:   string | null;
  portalPassword?:   string | null;
  adminWebPassword?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cidrPrefixLength(ip: string): number | null {
  const slashMatch = /\/(\d+)$/.exec(ip);
  if (slashMatch) return parseInt(slashMatch[1], 10);
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return 32;
  return null;
}

function buildCredPairs(s: SippySettings): Array<{ username: string; password: string }> {
  const pairs: Array<{ username: string; password: string }> = [];
  const seen  = new Set<string>();
  const push  = (u: string, p: string) => {
    const k = `${u}\x00${p}`;
    if (seen.has(k) || !u || !p) return;
    seen.add(k);
    pairs.push({ username: u, password: p });
  };
  push(s.apiAdminUsername ?? '', s.apiAdminPassword ?? '');
  push(s.portalUsername   ?? '', s.portalPassword   ?? '');
  if (s.adminWebPassword) {
    push(s.apiAdminUsername ?? '', s.adminWebPassword);
    push(s.portalUsername   ?? '', s.adminWebPassword);
  }
  return pairs;
}

// ─── Scoring engine ───────────────────────────────────────────────────────────

function scoreAccount(rules: SippyAuthRule[]): {
  score:     number;
  riskLevel: string;
  signals:   AuthExposureSignals;
} {
  const signalMessages: string[] = [];

  // ── 1. ipRisk (0–40): How permissive are the IP restrictions? ────────────
  let ipRisk = 0;
  const ips  = rules.map(r => r.remoteIp).filter(Boolean) as string[];

  if (ips.length === 0) {
    ipRisk = 40;
    signalMessages.push('No IP restriction — account accepts calls from any source IP');
  } else {
    let broadestPrefix = 32;
    for (const ip of ips) {
      const pfx = cidrPrefixLength(ip);
      if (pfx !== null && pfx < broadestPrefix) broadestPrefix = pfx;
    }
    if      (broadestPrefix <= 16) { ipRisk = 35; signalMessages.push(`Broad IP range allowed (/${broadestPrefix} subnet — up to ${Math.pow(2, 32 - broadestPrefix).toLocaleString()} IPs)`); }
    else if (broadestPrefix <= 23) { ipRisk = 20; signalMessages.push(`Wide IP range (/${broadestPrefix} subnet)`); }
    else if (broadestPrefix <= 24) { ipRisk = 15; signalMessages.push('/24 subnet allowed (up to 256 source IPs)'); }
    else if (broadestPrefix < 32)  { ipRisk = 5; }
    // /32 (single host) → 0 risk
  }

  // ── 2. authWeakness (0–30): Is there CLI/CLD identity verification? ──────
  let authWeakness = 0;
  const hasCliRule  = rules.some(r => r.incomingCli && r.incomingCli.trim() !== '');
  const hasCldRule  = rules.some(r => r.incomingCld && r.incomingCld.trim() !== '');

  if (!hasCliRule && !hasCldRule) {
    if (ips.length === 0) {
      authWeakness = 30;
      signalMessages.push('No IP restriction AND no CLI/CLD authentication — fully open account');
    } else {
      authWeakness = 15;
      signalMessages.push('CLI/CLD pattern authentication not enforced — relies on IP only');
    }
  } else if (ips.length === 0) {
    authWeakness = 15;
    signalMessages.push('CLI/CLD auth present but no IP restriction');
  }

  // ── 3. accessBreadth (0–20): How many auth rules / source subnets? ───────
  let accessBreadth = 0;

  if (rules.length > 5) {
    accessBreadth = 20;
    signalMessages.push(`${rules.length} auth rules — large access surface`);
  } else if (rules.length > 3) {
    accessBreadth = 10;
    signalMessages.push(`${rules.length} auth rules configured`);
  }

  if (ips.length > 0) {
    const uniqueSubnets = [...new Set(ips.map(ip => ip.split('.').slice(0, 3).join('.')))];
    if (uniqueSubnets.length > 2 && accessBreadth < 15) {
      accessBreadth = Math.max(accessBreadth, 15);
      signalMessages.push(`Access permitted from ${uniqueSubnets.length} distinct subnets`);
    }
  }

  // ── 4. configMisalignment (0–15): Dangerous combinations ─────────────────
  let configMisalignment = 0;
  const hasUnlimitedCps  = rules.length === 0 || rules.some(r => r.maxCps === null || r.maxCps === undefined);

  if (hasUnlimitedCps && ips.length === 0) {
    configMisalignment = 15;
    signalMessages.push('Unlimited CPS + no IP restriction — maximum blast radius if compromised');
  } else if (hasUnlimitedCps && authWeakness > 10) {
    configMisalignment = 8;
    signalMessages.push('Unlimited CPS with weak authentication controls');
  }

  // ── Final score + risk level ──────────────────────────────────────────────
  const score     = Math.min(100, ipRisk + authWeakness + accessBreadth + configMisalignment);
  const riskLevel = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';

  return {
    score,
    riskLevel,
    signals: { ipRisk, authWeakness, accessBreadth, configMisalignment, signals: signalMessages },
  };
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function runAuthExposureScorer(
  settings: SippySettings,
): Promise<{ scored: number; errors: number }> {
  let scored = 0;
  let errors = 0;

  try {
    const accounts = await db.select({
      accountId:   accountState.accountId,
      accountName: accountState.accountName,
    }).from(accountState);

    if (accounts.length === 0) return { scored: 0, errors: 0 };

    const portalUrl  = settings.portalUrl || undefined;
    const credPairs  = buildCredPairs(settings);

    if (credPairs.length === 0) {
      console.warn('[auth-exposure] No credentials — skipping');
      return { scored: 0, errors: 1 };
    }

    for (const acct of accounts) {
      try {
        const iAccount = parseInt(acct.accountId, 10);
        if (isNaN(iAccount)) continue;

        let authRules: SippyAuthRule[] = [];

        // Try credential pairs in priority order
        for (const { username, password } of credPairs) {
          const result = await listSippyAuthRules(username, password, { iAccount }, portalUrl);
          if (result.authRules.length > 0 || !result.error) {
            authRules = result.authRules;
            break;
          }
        }

        const { score, riskLevel, signals } = scoreAccount(authRules);

        await db.update(accountState)
          .set({
            authExposureScore:   score,
            exposureRiskLevel:   riskLevel,
            authExposureSignals: signals,
          })
          .where(eq(accountState.accountId, acct.accountId));

        scored++;
      } catch (e: any) {
        console.error(`[auth-exposure] Error scoring ${acct.accountId}:`, e.message);
        errors++;
      }
    }

    console.log(`[auth-exposure] Scored ${scored} accounts (${errors} errors)`);
  } catch (e: any) {
    console.error('[auth-exposure] Fatal error:', e.message);
    errors++;
  }

  return { scored, errors };
}
