/**
 * Identity investigation API — CAP-023 §12.
 *
 * A deterministic service, not an AI endpoint. Same evidence in, same verdict
 * out, every time. A language model may sit in front of this to phrase the
 * question and read back the answer; it never produces the verdict.
 *
 * POST /api/identity/investigate  — ask a bounded question of one result's evidence
 * GET  /api/identity/coverage     — how far evidence reaches, platform-wide
 */

import { db } from "./db";
import { routeTestResults } from "../shared/schema";
import { eq, gte, desc } from "drizzle-orm";
import { buildIdentityTimeline, IDENTITY_PATH } from "./services/identity/timeline";
import { investigate, investigateAll, type InvestigationQuestion } from "./services/identity/investigate";
import { narrateIdentity } from "./services/identity/narrate";
import type { CliComparison } from "./services/identity/cli";
import type { CldComparison } from "./services/identity/cld";

const QUESTIONS: InvestigationQuestion[] = [
  'what-happened',
  'can-i-blame-the-vendor',
  'can-i-blame-our-switch',
  'why-is-the-cld-different',
  'what-did-the-subscriber-see',
];

export function registerIdentityRoutes(app: any, requireRole: any): void {
  // ── POST /api/identity/investigate ───────────────────────────────────────
  app.post("/api/identity/investigate",
    (req: any, res: any, next: any) =>
      requireRole(["admin", "management", "routing_admin", "noc_operator"], req, res, next),
    async (req: any, res: any) => {
      try {
        const { resultId, question } = req.body ?? {};
        if (!resultId) return res.status(400).json({ success: false, error: "resultId is required" });
        if (question && !QUESTIONS.includes(question)) {
          return res.status(400).json({
            success: false,
            error: `Unknown question. The investigator answers a bounded set: ${QUESTIONS.join(", ")}.`,
          });
        }

        const [row] = await db.select().from(routeTestResults)
          .where(eq(routeTestResults.id, Number(resultId))).limit(1);
        if (!row) return res.status(404).json({ success: false, error: "result not found" });

        const cliEvidence = row.cliEvidence as CliComparison | null;
        const cldEvidence = row.cldEvidence as CldComparison | null;
        const cli = cliEvidence ? [cliEvidence] : [];
        const cld = cldEvidence ? [cldEvidence] : [];

        const timeline = buildIdentityTimeline({
          requestedCli: row.cliSent ?? null,
          requestedCld: row.destination ?? null,
          cli, cld,
          cliStages: cliEvidence ? ['Sippy ingress'] : [],
        });

        res.json({
          success: true,
          data: {
            resultId: row.id,
            observationCeiling: timeline.observationCeiling,
            timeline,
            narrative: narrateIdentity({ cli, cld }),
            answers: question
              ? [investigate({ timeline, cli, cld }, question)]
              : investigateAll({ timeline, cli, cld }),
          },
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

  // ── GET /api/identity/coverage ───────────────────────────────────────────
  // How far identity evidence reaches across recent tests. Each capability on
  // the CAP-023 roadmap raises this, which makes roadmap progress a measured
  // number rather than an assertion.
  app.get("/api/identity/coverage",
    (req: any, res: any, next: any) =>
      requireRole(["admin", "management", "routing_admin", "noc_operator"], req, res, next),
    async (_req: any, res: any) => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
        const rows = await db.select().from(routeTestResults)
          .where(gte(routeTestResults.startedAt, since))
          .orderBy(desc(routeTestResults.startedAt));

        const observedStages = new Set<string>();
        let withEvidence = 0;

        for (const r of rows) {
          const cliEvidence = r.cliEvidence as CliComparison | null;
          const cldEvidence = r.cldEvidence as CldComparison | null;
          if (!cliEvidence && !cldEvidence) continue;
          withEvidence++;
          const t = buildIdentityTimeline({
            requestedCli: r.cliSent ?? null,
            requestedCld: r.destination ?? null,
            cli: cliEvidence ? [cliEvidence] : [],
            cld: cldEvidence ? [cldEvidence] : [],
            cliStages: cliEvidence ? ['Sippy ingress'] : [],
          });
          for (const s of t.observedStages) observedStages.add(s);
        }

        const path = IDENTITY_PATH.map(p => ({
          stage: p.stage,
          level: p.level,
          observed: observedStages.has(p.stage),
        }));

        // The ceiling is the last CONTIGUOUS observed stage. An isolated
        // observation further along does not extend reach — the gap before it
        // is exactly what stops attribution.
        let ceiling: string | null = null;
        for (const p of path) {
          if (!p.observed) break;
          ceiling = p.level;
        }

        res.json({
          success: true,
          data: {
            windowDays: 7,
            testsWithIdentityEvidence: withEvidence,
            totalTests: rows.length,
            path,
            observationCeiling: ceiling,
            note:
              'Contiguous reach from the start of the path. Raising this is the measurable ' +
              'output of CAP-023 O2 packet capture, O3 terminating DID and O4 handset evidence.',
          },
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
}
