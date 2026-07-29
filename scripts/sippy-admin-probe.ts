/**
 * sippy-admin-probe.ts — answer "can we actually call an admin XML-RPC method?"
 *
 *   npx tsx scripts/sippy-admin-probe.ts
 *
 * WHY THIS EXISTS
 * POST /api/sippy/test cannot answer this question. testSippyConnection() tries XML-RPC
 * first and, on a 401, falls through to a WEB PORTAL LOGIN and still reports
 * { authenticated: true, mode: 'portal' }. That is correct behaviour for "is the switch
 * reachable and are the credentials real", but it means the connection test goes green
 * while every admin method — createAccount, the authentication rules, the routing group
 * assignment — returns 401. Provisioning then fails at its first write and looks like an
 * application bug.
 *
 * Authentication and authorisation are different questions. This probe asks the second
 * one, by calling listAccounts, a genuine admin method, through the exact function
 * production uses (sippy.listSippyAccounts) rather than a reimplementation that might
 * authenticate differently.
 *
 * The platform does not have one credential pair — routes.ts builds up to six from the
 * settings row (admin, portal, adminWebPassword combos, and the two cross-combos that
 * cover swapped DB fields) and tries each in turn. So "401" in a log means all six
 * failed. This prints the verdict PER PAIR, which distinguishes "no admin credential is
 * configured anywhere" from "the right one exists but is being tried too late".
 *
 * Passwords are never printed — only which settings field each came from, and its length.
 * Read-only: listAccounts creates nothing and changes nothing.
 */
import { Pool } from "pg";
import * as sippy from "../server/sippy";

type Pair = { username: string; password: string; origin: string };

function buildPairs(s: Record<string, string | null>): Pair[] {
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  const push = (username: string | null, password: string | null, origin: string) => {
    if (!username || !password) return;
    const k = `${username}\x00${password}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ username, password, origin });
  };
  // Same order as sippyXmlCredsPairs() in server/routes.ts — the order matters, because
  // a working pair that is tried sixth still costs five failed round-trips per call.
  push(s.api_admin_username, s.api_admin_password, "apiAdmin user + apiAdmin password");
  push(s.portal_username, s.portal_password, "portal user + portal password");
  if (s.admin_web_password) {
    push(s.api_admin_username, s.admin_web_password, "apiAdmin user + adminWebPassword");
    push(s.portal_username, s.admin_web_password, "portal user + adminWebPassword");
  }
  if (s.portal_username !== s.api_admin_username) {
    push(s.portal_username, s.api_admin_password, "portal user + apiAdmin password (cross)");
    push(s.api_admin_username, s.portal_password, "apiAdmin user + portal password (cross)");
  }
  return pairs;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — run this from the app environment.");
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(`
    SELECT portal_url, portal_username, portal_password,
           api_admin_username, api_admin_password, admin_web_password
      FROM settings ORDER BY id LIMIT 1
  `);
  await pool.end();

  if (!rows.length) {
    console.error("No settings row — Sippy has never been configured on this database.");
    process.exit(2);
  }
  const s = rows[0];
  const portalUrl: string = s.portal_url ?? "";
  if (!portalUrl) {
    console.error("settings.portal_url is empty — nothing to probe.");
    process.exit(2);
  }

  const pairs = buildPairs(s);
  console.log(`Sippy admin probe — listAccounts against ${portalUrl}`);
  console.log(`${pairs.length} credential pair(s) configured.\n`);

  if (!pairs.length) {
    console.error("No usable credential pair. Both the admin and portal fields are incomplete.");
    process.exit(1);
  }

  let anyOk = false;
  for (const [i, p] of pairs.entries()) {
    const label = `${i + 1}. ${p.origin} — user "${p.username}", password ${p.password.length} chars`;
    const started = Date.now();
    let verdict: string;
    try {
      // limit 1: this is a permission probe, not a data pull.
      const r = await sippy.listSippyAccounts(p.username, p.password, { limit: 1 }, portalUrl);
      const ms = Date.now() - started;
      if (!r.error) {
        anyOk = true;
        verdict = `OK   (${ms}ms) — admin method succeeded, ${r.accounts.length} account(s) returned`;
      } else if (r.error === "HTTP 401") {
        verdict = `401  (${ms}ms) — rejected. Credentials not accepted for admin XML-RPC.`;
      } else if (r.error === "HTTP 403") {
        verdict = `403  (${ms}ms) — authenticated but NOT authorised. This user is not an admin.`;
      } else {
        verdict = `FAIL (${ms}ms) — ${r.error}`;
      }
    } catch (e: any) {
      verdict = `ERROR (${Date.now() - started}ms) — ${e?.message ?? e}`;
    }
    console.log(`${label}\n     ${verdict}\n`);
  }

  if (anyOk) {
    console.log("VERDICT: at least one credential pair can call admin XML-RPC. Provisioning writes should reach Sippy.");
    console.log("If a LATER pair is the working one, move it into the apiAdmin fields — every admin call currently");
    console.log("pays the failed attempts ahead of it on every request.");
    process.exit(0);
  }

  console.log("VERDICT: no configured credential can call an admin XML-RPC method.");
  console.log("Provisioning will fail at its first Sippy write (account creation), before authentication or routing.");
  console.log("This is resolved on the Sippy side — an XML-RPC API user with admin rights — not in this codebase.");
  console.log("A 401 across every pair means no admin credential is stored; a 403 means one authenticates but lacks rights.");
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
