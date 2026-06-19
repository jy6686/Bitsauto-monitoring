import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, Header, Footer, NumberFormat,
} from 'docx';
import { readFileSync, writeFileSync } from 'fs';

// ── Professional light-theme palette ──────────────────────────────────────────
// Designed for white-page rendering (Word, LibreOffice, Google Docs, browser)
const DARK_NAVY       = '0F172A';  // H1 — near-black navy
const MED_NAVY        = '1E3A5F';  // H2 — deep navy
const TEAL            = '0D6E6E';  // H3 — dark teal
const BODY_TEXT       = '1E293B';  // Body paragraphs — dark slate (high contrast)
const MUTED_TEXT      = '475569';  // Secondary / caption text
const CODE_COLOR      = '1D4ED8';  // Inline code — blue
const ACCENT_LINE     = '3B82F6';  // Decorative border line
const TABLE_HEAD_BG   = '1E3A5F';  // Table header background — deep navy
const TABLE_HEAD_TEXT = 'FFFFFF';  // Table header text — white
const TABLE_ALT_BG    = 'F1F5F9';  // Alternating row background — very light blue-gray
const ROW_BORDER      = 'CBD5E1';  // Table cell border color
const HR_LINE         = 'D1D5DB';  // Horizontal rule

// Page geometry (twips: 1 inch = 1440 twips)
// US Letter 8.5 × 11 in = 12240 × 15840 twips
// Margins: 1 inch all sides = 1440 twips
const CONTENT_WIDTH = 12240 - 1440 - 1440; // 9360 twips

// ── Inline text parser: ***bold-italic***, **bold**, *italic*, `code` ────────
interface Span { text: string; bold?: boolean; italic?: boolean; code?: boolean }

function parseInline(raw: string): Span[] {
  const spans: Span[] = [];
  let s = raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // strip MD links → keep label
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '');      // strip images

  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<![*])\*(?![*])(.+?)(?<![*])\*(?![*])|`([^`]+)`)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) spans.push({ text: s.slice(last, m.index) });
    if      (m[2]) spans.push({ text: m[2], bold: true,  italic: true });
    else if (m[3]) spans.push({ text: m[3], bold: true });
    else if (m[4]) spans.push({ text: m[4], italic: true });
    else if (m[5]) spans.push({ text: m[5], code: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) spans.push({ text: s.slice(last) });
  return spans.filter(sp => sp.text.length > 0);
}

function toRuns(raw: string, defaultColor = BODY_TEXT, defaultSize = 20): TextRun[] {
  return parseInline(raw).map(sp =>
    new TextRun({
      text:    sp.text,
      bold:    sp.bold,
      italics: sp.italic,
      color:   sp.code ? CODE_COLOR : defaultColor,
      font:    sp.code ? 'Courier New' : 'Calibri',
      size:    sp.code ? defaultSize - 2 : defaultSize,
      // code gets a subtle highlight by being a different color — no background in docx TextRun
    })
  );
}

// ── Heading helpers ───────────────────────────────────────────────────────────
function h1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 600, after: 240 },
    border: { bottom: { color: ACCENT_LINE, size: 10, space: 6, style: BorderStyle.SINGLE } },
    children: [new TextRun({ text, color: DARK_NAVY, bold: true, size: 48, font: 'Calibri' })],
  });
}
function h2(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 440, after: 160 },
    border: { bottom: { color: ROW_BORDER, size: 4, space: 4, style: BorderStyle.SINGLE } },
    children: [new TextRun({ text, color: MED_NAVY, bold: true, size: 34, font: 'Calibri' })],
  });
}
function h3(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 320, after: 100 },
    children: [new TextRun({ text, color: TEAL, bold: true, size: 26, font: 'Calibri' })],
  });
}
function h4(text: string) {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, color: MED_NAVY, bold: true, size: 22, font: 'Calibri' })],
  });
}

function para(raw: string, indent = 0) {
  return new Paragraph({
    indent: indent ? { left: indent * 360 } : undefined,
    spacing: { after: 120, line: 276, lineRule: 'auto' as any },
    children: toRuns(raw, BODY_TEXT, 20),
  });
}

function bullet(raw: string, level = 0) {
  return new Paragraph({
    bullet: { level: Math.min(level, 8) },
    spacing: { after: 80, line: 276, lineRule: 'auto' as any },
    indent: { left: 360 * (level + 1), hanging: 360 },
    children: toRuns(raw, BODY_TEXT, 20),
  });
}

function numbered(raw: string, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bitsauto-num', level: Math.min(level, 8) },
    spacing: { after: 80, line: 276, lineRule: 'auto' as any },
    children: toRuns(raw, BODY_TEXT, 20),
  });
}

function blockquote(raw: string) {
  return new Paragraph({
    indent: { left: 720, hanging: 0 },
    spacing: { after: 140, line: 276, lineRule: 'auto' as any },
    border: { left: { color: ACCENT_LINE, size: 16, space: 12, style: BorderStyle.SINGLE } },
    shading: { type: 'solid', color: 'F8FAFC' },
    children: toRuns(raw, MUTED_TEXT, 19),
  });
}

function hrule() {
  return new Paragraph({
    spacing: { before: 280, after: 280 },
    border: { bottom: { color: HR_LINE, size: 6, space: 1, style: BorderStyle.SINGLE } },
    children: [],
  });
}

// ── Table builder — fixed DXA widths, no percentage guessing ─────────────────
function buildTable(rows: string[][]): Table {
  const colCount = Math.max(...rows.map(r => r.length), 1);

  // Distribute width: first column gets 28%, remainder split evenly
  // For 2-col tables: 28% / 72%  For 3-col: 28% / 36% / 36%  For 1-col: 100%
  function colWidth(colIdx: number): number {
    if (colCount === 1) return CONTENT_WIDTH;
    if (colIdx === 0) return Math.round(CONTENT_WIDTH * 0.30);
    return Math.round((CONTENT_WIDTH * 0.70) / (colCount - 1));
  }

  // Pad short rows to colCount
  const paddedRows = rows.map(r => {
    const out = [...r];
    while (out.length < colCount) out.push('');
    return out;
  });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    borders: {
      top:           { style: BorderStyle.SINGLE, size: 4, color: ROW_BORDER },
      bottom:        { style: BorderStyle.SINGLE, size: 4, color: ROW_BORDER },
      left:          { style: BorderStyle.SINGLE, size: 4, color: ROW_BORDER },
      right:         { style: BorderStyle.SINGLE, size: 4, color: ROW_BORDER },
      insideH:       { style: BorderStyle.SINGLE, size: 4, color: ROW_BORDER },
      insideV:       { style: BorderStyle.SINGLE, size: 4, color: ROW_BORDER },
    },
    rows: paddedRows.map((cells, ri) => new TableRow({
      tableHeader: ri === 0,
      children: cells.map((cell, ci) => {
        const isHeader = ri === 0;
        const isAlt    = !isHeader && ri % 2 === 0;
        return new TableCell({
          width: { size: colWidth(ci), type: WidthType.DXA },
          shading: isHeader
            ? { type: 'solid', color: TABLE_HEAD_BG, fill: TABLE_HEAD_BG }
            : isAlt
              ? { type: 'solid', color: TABLE_ALT_BG, fill: TABLE_ALT_BG }
              : { type: 'solid', color: 'FFFFFF', fill: 'FFFFFF' },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          children: [new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 0, line: 260, lineRule: 'auto' as any },
            children: toRuns(
              cell.trim(),
              isHeader ? TABLE_HEAD_TEXT : BODY_TEXT,
              isHeader ? 19 : 19,
            ).map(run => {
              // Header runs — force bold + white
              if (isHeader) return new TextRun({ ...run, bold: true, color: TABLE_HEAD_TEXT });
              return run;
            }),
          })],
        });
      }),
    })),
  });
}

// ── Main converter ────────────────────────────────────────────────────────────
export async function convertMdToDocx(mdPath: string, outPath: string, docTitle: string): Promise<void> {
  const src   = readFileSync(mdPath, 'utf8');
  const lines = src.split(/\r?\n/);

  const children: (Paragraph | Table)[] = [];
  let tableRows: string[][] = [];
  let i = 0;

  function flushTable() {
    if (tableRows.length === 0) return;
    // Drop separator rows (all cells look like: ---, :---, ---:)
    const rows = tableRows.filter(r => !r.every(c => /^[-: ]+$/.test(c)));
    if (rows.length > 0) {
      children.push(buildTable(rows));
      // spacing after table
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    }
    tableRows = [];
  }

  while (i < lines.length) {
    const line    = lines[i];
    const trimmed = line.trim();

    // Blank line
    if (trimmed === '') {
      flushTable();
      children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      i++; continue;
    }

    // HR  (--- or ***)
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushTable(); children.push(hrule()); i++; continue;
    }

    // Headings
    if (trimmed.startsWith('#### ')) { flushTable(); children.push(h4(trimmed.slice(5).trim())); i++; continue; }
    if (trimmed.startsWith('### '))  { flushTable(); children.push(h3(trimmed.slice(4).trim())); i++; continue; }
    if (trimmed.startsWith('## '))   { flushTable(); children.push(h2(trimmed.slice(3).trim())); i++; continue; }
    if (trimmed.startsWith('# '))    { flushTable(); children.push(h1(trimmed.slice(2).trim())); i++; continue; }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushTable(); children.push(blockquote(trimmed.slice(2))); i++; continue;
    }

    // Markdown table row
    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      tableRows.push(cells);
      i++; continue;
    }

    // Bullet list (-, *, +)
    const bulletMatch = /^(\s*)[-*+] (.+)$/.exec(line);
    if (bulletMatch) {
      flushTable();
      const level = Math.floor((bulletMatch[1] ?? '').length / 2);
      children.push(bullet(bulletMatch[2].trim(), level));
      i++; continue;
    }

    // Numbered list (1. or 1))
    const numMatch = /^(\s*)\d+[.)]\s+(.+)$/.exec(line);
    if (numMatch) {
      flushTable();
      const level = Math.floor((numMatch[1] ?? '').length / 3);
      children.push(numbered(numMatch[2].trim(), level));
      i++; continue;
    }

    // Normal paragraph
    flushTable();
    children.push(para(trimmed));
    i++;
  }
  flushTable();

  const today = new Date().toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bitsauto-num',
        levels: Array.from({ length: 9 }, (_, lvl) => ({
          level: lvl,
          format: NumberFormat.DECIMAL,
          text:   `%${lvl + 1}.`,
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: 360 * (lvl + 1), hanging: 360 } },
            run: { color: BODY_TEXT, size: 20, font: 'Calibri' },
          },
        })),
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 20, color: BODY_TEXT },
        },
      },
    },
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { color: ROW_BORDER, size: 4, space: 4, style: BorderStyle.SINGLE } },
            spacing: { after: 120 },
            children: [
              new TextRun({ text: 'Bitsauto Monitoring Platform  ·  ', color: MUTED_TEXT, size: 16, font: 'Calibri' }),
              new TextRun({ text: docTitle, color: MED_NAVY, bold: true, size: 16, font: 'Calibri' }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { color: ROW_BORDER, size: 4, space: 4, style: BorderStyle.SINGLE } },
            spacing: { before: 80 },
            children: [
              new TextRun({ text: 'Confidential  ·  ', color: MUTED_TEXT, size: 16, font: 'Calibri' }),
              new TextRun({ text: today, color: MUTED_TEXT, size: 16, font: 'Calibri' }),
            ],
          })],
        }),
      },
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  writeFileSync(outPath, buf);
}
