// عقد §52 — وضع التركيز الموحد (UNIFIED-FOCUS) — النواة النقية (بلا إدخال/إخراج)
// ============================================================
// الخندق التنافسي: #3 محرك الأتمتة/التاريخ (التركيز حالة زمنية بانتهاء
// ذاتي واستعادة حال سابقة — لا بقاء بعد انقضائه) + #2 عمق التكامل الرأسي
// (كتم موحد: إشعار الهاتف المعكوس + DND المكتب في مفتاح واحد).
// مقابل المنافسين مباشرة:
//  - Apple Focus: مغلق منظومة أبل ويقوده حساب — هنا محلي حصرًا بلا حساب.
//  - Phone Link «دون إزعاج»: مزامنة يدوية بلا انتهاء ذاتي ولا استعادة حالة.
//  - KDE Connect: لا مكافئ موحد عبر الأجهزة.
//
// حدود صادقة (§52.حدود):
//  - الكتم على طبقة الخادم (تعكيس الإشعارات + DND المكتب) — كتم أجهزة النظام
//    الأصلية خارج النطاق (نفس حدود كل الجسور المعلنة).
//  - لا يعيد تكرار قواعد الهدوء §11 بلسان آخر: التداخل مع «ساعات الهدوء»
//    يُحسب ويُعلن — الفرض يبقى لقواعد الفلترة الأصلية.
//  - صفر مخطط: الحالة ملف JSON خارج المخطط (نمط §37/§48/§49) — الحذف = توقف.

export const FOCUS_MIN_MINUTES = 5
export const FOCUS_MAX_MINUTES = 240
/** شرائح المدة المعروضة في الواجهة (دقائق) */
export const FOCUS_PRESETS = [25, 45, 60, 90]

export interface FocusState {
  until: number
  suppressMirroring: boolean
  autoReplyText: string | null
  prevDnd: boolean
  suppressed: number
  createdAt: number
}

export function validateFocusMinutes(minutes: unknown): { ok: boolean; error?: string } {
  if (typeof minutes !== "number" || !Number.isInteger(minutes)) return { ok: false, error: "invalid-minutes" }
  if (minutes < FOCUS_MIN_MINUTES || minutes > FOCUS_MAX_MINUTES) return { ok: false, error: "invalid-minutes" }
  return { ok: true }
}

/** تسوية الحالة من ملف خام — الغريب يُلغى بصدق (فشل-آمن نمط §38) */
export function normalizeFocusState(raw: unknown): FocusState | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const until = Number(r.until)
  if (!Number.isFinite(until)) return null
  return {
    until,
    suppressMirroring: r.suppressMirroring !== false,
    autoReplyText: typeof r.autoReplyText === "string" && r.autoReplyText.trim() ? r.autoReplyText.slice(0, 200) : null,
    prevDnd: r.prevDnd === true,
    suppressed: Number.isInteger(r.suppressed) && (r.suppressed as number) >= 0 ? (r.suppressed as number) : 0,
    createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : until,
  }
}

/** التركيز نشط الآن؟ (الماضي = غير نشط — لا حالة زومبي) */
export function focusActive(s: FocusState | null, nowMs: number): boolean {
  return !!s && s.until > nowMs
}

export function focusRemainingMs(s: FocusState | null, nowMs: number): number {
  if (!s) return 0
  return Math.max(0, s.until - nowMs)
}

/** هل يحتاج الانتهاء استعادة (ملف موجود وانقضى)؟ — يُستدعى من طبقة الحالة */
export function focusNeedsRestore(s: FocusState | null, nowMs: number): boolean {
  return !!s && s.until <= nowMs
}

/** تداخل مع ساعات الهدوء المعلنة (قواعد الفلترة §11) — إعلان لا فرض */
export function focusOverlapsQuiet(s: FocusState | null, quietUntilMs: number | null): boolean {
  if (!s || !quietUntilMs) return false
  return s.until > quietUntilMs
}

/** مدد التمديد المسموحة: الدقائق تُضاف فوق الباقي بسقف الجلسة الأقصى من الآن */
export function extendUntil(s: FocusState | null, minutes: number, nowMs: number): number | null {
  if (!focusActive(s, nowMs)) return null
  const v = validateFocusMinutes(minutes)
  if (!v.ok) return null
  const ceiling = nowMs + FOCUS_MAX_MINUTES * 60_000
  return Math.min((s as FocusState).until + minutes * 60_000, ceiling)
}
