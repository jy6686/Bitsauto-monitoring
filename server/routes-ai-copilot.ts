/**
 * AI Route Copilot — Express route registration
 * POST /api/ai/route-copilot — run analysis, return ranked recommendations
 * GET  /api/ai/route-copilot/status — engine health check
 */

import type { Express } from "express";
import { runRouteCopilot } from "./services/ai/route-copilot";

type RequireRoleFn = (roles: string[], req: any, res: any, next: any) => void;

// vendorPrefixData is passed in from the main routes.ts context (has access to cdrCache)
// or set to null to skip Q-Score layer gracefully
let _getCdrBasedPrefixData: (() => Promise<any>) | null = null;
export function setVendorPrefixDataProvider(fn: () => Promise<any>) {
  _getCdrBasedPrefixData = fn;
}

export function registerAiCopilotRoutes(app: Express, requireRole: RequireRoleFn) {
  // ── POST /api/ai/route-copilot — run copilot analysis ──────────────────────
  app.post(
    "/api/ai/route-copilot",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (_req: any, res: any) => {
      try {
        // Try to load vendor prefix intelligence (best-effort — not fatal if unavailable)
        let vendorPrefixData: any = null;
        try {
          if (_getCdrBasedPrefixData) {
            vendorPrefixData = await _getCdrBasedPrefixData();
          }
        } catch {
          // CDR cache may not be populated yet — skip Q-Score layer
        }

        const result = await runRouteCopilot(vendorPrefixData);
        res.json({ success: true, data: result });
      } catch (err: any) {
        console.error("[ai-copilot] Error:", err.message);
        res.status(500).json({ success: false, error: err.message ?? "Analysis failed" });
      }
    },
  );

  // ── GET /api/ai/route-copilot/status ────────────────────────────────────────
  app.get(
    "/api/ai/route-copilot/status",
    (req: any, res: any, next: any) => requireRole(["admin", "management"], req, res, next),
    async (_req: any, res: any) => {
      const hasOpenAI = !!process.env.OPENAI_API_KEY;
      res.json({
        available: true,
        aiEnhanced: hasOpenAI,
        mode: hasOpenAI ? "rule-based + openai" : "rule-based",
      });
    },
  );
}
