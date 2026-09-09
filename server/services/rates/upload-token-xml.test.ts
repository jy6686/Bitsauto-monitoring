/**
 * The upload-token request contract, asserted on the XML that actually goes to Sippy.
 *
 * Jobs #33 and #34 (2026-09-02, tariff 66) are the last successful `upload_token` pushes on
 * this switch, and both were made with `expires_on` UNDEFINED — as every upload this codebase
 * had ever created was. `8a5974aa` began sending it on 2026-09-07 and it was corrected twice
 * more; no upload has produced a rate since. Sippy documents `expires_on` as "when the system
 * stops any attempts to process the file".
 *
 * Testing the argument would prove nothing — the element is emitted conditionally, so the
 * assertion has to be on the serialised request.
 */
import { describe, it, expect } from "vitest";
import { buildGetUploadTokenXml } from "../../sippy";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROCESS_ON = '2026-09-09 12:00:10';

describe("getUploadToken request XML", () => {
  it("REGRESSION: omits expires_on entirely when it is not supplied", () => {
    const xml = buildGetUploadTokenXml(1, PROCESS_ON, undefined, { i_tariff: 65 });
    expect(xml).not.toContain('expires_on');
  });

  it("still sends process_on, which the switch does accept", () => {
    const xml = buildGetUploadTokenXml(1, PROCESS_ON, undefined, { i_tariff: 65 });
    expect(xml).toContain('<name>process_on</name>');
    expect(xml).toContain(`<string>${PROCESS_ON}</string>`);
  });

  it("sends process_on as <string>, never <dateTime.iso8601>", () => {
    // Proven 2026-07-30: an iso8601-typed date faults 500 "Fatal error"; the identical value
    // as a string is accepted. This is an XML-type constraint of this build, not a format one.
    const xml = buildGetUploadTokenXml(1, PROCESS_ON, undefined, { i_tariff: 65 });
    expect(xml).not.toContain('dateTime.iso8601');
  });

  it("carries the tariff the upload targets", () => {
    const xml = buildGetUploadTokenXml(1, PROCESS_ON, undefined, { i_tariff: 65 });
    expect(xml).toContain('<name>i_tariff</name>');
    expect(xml).toContain('<int>65</int>');
  });

  it("still EMITS expires_on if a caller supplies one — the omission is the caller's choice", () => {
    // The builder is not the guard. Keeping it capable means a future caller can send the
    // element deliberately once there is evidence Sippy wants it.
    const xml = buildGetUploadTokenXml(1, PROCESS_ON, '2026-09-09 12:15:10', { i_tariff: 65 });
    expect(xml).toContain('<name>expires_on</name>');
  });

  it("omits process_on too when it is not supplied", () => {
    const xml = buildGetUploadTokenXml(1, undefined, undefined, { i_tariff: 65 });
    expect(xml).not.toContain('process_on');
    expect(xml).toContain('<int>65</int>');
  });

  it("GUARD: uploadExpiresOn() is not called anywhere — the builder test alone cannot catch this", () => {
    // The tests above prove the builder omits the element when given undefined. They would
    // still pass if a CALL SITE started supplying one again, which is exactly how this
    // regressed: the builder never changed, the call sites did. A first attempt at this guard
    // parsed call arguments with a length-capped regex and silently skipped the one call site
    // it existed to protect, because a long comment pushed it past the cap. So this asserts
    // the simplest checkable fact instead: the helper has no callers at all.
    const src = readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8');
    const uses = src.split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(l => /\buploadExpiresOn\s*\(/.test(l.line))
      .filter(l => !/^function uploadExpiresOn/.test(l.line))   // its own declaration
      .filter(l => !l.line.startsWith('//') && !l.line.startsWith('*'));
    expect(uses.map(u => `sippy.ts:${u.n} ${u.line}`)).toEqual([]);
  });
});
