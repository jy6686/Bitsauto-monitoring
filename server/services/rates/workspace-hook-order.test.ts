/**
 * WorkspaceShell must call the same hooks on every render.
 *
 * It called `useState`, then returned early on `isLoading`, then returned early again on
 * `scope?.scopeError`, and only AFTER both returns called `useQuery` for
 * /api/commercial/actions. A hook behind a conditional return.
 *
 * That violation was unreachable for as long as `/api/commercial/scope` was broken: it
 * answered `scopeError: 'no_kam_link'` for every admin, so the component always returned at
 * the second branch with a stable hook count. Fixing the scope resolution in `ca75be4b` let
 * rendering continue past both returns for the first time, the hook count grew between
 * renders, and React tore the tree down — production showed "Application Error / Minified
 * React error #310" on /commercial, verified live 2026-09-20 on build `b32936c2`.
 *
 * So this is a LATENT defect that a correct fix elsewhere exposed. It must not be "fixed" by
 * restoring the scope bug.
 *
 * WHY THIS IS A SOURCE TEST. The rule of hooks is a static property, and this repo has no
 * way to render a component in a test: vitest runs with `environment: 'node'` and there is no
 * jsdom, no @testing-library/react, and no react-test-renderer. There is also no eslint at
 * all, so `react-hooks/rules-of-hooks` is not watching this. Adding a DOM test stack to catch
 * one ordering bug is a bigger change than the bug; asserting the ordering directly is not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = readFileSync(
  join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'commercial-workspace.tsx'),
  'utf8',
);

/** Blank comments in place — same length, same line count — so offsets stay truthful. */
const blankComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
   .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));

/** A hook call: the name, then `(` or a generic like `useQuery<Resp>(`. */
const HOOK = /\b(use[A-Z][A-Za-z0-9]*)\s*[<(]/;

/** The body of a named function component, by brace matching. */
function bodyOf(code: string, name: string): string {
  const at = code.search(new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, 'm'));
  expect(at, `${name} must exist`).toBeGreaterThan(-1);
  const open = code.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(open + 1, i); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

interface Scan { hookLines: Array<{ hook: string; idx: number }>; firstEarlyReturn: number | null }

/**
 * Scan a component body for hooks called at the component's own statement level, and for the
 * first `if (...) { ... return ... }` at that same level.
 *
 * Only depth-0 lines count, which is what keeps `return` statements INSIDE a `useMemo` or
 * `useQuery` callback from being mistaken for the component returning early — a distinction
 * an earlier version of this scan got wrong, reporting two components that were perfectly
 * correct.
 */
function scan(body: string): Scan {
  const lines = body.split('\n');
  const hookLines: Array<{ hook: string; idx: number }> = [];
  let firstEarlyReturn: number | null = null;
  let depth = 0;
  let blockStart: number | null = null;
  let blockHasReturn = false;

  lines.forEach((line, i) => {
    const before = depth;
    if (before === 0 && HOOK.test(line)) hookLines.push({ hook: line.match(HOOK)![1], idx: i });
    if (before === 0 && /^\s*if\s*\(/.test(line)) { blockStart = i; blockHasReturn = false; }
    if (before >= 1 && /\breturn\b/.test(line)) blockHasReturn = true;
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (before >= 1 && depth === 0 && blockStart !== null) {
      if (blockHasReturn && firstEarlyReturn === null) firstEarlyReturn = blockStart;
      blockStart = null;
    }
  });
  return { hookLines, firstEarlyReturn };
}

describe('WorkspaceShell calls every hook before it can return', () => {
  const body = bodyOf(blankComments(PAGE), 'WorkspaceShell');
  const { hookLines, firstEarlyReturn } = scan(body);

  it('has the early returns this test is about — otherwise it is guarding nothing', () => {
    expect(firstEarlyReturn, 'WorkspaceShell should still return early while loading').not.toBeNull();
  });

  it('still calls the hooks it needs', () => {
    const names = hookLines.map(h => h.hook);
    expect(names).toContain('useCommercialWorkspace');
    expect(names).toContain('useState');
    expect(names).toContain('useQuery');
  });

  /**
   * THE LINE THAT MATTERS. Every hook must sit above the first conditional return, so the
   * render that bails and the render that proceeds run the identical hook sequence.
   */
  it('calls NO hook after the first conditional return', () => {
    const after = hookLines.filter(h => firstEarlyReturn !== null && h.idx > firstEarlyReturn);
    expect(after.map(h => h.hook), 'hooks reached only on some renders').toEqual([]);
  });

  it('specifically, the actions query is above the returns', () => {
    const q = hookLines.find(h => h.hook === 'useQuery');
    expect(q, 'the actions query must still be in this component').toBeDefined();
    expect(q!.idx).toBeLessThan(firstEarlyReturn!);
  });
});

describe('the scan itself is honest', () => {
  /**
   * The first version of this scan counted a `return` inside a `useMemo` callback as the
   * component returning early, and reported LiveTrafficSection and ActionsSection as broken
   * when they are fine. These two hold that correction: a callback's return is not an early
   * return, and a real early return is still detected.
   */
  it('does not mistake a return inside a callback for an early return', () => {
    const fine = `
      const [a, setA] = useState('');
      const m = useMemo(() => {
        if (!a) return [];
        return [a];
      }, [a]);
      return <div>{m}</div>;
    `;
    const { firstEarlyReturn } = scan(fine);
    expect(firstEarlyReturn).toBeNull();
  });

  it('does detect a genuine early return, and a hook placed after one', () => {
    const broken = `
      const [a, setA] = useState('');
      if (!a) {
        return <div>loading</div>;
      }
      const q = useQuery({ queryKey: ['x'] });
      return <div>{q}</div>;
    `;
    const { firstEarlyReturn, hookLines } = scan(broken);
    expect(firstEarlyReturn).not.toBeNull();
    expect(hookLines.filter(h => h.idx > firstEarlyReturn!).map(h => h.hook)).toEqual(['useQuery']);
  });
});
