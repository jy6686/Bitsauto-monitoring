/**
 * AI Route Recommendations — Express route registration
 * POST /api/ai/route-recommendations — run analysis, return ranked recommendations
 * GET  /api/ai/route-recommendations/status — engine health check
 */

import type { Express } from "express";
import { runRouteCopilot, AiContractError } from "./services/ai/route-copilot";

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
}
