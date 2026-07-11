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
  app.get('/api/dev/self-test', async (req, res) => {
    try {
      const module = typeof req.query.module === 'string' ? req.query.module : undefined;
      const type = typeof req.query.type === 'string' ? (req.query.type as SelfTestType) : undefined;
      const result = await runSelfTests({ module, type });
      return res.json({ modules: listModules(), ...result });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });
}
