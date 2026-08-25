/**
 * build-info.ts
 *
 * Which code is this instance running.
 *
 * A published deployment and the workspace dev server look identical from a
 * screenshot, and the Health page's "Commit" was a slice of REPL_ID — an
 * environment identifier that never changes between deploys. So fixes that had
 * been pushed but never published were repeatedly assumed live, and the only
 * way to tell was to hunt for a visible symptom.
 *
 * Production reads the stamp written by script/build.ts at build time. The dev
 * server has no such file, so it reads git directly and says so. Neither path
 * ever invents a value: an unknown build reports "unknown".
 */

import fs from 'fs';
import path from 'path';

export interface BuildInfo {
  gitCommit: string;
  buildTime: string | null;
  version:   string;
  /** 'build-stamp' in a deployed image, 'git' in the workspace. */
  source:    'build-stamp' | 'git' | 'unknown';
  environment: 'production' | 'workspace';
  startedAt: string;
}

const STARTED_AT = new Date().toISOString();
let cached: BuildInfo | null = null;

export function getBuildInfo(): BuildInfo {
  if (cached) return cached;

  const environment: BuildInfo['environment'] =
    process.env.NODE_ENV === 'production' ? 'production' : 'workspace';

  // Deployed image: the stamp baked in at build time.
  for (const p of [path.join(process.cwd(), 'dist/build-info.json'), path.join(__dirname, 'build-info.json')]) {
    try {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
        cached = {
          gitCommit: j.gitCommit ?? 'unknown',
          buildTime: j.buildTime ?? null,
          version:   j.version   ?? 'unknown',
          source:    'build-stamp',
          environment, startedAt: STARTED_AT,
        };
        return cached;
      }
    } catch { /* try the next location */ }
  }

  // Workspace: read the checkout directly.
  try {
    const { execSync } = require('child_process');
    const gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', timeout: 3000 }).trim();
    cached = {
      gitCommit, buildTime: null,
      version: `dev-${gitCommit}`,
      source: 'git', environment, startedAt: STARTED_AT,
    };
    return cached;
  } catch { /* fall through */ }

  cached = {
    gitCommit: 'unknown', buildTime: null, version: 'unknown',
    source: 'unknown', environment, startedAt: STARTED_AT,
  };
  return cached;
}
