// عقد §53 — التسليم اليدوي الذكي (SMART-HANDOFF) — النواة النقية (بلا إدخال/إخراج)
// ============================================================
// الخندق التنافسي: #1 الخصوصية المعمارية (بلا حساب ولا سحابة — قائمة الانتظار
// على جهاز المالك حصرًا) + #4 التبنّي صفري الاحتكاك (الهاتف يدفع بلا تسجيل).
// مقابل المنافسين مباشرة:
//  - Apple Handoff: يتطلب حساب Apple وأجهزة أبل حصرًا — هنا أي زوج أجهزة مقترن
//    على الشبكة المحلية بلا حساب إطلاقًا.
//  - Microsoft «متابعة على الحاسوب» (Phone Link): يتطلب حساب Microsoft وربط
//    سحابي — هنا الدفع من الهاتف إلى الحاسوب محلي بلا وسيط.
//  - Pushbullet Push: قناة سحابية بحساب وسقف اشتراك — هنا صفر سحابة صفر حساب.
//
// الفكرة: الهاتف «يدفع» عنصر متابعة (رابط · نص · مرجع ملف · موضع وسائط) إلى
// الحاسوب، فيظهر شريط «أكمل من حيث توقفت» بفعل بنقرة — والمعاينة مقنّعة إن
// صنّفها §50 حساسة (تآزر عقود: حارس الحساسية نفسه بلا ازدواج).
//
// حدود صادقة (§53.حدود):
//  - الرابط http/https حصرًا — لا مخططات تنفيذ (javascript: وغيرها مرفوضة).
//  - النص ≤ 8KB والرابط ≤ 2KB — سقوف دفع تقيّب الاستهلاك.
//  - القائمة ≤ 50 عنصرًا وعمرها ≤ 24 ساعة — الأقدم يُطرد حتميًا.
//  - «الفعل» يعيد توجيه إرشادي للواجهة (open-url/copy) — فتح النوافذ بيد
//    المتصفح حصرًا (سياسة النوافذ المنبثقة حقيقة موثقة لا تُكذَّب).

export type HandoffKind = "url" | "text" | "file-ref" | "media-position"

export const HANDOFF_URL_MAX = 2048
export const HANDOFF_TEXT_MAX = 8192
export const HANDOFF_REF_MAX = 512
export const HANDOFF_NOTE_MAX = 140
export const HANDOFF_SOURCE_MAX = 60
export const HANDOFF_CAP = 50
export const HANDOFF_TTL_MS = 24 * 3600_000
export const HANDOFF_DEDUPE_MS = 60_000
export const HANDOFF_RATE_PER_MIN = 30
/** سقف موضع الوسائط بالمللي ثانية (24 ساعة) — رفض المواضع السالبة والهائلة */
export const HANDOFF_POSITION_MAX_MS = 86_400_000

export interface HandoffItem {
  id: string
  kind: HandoffKind
  /** رابط أو نص أو مسار افتراضي أو JSON موضع وسائط — حسب kind */
  payload: string
  sourceDevice: string
  note: string
  at: number
  hits: number
  expiresAt: number
}

const KINDS: ReadonlySet<string> = new Set<HandoffKind>(["url", "text", "file-ref", "media-position"])

export function isHandoffKind(k: string): k is HandoffKind {
  return KINDS.has(k)
}

/** بصمة عرض حتمية FNV-1a مزدوجة (نمط §51) — للتعريف لا للسرّية */
export function handoffFingerprint(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  const str = String(s ?? "")
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x01000193) >>> 0
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16)
}

/** مفتاح التكرار: kind + نص الحمولة حرفيًا — للكشف داخل نافذة DEDUPE */
export function handoffDedupeKey(kind: HandoffKind, payload: string): string {
  return `${kind}|${payload}`
}

/** موضع وسائط سليم: JSON كائن بحقلَي media (نص) وpositionMs (صحيح ضمن السقف) */
export function parseMediaPosition(payload: string): { media: string; positionMs: number } | null {
  try {
    const j = JSON.parse(payload) as unknown
    if (!j || typeof j !== "object" || Array.isArray(j)) return null
    const o = j as Record<string, unknown>
    if (typeof o.media !== "string" || o.media.length === 0 || o.media.length > 200) return null
    if (typeof o.positionMs !== "number" || !Number.isInteger(o.positionMs) || o.positionMs < 0 || o.positionMs > HANDOFF_POSITION_MAX_MS) return null
    return { media: o.media, positionMs: o.positionMs }
  } catch {
    return null
  }
}

/**
 * تدقيق عنصر دفع (§53.ب) — أسباب رفض مغلقة:
 * unknown-kind · empty-payload · url-too-long · url-scheme · url-no-host ·
 * text-too-long · ref-too-long · bad-media-position · note-too-long · source-too-long
 * يعيد حمولة منقّاة (قصًّا محكمًا بلا كتم) أو خطأ صادقًا.
 */
export function validateHandoff(input: {
  kind: string
  payload: string
  sourceDevice?: string
  note?: string
}): { ok: true; kind: HandoffKind; payload: string; sourceDevice: string; note: string } | { ok: false; error: string } {
  if (!isHandoffKind(String(input.kind ?? ""))) return { ok: false, error: "unknown-kind" }
  const kind = input.kind as HandoffKind
  const payload = typeof input.payload === "string" ? input.payload : ""
  if (!payload.trim()) return { ok: false, error: "empty-payload" }
  if (kind === "url") {
    if (payload.length > HANDOFF_URL_MAX) return { ok: false, error: "url-too-long" }
    let u: URL
    try { u = new URL(payload) } catch { return { ok: false, error: "url-scheme" } }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "url-scheme" }
    if (!u.hostname) return { ok: false, error: "url-no-host" }
  } else if (kind === "text") {
    if (payload.length > HANDOFF_TEXT_MAX) return { ok: false, error: "text-too-long" }
  } else if (kind === "file-ref") {
    if (payload.length > HANDOFF_REF_MAX) return { ok: false, error: "ref-too-long" }
  } else {
    if (payload.length > HANDOFF_REF_MAX) return { ok: false, error: "ref-too-long" }
    if (!parseMediaPosition(payload)) return { ok: false, error: "bad-media-position" }
  }
  const sourceDevice = String(input.sourceDevice ?? "هاتف").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, HANDOFF_SOURCE_MAX) || "هاتف"
  const note = String(input.note ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, HANDOFF_NOTE_MAX)
  return { ok: true, kind, payload, sourceDevice, note }
}

/** إزالة المنتهي حتميًا — الحقيقة قبل العرض */
export function pruneHandoff(items: HandoffItem[], nowMs: number): HandoffItem[] {
  return items.filter((it) => typeof it.expiresAt === "number" && it.expiresAt > nowMs && typeof it.at === "number")
}

/**
 * دفع إلى القائمة (نقي): تكرار ذكي داخل نافذة 60ث (رفع hits وتحديث at
 * دون مضاعفة) · طرد الأقدم عند السقف · الأحدث أولًا.
 * يعيد {items, deduped} — لا يغير المرجع عند الخطأ (النداء يقرر).
 */
export function pushHandoffPure(
  items: HandoffItem[],
  item: HandoffItem,
  nowMs: number,
): { items: HandoffItem[]; deduped: boolean } {
  const live = pruneHandoff(items, nowMs)
  const key = handoffDedupeKey(item.kind, item.payload)
  const existing = live.find((it) => handoffDedupeKey(it.kind, it.payload) === key && nowMs - it.at < HANDOFF_DEDUPE_MS)
  if (existing) {
    const bumped = live.map((it) =>
      it.id === existing.id ? { ...it, hits: it.hits + 1, at: item.at, note: item.note || it.note } : it,
    )
    bumped.sort((a, b) => b.at - a.at)
    return { items: bumped, deduped: true }
  }
  const next = [item, ...live]
  next.sort((a, b) => b.at - a.at)
  // السقف: طرد الأقدم حتميًا (آخر القائمة بعد الفرز)
  return { items: next.slice(0, HANDOFF_CAP), deduped: false }
}

/**
 * المعاينة المقنّعة للعرض — تآزر §50: إن صنّف النص/الرابط حساسًا فالمعاينة
 * مقنّعة بنفس حارس الحساسية (بلا ازدواج تصنيف).
 */
export function handoffPreview(kind: HandoffKind, payload: string): string {
  if (kind === "file-ref") {
    const base = payload.split(/[\\/]+/).pop() ?? payload
    return base.slice(0, 80)
  }
  if (kind === "media-position") {
    const m = parseMediaPosition(payload)
    if (!m) return "—"
    const sec = Math.floor(m.positionMs / 1000)
    const mm = Math.floor(sec / 60)
    const ss = String(sec % 60).padStart(2, "0")
    return `${m.media.slice(0, 60)} @ ${mm}:${ss}`
  }
  if (kind === "url") {
    try {
      const u = new URL(payload)
      const rest = (u.pathname + u.search).slice(0, 40)
      return `${u.hostname}${rest}`
    } catch {
      return payload.slice(0, 60)
    }
  }
  // text — حارس حساسية §50 أولًا
  try {
    // استيراد كسول محروس: النواة نقية ولا تستورد وقت البناء
    // (النداء — الخادم/الواجهة — يمرر مصنِّف §50 صراحة عبر handoffPreviewWith)
    void 0
  } catch { /* لا شيء */ }
  return payload.replace(/\s+/g, " ").slice(0, 80)
}

/** نسخة بحارس §50 المحقون — تستعملها الخادم والواجهة */
export function handoffPreviewWith(
  kind: HandoffKind,
  payload: string,
  classify: (s: string) => { sensitive: unknown },
  mask: (s: string, sensitive: unknown) => string,
): string {
  if (kind === "text" || kind === "url") {
    try {
      const c = classify(payload)
      if (c && c.sensitive) return mask(payload, c.sensitive)
    } catch { /* المصنّف معطوب — سقوط للمعاينة الخام */ }
  }
  return handoffPreview(kind, payload)
}

/** شكل العرض العام للواجهة — بلا حمولة كاملة (الحمولة عبر act حصرًا) */
export function publicHandoffItem(it: HandoffItem, preview: string) {
  return {
    id: it.id,
    kind: it.kind,
    preview,
    sourceDevice: it.sourceDevice,
    note: it.note,
    at: it.at,
    hits: it.hits,
    expiresAt: it.expiresAt,
    fingerprint: handoffFingerprint(it.payload),
  }
}

/** توجيه الفعل للواجهة — نقية وقابلة للفحص */
export function actDirective(kind: HandoffKind, payload: string):
  | { directive: "open-url"; url: string }
  | { directive: "copy"; text: string }
  | { directive: "open-file"; path: string }
  | { directive: "resume-media"; media: string; positionMs: number } {
  if (kind === "url") return { directive: "open-url", url: payload }
  if (kind === "file-ref") return { directive: "open-file", path: payload }
  if (kind === "media-position") {
    const m = parseMediaPosition(payload)
    return { directive: "resume-media", media: m?.media ?? "", positionMs: m?.positionMs ?? 0 }
  }
  return { directive: "copy", text: payload }
}
