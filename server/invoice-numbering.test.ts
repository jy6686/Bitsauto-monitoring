/**
 * Invoice numbering: format rendering and series-sequence derivation.
 *
 * Pins the properties the old count(*)+1 scheme lacked: the default config
 * reproduces the existing C-series exactly, the sequence continues across
 * month boundaries, and a foreign-format row can never perturb the series.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveNumberingConfig, renderInvoiceNumber, literalHead,
  seriesMatcher, nextSeqFromNumbers, DEFAULT_FORMAT,
} from './invoice-numbering';

const AUG = new Date(Date.UTC(2026, 7, 25));

describe('resolveNumberingConfig', () => {
  it('unconfigured reproduces the existing series shape exactly', () => {
    const cfg = resolveNumberingConfig(null);
    expect(renderInvoiceNumber(cfg, AUG, 7)).toBe('C-2608-0007');
  });

  it('honours a configured prefix and format', () => {
    const cfg = resolveNumberingConfig({ invoiceNumberPrefix: 'ICH', invoiceNumberFormat: '{PREFIX}/{YYYY}/{SEQ:5}' });
    expect(renderInvoiceNumber(cfg, AUG, 42)).toBe('ICH/2026/00042');
  });

  it('a format without a sequence token is invalid and falls back to the default', () => {
    // Such a format could only ever mint one number; generation must not be
    // blockable by a configuration typo.
    const cfg = resolveNumberingConfig({ invoiceNumberFormat: 'INV-{YY}{MM}' });
    expect(cfg.format).toBe(DEFAULT_FORMAT);
  });
});

describe('renderInvoiceNumber', () => {
  it('a sequence larger than its padding is not truncated', () => {
    const cfg = resolveNumberingConfig(null);
    expect(renderInvoiceNumber(cfg, AUG, 123456)).toBe('C-2608-123456');
  });
});

describe('series sequence', () => {
  const cfg = resolveNumberingConfig(null);

  it('continues across month boundaries instead of resetting', () => {
    // July issued up to 0142; August continues the series. This is what makes
    // the series gap-free and cross-month collisions impossible.
    expect(nextSeqFromNumbers(cfg, ['C-2607-0141', 'C-2607-0142', 'C-2606-0090'])).toBe(143);
  });

  it('ignores numbers from other formats sharing the table', () => {
    expect(nextSeqFromNumbers(cfg, ['INV-00005', 'C-2608-0002', 'DRAFT-x', 'C-2608-0002-DUP9'])).toBe(3);
  });

  it('starts at 1 on an empty table', () => {
    expect(nextSeqFromNumbers(cfg, [])).toBe(1);
  });

  it('recognises a sequence that outgrew its padding as part of the series', () => {
    expect(nextSeqFromNumbers(cfg, ['C-2608-9999', 'C-2608-10000'])).toBe(10001);
  });

  it('regex metacharacters in a configured format are literals, not syntax', () => {
    const c = resolveNumberingConfig({ invoiceNumberPrefix: 'A.B', invoiceNumberFormat: '{PREFIX}({YY}){SEQ:2}' });
    expect(seriesMatcher(c).test('A.B(26)07')).toBe(true);
    expect(seriesMatcher(c).test('AxB(26)07')).toBe(false);
    expect(nextSeqFromNumbers(c, ['A.B(26)07'])).toBe(8);
  });

  it('literalHead gives the cheap LIKE filter for the series', () => {
    expect(literalHead(cfg)).toBe('C-');
    expect(literalHead(resolveNumberingConfig({ invoiceNumberPrefix: 'ICH', invoiceNumberFormat: '{PREFIX}/{YYYY}/{SEQ:5}' }))).toBe('ICH/');
  });
});
