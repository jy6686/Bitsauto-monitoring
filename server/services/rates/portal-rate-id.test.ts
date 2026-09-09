/**
 * These reproduce the exact page shape that destroyed a production rate.
 *
 * Tariff 64 held one rate — `191 @ 0.02`, i_rate 9115. Pushing the NEW prefix 19370 scraped
 * `i_rate=9115` out of that row's edit link and submitted it with action=change, so Sippy
 * rewrote the existing row instead of adding one. The old fallback regex is reproduced here
 * verbatim so the tests can show it matching where the new resolver refuses.
 */
import { describe, it, expect } from "vitest";
import { resolveNewRateId } from "./portal-rate-id";

/** Sippy's rates page as it looked for tariff 64: one existing rate, rendered as an edit link. */
const PAGE_WITH_ONE_EXISTING_RATE = `
  <html><body><table>
    <tr><td><a href="rates_tariff.php?action=edit&i_rate=9115&i_tariff=64">191</a></td>
        <td>0.02</td></tr>
  </table></body></html>`;

/** A genuine add form: the reserved id arrives as a real input. */
const ADD_FORM = (id: number) => `
  <html><body><form method="GET" action="rates_tariff.php">
    <input type="hidden" name="action" value="change">
    <input type="hidden" name="i_rate" value="${id}">
    <input type="text" name="prefix" value="">
  </form></body></html>`;

/** The loose pattern the old code used second. Kept to demonstrate what it matched. */
const OLD_LOOSE_FALLBACK = /[?&]i_rate=(\d+)/i;

describe("resolveNewRateId", () => {
  it("REGRESSION — refuses the page that overwrote 191 @ 0.02 on tariff 64", () => {
    // The old fallback found 9115 here and submitted it as if it were a new id.
    expect(OLD_LOOSE_FALLBACK.exec(PAGE_WITH_ONE_EXISTING_RATE)?.[1]).toBe('9115');

    const d = resolveNewRateId(PAGE_WITH_ONE_EXISTING_RATE, [9115]);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('no_form_field');
  });

  it("refuses an id that collides with an existing rate, even from a real form field", () => {
    // Belt and braces: a form that hands back an in-use id must not be trusted either.
    const d = resolveNewRateId(ADD_FORM(9115), [9115, 9116]);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('collides_with_existing');
    expect(d.ok === false && d.candidate).toBe(9115);
    expect(d.ok === false && d.message).toContain('191 @ 0.02');
  });

  it("accepts a genuinely new id from the form field", () => {
    const d = resolveNewRateId(ADD_FORM(9200), [9115, 9116]);
    expect(d.ok).toBe(true);
    expect(d.ok === true && d.iRate).toBe(9200);
  });

  it("accepts when the tariff is empty — nothing to collide with", () => {
    const d = resolveNewRateId(ADD_FORM(1), []);
    expect(d.ok === true && d.iRate).toBe(1);
  });

  it("reads the field with attributes in either order", () => {
    const reversed = `<input value="9201" name="i_rate" type="hidden">`;
    expect(resolveNewRateId(reversed, []).ok).toBe(true);
  });

  it("refuses a page with edit links but no add-form field", () => {
    // The multi-row case: a busy customer tariff. The old code would pick whichever link
    // its regex hit first and silently reprice that destination.
    const busy = `
      <a href="?action=edit&i_rate=4&i_tariff=2">19230</a>
      <a href="?action=edit&i_rate=5&i_tariff=2">19231</a>
      <a href="?action=edit&i_rate=6&i_tariff=2">19232</a>`;
    expect(OLD_LOOSE_FALLBACK.exec(busy)?.[1]).toBe('4');   // what the old code would have used
    const d = resolveNewRateId(busy, [4, 5, 6]);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toBe('no_form_field');
  });

  it("refuses empty, junk and unusable values rather than defaulting", () => {
    for (const html of ['', '<html></html>', '<input name="i_rate" value="">', '<input name="i_rate" value="abc">', '<input name="i_rate" value="0">']) {
      const d = resolveNewRateId(html, [9115]);
      expect(d.ok).toBe(false);
    }
  });

  it("does not treat a similarly-named field as the id", () => {
    const d = resolveNewRateId('<input name="i_rate_old" value="9115">', []);
    expect(d.ok).toBe(false);
  });
});
