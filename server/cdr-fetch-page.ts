/**
 * cdr-fetch-page.ts — what one page of a CDR fetch means for the loop around it.
 *
 * The defect this pins: the billing importer's pagination loop ended on any
 * short page — and the fetch function returned an EMPTY array, not an error,
 * for auth failures, HTTP errors, XML-RPC faults and timeouts. An empty array
 * is shorter than a full page, so a transient fault at page 800 of 900 was
 * indistinguishable from "no more records": the loop broke, the job logged
 * Complete, the run row wrote ok, and the period was certified on a partial
 * month. The owner's rule, verbatim: **an error must never be treated as
 * end-of-data.**
 *
 * Three outcomes, exhaustively:
 *
 *   continue     a full page arrived — there may be more
 *   end_of_data  a SUCCESSFUL call returned fewer rows than the page size;
 *                Sippy has said, in-band, that this is the end
 *   error        the call did not succeed. Nothing about the data may be
 *                concluded from it, least of all that it ended
 *
 * Dependency-free so the rule is pinned by tests rather than by a database.
 */

export interface CdrPage {
  /** Did the fetch itself succeed? A failed fetch says nothing about the data. */
  ok: boolean;
  /** Rows in this page. Meaningless when ok is false. */
  count: number;
}

export type PageOutcome = 'continue' | 'end_of_data' | 'error';

export function classifyCdrPage(page: CdrPage, pageSize: number): PageOutcome {
  if (!page.ok) return 'error';
  return page.count < pageSize ? 'end_of_data' : 'continue';
}
