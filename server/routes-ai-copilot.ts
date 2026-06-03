/**
 * AI Route Recommendations — Express route registration
 * POST /api/ai/route-recommendations        — run analysis, return ranked recommendations
 * GET  /api/ai/route-recommendations/status — engine health check
 * POST /api/ai/route-copilot/apply          — apply a recommendation (audit-logged)
 */

import type { Express } from "express";
import { runRouteCopilot, AiContractError } from "./services/ai/route-copilot";
import {
  createAction,
  approveAction,
} from "./action-store";
import {
  recommendationToActionType,
  buildSippyParams,
  computeIdempotencyKey,
  executeAction,
} from "./action-executor";

type RequireRoleFn = (roles: string[], req: any, res: any, next: any) => void;

// vendorPrefixData is injected from routes.ts which has access to cdrCache
let _getCdrBasedPrefixData: (() => Promise<any>) | null = null;
export function setVendorPrefixDataProvider(fn: () => Promise<any>) {
  _getCdrBasedPrefixData = fn;
}

export function registerAiCopilotRoutes(app: Express, requireRole: RequireRoleFn) {
  // ── POST /api/ai/route-recommendations ─────────────────────────────────────
  app.post(
    "/api/ai/route-recommendations",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (_req: any, res: any) => {
      // Attempt to load vendor prefix intelligence (Q-Score layer)
      let vendorPrefixData: any = null;
      try {
        if (_getCdrBasedPrefixData) {
          vendorPrefixData = await _getCdrBasedPrefixData();
        }
      } catch {
        // CDR cache not yet populated — Q-Score layer skipped, not fatal
      }

      try {
        const result = await runRouteCopilot(vendorPrefixData);
        res.json({ success: true, data: result });
      } catch (err: any) {
        if (err instanceof AiContractError) {
          // OpenAI malformed output, rate-limit, or timeout → 502
          console.error("[ai-recommendations] AI contract error:", err.message);
          return res.status(502).json({
            success: false,
            error: err.message,
            code: "AI_CONTRACT_ERROR",
          });
        }
        console.error("[ai-recommendations] Internal error:", err.message);
        res.status(500).json({ success: false, error: err.message ?? "Analysis failed" });
      }
    },
  );

  // ── GET /api/ai/route-recommendations/status ────────────────────────────────
  app.get(
    "/api/ai/route-recommendations/status",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    (_req: any, res: any) => {
      const hasOpenAI = !!process.env.OPENAI_API_KEY;
      res.json({
        available: true,
        aiEnhanced: hasOpenAI,
        mode: hasOpenAI ? "ai_enhanced" : "rule_based_preview",
        warning: hasOpenAI
          ? null
          : "OpenAI API key not configured — recommendations will be rule-based preview only",
      });
    },
  );

  // ── POST /api/ai/route-copilot/apply ───────────────────────────────────────
  // Applies a route copilot recommendation: creates an action record, executes
  // it (dry-run unless C2_EXECUTION_ENABLED=true), and records it to the audit
  // ledger. Admin/management roles only.
  app.post(
    "/api/ai/route-copilot/apply",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (req: any, res: any) => {
      const { recommendation, note } = req.body ?? {};

      if (!recommendation || !recommendation.id || !recommendation.action) {
        return res.status(400).json({ success: false, error: "recommendation.id and recommendation.action are required" });
      }

      // Derive actor identity from session
      const actor = req.user ?? {};
      const actorId   = String(actor.id ?? actor.userId ?? "system");
      const actorName = actor.name ?? actor.username ?? actor.email ?? "Operator";

      // Map recommendation to action type using dominant signal
      // Route copilot recs may carry a risk level; map it to a signal for the executor
      const dominantSignal =
        recommendation.fraudSignals &&
        (recommendation.fraudSignals.fasCount + recommendation.fraudSignals.irsfCount) > 0
          ? "fraud"
          : recommendation.risk === "high"
            ? "health"
            : "health";

      const actionType = recommendationToActionType(dominantSignal);

      // Use the currentVendor or rec.id as the entity identifier for routing actions
      const entityId   = recommendation.currentVendor ?? recommendation.id;
      const entityName = recommendation.currentVendor
        ? `Vendor: ${recommendation.currentVendor}`
        : recommendation.destination
          ? `Destination: ${recommendation.destination}`
          : "Route";

      const sippyParams = buildSippyParams(entityId, actionType);

      const idempotencyKey = computeIdempotencyKey(
        entityId,
        actionType,
        { recId: recommendation.id, action: recommendation.action },
      );

      try {
        // 1. Create the action record in the audit ledger
        const action = await createAction({
          accountId:         entityId,
          accountName:       entityName,
          actionType,
          primaryAction:     recommendation.action,
          recommendationRef: {
            id:             recommendation.id,
            action:         recommendation.action,
            confidence:     recommendation.confidence,
            risk:           recommendation.risk,
            expectedImpact: recommendation.expectedImpact,
            currentVendor:  recommendation.currentVendor,
            targetVendor:   recommendation.targetVendor,
            destination:    recommendation.destination,
            note:           note ?? null,
          },
          sippyParams:       sippyParams.params,
          requestedBy:       actorId,
          requestedByName:   actorName,
          idempotencyKey,
        });

        // 2. Execute (dry-run gate is inside executeAction)
        const execResult = await executeAction(action.id, sippyParams.params);

        // 3. Update the action record with execution outcome
        const newStatus = execResult.success
          ? (execResult.mode === "executed" ? "executed" : "dry_run_approved")
          : "failed";

        const updatedAction = await approveAction(
          action.id,
          actorId,
          actorName,
          {
            mode:              execResult.mode,
            success:           execResult.success,
            verificationState: execResult.verificationState,
            result:            execResult.result ?? null,
            error:             execResult.error ?? null,
            sippyMethod:       sippyParams.method,
            sippyNote:         sippyParams.note,
          },
          newStatus,
          execResult.verificationState,
        );

        console.log(
          `[ai-copilot/apply] rec=${recommendation.id} action=${action.id} ` +
          `mode=${execResult.mode} status=${newStatus} actor=${actorId}`,
        );

        return res.json({
          success:      true,
          actionId:     action.id,
          mode:         execResult.mode,
          status:       newStatus,
          sippyNote:    sippyParams.note,
          idempotent:   !!(action as any)._idempotent,
          updatedAction,
        });
      } catch (err: any) {
        console.error("[ai-copilot/apply] error:", err.message);
        return res.status(500).json({ success: false, error: err.message ?? "Apply failed" });
      }
    },
  );
}
