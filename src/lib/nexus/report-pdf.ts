// §47 — مولّد PDF صفر-اعتماد لتقرير الامتثال (docs/enterprise-deploy.md §16)
// ============================================================
// PDF 1.4 صافٍ مكتوب يدويًا: كتالوج + صفحات A4 + قلمان قياسيان
// (Helvetica / Helvetica-Bold بتشفير WinAnsi) + جدول xref وترويسة trailer
// صحيحة — بلا أي حزمة خارجية (عقيدة المشروع: صفر اعتماد جديد).
// إنجليزي حصرًا (لغة مدققي الامتثال — الحد الصادق 47.و.4: قلم عربي مدمج
// يستدعي تشكيلًا كاملًا خارج نطاق العقد؛ العربية الكاملة عبر JSON والواجهة).
// دالٌّ نقي خالص: تقرير → بايتات — قابل للفحص في طور أ النقي بالبوابة.

/** هروب أحرف محتوى PDF: ( ) \ — تُسبَق بشرطة خلفية */
export function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

/** تحويل إلى WinAnsi-آمن (لاتيني أساسًا): الأحرف الشائعة تُنقل حرفيًا
 * (— → - · « » → ") والبقية غير-اللاتينية (عربية/رموز) تُحذف بصدق —
 * الناتج بايتات ≤ 0x7E حصرًا (فحص البوابة أ21 يفرضه). */
export function toWinAnsi(s: string): string {
  const out = s
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u00B7\u2022\u2023\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u00E9\u00E8\u00EA]/g, "e")
    .replace(/[\u00E0]/g, "a")
    .replace(/[\u00FC]/g, "u")
    .replace(/[\u00F6]/g, "o")
    .replace(/[\u00E7]/g, "c")
    .replace(/[\u2192\u21D2]/g, "->")
    .replace(/[\u2265]/g, ">=")
    .replace(/[\u2264]/g, "<=")
    // كل ما تبقى فوق 0x7E (عربية ورموز وكنترول) يُحذف — الصدق فوق التمويه
    .replace(/[^\x20-\x7E\n]/g, "")
  return out
}

export interface ReportSection {
  title: string
  lines: string[]
}

// ---------- تخطيط الصفحة (A4 595×842 — هوامش 50 — سطر 14pt) ----------
const PAGE_W = 595
const PAGE_H = 842
const MARGIN_X = 50
const TOP_Y = 792
const BOTTOM_MIN = 60
const LEAD = 14
const BODY = 10
const HEAD = 13

/** سطر واحد بتموضع مطلق — كل سطر كتلة BT/ET مستقلة (لا حالة نص
 * عابرة للأسطر: أبسط بنية وأصحها — لا BT مفتوح قبل BT جديد إطلاقًا) */
interface PdfLine {
  text: string
  bold: boolean
  y: number
}

/** بناء PDF كاملًا من الأقسام — بايتات جاهزة للإرسال كـ application/pdf */
export function buildPdf(sections: ReportSection[]): Uint8Array {
  // ---------- التخطيط: صفحات من أسطر بتموضع مطلق ----------
  const pages: PdfLine[][] = [[]]
  let y = TOP_Y
  const cur = () => pages[pages.length - 1]!
  for (const sec of sections) {
    // فاصل قبل القسم (ما لم يكن أول عنصر في صفحته)
    if (cur().length > 0) y -= 8
    // عنوان لا يتسع → صفحة جديدة (أول عنصر في صفحة جديدة لا يُفحص)
    if (cur().length > 0 && y - 22 < BOTTOM_MIN) {
      pages.push([])
      y = TOP_Y
    }
    cur().push({ text: sec.title, bold: true, y })
    y -= 22
    for (const ln of sec.lines.length > 0 ? sec.lines : [""]) {
      if (y < BOTTOM_MIN) {
        pages.push([])
        y = TOP_Y
      }
      cur().push({ text: ln, bold: false, y })
      y -= LEAD
    }
  }
  const live = pages.filter((p) => p.length > 0)

  // ---------- محتوى كل صفحة: أسطر BT/ET مستقلة بتموضع مطلق ----------
  const contents = live.map((lines) =>
    lines
      .map((l) =>
        `BT ${l.bold ? `/F2 ${HEAD}` : `/F1 ${BODY}`} Tf ${MARGIN_X} ${l.y} Td (${pdfEscape(toWinAnsi(l.text))}) Tj ET`,
      )
      .join("\n"),
  )

  // ---------- تجميع الكائنات ----------
  const nPages = live.length
  const objs: string[] = [] // فهرس 1-based: objs[0] → «1 0 obj»
  const pageObjNums: number[] = []
  // ترتيب ثابت: 1 كتالوج · 2 صفحات · ثم لكل صفحة: كائن صفحة + محتواها · الخطان آخرًا
  let next = 3
  const pageObjs: { page: number; content: number; contentStr: string }[] = []
  for (const contentStr of contents) {
    pageObjs.push({ page: next, content: next + 1, contentStr })
    pageObjNums.push(next)
    next += 2
  }
  const fontRegular = next
  const fontBold = next + 1

  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objs.push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${nPages} >>`)
  for (const po of pageObjs) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${po.content} 0 R >>`,
    )
    objs.push(`<< /Length ${Buffer.byteLength(po.contentStr, "latin1")} >>\nstream\n${po.contentStr}\nendstream`)
  }
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`)
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`)

  // ---------- التسلسل والبايتات وxref ----------
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(body, "latin1"))
    body += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xrefStart = Buffer.byteLength(body, "latin1")
  const count = objs.length + 1
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body + xref + trailer, "latin1")
}

// ---------- تحويل تقرير الامتثال إلى أقسام إنجليزية ----------
/** حقل عددي آمن للعرض (null → «—» يُنقل لاحقًا إلى ASCII «n/a») */
function num(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "n/a"
}
function str(v: unknown): string {
  return typeof v === "string" && v ? v : "n/a"
}
function yesNo(v: unknown): string {
  return v === true ? "yes" : "no"
}

/** تقرير §47 (كائن JSON من /api/enterprise/report) → أقسام إنجليزية للـPDF.
 * مُتحفظة عمدًا: لا تنسيق مُعقّد — أسطر نص قابلة للفحص والقراءة البشرية. */
export function complianceSections(report: Record<string, unknown>): ReportSection[] {
  const policy = (report.policy ?? {}) as Record<string, unknown>
  const enforced = (report.enforced ?? {}) as Record<string, unknown>
  const posture = (report.posture ?? {}) as Record<string, unknown>
  const pairGate = (report.pairGate ?? {}) as Record<string, unknown>
  const rotation = (pairGate.rotation ?? {}) as Record<string, unknown>
  const versions = (report.versions ?? {}) as Record<string, unknown>
  const devices = (report.devices ?? {}) as Record<string, unknown>
  const metrics = (report.metrics ?? {}) as Record<string, unknown>
  const pairing = (metrics.pairing ?? {}) as Record<string, unknown>
  const audit = (report.audit ?? {}) as Record<string, unknown>

  const sections: ReportSection[] = [
    {
      title: "NexusLink Enterprise Compliance Report",
      lines: [
        `Generated: ${str(report.generatedAt)}`,
        `Organization: ${str(report.organization)}`,
        `Contract: ${str(report.contract)} (local export only - no cloud)`,
        `Platform: ${str(report.platform)} - App version: ${str(versions.app)}`,
      ],
    },
    {
      title: "Policy State",
      lines: [
        `State: ${str(policy.state)} (schema v${str(policy.schemaVersion)})`,
        `Policy fingerprint (sha256:16): ${str(policy.hash)}`,
        `Effective posture source: ${str(posture.source)} - external closed: ${yesNo(posture.closed)}`,
      ],
    },
    {
      title: "Enforced Controls",
      lines: [
        `Remote access: ${str(enforced.remoteAccess ?? "not-enforced")}`,
        `Blocked bridges: ${Array.isArray(enforced.blockedBridges) && enforced.blockedBridges.length ? (enforced.blockedBridges as unknown[]).join(", ") : "none"}`,
        `Locked settings sections: ${Array.isArray(enforced.lockedSettings) && enforced.lockedSettings.length ? (enforced.lockedSettings as unknown[]).join(", ") : "none"}`,
        `Access-code rotation days: ${num(enforced.accessCodeRotationDays)}`,
        `Disabled capabilities: ${Array.isArray(enforced.disabledCapabilities) && enforced.disabledCapabilities.length ? (enforced.disabledCapabilities as unknown[]).join(", ") : "none"}`,
        `Minimum allowed version: ${str(enforced.minimumVersion)} - this device below floor: ${yesNo(versions.belowMinimum)}`,
      ],
    },
    {
      title: "Pairing Gate & Rotation",
      lines: [
        `Enabled: ${yesNo(pairGate.enabled)}`,
        `Token fingerprint: ${str(pairGate.fingerprint)}`,
        `Created at: ${str(pairGate.createdAt)}`,
        `Rotation due: ${yesNo(rotation.due)} (age ${num(rotation.ageDays)} days / policy ${num(rotation.days)})`,
      ],
    },
    {
      title: "Device Inventory (descriptive only)",
      lines: [
        `Total devices: ${num(devices.total)}`,
        `By kind: ${Object.entries((devices.byKind ?? {}) as Record<string, unknown>)
          .map(([k, v]) => `${k}=${typeof v === "number" ? v : 0}`)
          .join(" ") || "none"}`,
        ...(Array.isArray(devices.items)
          ? (devices.items as Record<string, unknown>[]).slice(0, 12).map((d) =>
              `- ${str(d.name)} [${str(d.kind)}] state=${str(d.state)} lastSeen=${str(d.lastSeenAgo)} rtt=${num(d.rttMs)}ms`,
            )
          : []),
      ],
    },
    {
      title: "Measured Metrics (contracts 29/30)",
      lines: [
        `Pairing (30) samples: ${num(pairing.n)} - last ${num(pairing.last)}ms - avg ${num(pairing.avg)}ms`,
        `Pairing p95: ${num(pairing.p95)}ms - max ${num(pairing.max)}ms - pass rate ${num(pairing.passRate)}% (target < ${num(metrics.pairTargetMs)}ms)`,
        `Control p95 window (29) is client-side live telemetry - not part of the server-side report (honest boundary 47.w)`,
      ],
    },
    {
      title: "Audit Trail (contract 39)",
      lines: [
        `Records: ${num(audit.count)} - chain valid: ${yesNo(audit.valid)}`,
        audit.brokenAt ? `Chain broken at record: ${num(audit.brokenAt)}` : `Chain intact (tamper-evident hashes verified)`,
      ],
    },
    {
      title: "Honest Boundaries (contract 47.w)",
      lines: [
        "1. No MDM cloud channel: all policy resolution is local from a file on disk.",
        "2. Overdue rotation is loudly surfaced - the token is never auto-revoked.",
        "3. Minimum-version floor is an announcement, not a live block.",
        "4. This PDF is English-only (auditor language); full detail is in the JSON export.",
        "5. Fleet-wide collection of these reports requires real deployment (owner decision).",
      ],
    },
  ]
  return sections
}

/** التقرير كاملًا → بايتات PDF */
export function buildCompliancePdf(report: Record<string, unknown>): Uint8Array {
  return buildPdf(complianceSections(report))
}
