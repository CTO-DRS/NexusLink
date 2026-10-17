// NexusLink — أنواع محرك الروتينات (عقد §26) — مشتركة بين الجسر (سيرفر) والواجهة (عميل)
// =====================================================================
// المبدأ (القاعدة الذهبية): لا بروتوكول موازٍ — كل الأفعال تعبر القنوات القائمة
// (prod: clip:new · guard: dev:ring · UDP: WoL) وكل الحقائق من مصادر عملية Next القائمة.

/** أنواع المشغلات المدعومة في الإصدار الأول (§26.أ). */
export type TriggerKind =
  | "device.connect"      // جهاز في سجل الأجهزة عاد إلى «متصل»
  | "device.disconnect"   // جهاز في سجل الأجهزة غادر إلى «غير متصل»
  | "battery.below"       // بطارية جهاز هبطت تحت العتبة (حافة نازلة + إعادة تسليح +5)
  | "clip.received"       // وصل محتوى جديد إلى الحافظة الموحدة (من جسر prod)
  | "time.once"           // مرة واحدة عند طابع زمني (epoch ms)
  | "time.daily"          // يوميًا عند ساعة:دقيقة (ساعة الخادم المحلية)

/** أنواع الأفعال المدعومة في الإصدار الأول (§26.ب) — كلها قنوات قائمة. */
export type ActionKind =
  | "notify"          // إذاعة إشعار لعملاء الواجهة (حدث auto:fired)
  | "clipboard.push"  // دفع نص إلى الحافظة الموحدة (clip:new عبر جسر prod)
  | "phone.ring"      // رنين الهاتف المتصل بقناة الحماية (dev:ring عبر guardEmitToAgent)
  | "wol"             // حزمة Wake-on-LAN سحرية عبر UDP (نفس مسار WoL القائم)

export interface AutoTrigger {
  kind: TriggerKind
  /** مرشّح الجهاز من سجل الأجهزة (null/غياب = أي جهاز) — للمشغلات الجهازية. */
  deviceId?: string | null
  /** عتبة البطارية 1..100 — لمشغّل battery.below. */
  threshold?: number
  /** الطابع الزمني (epoch ms) — لمشغّل time.once. */
  at?: number
  /** الساعة 0..23 — لمشغّل time.daily. */
  hh?: number
  /** الدقيقة 0..59 — لمشغّل time.daily. */
  mm?: number
}

export interface AutoAction {
  kind: ActionKind
  /** نص الإشعار أو محتوى الحافظة — notify / clipboard.push. */
  text?: string
  /** عنوان MAC بصيغة XX:XX:XX:XX:XX:XX — للفعل wol. */
  mac?: string
}

/** قاعدة روتين كاملة كما تُخزَّن في ذاكرة الجسر وتُعرض في الواجهة. */
export interface AutoRule {
  id: string
  name: string
  enabled: boolean
  trigger: AutoTrigger
  action: AutoAction
  createdAt: number
  lastFiredAt: number | null
  fireCount: number
}

/** مدخل سجل تشغيل — يُذاع للواجهة ويُحفظ في ذاكرة الجسر (آخر 80). */
export interface AutoRunEntry {
  id: string
  ruleId: string
  ruleName: string
  at: number
  ok: boolean
  detail: string
  manual: boolean
}

/** حالة المحرك الكاملة التي تُذاع للعملاء بعد كل تغيير (auto:state). */
export interface AutoStatePayload {
  rules: AutoRule[]
  log: AutoRunEntry[]
  stats: {
    rulesTotal: number
    rulesEnabled: number
    firesToday: number
    lastFiredAt: number | null
  }
  bootedAt: number
}

/** حمولة حدث إطلاق الروتين (auto:fired) — تستهلكه الواجهة للتنبيه الفوري. */
export interface AutoFiredPayload {
  ruleId: string
  ruleName: string
  at: number
  ok: boolean
  detail: string
  manual: boolean
}

export const TRIGGER_KINDS: readonly TriggerKind[] = [
  "device.connect", "device.disconnect", "battery.below", "clip.received", "time.once", "time.daily",
] as const

export const ACTION_KINDS: readonly ActionKind[] = [
  "notify", "clipboard.push", "phone.ring", "wol",
] as const
