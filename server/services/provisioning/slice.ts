/**
 * slice.ts — the Sprint 2.3A vertical slice.
 *
 * Runs a REAL provisioning pipeline end to end, but only over the stages that are
 * implemented and verifiable today: preflight → tariff → service plan → account → stop.
 *
 * The point is not speed. It exercises the parts that are hardest to get right —
 * orchestration, job lifecycle, stage persistence, idempotent retry, read-back
 * verification, failure handling, audit and authorisation — against real Sippy, before
 * the engine is responsible for a fully live customer. The remaining stages reuse the
 * same pattern, so they inherit whatever this proves.
 *
 * tariff and service_plan are included even though company creation already makes them:
 * both steps reuse-before-create, so on a normal run they verify the objects exist rather
 * than duplicating them. That is a free correctness check, not redundant work.
 *
 * Deliberately NOT wired into POST /api/companies/:id/provision — that endpoint is frozen
 * (docs/ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md §2). This is a separate path.
 */
import { db } from "../../db";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";
import { createRun, executeRun } from "./runner";
import { runPreflight, type PreflightResult } from "./preflight";
import { tariffStep } from "./steps/tariff.step";
import { servicePlanStep } from "./steps/service-plan.step";
import { accountStep } from "./steps/account.step";
import type { ProvisioningStep } from "./types";

/** Stages this slice executes. Extended one at a time per Sprint 2.3B..2.3F. */
export const SLICE_STEPS: ProvisioningStep[] = [tariffStep, servicePlanStep, accountStep];

/** Stages written but not yet in the pipeline — shown in the dry-run plan so an operator
 *  sees what is NOT yet automated rather than assuming full coverage. */
const NOT_YET_AUTOMATED = [
  "Authentication", "Routing", "IP authorisation", "Products",
  "Rates", "Capacity & media", "Traffic activation",
];

export interface SliceResult {
  dryRun: boolean;
  preflight: PreflightResult;
  plan?: { willRun: string[]; notYetAutomated: string[] };
  runRef?: string;
  runId?: number;
  status?: string;
  steps?: Array<{ key: string; status: string; error?: string }>;
}

export async function provisionSlice(opts: {
  companyId: number;
  actor: string;
  dryRun: boolean;
}): Promise<SliceResult> {
  const preflight = await runPreflight(opts.companyId);

  // Preflight gates BOTH modes. A dry run that skipped validation would report a plan
  // that cannot actually execute, which is worse than no dry run at all.
  if (!preflight.canProvision) {
    return {
      dryRun: opts.dryRun,
      preflight,
      plan: { willRun: [], notYetAutomated: NOT_YET_AUTOMATED },
    };
  }

  if (opts.dryRun) {
    return {
      dryRun: true,
      preflight,
      plan: {
        willRun: SLICE_STEPS.map(s => s.label),
        notYetAutomated: NOT_YET_AUTOMATED,
      },
    };
  }

  const [company]: any[] = await db.select().from(companies).where(eq(companies.id, opts.companyId));

  const { runId, runRef } = await createRun({
    companyId: opts.companyId,
    profileId: company?.provisioningProfileId ?? null,
    actor: opts.actor,
    steps: SLICE_STEPS,
    // Frozen snapshot: a retry replays identical input rather than re-reading mutable
    // company state that may have changed since the run started.
    input: {
      companyName: company?.name ?? "",
      currency: company?.currency ?? "USD",
      username: company?.shortCode?.toLowerCase() ?? undefined,
      iCustomer: 1,
      // Capacity and media come from the profile resolved at preparation. The engine
      // applies these; it does not choose them.
      maxSessions: company?.maxSessions ?? undefined,
      maxCps: company?.maxCps ?? undefined,
    },
  });

  // The runner resolves Sippy credentials itself from settings — one place that knows how
  // to authenticate, rather than each caller assembling its own credential bundle.
  const outcome = await executeRun(runId, SLICE_STEPS, { actor: opts.actor });

  return { dryRun: false, preflight, runRef, runId, status: outcome.status, steps: outcome.steps };
}
