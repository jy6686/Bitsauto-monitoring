/**
 * push-history-record.ts — a provisioning rates upload, recorded where operators look.
 *
 * Push History reads rate_push_jobs, and until 2026-09-15 only the Rate Manager paths
 * wrote there. A provisioning run that loaded 42 rates into tariff 68 (1global, run #32)
 * left no row, so the page said nothing had been pushed. The owner's decision: record it
 * as its own source — push_method 'provisioning_upload' — never dressed up as a Rate
 * Manager push. Retry does not apply to it (a provisioning upload is re-run from the
 * company card), and the retry route refuses it.
 *
 * Recording never fails the stage: the tariff already holds the rows, and a reporting
 * write that throws must not turn a successful upload into a failed run.
 */
import { db, pool } from "../../db";
import { ratePushJobs } from "@shared/schema";

export const PROVISIONING_PUSH_METHOD = "provisioning_upload";

export type ProvisioningUploadOutcome = "completed" | "failed" | "needs_review";

export interface ProvisioningPushInput {
  runId: number;
  companyName: string;
  iTariff: number;
  switchName: string;
  rows: Array<{ prefix: string; destinationName: string; productCode: string }>;
  byProduct: Array<{ code: string; count: number }>;
  outcome: ProvisioningUploadOutcome;
  /** The upload's own words — importer status, sampled read-back, or the refusal. */
  message: string;
  uploadStatus?: string | null;
  verified?: boolean;
  startedAt: Date;
  finishedAt: Date;
}

/** Join items until `max` characters, then say how many were left out. */
export function summarise(items: string[], max: number): string {
  const whole = items.join(", ");
  if (whole.length <= max) return whole;
  const out: string[] = [];
  let len = 0;
  for (const it of items) {
    const add = (out.length ? 2 : 0) + it.length;
    if (len + add > max - 8 && out.length) break;
    out.push(it); len += add;
  }
  const rest = items.length - out.length;
  const s = out.join(", ") + (rest > 0 ? ` +${rest}` : "");
  return s.length > max ? s.slice(0, max) : s;
}

/** Pure: the rate_push_jobs row for one provisioning upload. */
export function buildProvisioningPushRow(input: ProvisioningPushInput): typeof ratePushJobs.$inferInsert {
  const rows = input.rows.length;
  const prefixes = input.rows.map(r => r.prefix);
  const destinations = Array.from(new Set(input.rows.map(r => r.destinationName).filter(Boolean)));
  const productSummary = input.byProduct.map(p => `${p.code} ${p.count}`).join(" · ");
  const ok = input.outcome === "completed";
  return {
    jobId:              `prov-${input.runId}-rates`,
    productName:        productSummary.slice(0, 64),
    trunkPrefix:        null,
    format:             "full",
    rateType:           "current",
    // Operation count, matching how push-batch fills these three (see routes.ts).
    totalClients:       rows,
    pushedClients:      ok ? rows : 0,
    failedClients:      ok ? 0 : rows,
    status:             input.outcome,
    switchName:         input.switchName.slice(0, 128),
    iTariff:            input.iTariff,
    fullPrefix:         summarise(prefixes, 32),
    dialPrefix:         summarise(prefixes, 128),
    // The Dests column counts these names; a long list is cut at whole names, so the
    // count can read low — `notes` carries the true figure.
    destinationName:    summarise(destinations, 256),
    effectiveAt:        "immediate",
    createdBy:          "provisioning",
    clientNames:        input.companyName,
    notificationType:   null,
    pushMethod:         PROVISIONING_PUSH_METHOD,
    uploadStatus:       input.uploadStatus ?? null,
    verificationResult: ok ? (input.verified ? "verified" : "unverified") : (input.outcome === "needs_review" ? "unverified" : "refused"),
    errorMessage:       ok ? null : input.message.slice(0, 2000),
    notes:              `Provisioning run #${input.runId}: ${rows} row(s) across ${destinations.length} destination(s) → tariff ${input.iTariff} — ${productSummary} — ${input.message}`.slice(0, 2000),
    startedAt:          input.startedAt,
    completedAt:        input.finishedAt,
    lastStep:           input.outcome === "completed" ? "completed" : "failed",
    lastStepAt:         input.finishedAt,
  };
}

/** Best effort. Returns what happened so the step can print it; never throws. */
export async function recordProvisioningPush(input: Omit<ProvisioningPushInput, "companyName"> & { companyId: number }): Promise<{ ok: boolean; jobId: string; error?: string }> {
  const jobId = `prov-${input.runId}-rates`;
  try {
    const { rows } = await pool.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [input.companyId]);
    const companyName = rows[0]?.name ?? `company ${input.companyId}`;
    const values = buildProvisioningPushRow({ ...input, companyName });
    await db.insert(ratePushJobs).values(values).onConflictDoNothing();
    return { ok: true, jobId };
  } catch (e: any) {
    return { ok: false, jobId, error: e?.message ?? String(e) };
  }
}
