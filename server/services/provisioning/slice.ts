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
import { authenticationStep } from "./steps/authentication.step";
import { capacityStep } from "./steps/capacity.step";
import { ratesStep } from "./steps/rates.step";
import { accountEmailStep } from "./steps/account-email.step";
import type { ProvisioningStep } from "./types";
import { writeAudit } from "../../audit";

/** Stages this slice executes. Extended one at a time per Sprint 2.3B..2.3F. */
// ratesStep LAST and non-blocking: its rows go into the tariff the account references, so
// everything above it must exist and be verified first, and a customer with a working
// account but no rates is recoverable from Rate Manager in minutes — worse to abort a run
// that has already built the account, authentication and capacity.
// accountEmailStep LAST (order 100) and non-blocking. It used to run in a detached
// `.then()` after the run resolved, gated on the status being 'completed' or
// 'completed_with_warnings' — so its outcome never appeared on the card and an operator
// could not tell whether the customer had their credentials. A last-ordered step is the
// same gate expressed by the framework: the runner halts on a blocking failure, so this
// cannot run when the account is not live, and an earlier non-blocking failure does not
// stop it.
export const SLICE_STEPS: ProvisioningStep[] = [tariffStep, servicePlanStep, accountStep, authenticationStep, capacityStep, ratesStep, accountEmailStep];

/** Stages written but not yet in the pipeline — shown in the dry-run plan so an operator
 *  sees what is NOT yet automated rather than assuming full coverage. */
// "Routing" is no longer listed here: routing group assignment is not a separate stage in
// Sippy. Every authentication rule carries its own i_routing_group, resolved from the
// routing package matrix, so the authentication stage applies routing as it applies
// authentication. Routing group CREATION stays manual by design — which groups exist is a
// network design decision made in Routing Manager, not something provisioning should invent.
// Products are likewise not a stage: a product is the digit inside each rule's incoming CLD.
const NOT_YET_AUTOMATED = [
  "Media (codec / relay)", "Traffic activation",
];

export interface SliceResult {
  dryRun: boolean;
  preflight: PreflightResult;
  plan?: { willRun: string[]; notYetAutomated: string[] };
  runRef?: string;
  /** Poll GET /api/provisioning/jobs/:jobId for progress. */
  runId?: number;
  status?: string;
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
  // ── Fire and forget ───────────────────────────────────────────────────────
  // The caller gets a job id immediately and polls. Provisioning is not a 2-second
  // request: it retries, waits on Sippy, and will grow to a dozen stages — holding an
  // HTTP connection open for that is a design that fails on the first slow switch call.
  //
  // Errors are swallowed into the run record rather than escaping: an unhandled rejection
  // from a detached promise would take the process down, and the failure is already
  // durable in provisioning_steps.
  void executeRun(runId, SLICE_STEPS, { actor: opts.actor })
    .then(async (result) => {
      // The send itself moved into accountEmailStep so its outcome lands on the card with
      // every other stage. Sending here as well would email the customer twice.
      //
      // The AUDIT stays, because it answers a different question from the run record: "was
      // this customer ever sent their credentials, and when" is asked months later, long
      // after anyone is looking at a provisioning run.
      const email = result.steps?.find(s => s.key === 'account_email');
      if (!email) return;
      void writeAudit({
        category: 'operational', action: 'company.account_details_emailed',
        actor: opts.actor, actorType: 'user',
        targetType: 'company', targetId: String(opts.companyId),
        metadata: { runRef, sent: email.status === 'success', error: email.error ?? null },
      });
    })
    .catch(e => console.error(`[provisioning] ${runRef} run failed outside step handling:`, e?.message));

  return { dryRun: false, preflight, runRef, runId, status: 'queued' };
}
