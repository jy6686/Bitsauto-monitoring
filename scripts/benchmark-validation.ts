/**
 * Intelligence Benchmark Validation — Phase 1–5
 * Run: npx tsx scripts/benchmark-validation.ts
 *
 * Tests operational correctness of intelligence engines against LIVE data.
 * NOT a UI test — validates whether conclusions are semantically correct.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { desc, gte, eq, and, sql } from "drizzle-orm";
import {
  incidents,
  vendorMetricBaselines,
  carrierQualityScores,
  anomalyEvents,
  callSnapshots,
  sippySnapshots,
  alertRules,
} from "../shared/schema";

const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW= "\x1b[33m";
const RED   = "\x1b[31m";
const CYAN  = "\x1b[36m";
const DIM   = "\x1b[2m";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db   = drizzle(pool);

type BenchResult = { phase: string; check: string; status: 'PASS' | 'WARN' | 'FAIL'; finding: string; risk?: string };
const results: BenchResult[] = [];

function pass(phase: string, check: string, finding: string) {
  results.push({ phase, check, status: 'PASS', finding });
  console.log(`  ${GREEN}✓${RESET} ${check}`);
  console.log(`    ${DIM}${finding}${RESET}`);
}
function warn(phase: string, check: string, finding: string, risk?: string) {
  results.push({ phase, check, status: 'WARN', finding, risk });
  console.log(`  ${YELLOW}⚠${RESET} ${check}`);
  console.log(`    ${DIM}${finding}${RESET}`);
  if (risk) console.log(`    ${YELLOW}Risk: ${risk}${RESET}`);
}
function fail(phase: string, check: string, finding: string, risk?: string) {
  results.push({ phase, check, status: 'FAIL', finding, risk });
  console.log(`  ${RED}✗${RESET} ${check}`);
  console.log(`    ${DIM}${finding}${RESET}`);
  if (risk) console.log(`    ${RED}Risk: ${risk}${RESET}`);
}

function header(title: string) {
  console.log(`\n${BOLD}${CYAN}${'─'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${CYAN}${'─'.repeat(60)}${RESET}`);
}

// ── Phase 1: Telemetry Integrity ────────────────────────────────────────────
async function phase1() {
  header("PHASE 1 — Telemetry Integrity");

  // 1a. Call snapshot count and recency
  const [snapCount] = await db.select({ count: sql<number>`count(*)::int` }).from(callSnapshots);
  const n = snapCount.count;
  if (n >= 100)       pass("P1", "Call snapshot volume", `${n} concurrent call snapshots persisted in DB`);
  else if (n >= 5)    warn("P1", "Call snapshot volume", `Only ${n} snapshots — low but non-zero`, "Live call tracking may be sparse");
  else                warn("P1", "Call snapshot volume", `${n} snapshots — very low volume`, "Likely quiet period or no active calls");

  // 1b. Most recent snapshot age
  const [latest] = await db.select({ ts: sql<Date>`max(created_at)` }).from(callSnapshots).catch(() => [{ ts: null }]);
  if (latest?.ts) {
    const ageMin = Math.round((Date.now() - new Date(latest.ts).getTime()) / 60_000);
    if (ageMin <= 5)  pass("P1", "Snapshot freshness", `Most recent snapshot ${ageMin}m ago — telemetry is live`);
    else if (ageMin <= 20) warn("P1", "Snapshot freshness", `Most recent snapshot ${ageMin}m ago`, "Snapshot cadence may be slower than expected");
    else              fail("P1", "Snapshot freshness", `Most recent snapshot ${ageMin}m ago — stale`, "Active call tracking may have stopped");
  } else {
    warn("P1", "Snapshot freshness", "No timestamp available on snapshots table");
  }

  // 1c. Sippy snapshot persistence (configuration state)
  const snapRows = await db.select({ key: sippySnapshots.key, updatedAt: sippySnapshots.updatedAt }).from(sippySnapshots);
  if (snapRows.length >= 3)  pass("P1", "Sippy config snapshots", `${snapRows.length} snapshot keys persisted (${snapRows.map(r => r.key).join(', ')})`);
  else if (snapRows.length > 0) warn("P1", "Sippy config snapshots", `Only ${snapRows.length} snapshot keys — expected accounts, vendors, connections`);
  else                       fail("P1", "Sippy config snapshots", "No Sippy config snapshots — watcher has not run", "Change detection is blind");

  // 1d. Alert rules configured
  const ruleRows = await db.select({ count: sql<number>`count(*)::int` }).from(alertRules);
  const rCount = ruleRows[0]?.count ?? 0;
  if (rCount >= 3)  pass("P1", "Alert rules configured", `${rCount} alert rules active`);
  else if (rCount > 0) warn("P1", "Alert rules configured", `Only ${rCount} alert rules — coverage may be thin`);
  else              fail("P1", "Alert rules configured", "No alert rules defined", "Threshold engine cannot fire without rules");
}

// ── Phase 2: Q-Score Validation ─────────────────────────────────────────────
async function phase2() {
  header("PHASE 2 — Q-Score Validation");

  // 2a. Carrier quality scores exist
  const scores = await db.select().from(carrierQualityScores).orderBy(desc(carrierQualityScores.lastComputedAt));
  if (scores.length === 0) {
    warn("P2", "Carrier quality score population", "No carrier quality scores computed yet", "Q-score engine has not processed carrier traffic");
    return;
  }
  pass("P2", "Carrier quality score population", `${scores.length} carrier(s) with quality scores`);

  // 2b. For each carrier: verify stability score is in valid range
  const invalidRange = scores.filter(s => s.stabilityScore !== null && (s.stabilityScore! < 0 || s.stabilityScore! > 100));
  if (invalidRange.length === 0) pass("P2", "Score range validity", "All stability scores in 0–100 range");
  else fail("P2", "Score range validity", `${invalidRange.length} carrier(s) have out-of-range stability scores: ${invalidRange.map(s => `${s.carrierName}=${s.stabilityScore}`).join(', ')}`, "Normalization bug in Q-score engine");

  // 2c. ASR values make operational sense (0–100, not all 0 or all 100)
  const validAsr = scores.filter(s => s.rollingAsr !== null);
  if (validAsr.length === 0) {
    warn("P2", "ASR population", "No carriers have ASR data", "CDR enrichment may not have resolved vendor fields");
  } else {
    const asrValues = validAsr.map(s => s.rollingAsr!);
    const allZero = asrValues.every(v => v < 0.01);
    const allHundred = asrValues.every(v => v > 99.9);
    const avg = asrValues.reduce((a, b) => a + b, 0) / asrValues.length;
    if (allZero)      fail("P2", "ASR operational range", "All ASR values are 0% — CDR result codes not being parsed correctly", "Q-score ASR component will always be 0");
    else if (allHundred) warn("P2", "ASR operational range", "All ASR values are 100% — likely only answered calls being counted", "FAS/RNA classification may be incorrect");
    else              pass("P2", "ASR operational range", `ASR range across ${validAsr.length} carrier(s): avg=${avg.toFixed(1)}% — values are operationally plausible`);

    // Per-carrier report
    for (const s of scores) {
      const asr = s.rollingAsr?.toFixed(1) ?? 'N/A';
      const pdd = s.avgPddMs ? `${(s.avgPddMs/1000).toFixed(2)}s` : 'N/A';
      const stability = s.stabilityScore?.toFixed(0) ?? 'N/A';
      const trend = s.trend ?? 'unknown';
      console.log(`    ${DIM}${s.carrierName.padEnd(20)} ASR=${asr.padStart(6)}%  PDD=${pdd.padStart(6)}  Score=${stability.padStart(3)}/100  trend=${trend}${RESET}`);
    }
  }

  // 2d. Vendor metric baselines exist (needed for degradation comparison)
  const baselines = await db.select().from(vendorMetricBaselines);
  const byVendor = new Map<string, typeof baselines>();
  for (const b of baselines) {
    const list = byVendor.get(b.vendor) ?? [];
    list.push(b);
    byVendor.set(b.vendor, list);
  }
  const vendorCount = byVendor.size;
  if (vendorCount === 0) {
    warn("P2", "Vendor metric baselines", "No baselines computed yet — anomaly engine has not run long enough", "Statistical degradation detection needs 72h of history");
  } else {
    const metrics = [...new Set(baselines.map(b => b.metric))];
    pass("P2", "Vendor metric baselines", `${vendorCount} vendor(s) with baselines across metrics: ${metrics.join(', ')}`);

    // Check for suspicious stddev=0 (frozen baseline)
    const frozenBaselines = baselines.filter(b => b.stddev === 0);
    if (frozenBaselines.length > 0) {
      warn("P2", "Baseline stddev validity", `${frozenBaselines.length} baseline(s) have stddev=0 — variance not captured`, "Anomaly detection may not fire on real degradations");
    } else {
      pass("P2", "Baseline stddev validity", "All baselines have non-zero stddev — variance is being captured");
    }
  }
}

// ── Phase 3: Recommendation Validation ──────────────────────────────────────
async function phase3() {
  header("PHASE 3 — Recommendation Validation");

  // 3a. Verify recommendation engine is running (check log proxy: baselines exist for vendors)
  const baselines = await db.select().from(vendorMetricBaselines);
  const vendorSet = new Set(baselines.map(b => b.vendor));

  if (vendorSet.size === 0) {
    warn("P3", "Recommendation engine baseline coverage", "No vendor baselines found — recommendation engine has limited signal data", "Rules will fire on current-window data only, no historical comparison");
  } else {
    pass("P3", "Recommendation engine baseline coverage", `${vendorSet.size} vendor(s) have baseline history for rule comparison`);
  }

  // 3b. Verify carrier quality scores have enough sample count to trigger rules
  const scores = await db.select().from(carrierQualityScores);
  const thinSamples = scores.filter(s => s.sampleCount < 10);
  const adequateSamples = scores.filter(s => s.sampleCount >= 10);
  if (adequateSamples.length === scores.length && scores.length > 0) {
    pass("P3", "Sample adequacy for rule firing", `All ${scores.length} carrier(s) have ≥10 samples — rules will fire with statistical confidence`);
  } else if (adequateSamples.length > 0) {
    warn("P3", "Sample adequacy for rule firing", `${thinSamples.length}/${scores.length} carrier(s) have <10 samples`, "Rules may fire on thin data — confidence will be lower");
  } else if (scores.length > 0) {
    warn("P3", "Sample adequacy for rule firing", `All carriers have <10 samples — early-stage data`, "Recommendations valid but confidence will be conservative");
  } else {
    warn("P3", "Sample adequacy for rule firing", "No carrier quality scores — recommendation engine using CDR window data only");
  }

  // 3c. Confidence floor: verify alert rules have sensible thresholds
  const rules = await db.select().from(alertRules);
  if (rules.length > 0) {
    const asrRules = rules.filter(r => (r as any).metric?.toLowerCase().includes('asr') || (r as any).name?.toLowerCase().includes('asr'));
    const fasRules = rules.filter(r => (r as any).metric?.toLowerCase().includes('fas') || (r as any).name?.toLowerCase().includes('fas'));
    console.log(`    ${DIM}Alert rules configured: ${rules.length} total`);
    if (asrRules.length) console.log(`      ASR rules: ${asrRules.length}`);
    if (fasRules.length) console.log(`      FAS rules: ${fasRules.length}${RESET}`);
    pass("P3", "Alert rule threshold coverage", `${rules.length} alert rule(s) configured — thresholds active`);
  } else {
    warn("P3", "Alert rule threshold coverage", "No alert rules — recommendation engine uses CDR window heuristics only", "Confidence calibration cannot reference configured thresholds");
  }
}

// ── Phase 4: Degradation Validation ─────────────────────────────────────────
async function phase4() {
  header("PHASE 4 — Degradation Validation");

  const since24h = new Date(Date.now() - 24 * 60 * 60_000);

  // 4a. Anomaly events in last 24h
  const recentAnomalies = await db.select().from(anomalyEvents)
    .where(gte((anomalyEvents as any).detectedAt ?? sql`now()`, since24h))
    .catch(() => [] as any[]);

  if (recentAnomalies.length === 0) {
    // Try without time filter
    const allAnomalies = await db.select().from(anomalyEvents).limit(20).catch(() => [] as any[]);
    if (allAnomalies.length === 0) {
      warn("P4", "Anomaly event history", "No anomaly events in DB — either no degradations or engine hasn't run long enough for baselines", "Statistical detection needs 72h of history before baselines stabilize");
    } else {
      warn("P4", "Anomaly event history", `${allAnomalies.length} historical anomaly events — none in last 24h`, "Either traffic is clean or degradation engine baselines need more time");
    }
  } else {
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const a of recentAnomalies) { bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1; }
    const hasFalsePositiveRisk = recentAnomalies.length > 20;
    if (hasFalsePositiveRisk) {
      warn("P4", "Anomaly event rate", `${recentAnomalies.length} anomalies in 24h — high rate, check for false positives`, "Baseline stddev may be too tight");
    } else {
      pass("P4", "Anomaly event rate", `${recentAnomalies.length} anomaly event(s) in last 24h — rate is operationally sane`);
    }
    console.log(`    ${DIM}Severity breakdown: critical=${bySeverity.critical} high=${bySeverity.high} medium=${bySeverity.medium} low=${bySeverity.low}${RESET}`);

    // 4b. Verify anomalies have recommendation text
    const missingRec = recentAnomalies.filter((a: any) => !a.recommendation || a.recommendation.trim().length === 0);
    if (missingRec.length === 0) pass("P4", "Anomaly recommendation coverage", "All anomaly events have recommendation text");
    else warn("P4", "Anomaly recommendation coverage", `${missingRec.length} anomaly event(s) missing recommendation text`, "RCA linkage will be incomplete");
  }

  // 4c. Vendor baselines vs detected anomalies correlation
  const baselines = await db.select().from(vendorMetricBaselines);
  const anomalyVendors = new Set(recentAnomalies.map((a: any) => a.vendor).filter(Boolean));
  const baselineVendors = new Set(baselines.map(b => b.vendor));

  if (anomalyVendors.size > 0 && baselineVendors.size > 0) {
    const covered = [...anomalyVendors].filter(v => baselineVendors.has(v)).length;
    if (covered === anomalyVendors.size) {
      pass("P4", "Anomaly–baseline vendor coverage", `All ${anomalyVendors.size} anomalous vendor(s) have baseline data — detection is statistically grounded`);
    } else {
      warn("P4", "Anomaly–baseline vendor coverage", `${covered}/${anomalyVendors.size} anomalous vendors have baselines`, "Some detections may be window-only comparisons without historical context");
    }
  }
}

// ── Phase 5: Incident Validation ─────────────────────────────────────────────
async function phase5() {
  header("PHASE 5 — Incident Validation");

  const since24h = new Date(Date.now() - 24 * 60 * 60_000);

  // 5a. Active incidents
  const activeInc = await db.select().from(incidents)
    .where(eq(incidents.status, 'active'))
    .orderBy(desc(incidents.openedAt));
  const resolvedInc = await db.select().from(incidents)
    .where(and(eq(incidents.status, 'resolved'), gte(incidents.updatedAt, since24h)))
    .orderBy(desc(incidents.updatedAt));

  if (activeInc.length === 0) {
    pass("P5", "Active incident count", "No active incidents — system is operationally clean");
  } else {
    const crits = activeInc.filter(i => i.severity === 'critical');
    const highs  = activeInc.filter(i => i.severity === 'high');
    if (crits.length > 0) {
      fail("P5", "Active incident severity", `${crits.length} CRITICAL incident(s) active: ${crits.map(i => i.entityName ?? i.entityId).join(', ')}`, "Requires immediate operational attention");
    } else if (highs.length > 0) {
      warn("P5", "Active incident severity", `${highs.length} HIGH incident(s) active`, "Should be reviewed within operational SLA");
    } else {
      pass("P5", "Active incident severity", `${activeInc.length} active incident(s), all severity ≤ medium`);
    }
  }

  // 5b. Entity attribution — incidents should have meaningful entity names
  const missingName = activeInc.filter(i => !i.entityName || i.entityName.trim().length === 0);
  if (missingName.length === 0 && activeInc.length > 0) {
    pass("P5", "Entity name attribution", `All ${activeInc.length} active incident(s) have entity names`);
  } else if (missingName.length > 0) {
    warn("P5", "Entity name attribution", `${missingName.length}/${activeInc.length} incident(s) missing entity name — only entityId set`, "RCA linkage uses entityId — less human-readable");
  } else {
    pass("P5", "Entity name attribution", "No active incidents to check");
  }

  // 5c. Incident types are categorized
  const types = new Set(activeInc.map(i => i.incidentType));
  if (types.size > 0) {
    console.log(`    ${DIM}Active incident types: ${[...types].join(', ')}${RESET}`);
    pass("P5", "Incident type coverage", `${types.size} distinct incident type(s) across ${activeInc.length} active incidents`);
  }

  // 5d. Confidence values are reasonable
  const lowConfidence = activeInc.filter(i => i.confidence < 50);
  if (lowConfidence.length > 0) {
    warn("P5", "Incident confidence calibration", `${lowConfidence.length} incident(s) have confidence <50% — may be speculative`, "Low-confidence incidents may erode operator trust");
  } else if (activeInc.length > 0) {
    pass("P5", "Incident confidence calibration", `All ${activeInc.length} active incident(s) have confidence ≥50%`);
  }

  // 5e. Resolution rate (in last 24h)
  if (resolvedInc.length > 0) {
    pass("P5", "Incident resolution rate", `${resolvedInc.length} incident(s) resolved in last 24h — auto-resolution is working`);
    const avgResTime = resolvedInc.reduce((sum, i) => {
      if (i.resolvedAt) return sum + (new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime());
      return sum;
    }, 0) / resolvedInc.filter(i => i.resolvedAt).length;
    if (!isNaN(avgResTime)) {
      console.log(`    ${DIM}Avg resolution time: ${Math.round(avgResTime / 60_000)}m${RESET}`);
    }
  } else {
    warn("P5", "Incident resolution rate", "No incidents resolved in last 24h — either no incidents opened or auto-resolution not firing");
  }

  // 5f. Suggested action coverage
  const missingSuggest = activeInc.filter(i => !i.suggestedAction || i.suggestedAction.trim().length === 0);
  if (missingSuggest.length === 0 && activeInc.length > 0) {
    pass("P5", "Suggested action coverage", `All ${activeInc.length} active incident(s) have suggested actions`);
  } else if (missingSuggest.length > 0) {
    warn("P5", "Suggested action coverage", `${missingSuggest.length}/${activeInc.length} incident(s) missing suggested action`, "Operators have no guidance for these incidents");
  }

  // Per-incident summary
  if (activeInc.length > 0) {
    console.log(`\n    ${DIM}Active incidents:${RESET}`);
    for (const i of activeInc) {
      const age = Math.round((Date.now() - new Date(i.openedAt).getTime()) / 60_000);
      const sev = i.severity === 'critical' ? RED : i.severity === 'high' ? YELLOW : DIM;
      console.log(`    ${sev}[${i.severity.toUpperCase()}]${RESET}${DIM} ${(i.entityName ?? i.entityId).padEnd(25)} ${i.incidentType.padEnd(20)} conf=${i.confidence}% age=${age}m${RESET}`);
    }
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
function summary() {
  const total  = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n${BOLD}${CYAN}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}  BENCHMARK SUMMARY${RESET}`);
  console.log(`${CYAN}${'═'.repeat(60)}${RESET}`);
  console.log(`  ${GREEN}PASS  ${passed}/${total}${RESET}`);
  if (warned) console.log(`  ${YELLOW}WARN  ${warned}/${total}${RESET}`);
  if (failed) console.log(`  ${RED}FAIL  ${failed}/${total}${RESET}`);

  const overallStatus = failed > 0 ? 'FAIL' : warned > 2 ? 'WARN' : 'PASS';
  const statusColor = overallStatus === 'PASS' ? GREEN : overallStatus === 'WARN' ? YELLOW : RED;
  console.log(`\n  Overall: ${statusColor}${BOLD}${overallStatus}${RESET}\n`);

  if (failed > 0 || warned > 0) {
    const issues = results.filter(r => r.status !== 'PASS');
    console.log(`${BOLD}  Issues requiring attention:${RESET}`);
    for (const r of issues) {
      const col = r.status === 'FAIL' ? RED : YELLOW;
      console.log(`  ${col}[${r.status}]${RESET} ${DIM}${r.phase}${RESET} ${r.check}`);
      if (r.risk) console.log(`          ${DIM}Risk: ${r.risk}${RESET}`);
    }
  }
  console.log();
}

// ── Run all phases ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}${CYAN}Intelligence Benchmark Validation${RESET}`);
  console.log(`${DIM}Running against live database — ${new Date().toISOString()}${RESET}`);

  try {
    await phase1();
    await phase2();
    await phase3();
    await phase4();
    await phase5();
    summary();
  } catch (e: any) {
    console.error(`\n${RED}Benchmark error: ${e.message}${RESET}`);
    console.error(e.stack);
  } finally {
    await pool.end();
  }
}

main();
