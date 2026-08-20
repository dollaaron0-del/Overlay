import PDFDocument from "pdfkit";

// Renders the same Markdown subset the web client's miniMarkdown.tsx knows
// about (headings, bold/italic/code, links, lists, blockquotes, code fences,
// pipe tables, rules) into an actual PDF, so a long or final Emmy reply can
// land as a real document attachment instead of only living in a clipped
// in-bubble preview (see EMMY_LONG_REPORT_CHARS).

const BODY_FONT = "Helvetica";
const BODY_BOLD = "Helvetica-Bold";
const BODY_ITALIC = "Helvetica-Oblique";
const MONO_FONT = "Courier";
const TEXT_COLOR = "#111827";
const MUTED_COLOR = "#6b7280";
const LINK_COLOR = "#2563eb";
const RULE_COLOR = "#d1d5db";
const BODY_SIZE = 10.5;

interface InlineToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

const INLINE_PATTERN = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) tokens.push({ text: text.slice(lastIndex, match.index) });
    if (match[1] !== undefined) tokens.push({ text: match[1], code: true });
    else if (match[2] !== undefined) tokens.push({ text: match[2], href: match[3] });
    else if (match[4] !== undefined || match[5] !== undefined) tokens.push({ text: (match[4] ?? match[5])!, bold: true });
    else if (match[6] !== undefined || match[7] !== undefined) tokens.push({ text: (match[6] ?? match[7])!, italic: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) tokens.push({ text: text.slice(lastIndex) });
  return tokens.length > 0 ? tokens : [{ text: "" }];
}

function writeInline(doc: PDFDocument, tokens: InlineToken[], size: number): void {
  tokens.forEach((tok, i) => {
    if (tok.code) doc.font(MONO_FONT).fontSize(size - 0.5).fillColor("#b91c1c");
    else if (tok.bold) doc.font(BODY_BOLD).fontSize(size).fillColor(TEXT_COLOR);
    else if (tok.italic) doc.font(BODY_ITALIC).fontSize(size).fillColor(TEXT_COLOR);
    else if (tok.href) doc.font(BODY_FONT).fontSize(size).fillColor(LINK_COLOR);
    else doc.font(BODY_FONT).fontSize(size).fillColor(TEXT_COLOR);

    const opts: Record<string, unknown> = { continued: i < tokens.length - 1 };
    if (tok.href) {
      opts.link = tok.href;
      opts.underline = true;
    }
    doc.text(tok.text, opts);
  });
  doc.fillColor(TEXT_COLOR).font(BODY_FONT).fontSize(BODY_SIZE);
}

function availableWidth(doc: PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function ensureRoom(doc: PDFDocument, height: number): void {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function renderCodeBlock(doc: PDFDocument, codeLines: string[]): void {
  const width = availableWidth(doc);
  const text = codeLines.join("\n") || " ";
  doc.font(MONO_FONT).fontSize(9);
  const height = doc.heightOfString(text, { width: width - 16 }) + 16;
  ensureRoom(doc, height);
  const y = doc.y;
  doc.rect(doc.page.margins.left, y, width, height).fill("#f3f4f6");
  doc.fillColor("#1f2937").text(text, doc.page.margins.left + 8, y + 8, { width: width - 16 });
  doc.y = y + height + 10;
  doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_COLOR);
}

function renderTable(doc: PDFDocument, rows: string[][]): void {
  const [head, ...body] = rows;
  if (!head) return;
  const width = availableWidth(doc);
  const colWidth = width / head.length;
  const padding = 4;

  const drawRow = (cells: string[], bold: boolean, fillBg?: string) => {
    doc.font(bold ? BODY_BOLD : BODY_FONT).fontSize(9.5);
    const rowHeight = Math.max(...cells.map((c) => doc.heightOfString(c, { width: colWidth - padding * 2 })), 12) + padding * 2;
    ensureRoom(doc, rowHeight);
    const y = doc.y;
    if (fillBg) doc.rect(doc.page.margins.left, y, width, rowHeight).fill(fillBg);
    cells.forEach((c, i) => {
      doc
        .font(bold ? BODY_BOLD : BODY_FONT)
        .fontSize(9.5)
        .fillColor(TEXT_COLOR)
        .text(c, doc.page.margins.left + i * colWidth + padding, y + padding, { width: colWidth - padding * 2 });
    });
    doc.y = y + rowHeight;
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + width, doc.y)
      .strokeColor(RULE_COLOR)
      .lineWidth(0.5)
      .stroke();
  };

  drawRow(head, true, "#f3f4f6");
  for (const row of body) drawRow(row, false);
  doc.moveDown(0.6);
  doc.fillColor(TEXT_COLOR).font(BODY_FONT).fontSize(BODY_SIZE);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

const HEADING_SIZES = [16, 14, 12.5, 11.5, 11, 10.5];

function renderBlocks(doc: PDFDocument, markdown: string): void {
  const lines = markdown.split("\n");
  let listItems: { ordered: boolean; text: string }[] | null = null;
  let quoteLines: string[] | null = null;

  const flushList = () => {
    if (!listItems) return;
    for (const [idx, item] of listItems.entries()) {
      const bullet = item.ordered ? `${idx + 1}.` : "•";
      doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_COLOR).text(`${bullet} `, { continued: true, indent: 14 });
      writeInline(doc, tokenizeInline(item.text), BODY_SIZE);
    }
    doc.moveDown(0.3);
    listItems = null;
  };

  const flushQuote = () => {
    if (!quoteLines) return;
    const text = quoteLines.join(" ");
    doc.font(BODY_ITALIC).fontSize(BODY_SIZE).fillColor(MUTED_COLOR).text(text, { indent: 16 });
    doc.moveDown(0.3);
    doc.fillColor(TEXT_COLOR).font(BODY_FONT);
    quoteLines = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      flushList();
      flushQuote();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      renderCodeBlock(doc, codeLines);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      flushQuote();
      const rows: string[][] = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      renderTable(doc, rows);
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    const orderedMatch = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    const quoteMatch = /^\s*>\s?(.*)$/.exec(line);
    const ruleMatch = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.exec(line);

    if (headingMatch) {
      flushList();
      flushQuote();
      const level = headingMatch[1].length;
      const size = HEADING_SIZES[level - 1] ?? 10.5;
      doc.moveDown(0.4);
      doc.font(BODY_BOLD).fontSize(size).fillColor(TEXT_COLOR);
      writeInline(doc, tokenizeInline(headingMatch[2]), size);
      doc.moveDown(0.2);
    } else if (ruleMatch) {
      flushList();
      flushQuote();
      doc.moveDown(0.3);
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor(RULE_COLOR)
        .lineWidth(0.75)
        .stroke();
      doc.moveDown(0.3);
    } else if (bulletMatch) {
      flushQuote();
      listItems = listItems ?? [];
      listItems.push({ ordered: false, text: bulletMatch[1] });
    } else if (orderedMatch) {
      flushQuote();
      listItems = listItems ?? [];
      listItems.push({ ordered: true, text: orderedMatch[1] });
    } else if (quoteMatch) {
      flushList();
      quoteLines = quoteLines ?? [];
      quoteLines.push(quoteMatch[1]);
    } else if (line.trim() === "") {
      flushList();
      flushQuote();
    } else {
      flushList();
      flushQuote();
      writeInline(doc, tokenizeInline(line), BODY_SIZE);
      doc.moveDown(0.35);
    }
    i++;
  }
  flushList();
  flushQuote();
}

/** Mirrors the web client's downloadFilenameFor so the same chat/date always produces the same display name. */
export function pdfFilenameFor(chatTitle: string, atIso: string): string {
  const safeTitle =
    chatTitle
      .trim()
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "bericht";
  return `emmy-${safeTitle}-${atIso.slice(0, 10)}.pdf`;
}

/** Renders `markdown` as a standalone PDF report with `title` as its heading, returning the finished file's bytes. */
export function renderMarkdownToPdf(markdown: string, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.info.Title = title;

    doc.font(BODY_BOLD).fontSize(18).fillColor(TEXT_COLOR).text(title);
    doc.moveDown(0.3);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor(RULE_COLOR)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.8);

    renderBlocks(doc, markdown);

    doc.end();
  });
}
