// server/action-firewall.ts
// ── C2 Execution Firewall ─────────────────────────────────────────────────────
// Hard safety constraints evaluated before every approval/execution.
// If any rule fires, the action is blocked and the reason returned.
// These rules prevent cascade failures from bad automation.

import { Pool } from 'pg';

export interface FirewallResult {
  allowed:  boolean;
  blocking: string[];   // rule names that fired
  warnings: string[];   // advisory (non-blocking) rule names
}

// ── Rule definitions ──────────────────────────────────────────────────────────

// Maximum number of accounts that may be in ACCOUNT_FREEZE simultaneously.
const MAX_CONCURRENT_FREEZES = 2;

// Maximum number of accounts that may be RATE_LIMITED simultaneously.
const MAX_CONCURRENT_RATE_LIMITS = 5;

// Minimum window between applying the same actionType to the same account (ms).
const MIN_REPEAT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Minimum CPS allowed via automated RATE_LIMIT action (params-level check).
const MIN_SAFE_CPS = 0.1;

// ── Firewall evaluation ───────────────────────────────────────────────────────

export async function evaluateFirewall(
  accountId:  string,
  actionType: string,
  params:     Record<string, unknown>,
): Promise<FirewallResult> {
  const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
  const blocking: string[] = [];
  const warnings: string[] = [];

  try {
    // ── Rule 1: Concurrent freeze limit ──────────────────────────────────────
    if (actionType === 'ACCOUNT_FREEZE') {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM account_actions
         WHERE action_type = 'ACCOUNT_FREEZE'
           AND status IN ('approved','executed')`,
      );
      const active = parseInt(rows[0]?.cnt ?? '0', 10);
      if (active >= MAX_CONCURRENT_FREEZES) {
        blocking.push(
          `FREEZE_LIMIT: ${active} account(s) already frozen (max ${MAX_CONCURRENT_FREEZES}). Unfreeze an account before adding another.`,
        );
      } else if (active >= MAX_CONCURRENT_FREEZES - 1) {
        warnings.push(`FREEZE_WARN: This will reach the concurrent freeze limit (${MAX_CONCURRENT_FREEZES}).`);
      }
    }

    // ── Rule 2: Concurrent rate-limit cap ─────────────────────────────────────
    if (actionType === 'RATE_LIMIT') {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM account_actions
         WHERE action_type = 'RATE_LIMIT'
           AND status IN ('approved','executed')`,
      );
      const active = parseInt(rows[0]?.cnt ?? '0', 10);
      if (active >= MAX_CONCURRENT_RATE_LIMITS) {
        blocking.push(
          `RATE_LIMIT_CAP: ${active} accounts already rate-limited (max ${MAX_CONCURRENT_RATE_LIMITS}). Review existing limits before adding more.`,
        );
      }
    }

    // ── Rule 3: Repeat-action cooldown ────────────────────────────────────────
    const { rows: recent } = await pool.query(
      `SELECT id, created_at FROM account_actions
       WHERE account_id   = $1
         AND action_type  = $2
         AND status NOT IN ('rejected','rolled_back')
         AND created_at   > NOW() - INTERVAL '1 hour'
       ORDER BY created_at DESC LIMIT 1`,
      [accountId, actionType],
    );
    if (recent.length > 0) {
      const ageMs    = Date.now() - new Date(recent[0].created_at).getTime();
      const remaining = Math.ceil((MIN_REPEAT_INTERVAL_MS - ageMs) / 60000);
      if (ageMs < MIN_REPEAT_INTERVAL_MS) {
        blocking.push(
          `COOLDOWN: Same action (${actionType}) was applied to account ${accountId} ${Math.round(ageMs / 60000)}m ago. Wait ${remaining}m before re-applying.`,
        );
      }
    }

    // ── Rule 4: CPS floor (params-level) ─────────────────────────────────────
    if (actionType === 'RATE_LIMIT' && params.max_cps !== undefined) {
      const cps = parseFloat(String(params.max_cps));
      if (!isNaN(cps) && cps < MIN_SAFE_CPS) {
        blocking.push(
          `CPS_FLOOR: max_cps=${cps} is below the minimum safe value (${MIN_SAFE_CPS}). Setting CPS this low risks complete traffic blackout.`,
        );
      }
    }

    // ── Rule 5: Advisory — multiple action types on one account ───────────────
    const { rows: multi } = await pool.query(
      `SELECT DISTINCT action_type FROM account_actions
       WHERE account_id  = $1
         AND status IN ('approved','executed')`,
      [accountId],
    );
    if (multi.length >= 2) {
      warnings.push(
        `MULTI_ACTION: Account ${accountId} already has ${multi.length} active action type(s): ${multi.map((r: any) => r.action_type).join(', ')}. Verify combined effect before adding another.`,
      );
    }

    return { allowed: blocking.length === 0, blocking, warnings };
  } finally {
    await pool.end();
  }
}
