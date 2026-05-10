import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, Header, Footer, NumberFormat,
} from 'docx';
import { readFileSync, writeFileSync } from 'fs';

// ── Palette (dark-themed, matches platform branding) ──────────────────────────
const ACCENT  = '00D4FF';
const WHITE   = 'FFFFFF';
const LIGHT   = 'E8E8E8';
const MID     = 'BDBDBD';
const MUTED   = '888888';
const PANEL   = '1A1F2E';
const BQ_LINE = '2A3550';

// ── Inline text parser: **bold**, *italic*, `code` ───────────────────────────
interface Span { text: string; bold?: boolean; italic?: boolean; code?: boolean; color?: string }

function parseInline(raw: string): Span[] {
  const spans: Span[] = [];
  // strip markdown links [label](url) → keep label only
  let s = raw.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // strip images
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<![*])\*(?![*])(.+?)(?<![*])\*(?![*])|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) spans.push({ text: s.slice(last, m.index) });
    if (m[2]) spans.push({ text: m[2], bold: true, italic: true });
    else if (m[3]) spans.push({ text: m[3], bold: true });
    else if (m[4]) spans.push({ text: m[4], italic: true });
    else if (m[5]) spans.push({ text: m[5], code: true, color: ACCENT });
    last = m.index + m[0].length;
  }
  if (last < s.length) spans.push({ text: s.slice(last) });
  return spans.filter(sp => sp.text.length > 0);
}

function toRuns(raw: string, defaultColor = LIGHT): TextRun[] {
  return parseInline(raw).map(sp =>
    new TextRun({
      text: sp.text,
      bold:    sp.bold,
      italics: sp.italic,
      color:   sp.color ?? (sp.code ? ACCENT : defaultColor),
      font:    sp.code ? 'Courier New' : 'Calibri',
      size:    sp.code ? 18 : 20,
    })
  );
}

// ── Heading helpers ───────────────────────────────────────────────────────────
function h1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 520, after: 180 },
    children: [new TextRun({ text, color: ACCENT, bold: true, size: 44, font: 'Calibri' })],
  });
}
function h2(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 380, after: 120 },
    border: { bottom: { color: BQ_LINE, size: 6, space: 4, style: BorderStyle.SINGLE } },
    children: [new TextRun({ text, color: WHITE, bold: true, size: 30, font: 'Calibri' })],
  });
}
function h3(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 80 },
    children: [new TextRun({ text, color: LIGHT, bold: true, size: 24, font: 'Calibri' })],
  });
}
function h4(text: string) {
  return new Paragraph({
    spacing: { before: 220, after: 60 },
    children: [new TextRun({ text, color: LIGHT, bold: true, size: 22, font: 'Calibri' })],
  });
}

function para(raw: string, indent = 0) {
  return new Paragraph({
    indent: indent ? { left: indent * 360 } : undefined,
    spacing: { after: 100 },
    children: toRuns(raw, MID),
  });
}

function bullet(raw: string, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 70 },
    children: toRuns(raw, LIGHT),
  });
}

function numbered(raw: string, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bitsauto-num', level },
    spacing: { after: 70 },
    children: toRuns(raw, LIGHT),
  });
}

function blockquote(raw: string) {
  return new Paragraph({
    indent: { left: 720, hanging: 0 },
    spacing: { after: 120 },
    border: { left: { color: ACCENT, size: 14, space: 10, style: BorderStyle.SINGLE } },
    children: toRuns(raw, MUTED),
  });
}

function hrule() {
  return new Paragraph({
    spacing: { before: 240, after: 240 },
    border: { bottom: { color: BQ_LINE, size: 6, space: 1, style: BorderStyle.SINGLE } },
    children: [],
  });
}

// ── Table builder ─────────────────────────────────────────────────────────────
function buildTable(rows: string[][]): Table {
  const colCount = Math.max(...rows.map(r => r.length));
  const pct = Math.floor(100 / Math.max(colCount, 1));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((cells, ri) => new TableRow({
      tableHeader: ri === 0,
      children: cells.map(cell => new TableCell({
        width: { size: pct, type: WidthType.PERCENTAGE },
        shading: ri === 0 ? { type: 'solid', color: PANEL } : undefined,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({
            text: cell.trim(),
            bold: ri === 0,
            color: ri === 0 ? ACCENT : LIGHT,
            size: 18,
            font: 'Calibri',
          })],
        })],
      })),
    })),
  });
}

// ── Main converter ────────────────────────────────────────────────────────────
export async function convertMdToDocx(mdPath: string, outPath: string, docTitle: string): Promise<void> {
  const src = readFileSync(mdPath, 'utf8');
  const lines = src.split(/\r?\n/);

  const children: (Paragraph | Table)[] = [];

  let i = 0;
  let tableRows: string[][] = [];

  function flushTable() {
    if (tableRows.length > 0) {
      // remove separator rows (---|----|---)
      const rows = tableRows.filter(r => !r.every(c => /^[-: ]+$/.test(c)));
      if (rows.length > 0) children.push(buildTable(rows));
      tableRows = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line
    if (trimmed === '') {
      flushTable();
      children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      i++;
      continue;
    }

    // HR
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushTable();
      children.push(hrule());
      i++;
      continue;
    }

    // Headings
    if (trimmed.startsWith('#### ')) { flushTable(); children.push(h4(trimmed.slice(5).trim())); i++; continue; }
    if (trimmed.startsWith('### '))  { flushTable(); children.push(h3(trimmed.slice(4).trim())); i++; continue; }
    if (trimmed.startsWith('## '))   { flushTable(); children.push(h2(trimmed.slice(3).trim())); i++; continue; }
    if (trimmed.startsWith('# '))    { flushTable(); children.push(h1(trimmed.slice(2).trim())); i++; continue; }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushTable();
      children.push(blockquote(trimmed.slice(2)));
      i++;
      continue;
    }

    // Table row
    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      tableRows.push(cells);
      i++;
      continue;
    }

    // Bullet list
    const bulletMatch = /^(\s*)[-*+] (.+)$/.exec(line);
    if (bulletMatch) {
      flushTable();
      const level = Math.floor((bulletMatch[1] ?? '').length / 2);
      children.push(bullet(bulletMatch[2].trim(), Math.min(level, 8)));
      i++;
      continue;
    }

    // Numbered list
    const numMatch = /^(\s*)\d+[.)]\s+(.+)$/.exec(line);
    if (numMatch) {
      flushTable();
      const level = Math.floor((numMatch[1] ?? '').length / 3);
      children.push(numbered(numMatch[2].trim(), Math.min(level, 8)));
      i++;
      continue;
    }

    // Normal paragraph
    flushTable();
    children.push(para(trimmed));
    i++;
  }
  flushTable();

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bitsauto-num',
        levels: Array.from({ length: 9 }, (_, lvl) => ({
          level: lvl,
          format: NumberFormat.DECIMAL,
          text: `%${lvl + 1}.`,
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360 * (lvl + 1), hanging: 360 } } },
        })),
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 20, color: MID },
        },
      },
    },
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: docTitle, color: MUTED, size: 16, font: 'Calibri' }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Bitsauto Monitoring Platform  ·  Confidential  ·  ', color: MUTED, size: 16 }),
              new TextRun({ text: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), color: MUTED, size: 16 }),
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
