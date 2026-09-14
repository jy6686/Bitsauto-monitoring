/**
 * policy-config-store.ts — reading the per-client rate-change policy, and the thresholds it is
 * measured against.
 *
 * The engine (`rate-validation.ts`) is pure and takes its configuration as arguments. This is the
 * only thing that goes and gets it, so the engine stays free of a database and this file stays
 * free of policy judgement.
 *
 * TWO THINGS IT WILL NOT DO.
 *
 *   - **It will not default a missing policy to IGNORE.** No row for a (client, department, rule)
 *     means no declared policy, which the engine reads as `undecided`. An explicit row with a NULL
 *     action means the same thing and additionally records who considered it. Neither is
 *     permission, and there is no code path here that turns absence into an action.
 *   - **It will not choose between disagreeing thresholds.** `configuration_values` holds
 *     `future_effective_date` as 14 under `vendor` and 15 under `client`, and which is
 *     authoritative is an open business decision. The caller names the category; this module never
 *     picks one, and asking for a category that does not exist is an error rather than a fallback.
 */
import { sql } from 'drizzle-orm';
import type { Outcome, RuleConfig, RuleId, Thresholds } from './rate-validation';

export interface PolicyQueryable { execute(query: any): Promise<any>; }

const rows = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

export interface PolicyRuleRow {
  id: number;
  clientId: number;
  department: string;
  ruleKey: RuleId;
  /** NULL means considered and not decided. Never IGNORE. */
  selectedAction: Outcome | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string;
  createdAt: string | null;
  reason: string | null;
  supersedesId: number | null;
}

const toRow = (r: any): PolicyRuleRow => ({
  id: Number(r.id),
  clientId: Number(r.client_id),
  department: String(r.department),
  ruleKey: String(r.rule_key) as RuleId,
  selectedAction: r.selected_action === null || r.selected_action === undefined
    ? null : (String(r.selected_action) as Outcome),
  effectiveFrom: String(r.effective_from).slice(0, 10),
  effectiveTo: r.effective_to === null || r.effective_to === undefined
    ? null : String(r.effective_to).slice(0, 10),
  createdBy: String(r.created_by),
  createdAt: r.created_at == null ? null : new Date(r.created_at).toISOString(),
  reason: r.reason == null ? null : String(r.reason),
  supersedesId: r.supersedes_id == null ? null : Number(r.supersedes_id),
});

/**
 * The configurations in force for one client and department on one day.
 *
 * `asOf` is passed in rather than read from the clock, so replaying a push decides what the policy
 * said THEN rather than what it says now.
 */
export async function policyRulesInForce(
  db: PolicyQueryable,
  opts: { clientId: number; department: string; asOf: string },
): Promise<PolicyRuleRow[]> {
  const res = await db.execute(sql`
    SELECT * FROM rate_policy_rules
     WHERE client_id = ${opts.clientId}
       AND department = ${opts.department}
       AND effective_from <= ${opts.asOf}::date
       AND (effective_to IS NULL OR effective_to > ${opts.asOf}::date)
     ORDER BY rule_key`);
  return rows(res).map(toRow);
}

export interface ResolvedPolicy {
  config: RuleConfig | null;
  /** Every rule with a row in force, whatever its action — including the NULL ones. */
  declaredRules: RuleId[];
  /** Rules whose row exists but declares no action: considered, not decided. */
  undeclaredActions: RuleId[];
  /** True when this client and department have no policy at all. */
  noPolicy: boolean;
}

/**
 * Resolve one client+department into the shape the engine takes.
 *
 * Returns `config: null` when nothing is declared, because that is what the engine reads as "no
 * validation rules are configured" and turns into `undecided`. A `RuleConfig` with an empty
 * `outcomes` map would say the same thing, but going through null keeps one representation of
 * "nobody has decided" rather than two that have to agree.
 */
export async function resolvePolicyConfig(
  db: PolicyQueryable,
  opts: { clientId: number; clientName: string; department: string; asOf: string },
): Promise<ResolvedPolicy> {
  const inForce = await policyRulesInForce(db, opts);
  if (inForce.length === 0) {
    return { config: null, declaredRules: [], undeclaredActions: [], noPolicy: true };
  }

  const outcomes: Partial<Record<RuleId, Outcome>> = {};
  const undeclaredActions: RuleId[] = [];
  for (const r of inForce) {
    // A NULL action is NOT written into `outcomes`. The engine treats a rule with no entry as
    // undecided, which is exactly what "considered, not decided" should produce.
    if (r.selectedAction === null) undeclaredActions.push(r.ruleKey);
    else outcomes[r.ruleKey] = r.selectedAction;
  }

  return {
    config: { clientName: opts.clientName, department: opts.department, outcomes },
    declaredRules: inForce.map(r => r.ruleKey),
    undeclaredActions,
    noPolicy: false,
  };
}

export type DeclareOutcome =
  | { ok: true; row: PolicyRuleRow }
  | { ok: false; code: 'not_attributable' | 'invalid' | 'overlap' | 'unknown_client'; message: string };

/**
 * Declare one client+department+rule policy.
 *
 * The TABLE is the validator: rule and action vocabularies, the AUTO ADJUST scoping, date ordering,
 * the one-open-per-rule index and the no-overlap trigger all live in migration 519, so a writer
 * cannot produce a state the engine refuses. This function only attributes, inserts, and turns
 * the database's refusal into a code a route can answer with. It never defaults an action: a
 * caller declaring `selectedAction: null` is recording "considered, not decided", which is a
 * legitimate declaration and not IGNORE.
 */
export async function declarePolicyRule(
  db: PolicyQueryable,
  input: {
    clientId: number; department: string; ruleKey: RuleId; selectedAction: Outcome | null;
    effectiveFrom: string; effectiveTo?: string | null; reason?: string | null;
    supersedesId?: number | null; declaredBy: string;
  },
): Promise<DeclareOutcome> {
  if (!input.declaredBy || !String(input.declaredBy).trim()) {
    return { ok: false, code: 'not_attributable', message: 'A policy is a commercial claim, and the record has to say who made it.' };
  }
  try {
    const res = await db.execute(sql`
      INSERT INTO rate_policy_rules
        (client_id, department, rule_key, selected_action, effective_from, effective_to,
         created_by, reason, supersedes_id)
      VALUES (${input.clientId}, ${input.department}, ${input.ruleKey}, ${input.selectedAction},
              ${input.effectiveFrom}::date, ${input.effectiveTo ?? null},
              ${input.declaredBy}, ${input.reason ?? null}, ${input.supersedesId ?? null})
      RETURNING *`);
    const [row] = rows(res);
    return { ok: true, row: toRow(row) };
  } catch (e: any) {
    const m = String(e?.message ?? e);
    // The trigger's own messages name the clash; pass them through rather than paraphrasing.
    if (/already has a configuration covering that period|must be after effective_from/i.test(m)) {
      return { ok: false, code: 'overlap', message: m };
    }
    if (/rpr_one_open_per_rule_ux/i.test(m)) {
      return { ok: false, code: 'overlap', message: 'That rule already has an open-ended configuration for this client and department. Close it (set effective_to) before opening another.' };
    }
    if (/client_id_fkey/i.test(m)) {
      return { ok: false, code: 'unknown_client', message: `No company with id ${input.clientId}.` };
    }
    if (/rpr_auto_adjust_only_on_notice/i.test(m)) {
      return { ok: false, code: 'invalid', message: 'AUTO_ADJUST_EFFECTIVE_DATE is offered on rate_increase_notice_violation only.' };
    }
    if (/_check|violates check constraint|invalid input/i.test(m)) {
      return { ok: false, code: 'invalid', message: m };
    }
    throw e;
  }
}

/** Which `configuration_values` key each threshold is read from. */
const THRESHOLD_KEYS = {
  rateDecreaseAlertPct:       'rate_decrease_alert',
  rateIncreaseAlertPct:       'rate_increase_alert',
  increaseNoticePeriodDays:   'increase_notice_period',
  futureEffectiveDateDays:    'future_effective_date',
  oldEffectiveDateDays:       'old_effective_date',
  acceptablePendingIncreases: 'acceptable_pending_increase',
} as const satisfies Record<keyof Thresholds, string>;

export interface ResolvedThresholds {
  thresholds: Thresholds;
  /** Keys the category does not hold. Absent stays absent — the engine skips an unconfigured rule. */
  missing: string[];
  category: string;
}

/**
 * Read the thresholds from one `configuration_values` category.
 *
 * The category is REQUIRED and never defaulted. The seeded categories disagree —
 * `future_effective_date` is 14 under `vendor` and 15 under `client` — and the ratified design says
 * thresholds are global, so something has to be reconciled. Picking a category here would settle a
 * business question by import order.
 *
 * A value that will not parse is treated as absent rather than as zero: a threshold of 0 means
 * "every change is a violation", which is the most dangerous possible reading of a typo.
 */
export async function resolveThresholds(
  db: PolicyQueryable,
  category: string,
): Promise<ResolvedThresholds> {
  const res = await db.execute(sql`
    SELECT config_key, value FROM configuration_values
     WHERE category = ${category} AND is_active = TRUE`);

  const byKey = new Map(rows(res).map((r: any) => [String(r.config_key), r.value]));
  const thresholds: Thresholds = {};
  const missing: string[] = [];

  for (const [field, key] of Object.entries(THRESHOLD_KEYS) as Array<[keyof Thresholds, string]>) {
    const raw = byKey.get(key);
    if (raw === undefined || raw === null || String(raw).trim() === '') { missing.push(key); continue; }
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) { missing.push(key); continue; }
    thresholds[field] = n;
  }

  return { thresholds, missing, category };
}
