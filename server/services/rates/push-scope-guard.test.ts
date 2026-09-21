/**
 * A KAM may push rates only to accounts inside its own hierarchy.
 *
 * `push-batch` takes `accountNames` AND an optional `accounts: [{username, iAccount}]` from the
 * REQUEST BODY, and uses `acc.iAccount` directly to ask Sippy which tariff the account bills
 * on — i.e. the caller names the thing the write lands on. For admin and management that is
 * fine; they are trusted with every account. For a `kam` it is the whole attack surface, so
 * this guard authorises on the ACCOUNT IDS, never on the names, and never on the pairing
 * between them, because the body controls both sides of that pairing.
 *
 * WHERE IT RUNS IS PART OF THE CONTRACT. The check belongs beside the submit guards, BEFORE
 * the job row is inserted — not in the execution phase. The route deliberately creates the job
 * row before the first Sippy call so that a request cut short still leaves a record; a refusal
 * after that point would leave a `failed` job in Push History for a push that was never
 * authorised, and hand the reconciliation sweep an orphan to reason about. Refusing where the
 * duplicate guard refuses gives the property already certified in production on 2026-09-20:
 * job count unchanged, tariff unchanged, nothing recorded.
 *
 * ALL-OR-NOTHING. One out-of-scope account refuses the whole batch. Silently dropping the
 * offending entries would push a subset while the operator believes they pushed everything,
 * and a partial push nobody notices is worse than a refusal everybody sees.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pushScopeGuard, SCOPE_LIMITED_ROLES } from './push-scope-guard';

const base = {
  role: 'kam',
  accountNames: ['aura'],
  accounts: [{ username: 'aura', iAccount: 1065 }],
  scopedAccountIds: ['1065', '1066'] as readonly string[] | null,
};

describe('roles that are not scope-limited are unaffected', () => {
  it('admin proceeds without a scope list at all', () => {
    expect(pushScopeGuard({ ...base, role: 'admin', scopedAccountIds: null }).kind).toBe('proceed');
  });

  it('management proceeds', () => {
    expect(pushScopeGuard({ ...base, role: 'management', scopedAccountIds: null }).kind).toBe('proceed');
  });

  /** Only `kam` is scope-limited here. Widening this silently narrows an existing role. */
  it('kam is the only scope-limited role', () => {
    expect([...SCOPE_LIMITED_ROLES]).toEqual(['kam']);
  });
});

describe('a KAM pushing inside its own scope', () => {
  it('proceeds for a single in-scope account', () => {
    expect(pushScopeGuard(base).kind).toBe('proceed');
  });

  it('proceeds when every account in a batch is in scope', () => {
    expect(pushScopeGuard({
      ...base,
      accountNames: ['aura', 'test-31'],
      accounts: [{ username: 'aura', iAccount: 1065 }, { username: 'test-31', iAccount: 1066 }],
    }).kind).toBe('proceed');
  });
});

describe('a KAM pushing outside its scope — the whole batch is refused', () => {
  it('refuses a single out-of-scope account', () => {
    const d = pushScopeGuard({
      ...base, accountNames: ['someone-else'],
      accounts: [{ username: 'someone-else', iAccount: 9999 }],
    });
    expect(d.kind).toBe('out_of_scope');
    expect(d.kind === 'out_of_scope' && d.accountIds).toEqual(['9999']);
  });

  /** THE ONE THAT MATTERS: a mixed batch must not push its in-scope half. */
  it('refuses the ENTIRE batch when one of several accounts is out of scope', () => {
    const d = pushScopeGuard({
      ...base,
      accountNames: ['aura', 'someone-else'],
      accounts: [{ username: 'aura', iAccount: 1065 }, { username: 'someone-else', iAccount: 9999 }],
    });
    expect(d.kind).toBe('out_of_scope');
    expect(d.kind === 'out_of_scope' && d.accountIds).toEqual(['9999']);
  });

  it('names every offending account, not just the first', () => {
    const d = pushScopeGuard({
      ...base,
      accountNames: ['a', 'b'],
      accounts: [{ username: 'a', iAccount: 8001 }, { username: 'b', iAccount: 8002 }],
    });
    expect(d.kind === 'out_of_scope' && d.accountIds).toEqual(['8001', '8002']);
  });

  it('a KAM with an empty portfolio can push nothing', () => {
    expect(pushScopeGuard({ ...base, scopedAccountIds: [] }).kind).toBe('out_of_scope');
  });
});

describe('identity: no KAM record means no push', () => {
  /** `scopedAccountIds: null` is "this user has no KAM record", distinct from "has none assigned". */
  it('refuses when the caller has no KAM link', () => {
    expect(pushScopeGuard({ ...base, scopedAccountIds: null }).kind).toBe('no_kam_link');
  });
});

describe('the body cannot be used to smuggle an account through', () => {
  /**
   * The route resolves the tariff from `accounts[].iAccount`, so an account NAME with no
   * corresponding id would be pushed without ever being scope-checked. Refuse rather than
   * guess which account a bare name meant.
   */
  it('refuses a name with no matching account entry', () => {
    expect(pushScopeGuard({ ...base, accountNames: ['aura', 'ghost'] }).kind).toBe('unidentified');
  });

  it('refuses an entry carrying no iAccount', () => {
    expect(pushScopeGuard({
      ...base, accountNames: ['aura'], accounts: [{ username: 'aura' }],
    }).kind).toBe('unidentified');
  });

  it('refuses when the accounts array is missing entirely', () => {
    expect(pushScopeGuard({ ...base, accounts: undefined }).kind).toBe('unidentified');
  });

  /**
   * Authorisation keys on the ID, never the name. Relabelling an in-scope id with someone
   * else's display name must not matter, and must not smuggle the OTHER account in.
   */
  it('a mislabelled but in-scope id still proceeds — the name is not the authority', () => {
    expect(pushScopeGuard({
      ...base, accountNames: ['pretending-to-be-someone'],
      accounts: [{ username: 'pretending-to-be-someone', iAccount: 1065 }],
    }).kind).toBe('proceed');
  });

  it('an in-scope NAME paired with an out-of-scope id is refused', () => {
    const d = pushScopeGuard({
      ...base, accountNames: ['aura'], accounts: [{ username: 'aura', iAccount: 9999 }],
    });
    expect(d.kind).toBe('out_of_scope');
  });

  it('compares ids as strings, so 1065 and "1065" are the same account', () => {
    expect(pushScopeGuard({ ...base, scopedAccountIds: ['1065'] }).kind).toBe('proceed');
  });
});

// ── The wiring: role, allowlist, position, and the viewer-negative branches ──

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/**
 * The approved endpoints are spread across three route files — kpi and export live in
 * routes-rate-manager.ts and the picker in routes-commercial-catalogue.ts. An earlier version
 * of this file read only routes.ts, so `indexOf` returned -1 and the assertions were measuring
 * absence rather than the guard.
 */
const readRoutes = (f: string) =>
  strip(readFileSync(join(__dirname, '..', '..', f), 'utf8'));
const ROUTES = readRoutes('routes.ts');
const ALL_ROUTES = [ROUTES, readRoutes('routes-rate-manager.ts'),
                    readRoutes('routes-commercial-catalogue.ts')].join('\n');
const SCHEMA = strip(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'schema.ts'), 'utf8'));

describe('the kam role exists and is exact-match', () => {
  it('is part of the Role union', () => {
    expect(SCHEMA).toMatch(/\|\s*'kam'/);
  });

  it('is an assignable platform role', () => {
    expect(ROUTES).toMatch(/VALID_ROLES[^;]*'kam'/s);
  });
});

describe('the six approved endpoints admit kam, and nothing else does by accident', () => {
  const head = (method: string, path: string) => {
    const at = ALL_ROUTES.indexOf(`app.${method}('${path}'`);
    expect(at, `${method.toUpperCase()} ${path} must exist`).toBeGreaterThan(-1);
    const rest = ALL_ROUTES.slice(at);
    return rest.slice(0, rest.search(/async\s*\(/));
  };

  /** The six from the locked allowlist, at their real paths. */
  const APPROVED: Array<[string, string]> = [
    ['get',  '/api/rate-manager/kpi'],
    ['get',  '/api/rate-manager/jobs'],
    ['get',  '/api/rate-manager/jobs/:jobId/operations'],
    ['get',  '/api/rate-manager/jobs/by-request/:clientRequestId'],
    ['post', '/api/rate-manager/push-batch'],
  ];

  for (const [m, p] of APPROVED) {
    it(`${m.toUpperCase()} ${p} admits kam`, () => {
      expect(head(m, p)).toMatch(/'kam'/);
    });
  }

  /**
   * The picker's guard is the file's `READ` constant, not an inline array, so asserting the
   * literal in the registration would fail against a correct implementation. Assert both
   * halves: the route uses READ, and READ admits kam while WRITE does not.
   */
  it('GET /api/commercial/picker admits kam via the READ set, and WRITE still does not', () => {
    const CAT = readRoutes('routes-commercial-catalogue.ts');
    expect(head('get', '/api/commercial/picker')).toMatch(/requireRole\(\s*READ/);
    expect(CAT).toMatch(/const READ\s*=\s*\[[^\]]*'kam'/);
    expect(CAT).not.toMatch(/const WRITE\s*=\s*\[[^\]]*'kam'/);
  });

  /** The full price sheet stays out of reach — the Commercial drawer already hides it. */
  it('the rate export does NOT admit kam', () => {
    expect(head('get', '/api/rate-manager/export')).not.toMatch(/'kam'/);
  });

  /** KAM administration must never admit the role it administers. */
  it('KAM administration does not admit kam', () => {
    for (const [m, p] of [['post', '/api/kam'], ['patch', '/api/kam/:id'],
                          ['delete', '/api/kam/:id'], ['post', '/api/kam/:id/accounts']] as const) {
      expect(head(m, p), `${m} ${p}`).not.toMatch(/'kam'/);
    }
  });
});

describe('push-batch refuses BEFORE the job row exists', () => {
  const ROUTE = (() => {
    const at = ROUTES.indexOf("app.post('/api/rate-manager/push-batch'");
    expect(at).toBeGreaterThan(-1);
    return ROUTES.slice(at, at + 26000);
  })();

  it('calls the scope guard', () => {
    expect(ROUTE).toContain('pushScopeGuard(');
  });

  /**
   * Position is the contract. The route inserts the job row before the first Sippy call on
   * purpose; a refusal after that leaves a `failed` job for a push that was never authorised.
   */
  it('the guard runs before the job row is inserted', () => {
    const guard  = ROUTE.indexOf('pushScopeGuard(');
    const insert = ROUTE.indexOf('db.insert(ratePushJobs)');
    expect(guard, 'guard must exist').toBeGreaterThan(-1);
    expect(insert, 'the job insert must still exist').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(insert);
  });

  it('runs beside the submit guards, which also decide before the row exists', () => {
    const submit = ROUTE.indexOf('submitGuards(');
    const insert = ROUTE.indexOf('db.insert(ratePushJobs)');
    expect(submit).toBeGreaterThan(-1);
    expect(submit).toBeLessThan(insert);
  });
});

describe('a KAM cannot become unscoped through a viewer-negative branch', () => {
  /**
   * Both sites reasoned "if the caller is a viewer, scope them" — so any other role, including
   * a new `kam`, fell into the unscoped path. Neither may treat kam as unscoped.
   */
  it('getViewerClientScope does not hand kam a null (unscoped) result', () => {
    const at = ROUTES.indexOf('async function getViewerClientScope');
    expect(at).toBeGreaterThan(-1);
    const body = ROUTES.slice(at, at + 1200);
    expect(body).toMatch(/'kam'/);
  });

  /**
   * Anchored on CODE, not on the "Viewer IDOR guard" comment — `strip` removes comment lines,
   * so a comment anchor resolved to -1 and silently searched the whole file from index 0.
   */
  it('the account-history IDOR guard applies to kam as well as viewer', () => {
    const at = ROUTES.indexOf("app.get('/api/accounts/:id/balance-alert-history'");
    expect(at, 'the balance-alert-history route must exist').toBeGreaterThan(-1);
    const body = ROUTES.slice(at, at + 1800);
    expect(body).toMatch(/role === 'viewer' \|\| currentUser\?\.role === 'kam'/);
    expect(body).toMatch(/userId === currentUser\.id/);
  });
});

describe('GUARD/WRITE-PATH COUPLING: the guard checks the field the write targets', () => {
  /**
   * The guard is sound for a narrower reason than it first appears. The server does NOT
   * independently resolve a username to a Sippy account id — `accounts: [{username, iAccount}]`
   * comes from the request body. What makes the check meaningful is that the guard authorises
   * `accounts[].iAccount` and the write path resolves its target from that SAME field, so the
   * username is cosmetic to both.
   *
   * That is a coupling, not an independent property. If someone later changes the route to
   * resolve the target from `username` (or from `accountNames`), the guard would be checking a
   * field the write no longer uses and would become bypassable WITHOUT ANY OTHER TEST FAILING.
   * These assertions exist so that change breaks loudly.
   */
  const ROUTE = (() => {
    const at = ROUTES.indexOf("app.post('/api/rate-manager/push-batch'");
    expect(at).toBeGreaterThan(-1);
    return ROUTES.slice(at, at + 26000);
  })();

  it('asks Sippy about the account by iAccount, never by name', () => {
    expect(ROUTE).toMatch(/getAccountInfo\([^)]*acc\.iAccount\s*\)/);
    expect(ROUTE).not.toMatch(/getAccountInfo\([^)]*acc\.username\s*\)/);
  });

  it('skips any entry that carries no iAccount, rather than falling back to the name', () => {
    expect(ROUTE).toMatch(/if\s*\(!acc\.iAccount\)\s*continue;/);
  });

  it('looks the company up by iAccount too', () => {
    expect(ROUTE).toMatch(/getCompanyBySippyAccount\(Number\(acc\.iAccount\)\)/);
  });

  /** The guard must be fed the same array the write path reads. */
  it('the scope guard receives `accounts`, the array the write target comes from', () => {
    const at = ROUTE.indexOf('pushScopeGuard({');
    expect(at).toBeGreaterThan(-1);
    const call = ROUTE.slice(at, at + 320);
    // Shorthand `accounts,` — the array itself. `accounts: undefined` or any substituted
    // value would satisfy a looser word match while feeding the guard something other than
    // what the write path reads.
    expect(call).toMatch(/^\s*accounts,\s*$/m);
  });

  /**
   * `accountNames` stays the list of WHICH entries to act on — it must never itself become the
   * thing resolved to a tariff, which would put the write on a field the guard does not check.
   */
  it('does not resolve a tariff from accountNames', () => {
    expect(ROUTE).not.toMatch(/getAccountInfo\([^)]*accountNames/);
    expect(ROUTE).not.toMatch(/getCompanyBySippyAccount\([^)]*accountNames/);
  });
});
