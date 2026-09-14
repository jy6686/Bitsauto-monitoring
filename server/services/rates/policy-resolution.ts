/**
 * policy-resolution.ts — THE CONSUMER CONTRACT.
 *
 * The one place that assembles what the pure engine needs from what the database holds, and the
 * one place that says whether the result is fit to decide with.
 *
 *     configuration_values ─┐
 *                           ├─► resolvePolicyForPush ─► deps.policy ─► batch-runner
 *     rate_policy_rules ────┘
 *
 * WHY THIS IS NOT JUST TWO READS GLUED TOGETHER.
 *
 * Policy and thresholds can each be present, absent, or partial, and some combinations are
 * DANGEROUS rather than merely incomplete:
 *
 *   - A client who configured `REJECT_DESTINATION` for suspect decreases, against a threshold that
 *     is absent from `configuration_values`, would have every decrease proceed — the rule never
 *     fires, so a −98% cut sails through a declared refusal. The engine now reports that as
 *     `undecidable`; this module reports it BEFORE a push starts, so it is a configuration problem
 *     an operator can fix rather than a batch full of undecided rows.
 *   - Thresholds with no policy is the safe direction: every firing rule is undecided, so nothing
 *     proceeds on a violation.
 *
 * WHAT IT WILL NOT DO.
 *
 *   - **It will not pick a threshold category.** The seeded values disagree — `future_effective_date`
 *     is 14 under `vendor` and 15 under `client` — and which is authoritative is an open business
 *     decision. The caller names it.
 *   - **It will not supply a default policy.** A client with none resolves to `config: null`, which
 *     the engine reads as undecided. There is no house default to fall back to.
 *   - **It will not enable itself.** Returning a `policy` object does not turn enforcement on; a
 *     caller has to pass it to `runRateBatch`, and no production route does yet.
 */
import {
  resolvePolicyConfig, resolveThresholds, type PolicyQueryable,
} from './policy-config-store';
import {
  THRESHOLD_FOR_RULE, type RuleConfig, type RuleId, type Thresholds,
} from './rate-validation';

export interface PolicyResolutionRequest {
  clientId: number;
  clientName: string;
  department: string;
  /** The day the policy is read AS OF, so replaying a push applies the rules that were in force. */
  asOf: string;
  /**
   * Which `configuration_values` category the thresholds come from. REQUIRED: the categories
   * disagree and choosing one is a business decision, not a default.
   */
  thresholdCategory: string;
}

/** A configured consequence that cannot be enforced because its threshold is missing. */
export interface UnmeasurableRule {
  rule: RuleId;
  configuredAction: string;
  missingThreshold: string;
}

export interface PolicyResolution {
  /** Exactly the shape `runRateBatch` takes as `deps.policy`. Passing it is a separate act. */
  policy: { thresholds: Thresholds; config: RuleConfig | null; today: string };
  /** True when this client and department have no declared policy at all. */
  noPolicy: boolean;
  /** Rules with a row but no declared action: considered, not decided. */
  undeclaredActions: RuleId[];
  /** Threshold keys the chosen category does not hold. */
  missingThresholds: string[];
  /**
   * The dangerous combination, named before a push rather than discovered during one: a DECLARED
   * consequence whose threshold is absent, so the rule can never fire.
   */
  unmeasurableRules: UnmeasurableRule[];
  /**
   * Whether this configuration can decide anything at all. False does NOT mean "do not push" —
   * it means every violation will come back undecided, which the caller should say plainly rather
   * than letting an operator read a batch of refusals as a fault.
   */
  usable: boolean;
  /** Why, in words a run report or an operator message can print. */
  summary: string;
}

/**
 * Resolve one client+department into the engine's inputs, and report what is wrong with it.
 *
 * Reads only. Nothing here writes, pushes, or enables enforcement.
 */
export async function resolvePolicyForPush(
  db: PolicyQueryable,
  req: PolicyResolutionRequest,
): Promise<PolicyResolution> {
  const [declared, thresholdsRead] = await Promise.all([
    resolvePolicyConfig(db, {
      clientId: req.clientId, clientName: req.clientName,
      department: req.department, asOf: req.asOf,
    }),
    resolveThresholds(db, req.thresholdCategory),
  ]);

  const { thresholds, missing } = thresholdsRead;

  // A declared consequence whose threshold is absent. Computed here rather than left to the
  // engine's per-row reporting so an operator sees ONE configuration problem instead of one
  // undecided row per destination.
  const unmeasurableRules: UnmeasurableRule[] = [];
  for (const [rule, action] of Object.entries(declared.config?.outcomes ?? {}) as Array<[RuleId, string]>) {
    const key = THRESHOLD_FOR_RULE[rule];
    if (thresholds[key] === undefined) {
      unmeasurableRules.push({ rule, configuredAction: action, missingThreshold: key });
    }
  }

  const parts: string[] = [];
  if (declared.noPolicy) {
    parts.push(`${req.clientName} / ${req.department} has no declared rate-change policy, so any violation will be undecided rather than permitted.`);
  } else {
    parts.push(`${req.clientName} / ${req.department}: ${Object.keys(declared.config?.outcomes ?? {}).length} rule(s) declared.`);
  }
  if (declared.undeclaredActions.length) {
    parts.push(`Considered but not decided: ${declared.undeclaredActions.join(', ')}.`);
  }
  if (unmeasurableRules.length) {
    parts.push(
      `Declared but not enforceable — the threshold is missing from the '${req.thresholdCategory}' `
    + `configuration: ${unmeasurableRules.map(u => `${u.rule} (${u.missingThreshold})`).join(', ')}.`);
  } else if (missing.length) {
    // Missing thresholds nobody configured a consequence for are worth reporting but are not a
    // problem: an unconfigured rule was never going to act on them.
    parts.push(`Thresholds absent from '${req.thresholdCategory}' but unused by this policy: ${missing.join(', ')}.`);
  }

  // Usable = at least one rule both declared AND measurable. Anything less can still be passed to
  // the engine; it simply cannot produce a verdict other than undecided.
  const usable = Object.entries(declared.config?.outcomes ?? {})
    .some(([rule]) => thresholds[THRESHOLD_FOR_RULE[rule as RuleId]] !== undefined);

  return {
    policy: { thresholds, config: declared.config, today: req.asOf },
    noPolicy: declared.noPolicy,
    undeclaredActions: declared.undeclaredActions,
    missingThresholds: missing,
    unmeasurableRules,
    usable,
    summary: parts.join(' '),
  };
}
