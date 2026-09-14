/**
 * rates-upload-gate.ts — may the provisioning rates step go on to look for
 * prices, or is there nothing it could possibly upload?
 *
 * Pure, and deliberately narrow. On 2026-09-14 the step refused 1global's
 * upload with "No rates to load — 4 product(s), 0 destination(s)" while
 * seven prices were effective that day and readiness had counted them. The
 * "destinations" it counted were the LEGACY candidate list from
 * global_destinations, which the step now needs only to resolve old
 * prefix-keyed prices; catalogue-keyed prices carry their own destination
 * and version and are expanded into synthetic destinations later. Gating on
 * that legacy list therefore blocked every catalogue-priced customer.
 *
 * The only thing that makes an upload impossible before prices are read is
 * having no product to price. Everything else — no prices, no matching
 * destination, a stale catalogue version — is decided AFTER the prices are
 * read, where the step already reports it in words.
 */

export type PreUploadGate =
  | { proceed: true }
  | { proceed: false; reason: string };

export function preUploadGate(input: { productCount: number; legacyDestinationCount: number }): PreUploadGate {
  if (input.productCount === 0) {
    return { proceed: false, reason: 'No rates to load — the company has no products and none is commercial.' };
  }
  // A missing legacy candidate list is not a reason to stop: catalogue-keyed
  // prices do not use it.
  return { proceed: true };
}
