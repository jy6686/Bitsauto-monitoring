/**
 * Reading the importer's own report.
 *
 * The report is where — and only where — Sippy says why a rates upload FAILed. Two closing pilots
 * for SMP-006 failed with that reason sitting on the switch: the first because the push discarded
 * the URL, the second because the reader decoded a ZIP as UTF-8 text and produced a screenful of
 * replacement characters.
 *
 * These assert the distinction that matters operationally: a report that is EMPTY (the importer
 * refused before parsing and wrote nothing) is not the same as a report that could not be READ,
 * and neither may be reported as a reason.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { interpretUploadReport, reportCellText } from '../../sippy';

const workbook = async (rows: any[][]): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

describe('a workbook is parsed, not decoded', () => {
  it('reads the importer rows out of an XLSX', async () => {
    const buf = await workbook([
      ['Line', 'Prefix', 'Error'],
      [2, '19370', 'Rate activation date is in the past'],
    ]);
    const r = await interpretUploadReport(buf, 200);
    expect(r.ok).toBe(true);
    expect(r.format).toBe('xlsx');
    expect(r.text).toContain('19370');
    expect(r.text).toContain('Rate activation date is in the past');
    expect(r.rows?.[0]).toEqual(['Line', 'Prefix', 'Error']);
    expect(r.message).toMatch(/2 row\(s\)/);
  });

  it('does NOT return the raw zip bytes as text', async () => {
    const buf = await workbook([['Prefix', 'Error'], ['19370', 'boom']]);
    const r = await interpretUploadReport(buf, 200);
    // The defect this replaces: `PK` and a mess of replacement characters in place of a reason.
    expect(r.text.startsWith('PK')).toBe(false);
    expect(r.text).not.toContain('�');
  });

  it('a workbook with no rows says so, and does not invent a reason', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Report');
    const r = await interpretUploadReport(Buffer.from(await wb.xlsx.writeBuffer()), 200);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/EMPTY/i);
    expect(r.rows).toEqual([]);
  });

  it('an unreadable workbook is a FAILURE to read, never an empty report', async () => {
    // Zip header, garbage behind it. Claiming "the importer wrote no rows" here would be a lie.
    const corrupt = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not a zip')]);
    const r = await interpretUploadReport(corrupt, 200);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/could not be parsed/i);
    expect(r.message).not.toMatch(/refused before parsing/i);
  });
});

describe('everything that is not a workbook', () => {
  it('zero bytes is EMPTY — the signature of a refusal before parsing', async () => {
    const r = await interpretUploadReport(Buffer.alloc(0), 200);
    expect(r.ok).toBe(true);
    expect(r.format).toBe('text');
    expect(r.message).toMatch(/EMPTY/);
    expect(r.message).toMatch(/refused before parsing/i);
  });

  it('plain text is served as text', async () => {
    const r = await interpretUploadReport(Buffer.from('tariff is locked\n'), 200);
    expect(r.ok).toBe(true);
    expect(r.format).toBe('text');
    expect(r.text).toContain('tariff is locked');
  });

  it('a login page is a session failure, not a report', async () => {
    const r = await interpretUploadReport(Buffer.from('<html><title>Login</title><input name="login">'), 200);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/session was not accepted/i);
    // Nothing was learned about the import, so nothing about the import is claimed.
    expect(r.message).not.toMatch(/EMPTY|no rows/i);
  });

  it('a non-200 is reported as the HTTP status it was', async () => {
    const r = await interpretUploadReport(Buffer.from('nope'), 404);
    expect(r.ok).toBe(false);
    expect(r.message).toBe('HTTP 404');
  });
});

describe('a cell is rendered as the value it is, never decorated', () => {
  it('a DATE cell reads as the switch writes it, with no JSON quotes', () => {
    // The first report ever read on this platform showed `"2026-09-15T14:30:00.000Z"` for an
    // activation that had been uploaded, and accepted, as 2026-09-15 14:30:00. The quotes were
    // the reader's, and they pointed suspicion at the upload instead of at the conflict the
    // importer had actually reported.
    const out = reportCellText(new Date(Date.UTC(2026, 8, 15, 14, 30, 0)));
    expect(out).toBe('2026-09-15 14:30:00');
    expect(out).not.toContain('"');
    expect(out).not.toContain('T');
    expect(out).not.toContain('Z');
  });

  it('a date INSIDE a workbook survives the round trip', async () => {
    const buf = await workbook([['Activation Date'], [new Date(Date.UTC(2026, 8, 22, 0, 0, 0))]]);
    const r = await interpretUploadReport(buf, 200);
    expect(r.rows?.[1]).toEqual(['2026-09-22 00:00:00']);
  });

  it('rich text, formula results and plain values all read as text', () => {
    expect(reportCellText({ richText: [{ text: 'Another Rate with ' }, { text: 'conflicting' }] }))
      .toBe('Another Rate with conflicting');
    expect(reportCellText({ formula: 'A1', result: 0.2 })).toBe('0.2');
    expect(reportCellText({ error: '#REF!' })).toBe('#REF!');
    expect(reportCellText(60)).toBe('60');
    expect(reportCellText(null)).toBe('');
  });
});
