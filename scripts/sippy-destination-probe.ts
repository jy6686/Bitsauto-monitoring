/**
 * sippy-destination-probe.ts — what can we actually do to Sippy's Destinations table?
 *
 *   npx tsx scripts/sippy-destination-probe.ts
 *
 * WHY THIS EXISTS
 * "Publish the destination catalogue to Sippy" cannot be designed until two questions are
 * answered, and neither can be answered from our own codebase:
 *
 *   1. Does Sippy expose destination CRUD over XML-RPC, or is bulk file upload the only
 *      route? That decides whether the publisher is an incremental synchroniser or a
 *      workbook generator with an automated import.
 *
 *   2. Is there an upload TYPE for destinations at all? resolveUploadType() already asks
 *      Sippy via getDictionary('upload_types') and caches whatever comes back — the
 *      TypeScript union says 'rates' | 'routes' but the map holds whatever the switch
 *      supports. If 'destinations' is in there, the entire token -> XLSX -> upload -> poll
 *      chain that certified rates tonight works unchanged.
 *
 * THE QUESTION THIS PROBE DOES NOT ANSWER, AND WHY
 * Whether a destination upload REPLACES the table or MERGES into it. That one matters most
 * — the rate path already assumes replace (buildFullTariffXlsx exists because "Sippy portal
 * upload can operate in REPLACE mode (wipes rows not in the file)"), and if destinations
 * behave the same way a partial publish deletes the 2,923 rows the switch currently routes
 * against, including every NANP entry and its length rules.
 *
 * That cannot be probed safely. Finding out by uploading is the experiment that breaks the
 * switch. It has to come from Sippy's documentation or a test switch. This probe reports
 * everything that CAN be established read-only, so the remaining unknown is exactly one
 * question rather than three.
 *
 * STRICTLY READ-ONLY. It calls system.listMethods and getDictionary and nothing else.
 * It deliberately does NOT probe method names by invoking them: calling addDestination to
 * see whether it exists is how you find out that it does.
 */
import { Pool } from "pg";
import * as sippy from "../server/sippy";

function rpc(method: string, structMembers = ""): string {
  const params = structMembers
    ? `<params><param><value><struct>${structMembers}</struct></value></param></params>`
    : `<params/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><methodCall><methodName>${method}</methodName>${params}</methodCall>`;
}

function tags(body: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — run this from the app environment.");
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(`
    SELECT portal_url, portal_username, portal_password, api_admin_username, api_admin_password
      FROM settings ORDER BY id LIMIT 1
  `);
  await pool.end();
  if (!rows.length) { console.error("No settings row — Sippy has never been configured here."); process.exit(2); }

  const s = rows[0];
  const portalUrl: string = s.portal_url ?? "";
  const user: string = s.api_admin_username ?? s.portal_username ?? "";
  const pass: string = s.api_admin_password ?? s.portal_password ?? "";
  if (!portalUrl || !user || !pass) { console.error("portal_url / credentials incomplete."); process.exit(2); }

  console.log(`Sippy destination probe — ${portalUrl}`);
  console.log(`Credential: ${user} (${pass.length} chars)\n`);

  // ── 1. What methods exist? ──────────────────────────────────────────────────
  // Standard XML-RPC introspection. Not all servers implement it; if this one does not,
  // that is itself the answer to "can we enumerate the API" and the fallback is the docs.
  console.log("── system.listMethods ─────────────────────────────────────────────");
  const lm = await sippy.sippyRawCall(user, pass, portalUrl, rpc("system.listMethods"), 20000);
  if (lm.statusCode !== 200 || lm.faultString) {
    console.log(`  not available (${lm.statusCode}${lm.faultString ? ` — ${lm.faultString}` : ""})`);
    console.log("  -> the method list must come from Sippy's documentation instead.\n");
  } else {
    const names = tags(lm.body, "string").map(v => v.trim()).filter(Boolean).sort();
    console.log(`  ${names.length} method(s) exposed.`);
    const dest = names.filter(n => /dest/i.test(n));
    const upload = names.filter(n => /upload/i.test(n));
    console.log(`\n  DESTINATION-related (${dest.length}):`);
    for (const n of dest) console.log(`    ${n}`);
    if (!dest.length) console.log("    none — destinations are not manipulable per-row over XML-RPC.");
    console.log(`\n  UPLOAD-related (${upload.length}):`);
    for (const n of upload) console.log(`    ${n}`);
    console.log("");
  }

  // ── 2. Which upload types does this switch define? ──────────────────────────
  // This is what resolveUploadType() caches. If a destinations type exists, the transport
  // that certified rates tonight is reusable as-is.
  console.log("── getDictionary('upload_types') ──────────────────────────────────");
  const dict = await sippy.sippyRawCall(
    user, pass, portalUrl,
    rpc("getDictionary", `<member><name>name</name><value><string>upload_types</string></value></member>`),
    15000,
  );
  if (dict.statusCode !== 200 || dict.faultString) {
    console.log(`  failed (${dict.statusCode}${dict.faultString ? ` — ${dict.faultString}` : ""})`);
    console.log("  -> resolveUploadType() would fall back to routes=1, rates=2.\n");
  } else {
    const structs = tags(dict.body, "struct");
    const seen: Array<{ id: string; name: string }> = [];
    for (const st of structs) {
      const id = /<name>i_upload_type<\/name>\s*<value>\s*(?:<int>)?([^<]*)/i.exec(st)?.[1]?.trim();
      const nm = /<name>name<\/name>\s*<value>\s*(?:<string>)?([^<]*)/i.exec(st)?.[1]?.trim();
      if (id && nm) seen.push({ id, name: nm });
    }
    if (!seen.length) console.log("  returned nothing usable — same fallback applies.");
    for (const t of seen) console.log(`  ${t.id.padStart(3)} = ${t.name}`);
    const hasDest = seen.some(t => /dest/i.test(t.name));
    console.log(`\n  destinations upload type present: ${hasDest ? "YES — the rate transport is reusable" : "NO"}`);
  }

  console.log("\n── STILL UNANSWERED, and it is the one that matters ───────────────");
  console.log("  Does a destination upload REPLACE the table or MERGE into it?");
  console.log("  2,923 rows currently live there, including NANP and its length rules.");
  console.log("  If it replaces, a partial publish deletes them. Do not find this out by");
  console.log("  uploading — get it from Sippy's documentation or a test switch first.");
}

main().catch(e => { console.error(e); process.exit(1); });
