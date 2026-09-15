/**
 * rates-refusal.ts — naming WHY a rate matrix was refused, in the operator's terms.
 *
 * The generator refuses two unrelated things through one `errors` list: a matrix that
 * would be WRONG on the switch (two destinations composing to one prefix), and a matrix
 * that is complete but does not match what the customer bought (a selected product with
 * no priced rows). Both are hard refusals. They are not the same diagnosis.
 *
 * On 2026-09-15 the second case surfaced on 1global as RATE_MATRIX_INVALID with the line
 * "Product BC (Business Class) produced no rows", which reads as a corrupt matrix. The
 * matrix was fine; the customer had been onboarded with four products and only one was
 * priced. An operator told "the matrix is invalid" looks in the wrong place.
 *
 * Classification is structural: the generator reports unpriced products as their own
 * list, and each contributes exactly one error, so anything beyond that count is a
 * structural error. No message text is matched.
 */
import type { GeneratedMatrix } from '../rates/matrix-generator';

export type MatrixRefusalCode = 'UNPRICED_SELECTED_PRODUCT' | 'RATE_MATRIX_INVALID';

export interface MatrixRefusal {
  reasonCode: MatrixRefusalCode;
  /** One line for the stage's error field. */
  error: string;
  /** What the operator reads on the stage. */
  detail: string[];
  /** For the stage's failure metrics. */
  cause: string;
}

export function classifyMatrixRefusal(
  matrix: Pick<GeneratedMatrix, 'errors' | 'unpricedProducts' | 'summary'>,
): MatrixRefusal {
  const unpriced = matrix.unpricedProducts ?? [];
  const structuralErrors = matrix.errors.length - unpriced.length;
  const header = `${matrix.summary.rowsGenerated} row(s) generated, ${matrix.summary.rowsSkipped} skipped`;

  if (unpriced.length > 0 && structuralErrors <= 0) {
    const lines = unpriced.map(p =>
      `${p.name} (${p.code}) has been selected for this customer, but no effective rates exist for this product.`);
    return {
      reasonCode: 'UNPRICED_SELECTED_PRODUCT',
      error: lines.join(' · '),
      detail: [
        header,
        ...lines,
        "Remove the product from the customer's active product selection or add rates before provisioning.",
        'Nothing was uploaded — the tariff is unchanged. The refusal is deliberate: a tariff that silently carries a selected product with no rates is worse than no tariff.',
      ],
      cause: 'selected product has no priced rows',
    };
  }

  return {
    reasonCode: 'RATE_MATRIX_INVALID',
    error: matrix.errors.slice(0, 3).join(' · '),
    detail: [header, ...matrix.errors.slice(0, 5)],
    cause: 'rate matrix invalid',
  };
}
