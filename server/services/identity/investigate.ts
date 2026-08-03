/**
 * Identity investigator — CAP-023 §12.
 *
 * Answers a bounded set of operator questions from recorded evidence.
 *
 * ── Why this is deterministic and not an LLM call ────────────────────────────
 *
 * The questions operators actually ask under pressure are attribution
 * questions: "can I blame the vendor?", "was it our switch?". Those are not
 * judgements about the call. They are set-membership tests on evidence
 * coverage — does any observation exist at or beyond the point being blamed?
 * That has an exact answer, computable from the timeline's observation ceiling.
 *
 * Routing it through a language model would take an answer that is currently
 * always right and make it usually right. Worse, the failure mode is a fluent,
 * confident accusation of a named supplier — which is the single most expensive
 * mistake this platform could make, because it would be repeated to that
 * supplier in a commercial conversation.
 *
 * So the reasoning is fixed code and the evidence is the input. An LLM belongs
 * on top of this later, phrasing and routing questions to these answers — never
 * deciding them (CAP-021 AF-003: AI may flag and explain, never drive).
 *
 * CAP-021 L3: recomputable, never stored.
 */

import type { CliComparison } from './cli.js';
import type { CldComparison } from './cld.js';
import { bracket, reaches, type IdentityTimeline } from './timeline.js';

export type InvestigationQuestion =
  | 'what-happened'
  | 'can-i-blame-the-vendor'
  | 'can-i-blame-our-switch'
  | 'why-is-the-cld-different'
  | 'what-did-the-subscriber-see';

/**
 * Three ways of not knowing, and they are operationally different:
 *
 *   unsupported  — the evidence never existed. Nothing was observed at or
 *                  beyond the subject.
 *   inconclusive — evidence exists but does not resolve the question. Either
 *                  observations conflict, or a change is real but the gap
 *                  between the two observations contains several suspects.
 *   no           — evidence exists, reaches the subject, and clears it.
 *
 * Collapsing these is how an evidence platform starts producing confident
 * wrong answers. "Nothing was observed at the vendor", "something changed
 * somewhere in a span that includes the vendor" and "the vendor did not do it"
 * lead to three different next actions.
 */
export type InvestigationVerdict =
  | 'yes' | 'no' | 'partially' | 'inconclusive' | 'unsupported' | 'observed' | 'none';

export interface InvestigationAnswer {
  question: InvestigationQuestion;
  /** The question as an operator would phrase it. */
  asked: string;
  verdict: InvestigationVerdict;
  answer: string[];
  /** Which observations the answer rests on. */
  basedOn: string[];
  /** What was not observed, and therefore not concluded. */
  limits: string[];
}

export interface InvestigationInput {
  timeline: IdentityTimeline;
  cli: CliComparison[];
  cld: CldComparison[];
}

const ASKED: Record<InvestigationQuestion, string> = {
  'what-happened':              'What happened to the call identity?',
  'can-i-blame-the-vendor':     'Can I blame the vendor?',
  'can-i-blame-our-switch':     'Can I blame our switch?',
  'why-is-the-cld-different':   'Why is the called number different?',
  'what-did-the-subscriber-see': 'What did the subscriber see?',
};

function coverage(t: IdentityTimeline): string {
  return t.observationCeiling
    ? `Evidence reaches ${t.observationCeiling} (${t.observedStages.filter(s => s !== 'Requested').join(', ') || 'none'}).`
    : 'No observation was made anywhere on this call.';
}

export function investigate(
  input: InvestigationInput,
  question: InvestigationQuestion,
): InvestigationAnswer {
  const { timeline, cli, cld } = input;
  const asked = ASKED[question];
  const basedOn = [coverage(timeline)];
  const limits: string[] = [];

  if (timeline.unobservedStages.length) {
    limits.push(`Not observed: ${timeline.unobservedStages.join(', ')}.`);
  }

  switch (question) {
    // ── Attribution: answered from evidence coverage, never from behaviour ──
    case 'can-i-blame-the-vendor': {
      if (!reaches(timeline, 'O3')) {
        return {
          question, asked, verdict: 'unsupported', basedOn, limits,
          answer: [
            'No — and not because the vendor is cleared. There is no observation point inside or ' +
            'beyond the downstream vendor network on this call, so no conclusion about vendor ' +
            'behaviour can be supported in either direction.',
            'Everything recorded here stops at our own infrastructure. A vendor could have ' +
            'rewritten, localized or suppressed the identity and this call would look exactly ' +
            'the same to us.',
            'Making this answerable is CAP-023 O3 — a terminating endpoint we control — and, for ' +
            'attributing a finding to one named supplier rather than to the route, CAP-022 vendor ' +
            'targeting.',
          ],
        };
      }
      // Reaching past the vendor is not enough to blame it. The value must have
      // been observed entering AND leaving — otherwise a change seen further
      // along could have been made by any hop in the gap.
      const br = bracket(timeline, 'Vendor');

      // Compare the value ENTERING the span against the value once it has
      // passed. Scanning for "any downstream change" was wrong: it blamed the
      // vendor for a rewrite the carrier made two hops later.
      const entering = br.before?.cli.value ?? null;
      const leaving  = br.after?.cli.value ?? null;
      const changedAcrossSpan = entering != null && leaving != null && entering !== leaving;

      if (changedAcrossSpan && !br.isolated) {
        return {
          question, asked, verdict: 'inconclusive',
          basedOn: [...basedOn,
            `Change observed between ${br.before?.stage ?? 'the start'} and ${br.after?.stage ?? 'the end'}.`],
          limits: [...limits,
            `Unobserved hops inside that span: ${br.spanned.join(', ')}.`,
            'A transformation is attributable to the route, not to a named supplier, until ' +
            'CAP-022 vendor targeting is bound.'],
          answer: [
            `A transformation is real but cannot be pinned on the vendor. The identity was ` +
            `${entering} at ${br.before?.stage} and ${leaving} at ${br.after?.stage}, and that ` +
            `span contains ${br.spanned.length} possible hops: ${br.spanned.join(', ')}.`,
            'Isolating the vendor needs an observation on both sides of it, not merely one ' +
            'further along the path.',
          ],
        };
      }

      return {
        question, asked,
        verdict: changedAcrossSpan ? 'yes' : 'no',
        basedOn: [...basedOn,
          `Identity ${entering} at ${br.before?.stage} → ${leaving} at ${br.after?.stage}.`],
        limits: [
          ...limits,
          'A transformation observed downstream is attributable to the route, not to a named ' +
          'supplier, until CAP-022 vendor targeting is bound.',
        ],
        answer: changedAcrossSpan
          ? [`Yes. The vendor is the only hop between two observations, and the identity changed ` +
             `across it: ${entering} → ${leaving}.`]
          : ['No. The vendor is bracketed by observations on both sides and the identity is ' +
             `unchanged across it (${entering}). Any transformation on this call happened ` +
             'elsewhere in the path.'],
      };
    }

    case 'can-i-blame-our-switch': {
      const ours = [...cli.filter(c => c.evidenceLevel === 'O2'), ]
        .filter(c => c.observation !== 'UNKNOWN');
      const oursCld = cld.filter(c => c.evidenceLevel === 'O2' && c.observation !== 'UNKNOWN');

      if (ours.length === 0 && oursCld.length === 0) {
        return {
          question, asked, verdict: 'unsupported', basedOn, limits,
          answer: ['Nothing was observed inside our own infrastructure on this call, so its ' +
                   'behaviour is unverified. This is a gap in capture, not a clean bill of health.'],
        };
      }

      const cliClean = ours.every(c => c.observation === 'EXACT' || c.observation === 'LOCALIZED');
      const cldUnexpected = oursCld.filter(c => c.asConfigured === false);

      const answer: string[] = [];
      if (cliClean && ours.length) {
        answer.push(
          'Not for the caller identity. The requested CLI was originated as configured and ' +
          'recorded unchanged at every point we can see inside our own network.',
        );
      } else if (ours.length) {
        answer.push(
          `Yes, for the caller identity: ${ours.filter(c => c.observation !== 'EXACT').map(c => c.reason).join(' ')}`,
        );
      }
      if (cldUnexpected.length) {
        answer.push(
          'For the called number, a transformation inside our own path did not match the ' +
          `configuration: ${cldUnexpected.map(c => c.reason).join(' ')}`,
        );
      } else if (oursCld.length) {
        answer.push('The called-number transformation matched what the configuration predicts.');
      }

      // CLI and CLD are separate findings and routinely disagree — a clean CLI
      // with an unexpected CLD is the exact shape of the first PASS. Collapsing
      // them into one yes/no produced a verdict that contradicted its own first
      // sentence.
      const cliBlamed = ours.length > 0 && !cliClean;
      const cldBlamed = cldUnexpected.length > 0;
      return {
        question, asked,
        verdict: cliBlamed && cldBlamed ? 'yes'
          : cliBlamed || cldBlamed   ? 'partially'
          : 'no',
        answer, limits,
        basedOn: [...basedOn,
          ...ours.map(c => `CLI @ ${c.evidenceLevel}: ${c.observation}`),
          ...oursCld.map(c => `CLD @ ${c.stage}: ${c.observation}`)],
      };
    }

    case 'why-is-the-cld-different': {
      const changed = cld.filter(c => c.observation !== 'UNKNOWN' && c.observation !== 'UNCHANGED');
      if (!changed.length) {
        return {
          question, asked, verdict: 'none', basedOn, limits,
          answer: ['No called-number transformation was observed on this call.'],
        };
      }
      return {
        question, asked, verdict: 'observed',
        basedOn: [...basedOn, ...changed.map(c => `${c.stage}: ${c.observation}`)],
        limits: [
          ...limits,
          'The evidence establishes that a transformation occurred and what it produced. It does ' +
          'not identify which translation rule produced it — that lives in the switch ' +
          'configuration, outside this platform.',
        ],
        answer: changed.map(c =>
          `At ${c.stage} the number was recorded as ${c.observed}. ${c.reason}`,
        ),
      };
    }

    case 'what-did-the-subscriber-see': {
      if (!reaches(timeline, 'O4')) {
        return {
          question, asked, verdict: 'unsupported', basedOn, limits,
          answer: [
            'Unknown. No handset observation exists for this call, and nothing upstream can ' +
            'substitute for it — the terminating mobile network applies localization and ' +
            'suppression after the last point we can see.',
            'Closing this needs either an attested report from the person who answered, or a ' +
            'device agent on a registered test SIM (CAP-023 §6).',
          ],
        };
      }
      const handset = cli.find(c => c.evidenceLevel === 'O4');
      return {
        question, asked, verdict: 'observed',
        basedOn: [...basedOn, `O4: ${handset?.observation}`],
        limits,
        answer: [`The handset presented ${handset?.observed?.input}. ${handset?.reason ?? ''}`],
      };
    }

    case 'what-happened':
    default: {
      const parts: string[] = [];
      for (const s of timeline.stages.filter(s => s.observed)) {
        const bits = [
          s.cli.value ? `CLI ${s.cli.value}` : null,
          s.cld.value ? `CLD ${s.cld.value}` : null,
        ].filter(Boolean).join(', ');
        if (bits) parts.push(`${s.stage}: ${bits}${s.transformation ? ` (${s.transformation})` : ''}`);
      }
      return {
        question, asked, verdict: 'observed', basedOn, limits,
        answer: [
          parts.join('. ') + '.',
          timeline.unobservedStages.length
            ? `Beyond that the path is unobserved (${timeline.unobservedStages.join(', ')}), so ` +
              'nothing about the identity presented to the subscriber can be concluded from this call.'
            : 'The full path was observed.',
        ],
      };
    }
  }
}

/** Every question, for a panel that shows them all at once. */
export function investigateAll(input: InvestigationInput): InvestigationAnswer[] {
  return (Object.keys(ASKED) as InvestigationQuestion[]).map(q => investigate(input, q));
}
