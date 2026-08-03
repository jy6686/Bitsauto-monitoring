/**
 * Plain-language identity analysis — CAP-023 §10.
 *
 * No LLM. Every sentence is a direct consequence of a recorded field, so the
 * narration cannot describe a transformation that did not happen. Regenerated
 * on read and never stored (CAP-021 L3), so rewording it can never alter
 * recorded evidence.
 *
 * The style rule that matters: describe, do not accuse. A transformation is
 * reported with what was observed and what remains unobserved. Whether it
 * breaches anything is an L4 rule-pack decision made elsewhere, with the
 * commercial terms in hand.
 */

import type { CliComparison } from './cli.js';
import type { CldComparison } from './cld.js';

export interface IdentityEvidence {
  /** CLI observations, in path order. */
  cli: CliComparison[];
  /** CLD observations, in path order. */
  cld: CldComparison[];
}

const LEVEL_NAME: Record<string, string> = {
  O1: 'the request itself',
  O2: 'our own network',
  O3: 'a terminating endpoint we control',
  O4: 'the handset',
};

export function narrateIdentity(e: IdentityEvidence): string[] {
  const out: string[] = [];

  // ── Caller identity ──────────────────────────────────────────────────────
  const cliObserved = e.cli.filter(c => c.observation !== 'UNKNOWN');
  if (cliObserved.length === 0) {
    out.push(
      'No caller identity was observed anywhere on this call, so nothing can be said about ' +
      'whether the requested CLI survived. Only what we asked for is known.',
    );
  } else {
    const last = cliObserved[cliObserved.length - 1];
    const requested = last.requested.e164 ?? last.requested.input;
    const stages = cliObserved
      .map(c => `${LEVEL_NAME[c.evidenceLevel] ?? c.evidenceLevel} recorded ${c.observed?.e164 ?? c.observed?.input ?? 'nothing'}`)
      .join(', and ');

    if (cliObserved.every(c => c.observation === 'EXACT')) {
      out.push(
        `The requested caller ID was ${requested}. Every point we can see recorded the identical ` +
        `value — ${stages} — so there is no evidence of rewriting within the parts of the path we observe.`,
      );
    } else if (last.observation === 'LOCALIZED') {
      out.push(
        `The requested caller ID was ${requested}, and it arrived as ${last.observed?.input} — the same ` +
        `number in the destination's national format. A subscriber there can return the call as ` +
        `presented, so this is correct localization rather than a rewrite.`,
      );
    } else if (last.observation === 'SUPPRESSED') {
      out.push(
        `The requested caller ID was ${requested}, but the call arrived with no caller identity at all ` +
        `(${last.observed?.input || 'empty'}). Suppression is applied deliberately by some networks and ` +
        `mandated on some routes, so this records what happened without implying it was improper.`,
      );
    } else if (last.observation === 'REWRITTEN') {
      out.push(
        `The requested caller ID was ${requested}, and ${LEVEL_NAME[last.evidenceLevel]} recorded ` +
        `${last.observed?.e164} instead. That is a different but well-formed number. Substitution is ` +
        `legitimate on routes subject to regulatory CLI rules, so this is recorded as an observation, ` +
        `not a fault.`,
      );
    } else if (last.observation === 'MALFORMED') {
      out.push(
        `The requested caller ID was ${requested}, and what arrived (${last.observed?.input}) cannot be ` +
        `dialled from the destination. ${last.reason} Whatever the intent, the recipient cannot return ` +
        `this call.`,
      );
    }
  }

  // ── Called number ────────────────────────────────────────────────────────
  const cldObserved = e.cld.filter(c => c.observation !== 'UNKNOWN');
  for (const c of cldObserved) {
    if (c.asConfigured === true) {
      out.push(`At ${c.stage} the called number was recorded as ${c.observed}. ${c.reason}`);
    } else if (c.asConfigured === false) {
      out.push(
        `At ${c.stage} the called number was recorded as ${c.observed}, which is not what the ` +
        `configuration predicts. ${c.reason}`,
      );
    }
  }

  // ── What remains unobserved ──────────────────────────────────────────────
  const seen = new Set([...e.cli, ...e.cld]
    .filter(c => c.observation !== 'UNKNOWN')
    .map(c => c.evidenceLevel));
  const missing = (['O3', 'O4'] as const).filter(l => !seen.has(l));

  if (missing.length) {
    out.push(
      missing.length === 2
        ? 'No vendor or handset evidence exists for this call, so nothing can be concluded about ' +
          'caller identity beyond our own network. A carrier further along the path could have ' +
          'rewritten, localized or suppressed the CLI and this call would look exactly the same to us.'
        : `No ${missing[0] === 'O4' ? 'handset' : 'terminating-endpoint'} evidence exists for this call, ` +
          `so the final presentation to the subscriber is unverified.`,
    );
  }

  return out;
}
