/**
 * The Send Rate submit lifecycle — pure, so it is provable without React or a server.
 *
 * THE RULE: the HTTP response is a courtesy; the JOB ROW is the truth. `pushing` is released only
 * when the job the operator started reaches a terminal state on the server — never because a
 * response arrived, and never because one failed to.
 *
 * Why. push-batch is a long synchronous request. On 2026-09-19 the gateway answered 504 while the
 * server was still pushing; the page treated the error as "failed", re-enabled Submit, and the
 * second click started a second batch 9 s behind the first. Here a lost response moves to
 * `response_lost`: Submit stays disabled, the queue is kept, and the page polls the job it knows
 * by the client request id it generated before submitting. Only the row's status settles it.
 *
 * A 4xx is different: the server refused BEFORE recording anything (bad input, duplicate, a live
 * job on that tariff), so nothing is running and Submit comes back with the reason.
 */

export const TERMINAL_JOB_STATUSES = ['completed', 'partial', 'failed', 'needs_review'] as const;
export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

/** After this many polls that find NO job for the request id, the submit is judged never recorded. */
export const NOT_FOUND_LIMIT = 5;

export const POLL_INTERVAL_MS = 3000;

export type SubmitState =
  | { phase: 'idle'; lastError?: string }
  | { phase: 'submitting'; key: string }
  | { phase: 'response_lost'; key: string; error: string; notFound: number }
  | { phase: 'polling'; key: string; watching?: string; status?: string }
  | { phase: 'terminal'; key: string; watching: string; status: TerminalJobStatus };

export type SubmitEvent =
  | { type: 'SUBMIT'; key: string }
  | { type: 'RESPONSE_OK'; watching?: string }
  | { type: 'RESPONSE_LOST'; error: string }
  | { type: 'RESPONSE_REJECTED'; error: string }
  /**
   * `status` is the status of the WHOLE SUBMISSION, never of one sibling. A submission is one job
   * per account; a status that speaks for one of them would release Submit while another
   * customer's rates were still being written, which is the 2026-09-19 double-submit.
   */
  | { type: 'JOB'; watching: string; status: string }
  | { type: 'JOB_NOT_FOUND' }
  | { type: 'RESET' };

/**
 * `watching` names WHAT THE SCREEN IS WATCHING, which is not always a job.
 *
 * It was `jobId`, because a submission was one job. A submission is now one job per ACCOUNT under
 * a shared request id, so the thing whose completion releases Submit is the REQUEST — and naming
 * a sibling there would report one account's outcome as the submission's. A single-account
 * submission still watches its one job id, so nothing about that case reads differently.
 *
 * Renamed rather than reused: a field called `jobId` holding a request id is the kind of quiet
 * lie that survives every test and misleads the next reader.
 */
export const initialSubmitState: SubmitState = { phase: 'idle' };

const isTerminal = (s: string): s is TerminalJobStatus => (TERMINAL_JOB_STATUSES as readonly string[]).includes(s);

export function submitReducer(state: SubmitState, event: SubmitEvent): SubmitState {
  switch (event.type) {
    case 'RESET':
      return initialSubmitState;

    case 'SUBMIT':
      // Only from rest. While anything is in flight the button is disabled; a second SUBMIT is noise.
      if (state.phase === 'idle' || state.phase === 'terminal') return { phase: 'submitting', key: event.key };
      return state;

    case 'RESPONSE_OK':
      // The server answered — but the row decides. Keep pushing until it is terminal.
      if (state.phase === 'submitting') return { phase: 'polling', key: state.key, watching: event.watching };
      return state;

    case 'RESPONSE_LOST':
      if (state.phase === 'submitting') return { phase: 'response_lost', key: state.key, error: event.error, notFound: 0 };
      return state;

    case 'RESPONSE_REJECTED':
      // Refused before anything was recorded: nothing is running, so the button comes back.
      if (state.phase === 'submitting') return { phase: 'idle', lastError: event.error };
      return state;

    case 'JOB': {
      if (state.phase !== 'submitting' && state.phase !== 'response_lost' && state.phase !== 'polling') return state;
      if (isTerminal(event.status)) return { phase: 'terminal', key: state.key, watching: event.watching, status: event.status };
      return { phase: 'polling', key: state.key, watching: event.watching, status: event.status };
    }

    case 'JOB_NOT_FOUND': {
      if (state.phase !== 'response_lost') return state;   // a pending response, or a job already seen: keep waiting
      const notFound = state.notFound + 1;
      if (notFound >= NOT_FOUND_LIMIT) {
        return { phase: 'idle', lastError: 'The request was lost and no job was recorded for it — nothing was sent to the switch. You can submit again.' };
      }
      return { ...state, notFound };
    }
  }
}

/** Submit is allowed only at rest. */
export function canSubmit(state: SubmitState): boolean {
  return state.phase === 'idle' || state.phase === 'terminal';
}

/** Something the operator started has not settled on the server. */
export function isPushing(state: SubmitState): boolean {
  return state.phase === 'submitting' || state.phase === 'response_lost' || state.phase === 'polling';
}

/** The queue is the operator's intent; it is cleared only once the job has settled. */
export function shouldClearQueue(state: SubmitState): boolean {
  return state.phase === 'terminal';
}

export function pollIntervalMs(state: SubmitState): number | null {
  return isPushing(state) ? POLL_INTERVAL_MS : null;
}

export function statusMessage(state: SubmitState): string {
  switch (state.phase) {
    case 'idle':          return state.lastError ?? '';
    case 'submitting':    return 'Pushing… the switch is being written; this can take a minute or two.';
    case 'response_lost': return `The request did not come back (${state.error}), but the push is still running on the server — watching job ${state.key.slice(0, 8)}… Do not submit again.`;
    case 'polling':       return `Push ${state.watching ?? state.key.slice(0, 8)} is ${state.status ?? 'processing'} — waiting for it to finish.`;
    case 'terminal':      return `Push ${state.watching} finished: ${state.status}.`;
  }
}
