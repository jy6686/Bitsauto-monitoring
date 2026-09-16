/**
 * identity-inventory-text.ts — render the reconciliation as the matrix it is meant to be read as.
 *
 * The report answers three questions that must stay independent (owner, 2026-09-16):
 *
 *   1. Who is the Sippy customer?
 *   2. What billing relationship did the provisioning run actually PROVE?
 *   3. What product configuration is actually EVIDENCED?
 *
 * Deriving any of those from another is the failure this report exists to prevent. So each
 * gets its own line per company, and a line says "no evidence" rather than going quiet —
 * an omission reads as a clean bill of health, and none of these blanks are one.
 *
 * Plain text on purpose: it is readable in a browser tab, pasteable into a message, and
 * diffable between two runs.
 */
import type { InventoryReport, CompanyInventory, ProductState } from './identity-inventory';

const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
const wrap = (text: string, width: number, indent: string): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = []; let line = '';
  for (const w of words) {
    if (line && (line.length + 1 + w.length) > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : indent + l));
};

/** Product states, abbreviated only where the meaning survives. UNKNOWN never becomes a blank. */
const STATE_MARK: Record<ProductState, string> = {
  CONFIGURED: 'configured', MISSING: 'MISSING', UNKNOWN: 'UNKNOWN',
  UNEXPECTED: 'UNEXPECTED', NOT_SOLD: 'not sold',
};

function companyBlock(c: CompanyInventory): string[] {
  const label = (k: string) => pad(k, 21);
  const out: string[] = [`${c.companyName}  (company ${c.companyId})`];
  const row = (tee: string, key: string, value: string) => {
    const [first, ...rest] = wrap(value, 92, ' '.repeat(4 + 21 + 2));
    out.push(`${tee} ${label(key)}: ${first}`);
    for (const r of rest) out.push(r);
  };

  row('├──', 'Stored Sippy account', c.identity.storedAccount === null ? 'none' : String(c.identity.storedAccount));
  row('├──', 'Identity evidence', `${c.identity.status} — ${c.identity.note}`);
  row('├──', 'Billing-link evidence',
    `${c.billing.verdict}${c.billing.source ? ` (from ${c.billing.source})` : ''} — ${c.billing.note}`);
  row('├──', 'Stored tariff', c.identity.storedTariff === null ? 'none' : String(c.identity.storedTariff));
  row('├──', 'Product states', c.products.state.map(s => `${s.code} ${STATE_MARK[s.state]}`).join(' · ') || '(no products in the registry)');
  row('└──', 'Next action', c.nextAction);
  return out;
}

export function renderIdentityInventoryText(report: InventoryReport & { generatedAt?: string }): string {
  const L: string[] = [];
  L.push('PLATFORM IDENTITY AND PRODUCT RECONCILIATION');
  L.push(`Generated ${report.generatedAt ?? new Date().toISOString()} · READ-ONLY`);
  L.push('No company record was written and no Sippy call was made to produce this.');
  L.push('');
  L.push(`${report.generatedFor} companies`);
  const s = report.byStatus;
  L.push(`  Identity      VERIFIED ${s.VERIFIED} · REPAIRABLE ${s.REPAIRABLE} · CONFLICT ${s.CONFLICT} · UNRESOLVED ${s.UNRESOLVED} · NOT_PROVISIONED ${s.NOT_PROVISIONED}`);
  const b = report.billingLinks;
  L.push(`  Billing link  MATCHES ${b.matches} · DIFFERS ${b.differs} · NO_EVIDENCE ${b.noEvidence}`);
  L.push(`  Products      ${report.products.length} in the registry · ${report.productGaps} compan${report.productGaps === 1 ? 'y' : 'ies'} with a product gap`);
  L.push('');
  L.push('An identity the platform records is not a billing relationship, and a billing');
  L.push('relationship is not a product configuration. Each column below is evidenced on its');
  L.push('own; none is derived from another.');
  L.push('');

  L.push('PRODUCTS IN THE REGISTRY');
  L.push(`  ${pad('CODE', 6)}${pad('NAME', 20)}${pad('BOUGHT', 8)}${pad('CONFIG', 8)}${pad('MISSING', 9)}PRICED`);
  for (const p of report.products) {
    L.push(`  ${pad(p.code, 6)}${pad(p.name, 20)}${pad(String(p.bought), 8)}${pad(String(p.assigned), 8)}${pad(String(p.missing), 9)}${p.priced ? 'yes' : 'NO — nothing sendable'}`);
  }
  L.push('');
  L.push('COMPANIES — ordered so what needs a decision comes first');
  L.push('');
  for (const c of report.companies) { L.push(...companyBlock(c)); L.push(''); }

  L.push('Nothing in this report has been applied. The three-row identity repair and the');
  L.push('Special Bravo push both remain unauthorised.');
  return L.join('\n');
}
