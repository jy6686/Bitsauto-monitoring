/**
 * The billing-increment UI and API contract.
 *
 * The load-bearing assertion is the one that is easiest to get wrong and hardest to notice:
 * this edits the effective-dated COMMERCIAL change, never
 * `commercial_destination_prefixes.billing_increment`. That field is supplier data replaced on
 * every re-import, so a commitment written there would be silently reverted after clients had
 * already been emailed about it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI = readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'rate-manager.tsx'), 'utf8');
const API = readFileSync(join(__dirname, '..', '..', 'routes-increment-changes.ts'), 'utf8');
const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');

describe("the API edits the commitment, not the catalogue", () => {
  it("never writes commercial_destination_prefixes", () => {
    const c = code(API);
    expect(c).not.toMatch(/UPDATE\s+commercial_destination_prefixes/i);
    expect(c).not.toMatch(/INSERT\s+INTO\s+commercial_destination_prefixes/i);
  });

  it("writes the change through the atomic store, not with its own SQL", () => {
    // Bypassing acceptIncrementChange would bypass the transaction that keeps the change and its
    // notifications consistent.
    expect(code(API)).toContain('acceptIncrementChange');
    expect(code(API)).not.toMatch(/INSERT\s+INTO\s+billing_increment_changes/i);
  });

  it("sends nothing and touches no switch", () => {
    for (const forbidden of ['sendMail', 'sendEmail', 'nodemailer', 'sippy.', 'pushRate', 'uploadBinaryFile']) {
      expect(code(API), `must not reach ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("takes the destination's version and name from the catalogue, not the caller", () => {
    expect(code(API)).toContain('FROM commercial_destinations d WHERE d.id = ${destinationId}');
    expect(code(API)).toContain('catalogueVersionId: Number(dest.version_id)');
  });

  it("measures the change against what is IN FORCE, not the raw catalogue value", () => {
    // A second change must build on the first, not on the supplier's number.
    expect(code(API)).toContain('resolveEffectiveIncrement');
  });

  it("reports clients with no rate contact rather than omitting them silently", () => {
    expect(code(API)).toContain('clientsWithoutContact');
  });

  it("cancelling is a POST, and refuses once the switch already holds it", () => {
    expect(API).not.toMatch(/app\.delete\(/);
    expect(code(API)).toContain("existing.status === 'applied'");
  });

  it("scheduling is audited at warning severity", () => {
    // A change to what every call costs, announced to customers. Not routine.
    expect(code(API)).toContain('BILLING_INCREMENT_CHANGE_SCHEDULED');
    expect(code(API)).toContain("severity: 'warning'");
  });
});

describe("the UI schedules a change and shows all three facts", () => {
  it("posts to the increment-changes endpoint with destination, increment and date", () => {
    const c = code(UI);
    expect(c).toContain('`/api/products/${selectedProductId}/increment-changes`');
    expect(c).toContain('destinationId: incEdit.destinationId');
    expect(c).toContain('newIncrement: incForm.newIncrement');
    expect(c).toContain('effectiveDate: incForm.effectiveDate');
  });

  it("requires both a new increment and an effective date before it can be submitted", () => {
    // There is no "immediately" for a billing increment; the date is the contract.
    expect(code(UI)).toContain('!incForm.newIncrement || !incForm.effectiveDate');
  });

  it("shows what is IN FORCE, what is scheduled, and a catalogue conflict — three facts", () => {
    const c = code(UI);
    expect(c).toContain('inc?.inForce');
    expect(c).toContain('data-testid={`inc-scheduled-');
    expect(c).toContain('data-testid={`inc-conflict-');
  });

  it("flags a change whose date has passed but which the switch has not been given", () => {
    expect(code(UI)).toContain('data-testid={`inc-awaiting-');
  });

  it("tells the operator the consequence BEFORE they commit", () => {
    // Whitespace-tolerant: the sentence wraps across lines in the JSX.
    const flat = UI.replace(/\s+/g, ' ');
    expect(flat).toContain('On the effective date the switch is changed to the new increment');
    expect(flat).toContain('every client with a configured rate contact is notified of that same date');
    expect(flat).toContain('Nothing is sent until the change is accepted');
  });

  it("reports how many clients have no contact, after scheduling", () => {
    expect(code(UI)).toContain('clientsWithoutContact');
  });

  it("the UI never writes a catalogue increment", () => {
    const c = code(UI);
    expect(c).not.toContain('billing_increment');
    expect(c).not.toContain('/api/commercial/catalogues/${versionId}/destinations/increment');
  });
});
