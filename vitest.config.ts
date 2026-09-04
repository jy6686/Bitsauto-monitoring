import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 15_000,
    include: ['server/**/*.test.ts'],
    exclude: ['node_modules/**', '.cache/**', 'dist/**'],
    // A PARSEABLE BUT UNREACHABLE connection string, for tests that must import
    // a module whose import chain reaches server/db.ts — which throws on a
    // missing DATABASE_URL at module load, before any test body runs.
    //
    // It points at a closed port on purpose. pg's Pool does not connect when it
    // is constructed, so a test exercising PURE logic never dials out; a test
    // that accidentally issues a query fails on connection refused instead of
    // silently reaching a real database. Deliberately not a valid host: a test
    // suite that can reach production data is a worse problem than one that
    // cannot start.
    //
    // Almost every suite here needs nothing from this — the finance modules are
    // written to be pure precisely so they can be tested without a database.
    env: { DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/none' },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
});
