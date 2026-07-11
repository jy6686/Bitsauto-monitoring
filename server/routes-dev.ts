/**
 * Developer / Test Lab routes — in-platform operational verification.
 * GET /api/dev/self-test[?module=&type=] → registered self-tests with PASS/FAIL/…
 *
 * Diagnostic only (no production side-effects for unit tests). Subsystem test
 * modules are imported here for their registration side-effects.
 */
import type { Express } from 'express';
import { runSelfTests, listModules, type SelfTestType } from './dev/self-test-registry';

// Register subsystem self-tests (side-effect imports)
import './dev/vendor-rates-self-tests';

export function registerDevRoutes(app: Express): void {
  // GET /api/dev/self-test?module=&type=&tag=&deterministic=true
  app.get('/api/dev/self-test', async (req, res) => {
    try {
      const s = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
      const result = await runSelfTests({
        module: s('module'),
        type: s('type') as SelfTestType | undefined,
        tag: s('tag'),
        deterministicOnly: s('deterministic') === 'true',
      });
      return res.json({ modules: listModules(), ...result });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });
}
