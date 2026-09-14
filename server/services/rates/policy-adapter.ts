/**
 * policy-adapter.ts — the stored policy, handed to the batch runner PER CLIENT.
 *
 *     rate_policy_rules + configuration_values
 *          │  resolvePolicyForPush (one client + department)
 *          ▼
 *     perClientPolicy(db, ...)  ──►  deps.policy  ──►  runRateBatch
 *
 * A batch is destinations x clients, and policy is per client and department. This adapter is
 * what makes those line up: for each operation it resolves the policy of THAT operation's client,
 * once per client+department, and the runner evaluates each client's operations against their
 * own rules — so one client's REJECT RATE-SHEET drops that client's sheet and nobody else's.
 *
 * WHAT IT WILL NOT DO.
 *
 *   - **Invent a client.** An operation that does not name `clientId`, `clientName` and
 *     `department` resolves to null, which the runner refuses as `policy_unresolved`. Guessing
 *     the client from an account name would attach a policy to the wrong company.
 *   - **Consult `validation_rules`.** That table is a platform-wide singleton with
 *     `selected_action NOT NULL DEFAULT 'ignore'`; reading it as a fallback would make every
 *     unconfigured client the most permissive one. Nothing in this path imports or queries it.
 *   - **Pick a threshold category, supply a default policy, or turn enforcement on.** The
 *     category is the caller's; a client with no policy resolves to `config: null`, which the
 *     engine reads as undecided; and building the resolver enables nothing until a caller passes
 *     it to `runRateBatch`, which no production route does.
 */
import { resolvePolicyForPush, type PolicyResolution } from './policy-resolution';
import type { PolicyQueryable } from './policy-config-store';
import type { PolicyPerClient, RunnerOperation } from './batch-runner';

export interface PerClientPolicyOptions {
  /** The `configuration_values` category thresholds come from. Required; never defaulted. */
  thresholdCategory: string;
  /** The day the batch runs, injected so a replay decides as of then. */
  today: string;
  /**
   * Called once per distinct client+department with what was resolved, so a route can log or
   * surface `unmeasurableRules` and `usable` before the operations are evaluated.
   */
  onResolved?: (key: string, resolution: PolicyResolution) => void;
}

export const policyScopeKey = (clientId: number, department: string) => `${clientId}:${department}`;

/**
 * Build the per-client resolver the runner takes as `deps.policy`.
 *
 * Reads only, and lazily: a client's policy is fetched the first time one of its operations is
 * seen and reused for the rest of the batch. Building the resolver performs no query at all.
 */
export function perClientPolicy(db: PolicyQueryable, opts: PerClientPolicyOptions): PolicyPerClient {
  const cache = new Map<string, Promise<PolicyResolution>>();

  return {
    today: opts.today,
    async resolve(op: RunnerOperation) {
      const clientId = op.clientId ?? null;
      const clientName = op.clientName ?? null;
      const department = op.department ?? null;
      if (clientId === null || !clientName || !department || !String(department).trim()) return null;

      const key = policyScopeKey(clientId, department);
      let pending = cache.get(key);
      if (!pending) {
        pending = resolvePolicyForPush(db, {
          clientId, clientName, department,
          asOf: opts.today,
          thresholdCategory: opts.thresholdCategory,
        }).then(r => { opts.onResolved?.(key, r); return r; });
        cache.set(key, pending);
      }
      const resolution = await pending;
      return { key, policy: resolution.policy };
    },
  };
}
