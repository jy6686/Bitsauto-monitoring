/**
 * Reads back what buildRateSheetWorkbook writes and checks it against the
 * reference layout (QUICKCOM · FIRST CLASS · 8 Sep 2026): positions, titles,
 * styling, freeze pane, filter, merges, number format — and that no cell in
 * the table can carry a null.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildRateSheetWorkbook, LAYOUT, RATE_SHEET_COLUMNS, STATUS_LEGEND } from './rate-sheet-workbook';
import type { RateSheetModel } from './rate-sheet-model';

const model: RateSheetModel = {
  header: {
    companyName: '1global', productLabel: 'FIRST CLASS', sendDate: '14-Sep-2026', sendTime: '17:59:00',
    increaseEffectiveDate: '', decreaseEffectiveDate: '', technicalPrefix: '10191',
    kamName: 'Junaid Qadeer', kamEmail: 'junaid@ichibaanlogic.com',
  },
  rows: [
    { country: 'AFGHANISTAN', destination: 'AFGHANISTAN - MOBILE AWCC', prefix: '9370', rate: 0.173, status: 'N', billingIncrement: '60/1', effectiveDate: '14-Sep-2026', effectiveTime: '00:00:00' },
    { country: 'PAKISTAN', destination: 'PAKISTAN - MOBILE MOBILINK', prefix: '9230', rate: 0.04, status: 'N', billingIncrement: '1/1', effectiveDate: '14-Sep-2026', effectiveTime: '00:00:00' },
  ],
  terms: ['Paragraph one.', 'Paragraph two.'],
};

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return wb.getWorksheet('Rates')!;
}

describe('buildRateSheetWorkbook', () => {
  it('lays out the header block, legend, table and terms where the reference has them', async () => {
    const ws = await load(await buildRateSheetWorkbook(model));
    expect(ws.getCell('B4').value).toBe('Company Name');
    expect(ws.getCell('C4').value).toBe('1global');
    expect(ws.getCell('B10').value).toBe('Technical Prefix');
    expect(ws.getCell('C10').value).toBe('10191');
    expect(ws.getCell('B12').value).toBe('KAM Email');
    expect(ws.getCell('H4').value).toBe('N');
    expect(ws.getCell('I4').value).toBe('New Code');
    expect(ws.getCell('H12').value).toBe('DC');
    expect(STATUS_LEGEND).toHaveLength(9);
    expect(RATE_SHEET_COLUMNS.map(c => c.title)).toEqual(['Country', 'Destination', 'Prefix', 'Rate', 'Status', 'Billing Increment', 'Effective Date', 'Effective Time']);
    for (let i = 0; i < RATE_SHEET_COLUMNS.length; i++) expect(ws.getCell(LAYOUT.tableHeaderRow, LAYOUT.firstCol + i).value).toBe(RATE_SHEET_COLUMNS[i].title);
    expect(ws.getCell('B15').value).toBe('AFGHANISTAN');
    expect(ws.getCell('C16').value).toBe('PAKISTAN - MOBILE MOBILINK');
    expect(ws.getCell('D16').value).toBe('9230');
    expect(ws.getCell('E16').value).toBe(0.04);
    expect(ws.getCell('G15').value).toBe('60/1');
    expect(ws.getCell('B19').value).toBe('TERMS AND CONDITIONS');
    expect(ws.getCell('B20').value).toBe('Paragraph one.');
    expect(ws.getCell('B23').value).toBe('Paragraph two.');
  });

  it('styles like the reference: bold grey labels and headers, thin borders, wrapped text, Calibri 8/10', async () => {
    const ws = await load(await buildRateSheetWorkbook(model));
    const label = ws.getCell('B4'), value = ws.getCell('C4'), head = ws.getCell('B14'), body = ws.getCell('C15');
    expect(label.font.bold).toBe(true); expect(label.font.size).toBe(8); expect((label.fill as any).fgColor.argb).toBe('FFD3D3D3');
    expect(value.font.bold).toBeFalsy(); expect(value.font.size).toBe(8);
    expect(head.font.bold).toBe(true); expect(head.font.size).toBe(10); expect((head.fill as any).fgColor.argb).toBe('FFD3D3D3');
    for (const c of [label, value, head, body]) {
      expect(c.font.name).toBe('Calibri');
      expect(c.border.top?.style).toBe('thin'); expect(c.border.bottom?.style).toBe('thin');
      expect(c.alignment.wrapText).toBe(true);
    }
  });

  it('formats the rate to five decimals, freezes the header, and filters the table', async () => {
    const ws = await load(await buildRateSheetWorkbook(model));
    expect(ws.getCell('E15').numFmt).toBe('0.00000');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 14 });
    expect(ws.autoFilter).toBe('B14:I16');
    expect(ws.pageSetup.printTitlesRow).toBe('14:14');
    expect(ws.getColumn(1).width).toBe(3);
    expect(ws.getColumn(3).width).toBeCloseTo(30.7, 1);
  });

  it('merges each terms paragraph across B:H over two rows', async () => {
    const ws = await load(await buildRateSheetWorkbook(model));
    expect(ws.getCell('B20').isMerged).toBe(true);
    expect(ws.getCell('H21').isMerged).toBe(true);
    expect(ws.getCell('B22').isMerged).toBe(false);
  });

  it('never leaves a null in the table, and says so plainly when nothing is priced', async () => {
    const ws = await load(await buildRateSheetWorkbook(model));
    for (let r = LAYOUT.firstDataRow; r < LAYOUT.firstDataRow + model.rows.length; r++) {
      for (let c = 0; c < RATE_SHEET_COLUMNS.length; c++) {
        const v = ws.getCell(r, LAYOUT.firstCol + c).value;
        expect(v === null || v === undefined || String(v).toLowerCase() === 'null').toBe(false);
      }
    }
    const empty = await load(await buildRateSheetWorkbook({ ...model, rows: [] }));
    expect(empty.getCell('B15').value).toMatch(/No destinations are priced/);
  });
});
