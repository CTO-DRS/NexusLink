// ============================================================
// NexusLink — وثيقة المراجعة الربعية الأولى للخارطة (Q4-2026)
// docx-js generation — RTL Arabic — Cover R1 + palette DM-1
// Skill compliance: R1 recipe + calcTitleLayout + calcCoverSpacing
// + allNoBorders + 3-section numbering + TOC + horizontal tables
// ============================================================
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  SectionType, TableLayoutType, TableOfContents,
} = require("docx");
const fs = require("fs");
const path = require("path");

const ROOT = "/home/z/my-project";
const OUT = path.join(ROOT, "download", "NexusLink-المراجعة-الربعية-Q4-2026.docx");
const VISUAL = path.join(ROOT, "download", "NexusLink-Roadmap-Visual.png");

// ── Palette DM-1 (Deep Cyan — tech) — cover + table tokens ──
const P = {
  coverBg: "162235", titleColor: "FFFFFF", subtitleColor: "B0B8C0",
  metaColor: "90989F", footerColor: "687078", coverAccent: "37DCF2",
  primary: "162235",           // headings on white pages
  body: "000000",              // Profile A formal: pure black body
  secondary: "595959",         // captions
  headerBg: "1B6B7A", headerText: "FFFFFF",
  accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5",
};

// ── Border constants (MANDATORY allNoBorders on cover tables) ──
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB,
  insideHorizontal: NB, insideVertical: NB };

const ARIAL = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "Arial" };

// ── mixed(): split Arabic/Latin segments so Latin tokens keep LTR
//    ordering (versions, dates, codes) inside RTL paragraphs ──
const LT = /[A-Za-z0-9][A-Za-z0-9@._\/:+#\u2013-]*[A-Za-z0-9%]|[A-Za-z0-9]/g;
function seg(text, opts, rtl) {
  return new TextRun({
    text, font: ARIAL, size: opts.size || 24,
    bold: !!opts.bold, italics: !!opts.italics,
    color: opts.color || P.body, rightToLeft: rtl,
  });
}
function mixed(text, opts = {}) {
  const runs = [];
  let last = 0;
  for (const m of text.matchAll(LT)) {
    if (m.index > last) runs.push(seg(text.slice(last, m.index), opts, true));
    runs.push(seg(m[0], opts, false));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(seg(text.slice(last), opts, true));
  return runs;
}

// ── Paragraph builders (RTL: bidirectional on every paragraph) ──
function body(text, opts = {}) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: opts.after ?? 120, before: opts.before ?? 0 },
    children: mixed(text, { size: 24, ...opts }),
  });
}
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 360, after: 160, line: 380, lineRule: "atLeast" },
    children: mixed(text, { size: 32, bold: true, color: P.primary }),
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 240, after: 120, line: 340, lineRule: "atLeast" },
    children: mixed(text, { size: 28, bold: true, color: P.primary }),
  });
}
function tableCaption(text) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, keepNext: true,
    spacing: { before: 160, after: 80, line: 312 },
    children: mixed(text, { size: 21, bold: true, color: P.secondary }),
  });
}
function figCaption(text) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 160, line: 312 },
    children: mixed(text, { size: 21, color: P.secondary }),
  });
}

// ── Horizontal-Only table (business default) — RTL visual order ──
function cellPara(text, opts = {}) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT,
    spacing: { line: 312 },
    children: mixed(text, { size: 21, ...opts }),
  });
}
function buildTable(headers, rows, widths) {
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: headers.map((t, i) => new TableCell({
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: P.headerBg },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: [cellPara(t, { bold: true, color: P.headerText })],
    })),
  });
  const dataRows = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((t, i) => new TableCell({
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? "FFFFFF" : P.surface },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: [cellPara(t)],
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: true,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: P.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: P.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: P.innerLine },
      insideVertical: NB,
    },
    rows: [headerRow, ...dataRows],
  });
}

// ── calcTitleLayout — Arabic width model (pt*13/char avg, narrower
//    than CJK pt*20). Same contract: dynamic pt, semantic breaks,
//    orphan merge, max 3 lines. ──
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."،؛:！？. \t-–—·/"]);
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
function calcTitleLayoutAr(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 13; // Arabic proportional avg
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

// ── calcCoverSpacing (verbatim contract from design-system.md) ──
function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false,
    hasEnglishLabel = false, metaLineCount = 0,
    fixedHeight = 800, pageHeight = 16838,
    marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight +
    metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ── Cover R1 — RTL mirror (right-aligned, accent bars on the right)
//    Single 16838 wrapper, zero nested tables, paragraph borders only ──
function buildCoverR1RTL(config) {
  const padR = 1200, padL = 800;
  const availableWidth = 11906 - padR - padL - 300;
  const { titlePt, titleLines } = calcTitleLayoutAr(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400,
  });
  const accentRight = { style: BorderStyle.SINGLE, size: 8, color: P.coverAccent, space: 12 };
  const children = [];

  // 1. Dynamic top whitespace
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  // 2. Latin label with accent bottom border (right-aligned)
  if (config.englishLabel) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR, left: padL }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.coverAccent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "),
        size: 18, color: P.coverAccent, font: ARIAL, characterSpacing: 40 })],
    }));
  }

  // 3. Title lines (dynamic size, Rule 8 line spacing)
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR, left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300,
        line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true,
        color: P.titleColor, font: ARIAL, rightToLeft: true })],
    }));
  }

  // 4. Subtitle
  if (config.subtitle) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR, left: padL }, spacing: { after: 800, line: 340, lineRule: "atLeast" },
      children: mixed(config.subtitle, { size: 24, color: P.subtitleColor }),
    }));
  }

  // 5. Meta lines with RIGHT accent border (RTL mirror of R1 left bar)
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR + 200, left: padL }, spacing: { after: 80, line: 312 },
      border: { right: accentRight },
      children: mixed(line, { size: 24, color: P.metaColor }),
    }));
  }

  // 6. Dynamic bottom whitespace
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  // 7. Footer with top accent separator
  children.push(new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT,
    indent: { right: padR, left: padL },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.coverAccent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerRight || "", size: 16, color: P.footerColor, font: ARIAL, rightToLeft: true }),
      new TextRun({ text: "                                   ", size: 16, font: ARIAL }),
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.footerColor, font: ARIAL }),
    ],
  }));

  // Single 16838 wrapper — the ONLY table, allNoBorders mandatory
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.coverBg }, borders: noBorders,
        verticalAlign: "top",
        children,
      })],
    })],
  })];
}

// ── Figure: parse PNG IHDR for true aspect ratio (no hardcode) ──
function pngDims(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ============================================================
// CONTENT — المراجعة الربعية الأولى للخارطة
// ============================================================

const coverConfig = {
  title: "المراجعة الربعية للخارطة",
  subtitle: "المراجعة الأولى — الربع الرابع 2026",
  englishLabel: "QUARTERLY REVIEW",
  metaLines: [
    "الخارطة: NexusLink 2026–2029 · المراحل M0–M4",
    "الفترة المشمولة: 2026-10-09 حتى 2026-10-20",
    "الإصدار المرجعي: v1.2.0-fix2 · أساس E2E: 700",
    "الجهة: هندسة NexusLink — CTO-DRS · حوكمة داخلية",
  ],
  footerRight: "وثيقة حوكمة — سجل العمل docs/worklog",
  footerLeft: "NexusLink · أكتوبر 2026",
};

// ── 1. الملخص التنفيذي ──
const ch1 = [
  h1("1. الملخص التنفيذي"),
  body("تعرض هذه الوثيقة نتيجة المراجعة الربعية الأولى لخارطة طريق NexusLink (2026–2029)، المنعقدة بموجب بند الحوكمة الربعي الإلزامي وبند 6 من خطوات الثلاثين يومًا التي تقضي باعتماد الخارطة مرجعًا حيًا تُراجع ربعيًا في سجل العمل. تغطي المراجعة الفترة من الالتزام التأسيسي الأول في 2026-10-09 حتى 2026-10-20، وهي فترة قصيرة زمنيًا لكنها مكثفة بموازنة 209 إدخالات اعتماد على الفرع الرئيسي و1479 سطرًا من سجل العمل الموثق، وبحالة مزامنة صفرية الانحراف مع المستودع البعيد عند التدقيق."),
  body("الخلاصة الكمية للفترة: بلغت حزمة الفحوص الآلية عتبة 700/700 من 700 فحص E2E، مطابقةً عتبة المرحلة M0.4 بالضبط، بعد مسار نمو مرّ بخمس محطات موثقة من 585 إلى 603 ثم 617 ثم 626 ثم 700. وأُغلق التدقيق الأمني الداخلي الشامل (M0.3) ببنوده التسعة F1–F9 بما أنهى بنود الحافظة كاملة، وتحققت بنية تحديث ذاتي موقعة متكاملة من الخادم إلى واجهات الاستهلاك (قسم UPD بـ36 فحصًا)، وسُجلت أول سلسلة ثقة كاملة حية في تاريخ الحزمة من مسح رمز QR إلى جلسة مقبولة إلى إنهاء نظيف. وعلى مستوى التوزيع صار سير CI الخماسي أخضر وصفحة النشر حية بأصول الإصدار السبعة عشر."),
  body("الحكم الصريح للمراجعة: «اجتياز مع تحفظات خارجية». كل البنود القابلة للتنفيذ داخل بيئة التطوير أُنجزت بنسبة 100% بلا انحرافات نطاق، بينما يبقى المتبقي — توقيع المنصات، وحزمة Flathub، وحلقة التغذية الراجعة بعد أول نشر — معلقًا على مدخلات ملكية خارجية (شهادات مدفوعة، وحساب ناشر، ونطاق نهائي) لا على تنفيذ هندسي. لذلك توصي المراجعة بالاستمرار على المسار ذاته دون إعادة نطاق، مع اعتماد 700 خط أساس ربعي جديدًا للمؤشرات وتحديث الخارطة الحية وفق قرار هذه الوثيقة.", { after: 200 }),
];

// ── 2. النطاق والمنهجية ──
const ch2 = [
  h1("2. نطاق المراجعة وأهدافها ومنهجيتها"),
  body("تستند ضرورة هذه المراجعة إلى موضعين في الخارطة المعتمدة: بند 6 من الخطوات الفورية («اعتماد هذه الخارطة مرجعًا حيًا — مراجعة ربعية في سجل العمل»)، وقاعدة الحوكمة التي تنص على أن مؤشرات القياس تُراجع ربعيًا مع سجل المخاطر، وأن أي مؤشر يتراجع ربعين متتاليين يستدعي قرار إعادة تمويل أو إعادة نطاق. وبما أن هذه أول دورة ربعية منذ اعتماد الوثيقة، فتضطلع المراجعة بوظيفة إضافية وهي تثبيت خط الأساس الرسمي الأول الذي ستُقاس عليه الدورات اللاحقة، بحيث تكون المقارنة الربعية القادمة في يناير 2027 مقارنة أرقام معلومة لا انطباعات."),
  body("النطاق الزمني للمراجعة هو عمر المشروع كاملًا: من 2026-10-09 (الالتزام التأسيسي الأول في المستودع) حتى 2026-10-20 (تاريخ هذه الوثيقة). أما مصادر التدقيق فقد كانت ذاتية التحقق كاملة داخل المستودع: ملف الخارطة الحي docs/ROADMAP.md بسجليه المغلقين، وسجل العمل worklog.md بـ1479 سطرًا مقسمًا إلى مهام معرفة، ووثيقة التدقيق الأمني docs/security-audit.md بقائمة الفحص المكتوبة، وعقد البروتوكول docs/protocol-contract.md، وحزمة الفحوص scripts/desktop-e2e.mjs بعتبتها 700، وسجلات سير CI الخماسي، إضافة إلى فحوص صحة مباشرة أُجريت لحظة التحضير لهذه الوثيقة على الخدمات الأربع (الواجهة 3000، وخدمة الاتصالات 3003، وقناة التحكم 3004، والبوابة 8180) وجاءت الأربعة مستجيبة."),
  body("المنهجية المتبعة: مطابقة كل بند من بنود الخارطة مع دليل تنفيذ قابل للتحقق — إما إدخال محدد في سجل العمل، أو قسم فحوص E2E خضراء، أو وثيقة موقعة بتاريخ — مع اعتماد نمط الحدود الصادقة الموثق (نمط §26) الذي تلتزم به المشروع منذ تأسيسه: لا يُحتسب بند منجزًا ما لم تُذكر حدوده وما ينقصه بندًا صريحًا. وتُبين المراجعة بصدق ما لا تغطيه: فهي لا تقيس جودة الإدراك الاستخدامي لدى مستخدمين حقيقيين لغياب قاعدة مستخدمين بعد، ولا المؤشرات التشغيلية للمرحلة M1 (زمن الاقتران الفعلي، وp95، وموثوقية المزامنة) لأنها بنود ربع قادم لم تُشغَّل حلول قياسها بعد.", { after: 200 }),
];

// ── 3. مراجعة الإنجاز مقابل بنود الخارطة ──
const ch3 = [
  h1("3. مراجعة الإنجاز مقابل بنود الخارطة"),
  body("توزع الإنجاز خلال الفترة على مسارين متوازيين: مسار تأسيس البنية (إصدارات، سير نشر، خدمات حية) ومسار تراكم الثقة المقاسة (فحوص E2E، وإغلاقات أمنية). ويلخص هذا الفصل حالة بنود المرحلة التأسيسية M0 بنودًا، ثم بنود الثلاثين يومًا الستة، ثم المعالم الزمنية التي ربطت هذه الحالات ببعضها. المبدأ الحاكم للعرض: كل حالة مصحوبة بدليلها، وكل تأخير مصنف سببه — داخلي أم خارجي."),

  h2("3.1 حالة بنود المرحلة M0 الأربعة"),
  body("تهدف المرحلة M0 إلى «ثقة لا تُناقش» بمعيار خروج صريح هو تثبيت التطبيق بلا تحذيرات أمنية على منصات سطح المكتب الثلاث. أُنجز داخل البيئة البندان الثالث والرابع بالكامل، وتحقق البند الثاني بنيته الكاملة بانتظار إشارة النشر الحية، وبقي البند الأول — التوقيع النهائي — معلقًا حصرًا على شهادات مدفوعة خارج السيطرة الهندسية، ولو أن كل تمهيده التقني جاهز في سير الإصدار وبيانات التحديث الموقعة."),
  tableCaption("الجدول 1: حالة بنود المرحلة M0 عند المراجعة الربعية الأولى"),
  buildTable(
    ["البند", "الحالة", "الدليل القابل للتحقق"],
    [
      ["M0.1 — توقيع الحزم ونشرها (Windows codesign + macOS notarization + دفع أولي إلى Flathub)", "معلّق — مدخل خارجي", "شهادات مدفوعة خارج البيئة؛ كل التمهيد التقني جاهز: سير الإصدار، وبنية latest.json الموقعة، وأصول الحزمة"],
      ["M0.2 — التحديث الذاتي الصامت عبر latest.json الحي", "آلية كاملة — الإغلاق الرسمي مع أول إصدار موقّع حي", "قسم UPD بـ36 فحصًا: /api/version قياسية (channel/signature/semver)، محدّث Rust موقّع minisign، كاش 600 ثانية، بوت فحص 90 ثانية يقرأ autoCheck"],
      ["M0.3 — التدقيق الأمني الداخلي الشامل", "منجز", "بنود F1–F9 مغلقة بقائمة فحص مكتوبة في docs/security-audit.md وحدود صادقة موثقة لكل بند"],
      ["M0.4 — رفع عتبة E2E من 585 إلى 700", "منجز بالضبط", "700/700 (M1-Q700): قسم UPD للتحديث الذاتي بـ36 فحصًا + قسم DEV-LC لعمق الاقتران ودورة الحياة بـ38"],
    ],
    [30, 22, 48]
  ),

  h2("3.2 حالة بنود الثلاثين يومًا الستة"),
  body("قائمة الثلاثين يومًا هي الترجمة التنفيذية الفورية للخارطة، وستة بنود فيها تختبر جدية الالتزام بها. عند المراجعة: ثلاثة بنود منجزة كاملة بدليل، وبند خامس منجز بهذه الوثيقة نفسها التي تحقق البند السادس، وبندان معلقان على مدخلات خارجية كما يفصله الجدول. وبذلك لا يوجد أي بند مؤجل لسبب داخلي — وهو المعنى العملي لعبارة «صفر انحرافات نطاق» في الملخص التنفيذي."),
  tableCaption("الجدول 2: بنود الثلاثين يومًا — الحالة والدليل"),
  buildTable(
    ["البند", "الحالة", "الدليل القابل للتحقق"],
    [
      ["1. توقيع Windows + برنامج Apple/notarization آليًا في سير الإصدار", "معلّق", "يتطلب شهادات مدفوعة من المالك؛ هيكل سير الإصدار يستقبلها عند توفرها"],
      ["2. تدقيق أمني داخلي بقائمة فحص مكتوبة إلى بنود عمل مغلقة", "منجز", "التدقيق M0.3: F1–F9 مغلقة بقائمة مكتوبة في security-audit.md"],
      ["3. رفع E2E من 585 إلى 700 بتغطية التحديث والاقتران", "منجز", "M1-Q700: 700/700 بقسمي UPD وDEV-LC وسلسلة ثقة حية كاملة"],
      ["4. حزمة Flathub ودفعها للمراجعة", "معلّق", "يتطلب حساب ناشر على Flathub (بيئة بلا متجر لينكس محليًا)"],
      ["5. حلقة تغذية راجعة مبكرة موثقة في صفحة النشر", "جزئي", "صفحة النشر حية بأصول v1.2.0-fix2 السبعة عشر؛ إكمال الحلقة ينتظر أول نشر موقّع وقناة استقبال فعالة"],
      ["6. اعتماد الخارطة مرجعًا حيًا — مراجعة ربعية في سجل العمل", "منجز", "هذه الوثيقة + إدخال سجل العمل + تحديث ROADMAP.md بأساس جديد وسجل مراجعات"],
    ],
    [34, 14, 52]
  ),

  h2("3.3 المعالم الزمنية للفترة"),
  body("بدأت الفترة في 2026-10-09 بالالتزام التأسيسي الأول، وتقدمت عبر بناء المزايا والبنية حتى 2026-10-18 الذي شهد إصدار v1.2.0 بالروتينات الذكية ومشغلاتها التاريخية، ثم إصلاحات سير النشر وصولًا إلى v1.2.0-fix2 بسبعة عشر أصلًا مكتملة وأول سير Pages أخضر في تاريخ المشروع (نشر ساكن بلا Node)، مع إعادة إقلاع كاملة للمكدس الربعي بترقية سكربت الإقلاع الدائم. وفي 2026-10-19 اعتمدت الخارطة الشاملة وثيقةً وسجلاً حيًا، ثم جرى في اليوم نفسه — وهو أكثف أيام الفترة — التدقيق الأمني الشامل M0.3 (رفع العدد إلى 603)، فإغلاق F6 بالحافظة المشفرة المرتبطة بهوية الاقتران (617)، فإغلاق F9 بالتسليم الموجه (626)، ثم بلوغ 700/700 عبر M1-Q700 ببنيّة تحديث موقعة وسلسلة ثقة حية كاملة. وتُختتم الفترة بهذه المراجعة في 2026-10-20، أي أن اعتماد الخارطة وبلوغ أول عتبتين من عتباتها (M0.3 وM0.4) حدثا قبل أول مراجعة ربعية بيوم واحد — إيقاع يصعب تحسينه.", { after: 200 }),
];

// ── 4. مؤشرات القياس المحدثة ──
const visualBuf = fs.readFileSync(VISUAL);
const vd = pngDims(visualBuf);
const figW = 360;
const figH = Math.round(figW * (vd.h / vd.w));
const ch4 = [
  h1("4. مؤشرات القياس المحدثة وخط الأساس الجديد"),
  body("مؤشر الفحوص الآلية هو المؤشر الوحيد الذي حل عدة مرات خلال فترة واحدة قصيرة، وهو ما يجعله أصدق مؤشر متاح لإيقاع المشروع. يعرض الجدول 3 المحطات الخمس من أساس الخارطة حتى بلوغ 700، وكل محطة منها ليست رقمًا جامدًا بل تغطية وظيفية مضافة: أمان، فحافظة مشفرة، فتسليم موجه، فتحديث ذاتي وعمق اقتران. أما الشكل 1 فيعيد إنتاج الشكل المرحلي للخارطة من وثيقتها المعتمدة ليذكّر بأن هذه المحطات كلها ضمن المرحلتين الأولى والثانية من ثلاثين شهرًا."),
  new Paragraph({
    alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 40 },
    children: [new ImageRun({ data: visualBuf, transformation: { width: figW, height: figH }, type: "png" })],
  }),
  figCaption("الشكل 1: الشكل المرحلي لخارطة NexusLink (M0–M4 عبر 30 شهرًا) — معاد إنتاجه من وثيقة الخارطة المعتمدة"),
  tableCaption("الجدول 3: مسار نمو فحوص E2E خلال فترة المراجعة"),
  buildTable(
    ["المحطة", "العدد", "الزيادة", "المحتوى المضاف"],
    [
      ["أساس الخارطة (اعتماد 2026-10-19)", "585", "—", "الخط الأساس المرجعي عند التدوين v1.2.0-fix2"],
      ["التدقيق الأمني M0.3", "603", "+18", "قسم SEC دائم: 7 فحوص مصدر + 11 حيًا بمحاكاة استطلاع شبكي وتزوير ترويسة"],
      ["إغلاق F6", "617", "+14", "الحافظة الموحدة فوق قناة 3009 المشفرة (X25519) مربوطة بهوية الاقتران"],
      ["إغلاق F9", "626", "+9", "التسليم الموجه على 3004: زوج الجلسة حصرًا أثناء النشاط وإلا جمهور الثقة"],
      ["M1-Q700", "700", "+74", "قسم UPD للتحديث الذاتي (36) + قسم DEV-LC لعمق الاقتران ودورة حياة الأجهزة (38)"],
    ],
    [24, 10, 12, 54]
  ),
  body("وبموجب قاعدة الحوكمة تُراجع المؤشرات ربعيًا، فيعيد الجدول 4 قراءة جدول مؤشرات الخارطة بأساس محدث: عمود «أساس المراجعة» يثبت الوضع عند 2026-10-20 ليكون مرجع المقارنة في المراجعة الثانية. يلاحظ أن مؤشرين فقط تقاطعا مع أهدافهما مبكرًا (الفحوص، وقناة توزيع أولى)، وأن مؤشرات M1 الأربعة الباقية غير مقاسة بعد بالتعريف — فهي بنود الربع القادم لا بقيود على ما مضى."),
  tableCaption("الجدول 4: مؤشرات القياس — خط الأساس المعتمد في هذه المراجعة"),
  buildTable(
    ["المؤشر", "أساس المراجعة (معتمد)", "هدف نهاية M1", "الموقف من الهدف"],
    [
      ["فحوص E2E الخضراء", "700 (أساس ربعي جديد)", "900", "عتبة M0.4 تحققت مبكرًا؛ المسار نحو 900 يبدأ من قاعدة أرقى"],
      ["زمن الاقتران حتى أول قيمة", "دقائق (يدوي)", "أقل من 30 ثانية", "بند M1 قادم؛ سلسلة الثقة الحية وتغطية DEV-LC جاهزان كأرضية قياس"],
      ["موثوقية المزامنة الأسبوعية", "غير مقاسة", "99.9%", "بند M1؛ يتطلب أجهزة نشطة عبر فترة قياس كاملة"],
      ["استجابة التحكم p95 محليًا", "غير مقاسة", "أقل من 80ms", "بند M1 مع لوحة قياس حية"],
      ["قنوات التوزيع الرسمية", "صفحة النشر (حية)", "3", "التوقيع وFlathub هما مفتاحا القناتين الثاني والثالث"],
    ],
    [26, 20, 16, 38]
  ),
  body("قرار المراجعة بشأن المؤشرات: يُعتمد الرقم 700 خط أساس ربعي رسميًا في docs/ROADMAP.md ويُثبت في سجل المراجعات الربعية الجديد بها، مع الإبقاء على أهداف M1 كما هي بلا تخفيض. ولا يُفعَّل بند «إعادة التمويل أو إعادة النطاق» لأن شرطه — تراجع مؤشر ربعين متتاليين — غير متحقق في أي مؤشر.", { after: 200 }),
];

// ── 5. الوضع الأمني وحدوده الصادقة ──
const ch5 = [
  h1("5. الوضع الأمني وحدوده الصادقة"),
  body("أغلق التدقيق الأمني الشامل (M0.3) سلسلة هجوم كاملة كانت متاحة لأي جهاز أو صفحة على الشبكة المحلية: إغلاق الكمبيوتر وإيقاظه، وفتح روابط عليه، وقراءة حافظته، ومسح منافذه — كل ذلك بلا اقتران. عالجت الإغلاقات الخمسة الأولى هذه السلسلة بنية: بوابة ثقة لأوامر الطاقة والتبديل ترفض المجهول بلا ترحيل (F1)، وقائمة سماح على البوابة تحصر التحويل في المنافذ 3003–3009 وتقطع طريق المسح الأعمى (F2)، وتوحيد CORS بلا نجمة في الجسور الثمانية مع رفض المصادر الإنترنتية عند المصافحة (F3)، وحصر تسجيل عميل الجهاز بالجهاز نفسه عبر تمرير عنوان المصدر المستبدل (F4)، وحصر بثّي الحالة والحافظة بدور الكمبيوتر حصرًا (F5) — وقد كشف فحص F5 جانبيًا ثماني نقاط إصدار متقادمة فوحّدت على مصدر الحقيقة الواحد."),
  body("ثم جاء إغلاقا M1 الأمنيان ليكملا القصة حيث انتهى فيها التدقيق: F6 نقلت الحافظة الموحدة فوق القناة المشفرة 3009 بمصافحة X25519 مربوطة بهوية الاقتران بحيث لا يعبر النص الصريح السلك نحو أي عميل شبكي، وF9 حصرت التسليم على قناة التحكم 3004 بالتوجيه المزدوج: أثناء جلسة نشطة يصل المحتوى إلى وحدة التحكم المقترنة حصرًا، وبلا جلسة يبقى حصرًا في جمهور الثقة المحدد بالعضوية المسبقة، بينما سوكِت الاستطلاع الشبكي بلا هوية ولا محلية لا ينضم الجمهور ولا يسمع النص إطلاقًا — وبصفر تغيير في عقد الأحداث فلم يُكسر أي عميل قائم. وبهذين الإغلاقين انتهت بنود الحافظة في قائمة التدقيق كاملة (F6 + F9)."),
  body("التزامًا بنمط الحدود الصادقة، توثق المراجعة ما لا تدعيه النتائج: العميل المحلي بلا هوية يبقى في جمهور الثقة بحد «المحلي = الصادق» المعلن منذ العقد §13، فالحماية المبناة موجّهة للشبكة لا لنظام مخترق داخليًا، وقناة 3009 تبقى أعمق مسار موحد للحافظة خارج الجلسات. هذه الحدود مكتوبة في security-audit.md وفي §13 من عقد البروتوكول، وهي جزء من الدليل لا حاشية عليه — لأن ثقة لا تُناقش لا تُبنى على ادعاء بلا سقف معلن.", { after: 200 }),
];

// ── 6. المشكلات والدروس المستخلصة ──
const ch6 = [
  h1("6. المشكلات والدروس المستخلصة"),
  body("لم تأتِ الفترة بلا احتكاك مع الواقع التشغيلي، لكن الفارق أن كل احتكاك تحول خلالها إلى قاعدة مكتوبة في سجل العمل عند وقوعها ثم أُعيد تطبيقها بنجاح في الدورات اللاحقة — وهو ما يجعل كلفة كل درس مدفوعة مرة واحدة. أبرز المسارات: قيود الذاكرة في بيئة التشغيل التي تُسقط البناء مع المكدس الحي، وتفاعل أدوات التطوير مع مخرجات البناء الإنتاجي، وسلوك مكتبات الشبكة مع ترويسة المضيف، ودقة تفسير الإصدارات شبه الرسمية، ونظافة تاريخ الاعتمادات أمام الإدخالات العشوائية الآلية."),
  tableCaption("الجدول 5: الدروس المستخلصة والقواعد المرسخة المقابلة لها"),
  buildTable(
    ["الدرس الموثق عند وقوعه", "القاعدة المرسخة بعد المراجعة"],
    [
      ["البناء مع المكدس الحي يُسقط بـ exit 137 (نفاد الذاكرة المتاحة نحو 2 جيجابايت)", "قتل خدمات 3000/3003/3004/8180 قبل كل بناء، ثم الإقلاع بالنمط الناجي عبر .zscripts/dev.sh حصرًا"],
      ["البناء الإنتاجي ينظّف resources/gateway فيُفشل أول E2E بـ MODULE_NOT_FOUND", "تنفيذ bash apps/desktop/build-resources.sh قبل كل حزمة فحوص"],
      ["وضع التطوير يمسح .next/standalone فيفسد فحوص القناة الحية", "البناء الإنتاجي يسبق كل دورة E2E — لا فحوص حية فوق مخرجات وضع التطوير"],
      ["مكتبة undici تفرض ترويسة Host فعليًا فيفسد فحوص اشتقاق المضيف الحقيقية", "فحوص اشتقاق المضيف بـ curl لا fetch، على البوابة :81 ومباشر :3000"],
      ["لاحقة pre-release في v1.2.0-fix2 رفضها فحص إصدار صارم جدًا", "تفسير semver كامل بلاحقة اختيارية في /api/version — اكتشاف مشروع لا تلطيف"],
      ["إدخالات اعتماد عشوائية آلية للـ db تلتقط التزامن (ثلاث مرات في الفترة)", "الطي بـ reset --mixed قبل اعتماد العمل الموحد، ويعود الـ db الزمني إلى مساره"],
    ],
    [46, 54]
  ),
  body("القيمة التراكمية لهذه القواعد ظهرت رقميًا: دورة بلوغ 700 الأخيرة اكتملت بثلاث محاولات تشغيل فقط بعد تطبيق النمط الكامل (قتل المكدس ثم البناء ثم الموارد ثم الفحوص ثم الإقلاع)، بينما كانت الدورات المبكرة تسحب في تشخيص متكرر. وتوصي المراجعة بإبقاء هذا الجدول حيًا في سجل العمل — كل قاعدة بلا تطبيق متكرر موثق تُرحّل من «قاعدة مرسخة» إلى «ملاحظة تاريخية» في المراجعة القادمة.", { after: 200 }),
];

// ── 7. المخاطر والقرارات المطلوبة ──
const ch7 = [
  h1("7. المخاطر والقرارات المطلوبة من مالك المشروع"),
  body("يُعيد الجدول 6 قراءة سجل المخاطر الستة في الخارطة بحالتها الفعلية عند المراجعة، لا بحالتها النظرية عند التدوين. الخلاصة: لا خطر تفاقم خلال الفترة، وخطران تحركا اتجاهًا إيجابيًا فعليًا بفعل الأتمتة والقواعد المرسخة، بينما بقيت مخاطر التوزيع الثلاث مرتبطة بالقرارات الملكية المعلقة نفسها — وهذا تركز مخاطر صحي لأنه قابل للحل بقرار واحد لكل بند لا بعمل هندسي ممتد."),
  tableCaption("الجدول 6: سجل المخاطر — حالة التخفيف عند المراجعة"),
  buildTable(
    ["الخطر", "الأثر", "حالة التخفيف عند المراجعة"],
    [
      ["قيود iOS على الوصول المنخفض", "مرتفع", "بلا تغيير — عميل PWA محدود والحاسوب مقصود لمستخدمي أبل، صراحة بلا وعود كما في الخارطة"],
      ["كلفة توقيع Apple والتحقق", "متوسط", "الانضمام المبكر لبرنامج المطور هو بند M0.1 المعلق — ينتظر قرار المالك؛ بنية notarization في سير الإصدار جاهزة"],
      ["عوائق المتاجر", "متوسط", "توزيع مباشر موقّع أولًا قائم كأصول الإصدار؛ Flathub ينتظر حساب ناشر"],
      ["بطء التبني أمام علامات كبرى", "مرتفع", "صفحة النشر حية وقصة «بلا سحابة ولا حسابات» جاهزة؛ قصص الاستخدام الكمية تنتظر أول نشر موقّع ومستخدمين أوائل"],
      ["فريق هندسي واحد", "مرتفع", "تحرك إيجابيًا: أتمتة CI الخماسي + 700 فحص + قواعد مرسخة تخفض الاعتماد على الذاكرة البشرية؛ الافتتاح الجزئي للمجتمع في M3 كما هو مخطط"],
      ["تذبذب بيئة التشغيل", "منخفض", "أثبت نفسه: إعادات التشغيل المتعددة خلال الفترة مرت جميعها على النمط الناجي بلا استثناء"],
    ],
    [24, 10, 66]
  ),
  body("خمسة قرارات ملكية مطلوبة لفتح البنود المعلقة، وكلها خارج قدرة البيئة الهندسية بحكم طبيعتها: أولًا قرار شراء أو تفعيل شهادات التوقيع (Windows codesign وشهادة مطور Apple) وهو مفتاح M0.1 ومعيار خروج M0 كله؛ وثانيًا إنشاء حساب ناشر على Flathub لتدفع حزمته للمراجعة؛ وثالثًا تحديد النطاق النهائي لنطاق صفحات النشر ليتصل ببوابة النشر الحية؛ ورابعًا توفير عتاد Mac المشار إليه بـ G-38 لمنصة البناء والتوقيع لأبل؛ وخامسًا قرار الاحتفاظ بنسخة backup-pre-rewrite.bundle أو حذفها بعد اكتمال إعادة الكتابة والاستقرار عليها. مع كل قرار ينتقل بند كامل من عمود «معلّق» إلى قائمة التنفيذ المباشر، ولذلك توصي المراجعة بجدولة هذه القرارات الخمسة قبل المراجعة الربعية الثانية بأسبوعين على الأقل حتى تكون دورة يناير 2027 دورة قياس لا دورة انتظار.", { after: 200 }),
];

// ── 8. الحكم وخطة الربع القادم ──
const ch8 = [
  h1("8. حكم المراجعة وخطة الربع القادم"),
  body("حكم المراجعة الصريح وفق أدبيات المراجعة الدورية: اجتياز مع تحفظات خارجية. جوانب القوة حاسمة: بلوغ عتبة M0.4 بالضبط، وإغلاق التدقيق الأمني كاملًا بحدوده الموثقة، وبنية توزيع وتحديث جاهزة للتوقيع، وصفر انحرافات نطاق، وحالة مزامنة نظيفة عند الإغلاق. أما التحفظ فوحيد ومصنف: ثلاثة بنود ختامية معلقة على مدخلات ملكية خارجية، وهو تحفظ لا يعالجه العمل الهندسي بل القرار — ولذلك تحوّل في الخطة أدناه إلى إجراءات بمالك وتوقيت لا إلى ملاحظات مفتوحة."),
  tableCaption("الجدول 7: خطة الربع القادم — إجراءات بمالك وتوقيت ومعيار إنجاز"),
  buildTable(
    ["الإجراء", "المالك", "التوقيت", "معيار الإنجاز"],
    [
      ["تفعيل توقيع Windows + notarization في سير الإصدار", "المالك + الهندسة", "عند توفر الشهادة", "تثبيت بلا تحذيرات أمنية على المنصات الثلاث"],
      ["تجهيز حزمة Flathub ودفعها للمراجعة", "الهندسة", "عند فتح حساب الناشر", "قبول أولي من مراجعة Flathub"],
      ["اقتران فوري: من مسح QR إلى أول قيمة في أقل من 30 ثانية", "الهندسة", "الربع الحالي", "قياس حي مسجل في E2E ولوحة القياس"],
      ["offline-first: مزامنة تستأنف بلا فقد بعد أي انقطاع", "الهندسة", "الربع الحالي", "استئناف ناجح بعد انقطاع مفروض في الفحوص"],
      ["أداء مقيس: p95 أقل من 80ms بلوحة قياس حية", "الهندسة", "الربع الحالي", "قياس p95 مسجل على الشبكة المحلية"],
      ["إمكانية وصول كاملة + توسيع اللغات من لغتين إلى ست", "الهندسة", "الربع الحالي", "تغطية واجهة كاملة للغات الست في فحوص i18n"],
      ["رفع عتبة E2E من 700 إلى 900", "الهندسة", "نهاية M1", "900/900 خضراء ببندي اقتران ومزامنة"],
      ["المراجعة الربعية الثانية", "الهندسة + المالك", "يناير 2027", "وثيقة مراجعة معتمدة بمقارنة أساس معلومة"],
    ],
    [36, 14, 16, 34]
  ),
  body("تنفيذًا لحكم هذه المراجعة جرى فور اعتمادها: تحديث docs/ROADMAP.md بأساس E2E الجديد (700) وبسجل مراجعات ربعية يثبت هذه الدورة ويحدد موعد القادمة، وتسجيل إدخال كامل في سجل العمل بالأدلة نفسها التي اعتمدت عليها هذه الوثيقة، وحفظ نسختها في مجلد التسليم. وتبقى الخارطة كما هي: نجم شمال واحد («أجهزة المستخدم يد واحدة موثوقة — محليًا، خاصًا، بلا وسيط»)، وخمسة خنادق لا تُساوم، وباب ميزة لا يدخل الإصدار إلا باسم خندقه وحدوده الصادقة وفحوصه وترجمته — لأن ما أثبتته هذه الدورة الأولى أن الانضباط التوثيقي نفسه هو أسرع طريق لثقة لا تُناقش.", { after: 200 }),
];

// ============================================================
// ASSEMBLY — 3 sections (cover / TOC / body)
// ============================================================
const pgSize = { width: 11906, height: 16838 };
const bodyMargin = { top: 1440, bottom: 1440, right: 1701, left: 1417 }; // RTL mirror

function pageNumFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: ARIAL })],
    })],
  });
}
function docHeader() {
  return new Header({
    children: [new Paragraph({
      bidirectional: true, alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: P.innerLine, space: 4 } },
      spacing: { after: 0, line: 312 },
      children: mixed("المراجعة الربعية للخارطة · NexusLink", { size: 18, color: "808080" }),
    })],
  });
}

const tocChildren = [
  new Paragraph({
    bidirectional: true, alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 360, line: 380, lineRule: "atLeast" },
    children: [new TextRun({ text: "المحتويات", bold: true, size: 32, color: P.primary, font: ARIAL, rightToLeft: true })],
  }),
  new TableOfContents("جدول المحتويات", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { before: 200, line: 312 },
    children: [new TextRun({
      text: "ملاحظة: هذا الفهرس مولّد بحقول آلية؛ لضمان دقة أرقام الصفحات بعد أي تحرير، انقر بزر الفأرة الأيمن على الفهرس ثم اختر «تحديث الحقل».",
      italics: true, size: 18, color: "888888", font: ARIAL, rightToLeft: true,
    })],
  }),
  // NOTE: no trailing PageBreak — Section 3 is NEXT_PAGE (double break = blank page)
];

const doc = new Document({
  creator: "NexusLink Engineering — CTO-DRS",
  title: "المراجعة الربعية للخارطة — Q4 2026",
  subject: "مراجعة ربعية إلزامية لخارطة طريق NexusLink 2026–2029",
  description: "المراجعة الربعية الأولى: نطاقها وأدلتها ومؤشراتها وحكمها وخطة الربع القادم",
  styles: {
    default: {
      document: {
        run: { font: ARIAL, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: ARIAL, size: 32, bold: true, color: P.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 380 } },
      },
      heading2: {
        run: { font: ARIAL, size: 28, bold: true, color: P.primary },
        paragraph: { spacing: { before: 240, after: 120, line: 340 } },
      },
    },
  },
  sections: [
    { // Section 1: cover — margin 0, no footer/header, no pageNumbers
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1RTL(coverConfig),
    },
    { // Section 2: TOC — front matter (Roman numbering internal, no footer shown)
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: bodyMargin,
          pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      children: tocChildren,
    },
    { // Section 3: body — Arabic numerals restart at 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: bodyMargin,
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: docHeader() },
      footers: { default: pageNumFooter() },
      children: [...ch1, ...ch2, ...ch3, ...ch4, ...ch5, ...ch6, ...ch7, ...ch8],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("WROTE:", OUT, buf.length, "bytes");
  console.log("figure:", vd.w + "x" + vd.h, "->", figW + "x" + figH);
}).catch((e) => { console.error(e); process.exit(1); });
