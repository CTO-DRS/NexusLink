// عقد §55 — الماسح الموثق الحي (SCAN-TO-PDF) — النواة النقية (بلا إدخال/إخراج)
// ============================================================
// الخندق التنافسي: #1 الخصوصية المعمارية + #4 التبنّي صفري الاحتكاك.
// مقابل المنافسين مباشرة:
//  - Adobe Scan/Google Drive: الصفحات تُرفع لسحابة الغير ليعالجها خادمهم —
//    هنا الصفحات تبقى على شبكة المالك وPDF يُبنى على الحاسوب حرفيًا.
//  - AirDroid: يمر بوسيط حساب/سحابة — هنا جلسة محلية بلا حساب.
//
// الفكرة: الهاتف يصوّر صفحات ويدفعها (JPEG) لجلسة على الحاسوب؛ الجلسة تُرتب
// (تدوير/إعادة ترتيب/حذف/معالجة §61) ثم تُختم إلى PDF على جهاز المالك —
// مرور JPEG نقيًا افتراضيًا (filter="none") والمعالجة الاختيارية تُطبَّق
// عند الختم حصرًا في الذاكرة (حد §61 الصادق).
//
// حدود صادقة (§55.حدود — المحدثة بعقد §61):
//  - JPEG حصرًا (فحص بايتات السحر FFD8 حرفيًا لا الثقة بالترويسة).
//  - §61 (إغلاق الحد المعلن «عتبة/معالجة»): معالجة اختيارية لكل صفحة
//    (رمادي محسّن أو أبيض وأسود بعتبة 1..254) تُطبّق عند الختم حصرًا
//    في الذاكرة — ملف الصفحة الأصلي على القرص لا يُمس بايتيًا، ومرور
//    §55 النقي يبقى المسار الافتراضي filter="none". OCR عمل لاحق معلن.
//  - ≤ 30 صفحة لكل جلسة و≤ 12MB للصفحة و≤ 3 جلسات مفتوحة.
//  - مولد PDF صفر-اعتماد (نمط §47) — DeviceRGB للصور (كاميرات الهواتف
//    YCbCr→RGB؛ JPEG رماديّ نادر يُعلن بصدق في التوثيق).

export const SCAN_MAX_PAGES = 30
export const SCAN_PAGE_MAX_BYTES = 12 * 1024 * 1024
export const SCAN_TITLE_MAX = 80
export const SCAN_MAX_OPEN_SESSIONS = 3
export const SCAN_ROTATIONS = [0, 90, 180, 270] as const
export type ScanRotation = (typeof SCAN_ROTATIONS)[number]

// §61 — فلتر الصفحة: none (مرور §55 النقي) · gray (رمادي محسّن) · bw (عتبة)
export const SCAN_FILTERS = ["none", "gray", "bw"] as const
export type ScanFilter = (typeof SCAN_FILTERS)[number]
export const SCAN_THR_MIN = 1
export const SCAN_THR_MAX = 254
export const SCAN_THR_DEFAULT = 160

export function isScanFilter(v: unknown): v is ScanFilter {
  return (SCAN_FILTERS as readonly unknown[]).includes(v)
}

/** عتبة سليمة: عدد صحيح 1..254 — الغريب (0/255/كسري/غير رقمي) يرفض بصدق */
export function isValidThreshold(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= SCAN_THR_MIN && v <= SCAN_THR_MAX
}

export interface ScanPage {
  n: number
  name: string
  size: number
  rotate: ScanRotation
  at: number
  /** §61 — المعالجة المختارة تُطبّق عند الختم حصرًا — الأصل على القرص لا يُمس */
  filter: ScanFilter
  /** عتبة الأبيض والأسود (1..254) — تعرف حصرًا حين filter="bw" */
  thr?: number
}

export interface ScanSession {
  id: string
  title: string
  status: "open" | "sealed" | "cancelled"
  pages: ScanPage[]
  createdAt: number
  sealedFile?: string
}

export function isScanRotation(v: unknown): v is ScanRotation {
  return (SCAN_ROTATIONS as readonly unknown[]).includes(v)
}

/** فحص JPEG بالسحر حرفيًا — الثقة بالترويسة كذب شائع يرفضه العقد */
export function isJpegBytes(b: Buffer): boolean {
  return Buffer.isBuffer(b) && b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
}

/** أبعاد JPEG من علامة SOF (بدون فك ضغط — قراءة ترويسات حصرًا) */
export function jpegDimensions(b: Buffer): { w: number; h: number } | null {
  if (!isJpegBytes(b)) return null
  let i = 2
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]
    if (marker === 0xff) { i++; continue }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    if (marker === 0xd9) break // EOI
    if (i + 4 > b.length) break
    const len = b.readUInt16BE(i + 2)
    // SOF0..SOF15 عدا DHT(C4)/JPG(C8)/DAC(CC) تحمل الأبعاد
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) return null
      const h = b.readUInt16BE(i + 5)
      const w = b.readUInt16BE(i + 7)
      return w > 0 && h > 0 ? { w, h } : null
    }
    i += 2 + len
  }
  return null
}

/** عنوان جلسة سليم: قصّ محكم بلا محارف تحكم */
export function sanitizeScanTitle(s: string): string {
  let t = String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim()
  if (!t) t = "مسح ضوئي"
  return t.slice(0, SCAN_TITLE_MAX)
}

/** اسم ملف PDF سليم من العنوان (لاتيني آمن + طابع زمني) */
export function scanPdfFileName(title: string, nowMs: number): string {
  const safe = title.replace(/[^\w\u0600-\u06FF-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scan"
  const d = new Date(nowMs)
  const p = (n: number) => String(n).padStart(2, "0")
  return `scan-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${safe}.pdf`
}

// ---------- عمليات الجلسة النقية (أسباب رفض مغلقة) ----------

export function rotatePage(s: ScanSession, n: number, deg: number): { ok: true; session: ScanSession } | { ok: false; error: string } {
  if (!isScanRotation(deg)) return { ok: false, error: "invalid-rotation" }
  const idx = s.pages.findIndex((p) => p.n === n)
  if (idx < 0) return { ok: false, error: "page-not-found" }
  const pages = s.pages.map((p) => (p.n === n ? { ...p, rotate: deg } : p))
  return { ok: true, session: { ...s, pages } }
}

export function movePage(s: ScanSession, from: number, to: number): { ok: true; session: ScanSession } | { ok: false; error: string } {
  const N = s.pages.length
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= N || to >= N) {
    return { ok: false, error: "index-out-of-range" }
  }
  const order = [...s.pages]
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  return { ok: true, session: { ...s, pages: order } }
}

export function removePage(s: ScanSession, n: number): { ok: true; session: ScanSession } | { ok: false, error: string } {
  const pages = s.pages.filter((p) => p.n !== n)
  if (pages.length === s.pages.length) return { ok: false, error: "page-not-found" }
  return { ok: true, session: { ...s, pages } }
}

/**
 * §61 — اختيار معالجة صفحة (أسباب مغلقة: page-not-found · bad-filter · bad-threshold).
 * العتبة تعرف حصرًا مع bw (الغائبة تُسقط على SCAN_THR_DEFAULT) وتقديمها مع
 * فلتر آخر رفض صادقًا — والعودة إلى none تحذف العتبة نهائيًا.
 */
export function setPageFilter(
  s: ScanSession, n: number, filter: unknown, thr?: unknown,
): { ok: true; session: ScanSession } | { ok: false; error: string } {
  if (!isScanFilter(filter)) return { ok: false, error: "bad-filter" }
  const idx = s.pages.findIndex((p) => p.n === n)
  if (idx < 0) return { ok: false, error: "page-not-found" }
  const f: ScanFilter = filter
  if (f === "bw") {
    const t = thr === undefined || thr === null ? SCAN_THR_DEFAULT : thr
    if (!isValidThreshold(t)) return { ok: false, error: "bad-threshold" }
    const pages = s.pages.map((p) => (p.n === n ? { ...p, filter: f, thr: t } : p))
    return { ok: true, session: { ...s, pages } }
  }
  if (thr !== undefined && thr !== null) return { ok: false, error: "bad-threshold" }
  const pages = s.pages.map((p) => {
    if (p.n !== n) return p
    const { thr: _drop, ...rest } = p
    return { ...rest, filter: f }
  })
  return { ok: true, session: { ...s, pages } }
}

/**
 * §61 — تطبيع جلسة مقروءة من القرص: صفحات ما قبل §61 بلا filter تصير "none"
 * (ترحيل صامت للقراءة حصرًا — ملفات الصفحات نفسها لا تُمس) وأي thr يتيم
 * مع فلتر غير bw يُنظف.
 */
export function normalizeScanSession(s: ScanSession): ScanSession {
  if (!Array.isArray(s.pages)) return s
  let changed = false
  const pages = s.pages.map((p) => {
    if (!isScanFilter(p.filter)) { changed = true; return { ...p, filter: "none" as ScanFilter } }
    if (p.filter !== "bw" && "thr" in p) { changed = true; const { thr: _t, ...rest } = p; return rest as ScanPage }
    return p
  })
  return changed ? { ...s, pages } : s
}
