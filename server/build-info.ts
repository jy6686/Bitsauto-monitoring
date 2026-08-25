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
import { execSync } from 'child_process';

// This module must work under BOTH module systems: the dev server runs as ESM
// ("type": "module" + tsx) where __dirname and require() do not exist, and the
// production bundle is CommonJS where import.meta.url does not exist. So it
// uses neither — only process.cwd(), which is defined in both.

export interface BuildInfo {
  application: string;
  gitCommit: string;
  gitBranch: string;
  buildTime: string | null;
  version:   string;
  nodeVersion: string;
  /** Replit's instance identifier. Identifies the deployment, not the code. */
  deploymentId: string | null;
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
  for (const p of [
    path.join(process.cwd(), 'dist/build-info.json'),
    path.join(process.cwd(), 'build-info.json'),
  ]) {
    try {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
        cached = {
          application: 'BitsAuto',
          gitCommit: j.gitCommit ?? 'unknown',
          gitBranch: j.gitBranch ?? 'unknown',
          buildTime: j.buildTime ?? null,
          version:   j.version   ?? 'unknown',
          nodeVersion: process.version,
          deploymentId: process.env.REPL_ID ?? null,
          source:    'build-stamp',
          environment, startedAt: STARTED_AT,
        };
        return cached;
      }
    } catch { /* try the next location */ }
  }

  // Workspace: read the checkout directly.
  try {
    const git = (cmd: string) => execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim();
    const gitCommit = git('git rev-parse --short HEAD');
    const gitBranch = git('git rev-parse --abbrev-ref HEAD');
    cached = {
      application: 'BitsAuto',
      gitCommit, gitBranch, buildTime: null,
      version: `dev-${gitCommit}`,
      nodeVersion: process.version,
      deploymentId: process.env.REPL_ID ?? null,
      source: 'git', environment, startedAt: STARTED_AT,
    };
    return cached;
  } catch { /* fall through */ }

  cached = {
    application: 'BitsAuto',
    gitCommit: 'unknown', gitBranch: 'unknown', buildTime: null, version: 'unknown',
    nodeVersion: process.version,
    deploymentId: process.env.REPL_ID ?? null,
    source: 'unknown', environment, startedAt: STARTED_AT,
  };
  return cached;
}
