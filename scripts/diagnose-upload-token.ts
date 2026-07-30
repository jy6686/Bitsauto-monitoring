/**
 * diagnose-upload-token.ts — narrow "faultCode 500: Fatal error" on getUploadToken.
 *
 *   npx tsx scripts/diagnose-upload-token.ts --tariff 58
 *
 * WHY
 * getUploadToken returns faultCode 500 "Fatal error" for exactly the arguments production
 * sends — server/sippy.ts lines 6226 and 8944 both build
 * `buildGetUploadTokenXml(1, processOn, undefined, { i_tariff })`, and so does the admin
 * probe, so this is the real production failure and not a probe artefact.
 *
 * "Fatal error" with a 500 is Sippy's generic internal-error envelope. It does NOT say
 * unknown method, bad permission, or bad parameter — which leaves two very different
 * explanations with two opposite fixes:
 *
 *   (a) one of OUR parameters is unacceptable  → fix the request in BitsAuto
 *   (b) the method is broken on this build     → no request will work; manual UI import
 *
 * You cannot tell those apart from one failing call, so this varies ONE thing at a time
 * and reports each outcome. If the minimal call succeeds, a parameter is at fault and the
 * variants say which. If every variant faults identically, the method is broken here.
 *
 * It also asks the switch what upload types it actually supports. Our code asserts
 * "1 = Rates/Tariff, see getDictionary('upload_types')" in a comment, but getDictionary
 * has never once been called — that mapping has been taken on faith since it was written,
 * and a wrong i_upload_type would produce exactly this fault.
 *
 * Read-only apart from possibly minting an upload token that is never used and expires.
 * Nothing is uploaded and no tariff is modified.
 */
import { Pool } from "pg";
import * as sippy from "../server/sippy";

type Pair = { username: string; password: string; origin: string };

const member = (name: string, inner: string) => `<member><name>${name}</name><value>${inner}</value></member>`;
const int    = (n: number) => `<int>${n}</int>`;
const str    = (s: string) => `<string>${s}</string>`;
const dt     = (s: string) => `<dateTime.iso8601>${s}</dateTime.iso8601>`;

function call(method: string, structMembers: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><methodCall><methodName>${method}</methodName>`
       + `<params><param><value><struct>${structMembers}</struct></value></param></params></methodCall>`;
}

function sippyIso(offsetMs: number): string {
  const s = new Date(Date.now() + offsetMs).toISOString();
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}T${s.slice(11, 19)}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }

  const tArg = process.argv.indexOf("--tariff");
  const iTariff = tArg >= 0 ? Number(process.argv[tArg + 1]) : NaN;
  if (!Number.isFinite(iTariff) || iTariff <= 0) {
    console.error("Usage: diagnose-upload-token.ts --tariff <i_tariff>   (the Rate Cards page prints each id)");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(
    `SELECT portal_url, portal_username, portal_password, api_admin_username, api_admin_password
       FROM settings ORDER BY id LIMIT 1`);
  await pool.end();
  if (!rows.length) { console.error("No settings row."); process.exit(2); }
  const s = rows[0];
  const portalUrl: string = s.portal_url ?? "";
  if (!portalUrl) { console.error("settings.portal_url is empty."); process.exit(2); }

  // Same precedence as sippyXmlCreds(): apiAdmin first, portal as fallback.
  const pairs: Pair[] = [];
  if (s.api_admin_username && s.api_admin_password) pairs.push({ username: s.api_admin_username, password: s.api_admin_password, origin: "apiAdmin" });
  if (s.portal_username && s.portal_password)       pairs.push({ username: s.portal_username, password: s.portal_password, origin: "portal" });
  if (!pairs.length) { console.error("No credentials configured."); process.exit(2); }

  // Find a pair that can call an admin method at all, so a 500 below cannot be auth.
  let creds: Pair | null = null;
  for (const p of pairs) {
    const r = await sippy.listSippyAccounts(p.username, p.password, { limit: 1 }, portalUrl);
    if (!r.error) { creds = p; break; }
  }
  if (!creds) { console.error("No credential pair can call admin XML-RPC — run sippy-admin-probe.ts first."); process.exit(1); }

  console.log(`Diagnosing getUploadToken against ${portalUrl}`);
  console.log(`Credential: ${creds.origin} ("${creds.username}") — verified on listAccounts`);
  console.log(`Tariff: ${iTariff}\n`);

  const processOn = sippyIso(10_000);
  const expiresOn = sippyIso(86_400_000);

  const variants: Array<{ label: string; body: string; note?: string }> = [
    {
      label: "A  i_upload_type only",
      body: call("getUploadToken", member("i_upload_type", int(1))),
      note: "If this SUCCEEDS, the method works and one of our optional parameters is the problem.",
    },
    {
      label: "B  + params{i_tariff}",
      body: call("getUploadToken", member("i_upload_type", int(1))
              + member("params", `<struct>${member("i_tariff", int(iTariff))}</struct>`)),
    },
    {
      label: "C  + process_on",
      body: call("getUploadToken", member("i_upload_type", int(1)) + member("process_on", dt(processOn))),
    },
    {
      label: "D  full — EXACTLY what production sends",
      body: call("getUploadToken", member("i_upload_type", int(1)) + member("process_on", dt(processOn))
              + member("params", `<struct>${member("i_tariff", int(iTariff))}</struct>`)),
      note: "This is the failing call. Matches server/sippy.ts:6226 and :8944.",
    },
    {
      label: "E  + expires_on as well",
      body: call("getUploadToken", member("i_upload_type", int(1)) + member("process_on", dt(processOn))
              + member("expires_on", dt(expiresOn))
              + member("params", `<struct>${member("i_tariff", int(iTariff))}</struct>`)),
      note: "Some builds require an explicit expiry.",
    },
    {
      label: "F  i_upload_type 2 (routes/destination set)",
      body: call("getUploadToken", member("i_upload_type", int(2))),
      note: "A different type failing the same way points at the method; only type 1 failing points at the type.",
    },
    {
      label: "G  i_upload_type 0",
      body: call("getUploadToken", member("i_upload_type", int(0))),
      note: "Probing whether the type is validated at all — a DIFFERENT fault here means it is.",
    },
    // ── Type 2 = Rates, per this switch's own getDictionary. Production has always sent
    // type 1, which this switch calls Routes. C proved process_on breaks with ROUTES; it
    // has never been tried with RATES, and that is the combination production should be
    // sending. Testing rather than assuming: if H-J pass, one constant is the whole fix.
    {
      label: "H  type 2 (Rates) + params{i_tariff}",
      body: call("getUploadToken", member("i_upload_type", int(2))
              + member("params", `<struct>${member("i_tariff", int(iTariff))}</struct>`)),
    },
    {
      label: "I  type 2 + process_on",
      body: call("getUploadToken", member("i_upload_type", int(2)) + member("process_on", dt(processOn))),
      note: "C faulted on the same shape with type 1. If this passes, process_on was never the problem.",
    },
    {
      label: "J  type 2 + process_on + params{i_tariff}  ← the CORRECTED production call",
      body: call("getUploadToken", member("i_upload_type", int(2)) + member("process_on", dt(processOn))
              + member("params", `<struct>${member("i_tariff", int(iTariff))}</struct>`)),
      note: "If this issues a token, the rate-push defect is one wrong constant and nothing more.",
    },
    // ── J failed, so process_on breaks with Rates as well. These separate the three
    // remaining explanations, which need three different fixes:
    //   the XML TYPE is unsupported · the FORMAT is wrong · the PARAMETER is unsupported
    {
      label: "K  type 2 + expires_on only (also a dateTime.iso8601)",
      body: call("getUploadToken", member("i_upload_type", int(2)) + member("expires_on", dt(expiresOn))),
      note: "A DIFFERENT date field failing identically means <dateTime.iso8601> itself is the problem, not process_on.",
    },
    {
      label: "L  type 2 + process_on as <string>",
      body: call("getUploadToken", member("i_upload_type", int(2)) + member("process_on", str(processOn))),
      note: "If this passes, the value is fine and the XML type is what this build rejects.",
    },
    {
      label: "M  type 2 + process_on as <string> in SQL format",
      body: call("getUploadToken", member("i_upload_type", int(2))
              + member("process_on", str(new Date(Date.now() + 10_000).toISOString().slice(0, 19).replace('T', ' ')))),
      note: "YYYY-MM-DD HH:MM:SS — the shape the rate workbook's own date columns use.",
    },
    {
      label: "N  type 2 + process_on = obvious rubbish",
      body: call("getUploadToken", member("i_upload_type", int(2)) + member("process_on", str("not-a-date"))),
      note: "A DIFFERENT fault (like G's 410) means the value is parsed and validated. The SAME 500 means the parameter is not handled at all.",
    },
    {
      label: "O  type 2 + process_on as <string> + params{i_tariff}  ← the FIXED production call",
      body: call("getUploadToken", member("i_upload_type", int(2)) + member("process_on", str(processOn))
              + member("params", `<struct>${member("i_tariff", int(iTariff))}</struct>`)),
      note: "L proved the string encoding works alone. This is it with the tariff — what production now sends.",
    },
  ];

  for (const v of variants) {
    const r = await sippy.sippyRawCall(creds.username, creds.password, portalUrl, v.body);
    const verdict = r.faultCode
      ? `fault ${r.faultCode}: ${r.faultString}`
      : (r.statusCode === 200 ? "OK — token issued" : `HTTP ${r.statusCode}`);
    console.log(`${v.label}\n     ${verdict}`);
    if (v.note) console.log(`     ${v.note}`);
    console.log("");
  }

  // What this switch says it supports. Two shapes because the argument convention differs
  // across builds and a wrong shape would itself fault, telling us nothing.
  console.log("── getDictionary('upload_types') ───────────────────────────────");
  console.log("Our code asserts 1 = Rates/Tariff and cites this dictionary, but never calls it.\n");
  const dictBodies = [
    ['struct{name}', call("getDictionary", member("name", str("upload_types")))],
    ['bare string',  `<?xml version="1.0" encoding="UTF-8"?><methodCall><methodName>getDictionary</methodName><params><param><value><string>upload_types</string></value></param></params></methodCall>`],
  ] as const;
  for (const [shape, body] of dictBodies) {
    const r = await sippy.sippyRawCall(creds.username, creds.password, portalUrl, body);
    if (r.faultCode) { console.log(`  ${shape}: fault ${r.faultCode} — ${r.faultString}`); continue; }
    console.log(`  ${shape}: OK\n${r.body.slice(0, 1500).replace(/>\s+</g, '><')}\n`);
    break;
  }

  // Findings as of 2026-07-30 on this switch, kept here so a re-run is a REGRESSION check
  // rather than a fresh investigation. If any line below stops matching, something moved.
  console.log("\n── Established on this switch, 2026-07-30 ──────────────────────");
  console.log("A/B/F/H  OK     getUploadToken works; i_tariff valid; both upload types accepted.");
  console.log("dict     1=Routes 2=Rates — the OPPOSITE of what the code asserted for months.");
  console.log("C/I/J/K  500    any date sent as <dateTime.iso8601> faults, process_on and expires_on alike.");
  console.log("L        OK     the SAME value as a <string> is accepted → the XML TYPE was the fault.");
  console.log("M/N      402    malformed strings get a clean 'Unrecognized date format' → value is parsed;");
  console.log("                so YYYYMMDDThh:mm:ss is required, and SQL datetime is not accepted.");
  console.log("O        ?      the fixed production shape: string date + i_tariff. Must be OK.");
  console.log("\nProduction now sends type-from-dictionary + <string> date. If O faults, that is a");
  console.log("regression in the fix, not a new Sippy problem — nothing else here has changed.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
