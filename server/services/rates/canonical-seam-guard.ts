/**
 * canonical-seam-guard.ts — proving, from source, that no rate mutation escapes the canonical seam.
 *
 * THE INVARIANT IT ENFORCES:
 *
 *   No production rate mutation may reach `setSippyRateEntry` or `pushRateToSippy`
 *   except through the canonical `runRateBatch` seam.
 *
 * WHY A SOURCE GUARD RATHER THAN A TYPE. The primitives live on the `sippy` client module and are
 * legitimately callable; nothing in the type system distinguishes "called under the tariff lock"
 * from "called in a bare loop". The difference is structural, and it is exactly the difference
 * between the two entry points as they stand:
 *
 *   push-batch           wraps the primitive in `pushFor(jobId)` and passes it as `deps.push`.
 *                        `runRateBatch` invokes it INSIDE the advisory lock it holds.
 *   change-client-rates  calls `sippy.setSippyRateEntry(...)` from its own `for` loop, with no
 *                        lock and no lane. That is the bypass.
 *
 * So injection into the engine is correct and a direct call is not, and the rule follows: every
 * mutation call must sit inside a function that the handler hands to `runRateBatch` as a dependency.
 *
 * WHAT THIS CAN AND CANNOT PROVE. It reasons over text with brace matching, not a full parse. It
 * proves the structural property for handlers written in the shape this codebase actually uses, and
 * `bypassing`/`canonical` fixtures in its test prove the checker itself discriminates — the
 * failure this project has hit repeatedly is an instrument that reports a clean negative because it
 * never worked (`legacy-cdr-feed-stopped`, and the two regex attribution attempts in this audit).
 * It is not a substitute for review of a handler written in some other shape.
 */

/** The calls that mutate rates in Sippy. Reads are irrelevant here. */
export const MUTATION_PRIMITIVES = [
  'pushRateToSippy', 'setSippyRateEntry', 'deleteSippyRateEntry',
  'deleteAllRatesInTariff', 'addRateDirectToTariff', 'uploadRateGroup', 'pushRatesBulkXlsx',
] as const;

export const CANONICAL_SEAM = 'runRateBatch';

export type SeamFinding =
  | { readonly kind: 'NO_CANONICAL_SEAM'; readonly primitives: readonly string[] }
  | { readonly kind: 'DIRECT_MUTATION'; readonly primitive: string; readonly offset: number };

/** Body of the balanced `{...}` block that follows `from`, or null. */
function balancedBlockAfter(src: string, from: number): { start: number; end: number } | null {
  const start = src.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { start, end: i }; }
  }
  return null;
}

/**
 * Identifiers appearing in the `push` / `pushGroup` VALUE of every `runRateBatch(` deps object.
 * The whole value expression is scanned, not just the first identifier: the real call site writes
 * `pushGroup: bulkGroups ? pushGroupFor(jobId) : undefined`, and taking the first name there
 * captures the ternary's CONDITION and silently loses the factory.
 */
function injectedFactoryNames(src: string): Set<string> {
  const names = new Set<string>();
  const call = new RegExp(`${CANONICAL_SEAM}\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = call.exec(src)) !== null) {
    const deps = balancedBlockAfter(src, m.index + m[0].length - 1);
    if (!deps) continue;
    const body = src.slice(deps.start, deps.end + 1);
    for (const mm of body.matchAll(/\b(push|pushGroup)\s*:/g)) {
      // the value runs to the next comma at depth 0, or the end of the object
      let i = mm.index! + mm[0].length, depth = 0, out = '';
      for (; i < body.length; i++) {
        const c = body[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
        else if (c === ',' && depth === 0) break;
        out += c;
      }
      for (const id of out.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(id[0]);
    }
  }
  return names;
}

/**
 * Ranges covering the named functions' declarations.
 *
 * The extent is the whole STATEMENT — declaration through the `;` at depth zero — not the first
 * balanced `{...}`. A brace-less arrow (`const pushFor = (j) => async (o) => await sippy.push(...)`)
 * has no block of its own, and looking for one runs past the declaration entirely and swallows
 * unrelated later code, which is how a direct call beside a correct one escapes detection.
 */
function bodiesOf(src: string, names: ReadonlySet<string>): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const n of names) {
    const decl = new RegExp(`(?:function\\s+${n}\\s*\\(|(?:const|let|var)\\s+${n}\\s*=)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = decl.exec(src)) !== null) {
      let depth = 0, end = -1;
      for (let i = m.index; i < src.length; i++) {
        const c = src[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { depth--; if (depth === 0 && c === '}') { end = i; } }
        else if (c === ';' && depth === 0) { end = i; break; }
      }
      if (end < 0) { const b = balancedBlockAfter(src, m.index); if (b) end = b.end; }
      if (end > m.index) out.push({ start: m.index, end });
    }
  }
  return out;
}

/**
 * Analyse one handler's source. Empty array means the invariant holds for this handler.
 */
export function findSeamBypasses(source: string): SeamFinding[] {
  const present = MUTATION_PRIMITIVES.filter(p => new RegExp(`\\b${p}\\s*\\(`).test(source));
  if (present.length === 0) return [];

  if (!new RegExp(`\\b${CANONICAL_SEAM}\\s*\\(`).test(source)) {
    return [{ kind: 'NO_CANONICAL_SEAM', primitives: present }];
  }

  const allowed = bodiesOf(source, injectedFactoryNames(source));
  const inside = (i: number) => allowed.some(r => i > r.start && i < r.end);

  const findings: SeamFinding[] = [];
  for (const p of MUTATION_PRIMITIVES) {
    for (const m of source.matchAll(new RegExp(`\\b${p}\\s*\\(`, 'g'))) {
      if (!inside(m.index!)) findings.push({ kind: 'DIRECT_MUTATION', primitive: p, offset: m.index! });
    }
  }
  return findings;
}

/** True when this handler's every mutation goes through the seam. */
export function holdsCanonicalSeam(source: string): boolean {
  return findSeamBypasses(source).length === 0;
}
