// generate-roadmap-docx.js — NexusLink comprehensive roadmap (Arabic RTL DOCX)
// Cover: Recipe R1 (long-title fallback from R4/GO-1 routing) with GO-1 Graphite Orange palette,
// mirrored for RTL. 3-section architecture: cover (no footer) / TOC (Roman) / body (Arabic, start 1).
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  SectionType, LevelFormat, TableOfContents, TableLayoutType,
} = require("docx");
const fs = require("fs");
const path = require("path");
let imageSize;
try { imageSize = require("image-size").imageSize; } catch (e) { /* noop */ }
if (!imageSize) imageSize = require("image-size");

const { meta, chapters } = require("/home/z/my-project/scripts/roadmap-docx-content.js");

// ── GO-1 Graphite Orange palette (design-system.md) ──
const P = {
  bg: "1A2330", primary: "1A2330", accent: "D4875A", body: "000000",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "D4875A", headerText: "FFFFFF", accentLine: "D4875A", innerLine: "DDD0C8", surface: "F8F0EB" },
  secondary: "505A66",
};
const AR = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "Arial" };

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

// ── Title layout (Arabic-adapted calcTitleLayout: char width ≈ pt*12 twips) ──
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."،؛:.!?", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}

function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 12; // Arabic average glyph width (narrower than CJK pt*20)
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, midSpacing: Math.max(safeRemaining - topSpacing - bottomSpacing, 0), bottomSpacing };
}

// ── Cover: R1 mirrored for RTL (structure per recipe: single 16838 wrapper, allNoBorders,
//    paragraph-border decorations only, dynamic calcTitleLayout + calcCoverSpacing) ──
function buildCoverR1RTL(config) {
  const padL = 800, padR = 1200; // mirrored: text block inset 1200 from the right edge
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentRight = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];

  // 1. dynamic top whitespace
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  // 2. English label with accent bottom border (Latin — LTR run, right-anchored)
  if (config.englishLabel) {
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      indent: { left: padL, right: padR },
      spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({
        text: config.englishLabel.split("").join(" "),
        size: 18, color: P.accent, font: AR, characterSpacing: 40,
      })],
    }));
  }

  // 3. main title (dynamic size + smart line breaks) — Rule 8: explicit line spacing
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      bidirectional: true,
      indent: { left: padL, right: padR },
      spacing: {
        after: i < titleLines.length - 1 ? 100 : 300,
        line: Math.ceil(titlePt * 23), lineRule: "atLeast",
      },
      children: [new TextRun({
        text: titleLines[i], size: titleSize, sizeComplexScript: true,
        bold: true, boldComplexScript: true, rightToLeft: true,
        color: P.cover.titleColor, font: AR,
      })],
    }));
  }

  // 4. subtitle
  if (config.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT, bidirectional: true,
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({
        text: config.subtitle, size: 24, sizeComplexScript: true, rightToLeft: true,
        color: P.cover.subtitleColor, font: AR,
      })],
    }));
  }

  // 5. meta lines with accent bar on the right (mirrored from border.left)
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT, bidirectional: true,
      indent: { left: padL, right: padR + 200 }, spacing: { after: 80 },
      border: { right: accentRight },
      children: [new TextRun({
        text: line, size: 24, sizeComplexScript: true, rightToLeft: true,
        color: P.cover.metaColor, font: AR,
      })],
    }));
  }

  // 6. dynamic bottom whitespace
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  // 7. footer line with top accent separator
  children.push(new Paragraph({
    alignment: AlignmentType.RIGHT, bidirectional: true,
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerRight || "", size: 16, sizeComplexScript: true, rightToLeft: true, color: P.cover.footerColor, font: AR }),
      new TextRun({ text: "                                        ", font: AR }),
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.cover.footerColor, font: AR }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg },
        borders: noBorders,
        verticalAlign: "top",
        children,
      })],
    })],
  })];
}

// ── Body builders ──
function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    bidirectional: true,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, boldComplexScript: true, size: 32, sizeComplexScript: true, rightToLeft: true, color: P.primary, font: AR })],
  });
}
function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    alignment: AlignmentType.RIGHT,
    bidirectional: true,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, boldComplexScript: true, size: 28, sizeComplexScript: true, rightToLeft: true, color: P.primary, font: AR })],
  });
}
function bodyPara(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    bidirectional: true,
    spacing: { after: 120, line: 312 },
    children: [new TextRun({ text, size: 24, sizeComplexScript: true, rightToLeft: true, color: P.body, font: AR })],
  });
}
function captionPara(text, keepNext) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    bidirectional: true,
    keepNext: !!keepNext,
    spacing: { before: 160, after: 100, line: 312 },
    children: [new TextRun({ text, bold: true, boldComplexScript: true, size: 21, sizeComplexScript: true, rightToLeft: true, color: P.secondary, font: AR })],
  });
}

function tableBlock(block) {
  const n = block.headers.length;
  const widths = block.widths && block.widths.length === n ? block.widths : Array(n).fill(Math.floor(100 / n));
  const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: block.headers.map((h, idx) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: P.table.headerBg },
      margins: cellMargins,
      width: { size: widths[idx], type: WidthType.PERCENTAGE },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER, bidirectional: true, spacing: { line: 312 },
        children: [new TextRun({ text: h, bold: true, boldComplexScript: true, size: 21, sizeComplexScript: true, rightToLeft: true, color: P.table.headerText, font: AR })],
      })],
    })),
  });
  const dataRows = block.rows.map((row, rIdx) => new TableRow({
    cantSplit: true,
    children: row.map((cell, idx) => new TableCell({
      shading: rIdx % 2 === 1 ? { type: ShadingType.CLEAR, fill: P.table.surface } : undefined,
      margins: cellMargins,
      width: { size: widths[idx], type: WidthType.PERCENTAGE },
      children: [new Paragraph({
        alignment: idx === 0 ? AlignmentType.RIGHT : AlignmentType.RIGHT,
        bidirectional: true, spacing: { line: 312 },
        children: [new TextRun({ text: cell, size: 21, sizeComplexScript: true, rightToLeft: true, color: P.body, font: AR })],
      })],
    })),
  }));
  const tbl = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: true,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [headerRow, ...dataRows],
  });
  return [captionPara(block.caption, true), tbl, new Paragraph({ spacing: { after: 120 }, children: [] })];
}

function figureBlock(block) {
  const buf = fs.readFileSync(block.path);
  let dims;
  try { dims = imageSize(buf); } catch (e) { dims = imageSize(new Uint8Array(buf)); }
  const displayWidth = 580;
  const displayHeight = Math.round(displayWidth * (dims.height / dims.width));
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 160, after: 60 },
      children: [new ImageRun({ data: buf, transformation: { width: displayWidth, height: displayHeight }, type: "png" })],
    }),
    captionPara(block.caption, false),
  ];
}

function numListBlock(block) {
  return block.items.map((item) => new Paragraph({
    numbering: { reference: block.ref, level: 0 },
    alignment: AlignmentType.RIGHT,
    bidirectional: true,
    spacing: { after: 100, line: 312 },
    children: [new TextRun({ text: item, size: 24, sizeComplexScript: true, rightToLeft: true, color: P.body, font: AR })],
  }));
}

function buildBody() {
  const out = [];
  for (const ch of chapters) {
    out.push(heading1(ch.title));
    for (const b of ch.blocks) {
      if (b.type === "p") out.push(bodyPara(b.text));
      else if (b.type === "h2") out.push(heading2(b.text));
      else if (b.type === "table") out.push(...tableBlock(b));
      else if (b.type === "figure") out.push(...figureBlock(b));
      else if (b.type === "numlist") out.push(...numListBlock(b));
    }
  }
  return out;
}

// ── Footers / header ──
function pageNumFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: AR })],
    })],
  });
}
const bodyHeader = new Header({
  children: [new Paragraph({
    alignment: AlignmentType.RIGHT, bidirectional: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine, space: 4 } },
    children: [new TextRun({ text: meta.headerText, size: 18, sizeComplexScript: true, rightToLeft: true, color: "888888", font: AR })],
  })],
});

// ── TOC section children ──
function buildTocChildren() {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 480, after: 360, line: 480, lineRule: "atLeast" },
      children: [new TextRun({ text: meta.tocTitle, bold: true, boldComplexScript: true, size: 32, sizeComplexScript: true, rightToLeft: true, color: P.primary, font: AR })],
    }),
    new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
    new Paragraph({
      alignment: AlignmentType.RIGHT, bidirectional: true,
      spacing: { before: 200 },
      children: [new TextRun({ text: meta.tocHint, italics: true, size: 18, sizeComplexScript: true, rightToLeft: true, color: "888888", font: AR })],
    }),
  ];
}

// ── Assembly ──
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  title: meta.title,
  creator: "CTO-DRS · NexusLink",
  description: meta.subtitle,
  features: { updateFields: true },
  styles: {
    default: {
      document: {
        run: { font: AR, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: AR, size: 32, bold: true, color: P.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 312 } },
      },
      heading2: {
        run: { font: AR, size: 28, bold: true, color: P.primary },
        paragraph: { spacing: { before: 240, after: 120, line: 312 } },
      },
    },
  },
  numbering: {
    config: [{
      reference: "list-next-steps",
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.RIGHT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
  },
  sections: [
    { // Section 1: cover — margin 0, no footer, no pageNumbers
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1RTL(meta),
    },
    { // Section 2: front matter (TOC) — Roman numerals
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageNumFooter() },
      children: buildTocChildren(),
    },
    { // Section 3: body — Arabic numerals reset to 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: bodyHeader },
      footers: { default: pageNumFooter() },
      children: buildBody(),
    },
  ],
});

const OUT = "/home/z/my-project/download/NexusLink-خارطة-الطريق-الشاملة.docx";
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("WROTE " + OUT + " (" + Math.round(buf.length / 1024) + "KB)");
});
