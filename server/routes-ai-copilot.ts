/**
 * AI Route Recommendations — Express route registration
 * POST /api/ai/route-recommendations        — run analysis, return ranked recommendations
 * GET  /api/ai/route-recommendations/status — engine health check
 * POST /api/ai/route-copilot/apply          — apply a recommendation (audit-logged)
 * GET  /api/ai/route-copilot/summary        — lightweight NOC poll (no AI call)
 */

import type { Express } from "express";
import { runRouteCopilot, AiContractError } from "./services/ai/route-copilot";
import type { CopilotResult } from "./services/ai/route-copilot";
import {
  listActions,
  createAction,
  approveAction,
  getAction,
  rollbackAction,
  createRollbackEntry,
  verifyAction,
  listPendingApproval,
  setPendingApproval,
  atomicClaimPendingApproval,
  secondaryApproveAction,
  secondaryRejectAction,
  expireStaleApprovals,
} from "./action-store";
import {
  recommendationToActionType,
  buildSippyParams,
  buildRollbackParams,
  computeIdempotencyKey,
  executeAction,
  isExecutionEnabled,
  type ActionType,
  requiresDualApproval,
} from "./action-executor";
import { db } from "./db";
import { carrierQualityScores, fasEvents, irsfEvents, copilotResultCache, nocIncidents, nocIncidentEvents } from "../shared/schema";
import { desc, gte, sql } from "drizzle-orm";
import { broadcastRollbackFailureAlert, broadcastPendingApproval } from "./noc-ws";

type RequireRoleFn = (roles: string[], req: any, res: any, next: any) => void;

// vendorPrefixData is injected from routes.ts which has access to cdrCache
let _getCdrBasedPrefixData: (() => Promise<any>) | null = null;
export function setVendorPrefixDataProvider(fn: () => Promise<any>) {
  _getCdrBasedPrefixData = fn;
}

// ── Copilot summary in-memory TTL cache (2 min) ─────────────────────────────
// Eliminates redundant DB queries when multiple NOC operators poll simultaneously.
const SUMMARY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
let _summaryCache: { value: object; expiresAt: number } | null = null;

// ── Last CopilotResult in-memory cache (30 min) ──────────────────────────────
// Persists the most recent successful analysis so the page pre-populates on reload.
const COPILOT_RESULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
let _lastCopilotResult: { value: CopilotResult; expiresAt: number } | null = null;

export function invalidateCopilotSummaryCache(): void {
  _summaryCache = null;
  console.debug("[copilot-summary] Cache invalidated");
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
        // Store result in the 30-min in-memory cache so reloads pre-populate the panel
        _lastCopilotResult = { value: result, expiresAt: Date.now() + COPILOT_RESULT_TTL_MS };
        // Persist to DB so the cache survives server restarts / deployments
        try {
          await db.delete(copilotResultCache);
          await db.insert(copilotResultCache).values({ result: result as any, generatedAt: new Date() });
        } catch (dbErr: any) {
          console.warn("[ai-recommendations] DB cache write failed (non-fatal):", dbErr.message);
        }
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

  // ── GET /api/ai/route-copilot/cached ────────────────────────────────────────
  // Returns the last successful CopilotResult (within 30-min TTL) or 404.
  // Falls back to the DB-persisted cache when the in-memory cache is cold
  // (e.g. immediately after a server restart or deployment).
  app.get(
    "/api/ai/route-copilot/cached",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "noc"], req, res, next),
    async (_req: any, res: any) => {
      const now = Date.now();
      // ── 1. In-memory cache hit ────────────────────────────────────────────
      if (_lastCopilotResult && _lastCopilotResult.expiresAt > now) {
        return res.json({ success: true, data: _lastCopilotResult.value, cached: true, source: "memory" });
      }
      // ── 2. DB cache fallback ──────────────────────────────────────────────
      try {
        const rows = await db
          .select()
          .from(copilotResultCache)
          .orderBy(desc(copilotResultCache.generatedAt))
          .limit(1);

        if (rows.length > 0) {
          const row = rows[0];
          const ageMs = now - row.generatedAt.getTime();
          if (ageMs <= COPILOT_RESULT_TTL_MS) {
            // Re-warm in-memory cache so subsequent requests skip the DB
            const value = row.result as unknown as CopilotResult;
            _lastCopilotResult = { value, expiresAt: row.generatedAt.getTime() + COPILOT_RESULT_TTL_MS };
            return res.json({ success: true, data: value, cached: true, source: "db" });
          }
        }
      } catch (dbErr: any) {
        console.warn("[copilot-cached] DB fallback read failed (non-fatal):", dbErr.message);
      }
      return res.status(404).json({ success: false, error: "No cached result available" });
    },
  );

  // ── GET /api/ai/route-copilot/summary ───────────────────────────────────────
  // Lightweight NOC dashboard poll — pure DB query, no AI call, safe to run every 5 min.
  app.get(
    "/api/ai/route-copilot/summary",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "noc"], req, res, next),
    async (_req: any, res: any) => {
      try {
        // ── Cache check ──────────────────────────────────────────────────────
        const now = Date.now();
        if (_summaryCache && _summaryCache.expiresAt > now) {
          console.debug("[copilot-summary] Cache hit — serving cached result");
          return res.json(_summaryCache.value);
        }
        console.debug("[copilot-summary] Cache miss — running DB queries");

        const since24h = new Date(now - 24 * 60 * 60 * 1000);

        // Load latest 24h score per carrier
        const allScores = await db
          .select()
          .from(carrierQualityScores)
          .orderBy(desc(carrierQualityScores.lastComputedAt));

        const latestByCarrier = new Map<string, typeof allScores[number]>();
        for (const row of allScores) {
          if (row.windowHours === 24 && !latestByCarrier.has(row.carrierName)) {
            latestByCarrier.set(row.carrierName, row);
          }
        }
        const scores = [...latestByCarrier.values()];

        const criticalCarriers = scores.filter(
          s => (s.stabilityScore ?? 100) < 35 || (s.rollingAsr ?? 100) < 25,
        );
        const degradedCarriers = scores.filter(
          s => !criticalCarriers.includes(s) &&
            ((s.stabilityScore ?? 100) < 58 || (s.rollingAsr ?? 100) < 42),
        );

        // Fraud count (fast aggregate)
        const [fasCount, irsfCount] = await Promise.all([
          db.select({ n: sql<number>`count(*)` }).from(fasEvents).where(gte(fasEvents.detectedAt, since24h)),
          db.select({ n: sql<number>`count(*)` }).from(irsfEvents).where(gte(irsfEvents.detectedAt, since24h)),
        ]);
        const fraudEvents = Number(fasCount[0]?.n ?? 0) + Number(irsfCount[0]?.n ?? 0);

        const hasAlerts = criticalCarriers.length > 0 || degradedCarriers.length > 0;

        // Top action text + minimal recommendation for strip quick-apply
        let topAction: string | null = null;
        let topSignal: string | null = null;
        let topRecommendation: Record<string, unknown> | null = null;

        if (criticalCarriers.length > 0) {
          const worst = criticalCarriers.sort((a, b) => (a.stabilityScore ?? 100) - (b.stabilityScore ?? 100))[0];
          topAction = `Reroute traffic away from ${worst.carrierName} (stability: ${worst.stabilityScore?.toFixed(0) ?? "??"}/100)`;
          topSignal = `${criticalCarriers.length} critical carrier${criticalCarriers.length > 1 ? "s" : ""} detected`;
          topRecommendation = {
            id: `strip-reroute-${worst.carrierName}`,
            action: `Reroute traffic away from ${worst.carrierName}`,
            confidence: 82,
            risk: "high",
            source_mode: "rule_based",
            expectedImpact: `Stability ${worst.stabilityScore?.toFixed(0) ?? "??"}/100 — rerouting will reduce failed call exposure`,
            currentVendor: worst.carrierName,
            reasons: [
              worst.stabilityScore != null ? `Stability: ${worst.stabilityScore.toFixed(0)}/100 (critical threshold)` : null,
              worst.rollingAsr != null ? `Rolling ASR: ${worst.rollingAsr.toFixed(1)}%` : null,
              worst.trend === "degrading" ? "Trend: actively degrading" : null,
            ].filter(Boolean),
            simulate: { asrDelta: null, stabilityDelta: null, projectedAsr: null, projectedStability: null },
          };
        } else if (degradedCarriers.length > 0) {
          const worst = degradedCarriers.sort((a, b) => (a.stabilityScore ?? 100) - (b.stabilityScore ?? 100))[0];
          topAction = `Monitor or deprioritise ${worst.carrierName} (ASR: ${worst.rollingAsr?.toFixed(1) ?? "??"}%)`;
          topSignal = `${degradedCarriers.length} degraded carrier${degradedCarriers.length > 1 ? "s" : ""}`;
          topRecommendation = {
            id: `strip-deprioritise-${worst.carrierName}`,
            action: `Deprioritise ${worst.carrierName} routing by 20%`,
            confidence: 65,
            risk: "medium",
            source_mode: "rule_based",
            expectedImpact: `ASR ${worst.rollingAsr?.toFixed(1) ?? "?"}% — deprioritising reduces degraded traffic exposure`,
            currentVendor: worst.carrierName,
            reasons: [
              worst.stabilityScore != null ? `Stability: ${worst.stabilityScore.toFixed(0)}/100` : null,
              worst.rollingAsr != null ? `ASR: ${worst.rollingAsr.toFixed(1)}% — below acceptable threshold` : null,
            ].filter(Boolean),
            simulate: { asrDelta: null, stabilityDelta: null, projectedAsr: null, projectedStability: null },
          };
        } else if (fraudEvents > 3) {
          topAction = `Investigate carriers for elevated fraud signals (${fraudEvents} events in 24h)`;
          topSignal = `${fraudEvents} fraud events detected`;
        }

        const payload = {
          hasAlerts,
          criticalCount: criticalCarriers.length,
          degradedCount: degradedCarriers.length,
          fraudEvents,
          topAction,
          topSignal,
          topRecommendation,
          totalCarriers: scores.length,
          generatedAt: new Date().toISOString(),
        };

        // ── Store in cache ───────────────────────────────────────────────────
        _summaryCache = { value: payload, expiresAt: now + SUMMARY_CACHE_TTL_MS };

        res.json(payload);
      } catch (err: any) {
        console.error("[copilot-summary] Error:", err.message);
        res.status(500).json({ success: false, error: err.message ?? "Summary failed" });
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

  // ── GET /api/ai/route-copilot/execution-mode ────────────────────────────────
  // Returns whether the C2 execution gate is open (live) or closed (dry-run).
  // Safe for all management/noc roles — no sensitive data exposed.
  app.get(
    "/api/ai/route-copilot/execution-mode",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "noc"], req, res, next),
    (_req: any, res: any) => {
      const enabled = isExecutionEnabled();
      res.json({ enabled, mode: enabled ? "live" : "dry_run" });
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
      const { recommendation, note, source_mode } = req.body ?? {};

      if (!recommendation || !recommendation.id || !recommendation.action) {
        return res.status(400).json({ success: false, error: "recommendation.id and recommendation.action are required" });
      }

      // Validate source_mode if provided
      const validatedSourceMode: "ai_enhanced" | "rule_based" | undefined =
        source_mode === "ai_enhanced" || source_mode === "rule_based" ? source_mode : undefined;

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
            source_mode:    validatedSourceMode ?? null,
          },
          sippyParams:       sippyParams.params,
          requestedBy:       actorId,
          requestedByName:   actorName,
          idempotencyKey,
        });

        // 2. Four-eyes check — high-risk actions (ACCOUNT_FREEZE, ROUTE_BLOCK)
        //    when execution is live require a second operator to approve before
        //    the Sippy write fires. This check applies regardless of idempotency:
        //    - New action  → set pending_approval and return early
        //    - Idempotent action already in pending_approval → return that state (no re-execution)
        //    - Idempotent action in any other state → fall through to execute normally
        const isIdempotent = !!(action as any)._idempotent;

        // Idempotent re-submission when the existing action is still pending_approval:
        // do NOT bypass the gate — return the existing pending state.
        if (isIdempotent && action.status === 'pending_approval') {
          console.log(
            `[ai-copilot/apply] rec=${recommendation.id} action=${action.id} ` +
            `IDEMPOTENT_PENDING_APPROVAL — returning existing pending state actor=${actorId}`,
          );
          return res.json({
            success:                true,
            actionId:               action.id,
            mode:                   "pending_approval",
            status:                 "pending_approval",
            requiresSecondApproval: true,
            sippyNote:              sippyParams.note,
            idempotent:             true,
            updatedAction:          action,
          });
        }

        if (isExecutionEnabled() && requiresDualApproval(actionType) && !isIdempotent) {
          const pendingAction = await setPendingApproval(action.id, actorId, actorName);

          console.log(
            `[ai-copilot/apply] rec=${recommendation.id} action=${action.id} ` +
            `actionType=${actionType} DUAL_APPROVAL_REQUIRED actor=${actorId}`,
          );

          // Notify all connected management operators via WebSocket push
          try {
            broadcastPendingApproval({
              actionId:        action.id,
              actionType,
              accountName:     entityName,
              requestedByName: actorName,
              primaryAction:   recommendation.action,
            });
          } catch { /* non-fatal — operators can still poll the pending list */ }

          return res.json({
            success:                true,
            actionId:               action.id,
            mode:                   "pending_approval",
            status:                 "pending_approval",
            requiresSecondApproval: true,
            sippyNote:              sippyParams.note,
            idempotent:             false,
            updatedAction:          pendingAction,
          });
        }

        // 3. Execute (dry-run gate is inside executeAction)
        const execResult = await executeAction(action.id, sippyParams.method, sippyParams.params);

        // 4. Update the action record with execution outcome
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
          success:           true,
          actionId:          action.id,
          mode:              execResult.mode,
          status:            newStatus,
          sippyNote:         sippyParams.note,
          verificationState: execResult.verificationState,
          idempotent:        !!(action as any)._idempotent,
          updatedAction,
        });
      } catch (err: any) {
        console.error("[ai-copilot/apply] error:", err.message);
        return res.status(500).json({ success: false, error: err.message ?? "Apply failed" });
      }
    },
  );

  // ── GET /api/ai/route-copilot/applied-actions ────────────────────────────
  // Returns all account_actions that are executed + SUCCESS_CONFIRMED + not
  // rolled_back, with their recommendation rec ID extracted from the JSON column.
  // Used by the frontend to hydrate the Undo state across page reloads.
  app.get(
    "/api/ai/route-copilot/applied-actions",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "noc"], req, res, next),
    async (_req: any, res: any) => {
      try {
        const rows = await listActions({ status: "executed" });
        const eligible = rows
          .filter(
            (r: any) =>
              r.verification_state === "SUCCESS_CONFIRMED" &&
              r.action_type !== "ROLLBACK",
          )
          .map((r: any) => {
            const ref = r.recommendation_ref ?? {};
            return {
              actionId:          r.id,
              recId:             ref.id ?? null,
              accountId:         r.account_id,
              accountName:       r.account_name,
              actionType:        r.action_type,
              verificationState: r.verification_state,
              createdAt:         r.created_at,
            };
          })
          .filter((e: any) => !!e.recId);
        return res.json({ success: true, actions: eligible });
      } catch (err: any) {
        console.error("[ai-copilot/applied-actions] error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
      }
    },
  );

  // ── GET /api/ai/route-copilot/rollback-summary ───────────────────────────
  // Lightweight: returns count of actions rolled back in the last 24 h.
  app.get(
    "/api/ai/route-copilot/rollback-summary",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "noc"], req, res, next),
    async (_req: any, res: any) => {
      try {
        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        try {
          const r = await pool.query(`
            SELECT COUNT(*)::int AS count
            FROM account_actions
            WHERE action_type = 'ROLLBACK'
              AND created_at >= NOW() - INTERVAL '24 hours'
          `);
          return res.json({ success: true, count: r.rows[0]?.count ?? 0 });
        } finally {
          await pool.end();
        }
      } catch (err: any) {
        console.error("[ai-copilot/rollback-summary] error:", err.message);
        return res.status(500).json({ success: false, count: 0 });
      }
    },
  );

  // ── GET /api/ai/route-copilot/action-history ─────────────────────────────
  // Returns all non-ROLLBACK account_actions with their ROLLBACK sibling(s)
  // nested underneath. Supports ?filter=rolled_back|active, ?search=<text>,
  // ?dateFrom=<ISO>&dateTo=<ISO> for server-side filtering.
  app.get(
    "/api/ai/route-copilot/action-history",
    (req: any, res: any, next: any) => requireRole(["admin", "management", "noc"], req, res, next),
    async (req: any, res: any) => {
      try {
        const filter   = req.query.filter   as string | undefined;
        const search   = req.query.search   as string | undefined;
        const dateFrom = req.query.dateFrom as string | undefined;
        const dateTo   = req.query.dateTo   as string | undefined;

        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        try {
          const whereClauses: string[] = ["a.action_type != 'ROLLBACK'"];
          const params: any[] = [];

          if (filter === "rolled_back") {
            whereClauses.push("a.status = 'rolled_back'");
          } else if (filter === "active") {
            whereClauses.push("a.status = 'executed'");
          }

          if (search && search.trim()) {
            params.push(`%${search.trim().toLowerCase()}%`);
            const p = params.length;
            whereClauses.push(
              `(LOWER(a.account_name) LIKE $${p} OR LOWER(a.action_type) LIKE $${p} OR LOWER(COALESCE(a.requested_by_name, a.requested_by, '')) LIKE $${p} OR LOWER(COALESCE(a.approved_by_name, a.approved_by, '')) LIKE $${p})`,
            );
          }

          if (dateFrom) {
            params.push(dateFrom);
            whereClauses.push(`a.created_at >= $${params.length}`);
          }

          if (dateTo) {
            // Include the full end day by adding 1 day
            params.push(dateTo);
            whereClauses.push(`a.created_at < ($${params.length}::date + INTERVAL '1 day')`);
          }

          const where = "WHERE " + whereClauses.join(" AND ");
          const r = await pool.query(`
            SELECT
              a.*,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id',                 rb.id,
                    'action_type',        rb.action_type,
                    'status',             rb.status,
                    'primary_action',     rb.primary_action,
                    'requested_by',       rb.requested_by,
                    'requested_by_name',  rb.requested_by_name,
                    'verification_state', rb.verification_state,
                    'created_at',         rb.created_at,
                    'updated_at',         rb.updated_at,
                    'recommendation_ref', rb.recommendation_ref,
                    'sippy_result',       rb.sippy_result
                  ) ORDER BY rb.created_at ASC
                ) FILTER (WHERE rb.id IS NOT NULL),
                '[]'::json
              ) AS rollbacks
            FROM account_actions a
            LEFT JOIN account_actions rb
              ON rb.action_type = 'ROLLBACK'
             AND (rb.recommendation_ref->>'originalActionId')::int = a.id
            ${where}
            GROUP BY a.id
            ORDER BY a.created_at DESC
            LIMIT 500
          `, params);
          return res.json({ success: true, actions: r.rows });
        } finally {
          await pool.end();
        }
      } catch (err: any) {
        console.error("[ai-copilot/action-history] error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
      }
    },
  );

  // ── GET /api/ai/actions/pending ─────────────────────────────────────────────
  // Lists all actions in pending_approval state (awaiting second operator).
  // Management role required — these are the reviewers.
  // Each action is enriched with expires_at (computed from updated_at + TTL).
  app.get(
    "/api/ai/actions/pending",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (_req: any, res: any) => {
      try {
        const ttlMinutes = parseInt(process.env.DUAL_APPROVAL_TTL_MINUTES ?? '30', 10);
        const ttlMs = ttlMinutes * 60_000;
        const rows = await listPendingApproval();
        const enriched = rows.map((r: any) => ({
          ...r,
          expires_at: new Date(new Date(r.updated_at).getTime() + ttlMs).toISOString(),
          ttl_minutes: ttlMinutes,
        }));
        res.json({ success: true, data: enriched });
      } catch (err: any) {
        console.error("[ai-actions/pending] error:", err.message);
        res.status(500).json({ success: false, error: err.message ?? "List failed" });
      }
    },
  );

  // ── POST /api/ai/route-copilot/rollback/:actionId ────────────────────────
  // One-click rollback for a previously executed (SUCCESS_CONFIRMED) action.
  // Derives the inverse Sippy params, executes them, and logs the rollback
  // as a sibling ROLLBACK entry in the audit ledger.
  app.post(
    "/api/ai/route-copilot/rollback/:actionId",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (req: any, res: any) => {
      const actionId = parseInt(req.params.actionId, 10);
      if (isNaN(actionId)) {
        return res.status(400).json({ success: false, error: "Invalid actionId" });
      }

      const action = await getAction(actionId);
      if (!action) {
        return res.status(404).json({ success: false, error: "Action not found" });
      }

      if (action.verification_state !== "SUCCESS_CONFIRMED") {
        return res.status(409).json({
          success: false,
          error: `Only SUCCESS_CONFIRMED actions can be rolled back (current: ${action.verification_state})`,
        });
      }

      if (action.status === "rolled_back") {
        return res.status(409).json({ success: false, error: "Action has already been rolled back" });
      }

      const actor     = req.user ?? {};
      const actorId   = String(actor.id ?? actor.userId ?? "system");
      const actorName = actor.name ?? actor.username ?? actor.email ?? "Operator";
      const reason    = typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;

      const rollbackSippy = buildRollbackParams(
        action.account_id,
        action.action_type as ActionType,
      );

      // Gate: rollback requires live execution — the execution gate must be open.
      // Dry-run mode would not actually undo anything in Sippy, so marking the
      // original action as rolled_back would be incorrect.
      if (!isExecutionEnabled()) {
        return res.status(422).json({
          success: false,
          error:   "Rollback requires live execution (C2_EXECUTION_ENABLED=true). The execution gate is currently closed.",
        });
      }

      // Gate: non-reversible action types (ROUTE_BLOCK, MANUAL) have method:'none'.
      // We must NOT mark the original as rolled_back — operator must restore manually in Sippy.
      if (!rollbackSippy.method || rollbackSippy.method === "none") {
        const errMsg = "This action type cannot be automatically reversed — manual restoration required in Sippy.";
        // Emit persistent NOC alert so all operators know manual intervention is needed
        try {
          const [inc] = await db.insert(nocIncidents).values({
            title:           `Rollback requires manual action — ${action.account_name} (Action #${actionId})`,
            type:            "rollback_failure",
            severity:        "critical",
            status:          "open",
            entityType:      "account",
            entityId:        String(action.account_id),
            entityName:      action.account_name,
            description:     `Action #${actionId} (${action.action_type}) cannot be automatically reversed. Operator must restore settings manually in Sippy.\n\nRollback note: ${rollbackSippy.note ?? "No additional details."}`,
            suggestedAction: "Log into Sippy and manually revert the route/block change for this account.",
            source:          "system",
          }).returning();
          await db.insert(nocIncidentEvents).values({
            incidentId: inc.id,
            eventType:  "opened",
            toStatus:   "open",
            actorName:  actorName,
            note:       `Auto-raised: rollback of action #${actionId} for ${action.account_name} requires manual Sippy intervention.`,
          });
          broadcastRollbackFailureAlert({
            actionId,
            accountName:    action.account_name,
            errorMessage:   errMsg,
            manualRequired: true,
            occurredAt:     new Date().toISOString(),
          });
        } catch (nocErr: any) {
          console.error("[ai-copilot/rollback] Failed to create NOC incident for manual rollback:", nocErr.message);
        }
        return res.status(422).json({
          success:        false,
          error:          errMsg,
          rollbackNote:   rollbackSippy.note,
          manualRequired: true,
        });
      }

      // Execute the inverse Sippy operation
      const execResult = await executeAction(actionId, rollbackSippy.method, rollbackSippy.params);

      const verificationState = execResult.verificationState;

      // Gate: if the Sippy write failed, surface the error and do NOT transition
      // the original action to rolled_back — the live state may still be unchanged.
      if (!execResult.success || execResult.mode !== "executed") {
        const errMsg = execResult.error ?? "Rollback did not execute against Sippy";
        console.error(
          `[ai-copilot/rollback] action=${actionId} rollback execution failed/not-live: ${errMsg}`,
        );
        // Emit persistent NOC alert so all operators know live state may be inconsistent
        try {
          const [inc] = await db.insert(nocIncidents).values({
            title:           `Rollback FAILED — ${action.account_name} (Action #${actionId})`,
            type:            "rollback_failure",
            severity:        "critical",
            status:          "open",
            entityType:      "account",
            entityId:        String(action.account_id),
            entityName:      action.account_name,
            description:     `Rollback of action #${actionId} (${action.action_type}) failed to execute against Sippy. The live routing state may still reflect the original change.\n\nError: ${errMsg}`,
            suggestedAction: "Check Sippy connectivity and verify the route state manually. Re-attempt rollback once connectivity is restored.",
            source:          "system",
          }).returning();
          await db.insert(nocIncidentEvents).values({
            incidentId: inc.id,
            eventType:  "opened",
            toStatus:   "open",
            actorName:  actorName,
            note:       `Auto-raised: rollback execution failed for action #${actionId} — ${errMsg}`,
          });
          broadcastRollbackFailureAlert({
            actionId,
            accountName:    action.account_name,
            errorMessage:   errMsg,
            manualRequired: false,
            occurredAt:     new Date().toISOString(),
          });
        } catch (nocErr: any) {
          console.error("[ai-copilot/rollback] Failed to create NOC incident for failed rollback:", nocErr.message);
        }
        return res.status(500).json({
          success:           false,
          error:             errMsg,
          rollbackNote:      rollbackSippy.note,
          verificationState,
        });
      }

      // Execution confirmed live — create sibling ROLLBACK row + append ledger event.
      // This step is MANDATORY: if it fails we return an error and do NOT transition
      // the original action, so the audit state remains consistent.
      await createRollbackEntry({
        originalActionId:  actionId,
        accountId:         action.account_id,
        accountName:       action.account_name,
        rollbackNote:      rollbackSippy.note,
        sippyResult:       {
          mode:              execResult.mode,
          success:           execResult.success,
          verificationState: execResult.verificationState,
          result:            execResult.result ?? null,
          error:             execResult.error  ?? null,
        },
        executedBy:        actorId,
        executedByName:    actorName,
        verificationState: String(verificationState),
        reason,
      });

      // Mark original action as rolled_back only after audit entry is committed
      await rollbackAction(actionId, actorId, actorName, reason);

      console.log(
        `[ai-copilot/rollback] action=${actionId} rollback mode=${execResult.mode} ` +
        `success=${execResult.success} verification=${verificationState} actor=${actorId}`,
      );

      return res.json({
        success:           true,
        actionId,
        rollbackNote:      rollbackSippy.note,
        mode:              execResult.mode,
        execSuccess:       execResult.success,
        verificationState,
        error:             null,
      });
    },
  );

  // ── PATCH /api/ai/actions/:id/verify ────────────────────────────────────────
  // Re-reads Sippy account state for an UNKNOWN_PENDING action and updates the
  // verification_state. Only applies when the action is in executed status and
  // verification_state is UNKNOWN_PENDING.
  app.patch(
    "/api/ai/actions/:id/verify",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (req: any, res: any) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, error: "Invalid action id" });
      }

      const existing = await getAction(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: "Action not found" });
      }
      if (existing.verification_state !== "UNKNOWN_PENDING") {
        return res.json({
          success: true,
          alreadyResolved: true,
          action: existing,
          message: `Verification state is already ${existing.verification_state} — no re-check needed`,
        });
      }

      const actor     = req.user ?? {};
      const actorId   = String(actor.id ?? actor.userId ?? "system");
      const actorName = actor.name ?? actor.username ?? actor.email ?? "Operator";

      try {
        const updated = await verifyAction(id, actorId, actorName);
        console.log(
          `[ai-copilot/verify] action=${id} old=UNKNOWN_PENDING new=${updated?.verification_state} actor=${actorId}`,
        );
        return res.json({ success: true, action: updated });
      } catch (err: any) {
        console.error("[ai-copilot/verify] error:", err.message);
        return res.status(500).json({ success: false, error: err.message ?? "Verify failed" });
      }
    },
  );

  // ── POST /api/ai/actions/:id/approve ────────────────────────────────────────
  // Second-operator approval or rejection of a pending_approval action.
  // Body: { decision: "approve" | "reject", reason?: string }
  // - approve → fires executeAction against Sippy and transitions to executed/failed
  // - reject  → transitions to rejected with optional reason note
  // Management role required; the actor must not be the original requestor.
  app.post(
    "/api/ai/actions/:id/approve",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (req: any, res: any) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid action id" });

      const { decision, reason } = req.body ?? {};
      if (decision !== "approve" && decision !== "reject") {
        return res.status(400).json({ success: false, error: 'decision must be "approve" or "reject"' });
      }

      const actor     = req.user ?? {};
      const actorId   = String(actor.id ?? actor.userId ?? "system");
      const actorName = actor.name ?? actor.username ?? actor.email ?? "Operator";

      try {
        // ── Re-fetch action to get requested_by for self-actor check ────────────
        const actionMeta = await getAction(id);
        if (!actionMeta) {
          return res.status(404).json({ success: false, error: "Action not found" });
        }

        // Two-person rule: the actor must not be the same as the original requestor,
        // regardless of whether the decision is approve OR reject.
        if (actionMeta.requested_by && actionMeta.requested_by === actorId) {
          return res.status(403).json({
            success: false,
            error:   "Self-action not permitted — a different operator must approve or reject",
          });
        }

        if (decision === "reject") {
          // secondaryRejectAction guards status='pending_approval' internally.
          const updated = await secondaryRejectAction(id, actorId, actorName, reason ?? "");
          if (!updated) {
            return res.status(409).json({ success: false, error: "Action is no longer in pending_approval state" });
          }
          console.log(`[ai-actions/approve] action=${id} REJECTED by ${actorId}`);
          return res.json({ success: true, status: "rejected", updatedAction: updated });
        }

        // decision === "approve":
        // ── Atomic claim — prevents two concurrent approvers from both executing ─
        // atomicClaimPendingApproval does a single conditional UPDATE WHERE
        // status='pending_approval', returning the row only on success.
        // If another request already claimed the action, this returns null → 409.
        const claimed = await atomicClaimPendingApproval(id, actorId, actorName);
        if (!claimed) {
          return res.status(409).json({
            success: false,
            error:   "Action is no longer in pending_approval state (already claimed or resolved)",
          });
        }

        // ── Fire Sippy write ────────────────────────────────────────────────────
        const actionType  = claimed.action_type as string;
        const sippyParams = buildSippyParams(claimed.account_id, actionType as any);
        const execResult  = await executeAction(id, sippyParams.method, sippyParams.params);

        const newStatus = execResult.success
          ? (execResult.mode === "executed" ? "executed" : "dry_run_approved")
          : "failed";

        const updatedAction = await secondaryApproveAction(
          id,
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
          `[ai-actions/approve] action=${id} APPROVED by ${actorId} ` +
          `mode=${execResult.mode} status=${newStatus}`,
        );

        return res.json({
          success:      true,
          status:       newStatus,
          mode:         execResult.mode,
          sippyNote:    sippyParams.note,
          updatedAction,
        });
      } catch (err: any) {
        console.error(`[ai-actions/approve] action=${id} error:`, err.message);
        return res.status(500).json({ success: false, error: err.message ?? "Approval failed" });
      }
    },
  );

  // ── Approval expiry background job ──────────────────────────────────────────
  // Runs every 60 seconds. Sweeps for pending_approval actions older than
  // DUAL_APPROVAL_TTL_MINUTES (default 30) and transitions them to 'rejected'.
  const EXPIRY_SWEEP_INTERVAL_MS = 60_000;
  setInterval(async () => {
    try {
      const expired = await expireStaleApprovals();
      if (expired > 0) {
        console.log(`[approval-expiry] Swept ${expired} stale pending approval(s) to rejected`);
        invalidateCopilotSummaryCache();
      }
    } catch (err: any) {
      console.warn('[approval-expiry] Sweep error (non-fatal):', err.message);
    }
  }, EXPIRY_SWEEP_INTERVAL_MS);

  console.log(
    `[approval-expiry] Background job registered — sweeping every 60s, ` +
    `TTL=${process.env.DUAL_APPROVAL_TTL_MINUTES ?? '30'}m (DUAL_APPROVAL_TTL_MINUTES)`,
  );
}
