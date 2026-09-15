/**
 * rate-sheet-workbook.ts — the customer-facing FULL rate sheet as an .xlsx.
 *
 * Layout reproduces the rate notification the owner supplied as the standard
 * (QUICKCOM · FIRST CLASS · 8 Sep 2026): a margin column, a header block with
 * the status legend beside it, an eight-column table, and the terms under it.
 * Fonts, fills, borders, wrapping and widths are taken from that file's own
 * style definitions. Built with exceljs, chosen on 2026-09-14 because the
 * community SheetJS build silently drops every cell style it is given.
 *
 * Data only comes in through RateSheetModel; nothing here reads a database.
 */
import ExcelJS from 'exceljs';
import type { RateSheetModel, RateSheetRow } from './rate-sheet-model';

const FONT = 'Calibri';
const GREY = 'FFD3D3D3';
const thin = { style: 'thin' as const };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

type Style = { bold?: boolean; size: number; fill?: boolean; border?: boolean; wrap?: boolean; align?: 'left' | 'right' | 'center' };
const S = {
  label:  { bold: true,  size: 8,  fill: true,  border: true, wrap: true } as Style,   // header block labels, legend codes
  value:  { bold: false, size: 8,  fill: false, border: true, wrap: true } as Style,   // header block values, table rows
  head:   { bold: true,  size: 10, fill: true,  border: true, wrap: true } as Style,   // table header
  title:  { bold: true,  size: 8,  fill: false, border: false, wrap: true } as Style,  // "TERMS AND CONDITIONS"
  terms:  { bold: false, size: 8,  fill: false, border: false, wrap: true } as Style,  // footer paragraphs
};

function apply(cell: ExcelJS.Cell, st: Style, value: ExcelJS.CellValue): void {
  cell.value = value;
  cell.font = { name: FONT, size: st.size, bold: !!st.bold };
  if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
  if (st.border) cell.border = BORDER;
  cell.alignment = { wrapText: !!st.wrap, vertical: 'top', horizontal: st.align };
}

export const RATE_SHEET_COLUMNS: Array<{ key: keyof RateSheetRow; title: string; width: number }> = [
  { key: 'country',          title: 'Country',           width: 20.7 },
  { key: 'destination',      title: 'Destination',       width: 30.7 },
  { key: 'prefix',           title: 'Prefix',            width: 10.7 },
  { key: 'rate',             title: 'Rate',              width: 10.7 },
  { key: 'status',           title: 'Status',            width: 20.7 },
  { key: 'billingIncrement', title: 'Billing Increment', width: 17.7 },
  { key: 'effectiveDate',    title: 'Effective Date',    width: 12.7 },
  { key: 'effectiveTime',    title: 'Effective Time',    width: 12.7 },
];

export const STATUS_LEGEND: Array<[string, string]> = [
  ['N', 'New Code'], ['NC', 'No Change'], ['I', 'Increase'], ['D', 'Decrease'],
  ['PI', 'Pending Increase'], ['PD', 'Pending Decrease'], ['B', 'Block'],
  ['R', 'Removed/Delete'], ['DC', 'Destination Change'],
];

/** Where things sit, so tests and readers share one description of the layout. */
export const LAYOUT = {
  firstCol: 2,          // B — column A is a margin
  headerTop: 4,         // header block B4:C12, legend H4:I12
  tableHeaderRow: 14,   // column titles
  firstDataRow: 15,
  rateFormat: '0.00000',
};

export async function buildRateSheetWorkbook(model: RateSheetModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BitsAuto';
  wb.created = new Date();
  const lastDataRow = LAYOUT.firstDataRow + Math.max(model.rows.length, 1) - 1;
  const lastCol = LAYOUT.firstCol + RATE_SHEET_COLUMNS.length - 1; // I

  const ws = wb.addWorksheet('Rates', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: LAYOUT.tableHeaderRow, topLeftCell: `A${LAYOUT.firstDataRow}` }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${LAYOUT.tableHeaderRow}:${LAYOUT.tableHeaderRow}`, paperSize: 9 },
    properties: { defaultRowHeight: 15 },
  });

  // Column widths — margin, then the eight table columns, plus the legend's two.
  ws.getColumn(1).width = 3;
  RATE_SHEET_COLUMNS.forEach((c, i) => { ws.getColumn(LAYOUT.firstCol + i).width = c.width; });

  // Header block B4:C12
  const h = model.header;
  const headerLines: Array<[string, string]> = [
    ['Company Name', h.companyName],
    ['Product Name', h.productLabel],
    ['Send Date', h.sendDate],
    ['Send Time', h.sendTime],
    ['Increase Effective Date', h.increaseEffectiveDate],
    ['Decrease Effective Date', h.decreaseEffectiveDate],
    ['Technical Prefix', h.technicalPrefix],
    ['KAM Name', h.kamName],
    ['KAM Email', h.kamEmail],
  ];
  headerLines.forEach(([k, v], i) => {
    const row = LAYOUT.headerTop + i;
    apply(ws.getCell(row, 2), S.label, k);
    apply(ws.getCell(row, 3), S.value, v);
  });

  // Legend H4:I12
  STATUS_LEGEND.forEach(([code, meaning], i) => {
    const row = LAYOUT.headerTop + i;
    apply(ws.getCell(row, 8), S.label, code);
    apply(ws.getCell(row, 9), S.value, meaning);
  });

  // Table header
  RATE_SHEET_COLUMNS.forEach((c, i) => apply(ws.getCell(LAYOUT.tableHeaderRow, LAYOUT.firstCol + i), S.head, c.title));

  // Rows
  model.rows.forEach((r, i) => {
    const row = LAYOUT.firstDataRow + i;
    RATE_SHEET_COLUMNS.forEach((c, j) => {
      const cell = ws.getCell(row, LAYOUT.firstCol + j);
      apply(cell, { ...S.value, align: c.key === 'rate' ? 'right' : undefined }, r[c.key]);
      if (c.key === 'rate') cell.numFmt = LAYOUT.rateFormat;
    });
  });
  if (!model.rows.length) {
    apply(ws.getCell(LAYOUT.firstDataRow, LAYOUT.firstCol), S.value, 'No destinations are priced for this product.');
    ws.mergeCells(LAYOUT.firstDataRow, LAYOUT.firstCol, LAYOUT.firstDataRow, lastCol);
  }

  ws.autoFilter = { from: { row: LAYOUT.tableHeaderRow, column: LAYOUT.firstCol }, to: { row: lastDataRow, column: lastCol } };

  // Terms: title, then each paragraph merged across B:H over two rows, a blank row between.
  let row = lastDataRow + 3;
  apply(ws.getCell(row, 2), S.title, 'TERMS AND CONDITIONS');
  row += 1;
  for (const paragraph of model.terms) {
    apply(ws.getCell(row, 2), S.terms, paragraph);
    ws.mergeCells(row, 2, row + 1, 8);
    ws.getRow(row).height = 24;
    ws.getRow(row + 1).height = 24;
    row += 3;
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
