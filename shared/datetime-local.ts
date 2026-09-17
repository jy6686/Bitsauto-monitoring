/**
 * datetime-local.ts — the two conversions an <input type="datetime-local"> needs, and the
 * reason they exist.
 *
 * A `datetime-local` control has no timezone. It shows and returns a bare wall-clock string,
 * "2026-09-17T19:10", meaning whatever the operator's own clock says. The platform, and Sippy
 * behind it, run on UTC: Sippy's portal stamps its pages "(Etc/UTC)", its upload status
 * timestamps are labelled GMT, and `rateUploadAction` parses an activation string by appending
 * a literal "Z". Every one of those is correct. The gap was between them.
 *
 * WHAT THIS FIXES (2026-09-17). The Change Client Rates dialog seeded that control from
 * `new Date(...).toISOString().slice(0, 16)` — a UTC instant rendered by a control that means
 * local time — and submitted it with `v.replace("T", " ")`, which converts nothing. An operator
 * in Pakistan asking for 09:30 therefore sent "09:30", the server read it as 09:30 UTC, and the
 * rate went live at 14:30 their time. Five hours late, and invisible afterwards: Sippy's page
 * then shows 09:30, which is the number they typed.
 *
 * NO FIXED OFFSET APPEARS HERE. The conversion goes through the platform's own Date
 * implementation, so a browser in Karachi, Dubai or London each gets its own correct answer.
 * A hard-coded five hours would be right for exactly one office and wrong the day the clocks
 * move.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Format an instant as the LOCAL wall-clock string a `datetime-local` input expects.
 *
 * Deliberately built from the local getters rather than `toISOString`, which yields UTC. Putting
 * a UTC string into this control is what made the dialog's default wrong before anyone touched it.
 */
export function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert what the operator selected into the UTC string the server and Sippy expect.
 *
 * Returns "YYYY-MM-DD HH:MM" in UTC, the same shape the server already normalises, so nothing
 * downstream changes except the instant it denotes. Empty or unparseable input returns undefined
 * rather than a guess — an effective date the caller cannot state is not one to invent, and
 * omitting it makes the change immediate, which is the existing meaning of an empty field.
 *
 * A `datetime-local` value carries no offset, and ECMAScript parses that form as LOCAL time.
 * That is exactly the semantics wanted here, and it is why no offset arithmetic appears.
 */
export function localInputToUtcPayload(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
       + ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The UTC instant a local selection denotes, for showing the operator what will be sent. */
export function localInputUtcHint(value: string | undefined | null): string | null {
  const utc = localInputToUtcPayload(value);
  return utc ? `${utc} UTC` : null;
}
