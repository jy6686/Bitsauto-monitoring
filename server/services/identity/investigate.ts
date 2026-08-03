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

/**
 * The minimum additional evidence that would make this question decidable.
 *
 * Every non-deterministic verdict implies an engineering action, and stating it
 * is what turns "we cannot tell you" into a work item. Null when the verdict is
 * already deterministic — there is nothing to add.
 */
export interface NextObservation {
  action: string;
  /** What it would observe, e.g. 'O3 at the terminating endpoint'. */
  unlocks: string;
  /** What becomes answerable once it exists. */
  wouldEnable: string;
  reference: string;
  /**
   * False when the hop sits inside a third party's network and cannot be
   * instrumented directly. The action is then the closest honest substitute,
   * not a promise that the hop itself becomes visible.
   */
  directlyObtainable: boolean;
}

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
  /** The minimum evidence that would decide this next time. */
  recommendedNextObservation: NextObservation | null;
}

/**
 * How each point in the path could be observed.
 *
 * Two of them are honestly marked unobtainable: Vendor and Carrier sit inside
 * networks we do not run. Pretending otherwise would put an impossible task on
 * an operator's list, so those entries name the substitute that actually
 * narrows the span instead.
 */
const OBSERVATION_MECHANISM: Record<string, Omit<NextObservation, 'wouldEnable'>> = {
  'Asterisk egress': {
    action: 'Ring-buffered packet capture on the Sippy-facing interface, capped and written outside /',
    unlocks: 'O2 — the true From / PAI / RPID leaving our network, and the SIP Call-ID',
    reference: 'CAP-023 §4.1',
    directlyObtainable: true,
  },
  'Sippy ingress': {
    action: 'CDR probe by Call-ID (already in place)',
    unlocks: 'O2 — what Sippy recorded on our own leg',
    reference: 'CAP-023 §3',
    directlyObtainable: true,
  },
  'Vendor': {
    action:
      'Not directly observable — this hop is inside the supplier network. Bind CAP-022 vendor ' +
      'targeting so a change across the span is attributable to one named supplier rather than ' +
      'to whichever route LCR chose',
    unlocks: 'attribution to a supplier, not to a hop',
    reference: 'CAP-022 §9 (V5 gates it)',
    directlyObtainable: false,
  },
  'Carrier': {
    action:
      'Not directly observable. A terminating DID on our own SIP infrastructure collapses ' +
      'Carrier and Handset into a single endpoint we control, shrinking the span to one supplier',
    unlocks: 'O3 — delivered identity across the whole wholesale path',
    reference: 'CAP-023 §5',
    directlyObtainable: false,
  },
  'Handset': {
    action:
      'Attested report from the person who answered, or an Android device agent on a ' +
      'registered test SIM (iOS cannot expose incoming CLI to third-party apps)',
    unlocks: 'O4 — what the subscriber actually saw',
    reference: 'CAP-023 §6',
    directlyObtainable: true,
  },
};

/** The first unobserved hop in a span, and how to close it. */
function nextObservationFor(stages: string[], wouldEnable: string): NextObservation | null {
  for (const stage of stages) {
    const m = OBSERVATION_MECHANISM[stage];
    if (m) return { ...m, wouldEnable };
  }
  return null;
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
          recommendedNextObservation: nextObservationFor(
            ['Carrier', 'Handset'],
            'whether identity survived the wholesale path, and — with CAP-022 — which supplier changed it',
          ),
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
          recommendedNextObservation: nextObservationFor(
            br.spanned,
            `an attribution inside the ${br.before?.stage} → ${br.after?.stage} span, instead of naming it as a whole`,
          ),
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
        recommendedNextObservation: null, // bracketed and decided
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
          recommendedNextObservation: nextObservationFor(
            ['Asterisk egress'],
            'a deterministic answer on whether our own switch altered the identity',
          ),
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
        // Our own egress is still a proxy observation until the capture exists.
        recommendedNextObservation: nextObservationFor(
          ['Asterisk egress'],
          'confirmation from the wire rather than from Sippy\'s record of our leg',
        ),
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
          recommendedNextObservation: null,
          answer: ['No called-number transformation was observed on this call.'],
        };
      }
      return {
        question, asked, verdict: 'observed',
        basedOn: [...basedOn, ...changed.map(c => `${c.stage}: ${c.observation}`)],
        // Not an observation gap — the rule that produced it lives in the
        // switch configuration, so the next step is a config review.
        recommendedNextObservation: {
          action: 'Confirm the Sippy tech-prefix translation rule against the configured prefix',
          unlocks: 'the mechanism behind the transformation, not just its result',
          wouldEnable: 'stating why the transformation occurred, not only that it did',
          reference: 'CAP-023 §9.1',
          directlyObtainable: true,
        },
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
          recommendedNextObservation: nextObservationFor(
            ['Handset'],
            'a statement about what the subscriber actually saw',
          ),
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
        recommendedNextObservation: null,
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
        recommendedNextObservation: timeline.unobservedStages.length
          ? nextObservationFor(timeline.unobservedStages, 'a fuller account of the path')
          : null,
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
