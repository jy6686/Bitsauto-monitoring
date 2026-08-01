/**
 * sippy-destination-form-probe.ts — does a destination import REPLACE or MERGE?
 *
 *   npx tsx scripts/sippy-destination-form-probe.ts
 *
 * WHY THIS EXISTS
 * sippy-destination-probe.ts established that this switch defines no `destinations` upload
 * type — getDictionary('upload_types') returns only Routes=1 and Rates=2 — so the binary
 * upload transport that certified rates cannot be reused. The remaining path is the portal
 * form on /c1/destinations.php, which the platform already has working login machinery for.
 *
 * Before anything is POSTed there, one question has to be answered: does uploading a
 * destination file REPLACE the table or MERGE into it?
 *
 * 2,923 rows currently live there — every NANP entry, every Min/Max length rule the switch
 * uses to reject misdialled numbers. If the import replaces, publishing a partial catalogue
 * deletes them, on a live switch, and the first symptom is calls failing to route.
 *
 * The rate path already assumes replace for tariffs: buildFullTariffXlsx exists because
 * "Sippy portal upload can operate in REPLACE mode (wipes rows not in the file), so we MUST
 * include all current rows." Whether destinations behave the same way is unknown, and the
 * documentation does not say.
 *
 * WHAT THIS DOES
 * Logs into the portal with the same helper production uses, GETs the destinations page,
 * and prints the upload form's markup — every input, select, radio and checkbox inside it.
 * If Sippy offers a mode control ("replace existing", "merge", "action column"), it is in
 * that markup and the question is answered by reading rather than by uploading.
 *
 * STRICTLY READ-ONLY. One GET. It never submits the form. Finding out by uploading is the
 * experiment that breaks the switch.
 */
import { Pool } from "pg";
import * as sippy from "../server/sippy";

const DEST_PATH = "/c1/destinations.php";

function formsIn(html: string): string[] {
  return (html.match(/<form[\s\S]*?<\/form>/gi) ?? []);
}

function controlsIn(form: string): string[] {
  return (form.match(/<(?:input|select|option|textarea|button)[^>]*>/gi) ?? [])
    .map(t => t.replace(/\s+/g, " ").trim());
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set — run this from the app environment."); process.exit(2); }

  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(`
    SELECT portal_url, portal_username, portal_password, api_admin_username, api_admin_password, admin_web_password
      FROM settings ORDER BY id LIMIT 1
  `);
  await pool.end();
  if (!rows.length) { console.error("No settings row."); process.exit(2); }

  const s = rows[0];
  const base = sippy.sippyBase(s.portal_url ?? "");
  if (!base) { console.error("settings.portal_url is empty."); process.exit(2); }

  // Same pair order production uses, so a failure here means the same failure there.
  const pairs: Array<[string, string]> = [];
  const add = (u?: string | null, p?: string | null) => { if (u && p) pairs.push([u, p]); };
  add(s.portal_username, s.portal_password);
  add(s.api_admin_username, s.api_admin_password);
  add(s.portal_username, s.admin_web_password);
  add(s.api_admin_username, s.admin_web_password);

  console.log(`Sippy destination FORM probe — ${base}${DEST_PATH}`);
  console.log(`${pairs.length} credential pair(s) to try.\n`);

  const cookies = await sippy.getAnyPortalSession(base, ...pairs);
  if (!cookies) {
    console.error("Portal login failed on every pair — cannot read the form.");
    console.error("That is itself a finding: the portal upload path needs a credential that can reach this page.");
    process.exit(1);
  }
  console.log("Portal session obtained.\n");

  const cookieHeader = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const resp = await fetch(`${base}${DEST_PATH}`, { headers: { Cookie: cookieHeader } });
  const html = await resp.text();
  console.log(`GET ${DEST_PATH} -> HTTP ${resp.status}, ${html.length} bytes`);

  if (/name=["']?(login|username|passwd|password)/i.test(html) && !/destination/i.test(html)) {
    console.error("\nThe page returned a LOGIN form — this credential cannot reach the destinations page.");
    console.error("Same class of block as /c1/rates.php needing a rate-admin account.");
    process.exit(1);
  }

  const forms = formsIn(html);
  const uploadForms = forms.filter(f => /type=["']?file/i.test(f));
  console.log(`${forms.length} form(s) on the page, ${uploadForms.length} with a file input.\n`);

  if (!uploadForms.length) {
    console.log("No file-upload form found. Either the page renders it dynamically, or this");
    console.log("account cannot upload. Dumping every form's controls so the difference is visible:\n");
    forms.forEach((f, i) => {
      console.log(`── form #${i + 1} ${(/action=["']([^"']*)/i.exec(f)?.[1] ?? "(no action)")}`);
      for (const c of controlsIn(f)) console.log(`   ${c}`);
      console.log("");
    });
    return;
  }

  for (const [i, f] of uploadForms.entries()) {
    const action = /action=["']([^"']*)/i.exec(f)?.[1] ?? "(same page)";
    const method = /method=["']([^"']*)/i.exec(f)?.[1] ?? "GET";
    const enctype = /enctype=["']([^"']*)/i.exec(f)?.[1] ?? "(none)";
    console.log(`── upload form #${i + 1} ────────────────────────────────────────────`);
    console.log(`   action  : ${action}`);
    console.log(`   method  : ${method}`);
    console.log(`   enctype : ${enctype}`);
    console.log(`   controls:`);
    for (const c of controlsIn(f)) console.log(`     ${c}`);
    console.log("");
  }

  console.log("── HOW TO READ THIS ───────────────────────────────────────────────");
  console.log("  A select or radio naming replace / merge / append / overwrite  -> answered.");
  console.log("  A hidden field carrying an import MODE                          -> answered.");
  console.log("  Nothing but a file input and a submit button                    -> Sippy decides,");
  console.log("     and the file's own Action column (if it has one) is the only control. Check");
  console.log("     the header row of a Download Destinations export before uploading anything.");
}

main().catch(e => { console.error(e); process.exit(1); });
