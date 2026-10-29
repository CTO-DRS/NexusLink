// NexusLink — نواة الطوارئ النقية (عقد §48 — الوضع الشريف من «الحزمة الخفية»)
// ============================================================
// نواة رياضية نقية: صفر استيراد، صفر ملفات، صفر شبكة — تُستوردها الخادم
// والبوابة والتوأم الهاتفي وحتى مواصفة وكيل Flutter (§46.د/§48.د) بنفس
// الحتمية. القاعدة: نفس المدخلات = نفس الحسم، في كل مكان وإلى الأبد.
//
// حد 48.و.1 (حدود صادقة): لا «حزمة تثبّت نفسها خفيةً» — الوكيل يُثبَّت
// مسبقًا بيد المالك العالم حصرًا (نمط Find My)؛ ما هنا سياسة وتطبيق،
// لا عتادًا — الفلاش يمحو الوكيل ولا يبقى إلا سجل الأدلة.

/** كلمة التأكيد الحرفية — تُكتب حرفيًا لا تُختار من قائمة ولا تُختصر (48.ب). */
export const KILL_WORD = "اقتل"

/** حدود تطبيع تسليح التصعيد الذاتي — صاخبة لا صامتة (48.د). */
export const UNLOCK_FAIL_MIN = 3
export const UNLOCK_FAIL_MAX = 10
export const UNLOCK_FAIL_DEFAULT = 5

/** أثر تغيير شريحة SIM المُسلَّح مسبقًا (48.د) — kill/warn/off. */
export type SimChangeAction = "kill" | "warn" | "off"

export interface ArmRules {
  /** حد محاولات فتح الشاشة الفاشلة قبل التصعيد (3–10 بعد التطبيع). */
  unlockFailLimit: number
  /** أثر رصد تغيير الشريحة. */
  simChangeAction: SimChangeAction
}

export interface ArmResult {
  /** القواعد بعد التطبيع — null فقط عند مدخل لا يُصلاح إطلاقًا. */
  rules: ArmRules | null
  /** ملاحظات التطبيع الصاخب — كل تقييد يُعلن لا يُطبَّق صمتًا. */
  notes: string[]
}

/**
 * تطبيع صاخب لقواعد التسليح (48.د): كل قيمة خارج الحدود تُشدَّد إلى الحد
 * الأقرب مع ملاحظة معلنة — المالك يرى ما عُدِّل حرفيًا، لا صمت التطبيق.
 * المدخل السليم يمر بلا ملاحظة واحدة (نفس القيم للخارج).
 */
export function normalizeArmRules(raw: unknown): ArmResult {
  const notes: string[] = []
  const r = (raw ?? {}) as Record<string, unknown>

  // الغياب صامت (المالك لم يحدد = الافتراضي)؛ الحضور التالف صاخب (حدد شيئًا غير صالح)
  let limit: number
  const rawLimit = r.unlockFailLimit
  if (rawLimit === undefined || rawLimit === null || rawLimit === "") {
    limit = UNLOCK_FAIL_DEFAULT
  } else {
    limit = Number(rawLimit)
    if (!Number.isFinite(limit)) {
      limit = UNLOCK_FAIL_DEFAULT
      notes.push(`unlockFailLimit غير رقمي («${String(rawLimit)}») — استُخدم الافتراضي ${UNLOCK_FAIL_DEFAULT}`)
    } else if (limit < UNLOCK_FAIL_MIN) {
      notes.push(`unlockFailLimit ${limit} تحت الحد الأدنى — شُدِّد إلى ${UNLOCK_FAIL_MIN}`)
      limit = UNLOCK_FAIL_MIN
    } else if (limit > UNLOCK_FAIL_MAX) {
      notes.push(`unlockFailLimit ${limit} فوق الحد الأقصى — خُفِّض إلى ${UNLOCK_FAIL_MAX}`)
      limit = UNLOCK_FAIL_MAX
    }
  }

  let sim: SimChangeAction
  const rawSim = String(r.simChangeAction ?? "")
  if (rawSim === "kill" || rawSim === "warn" || rawSim === "off") {
    sim = rawSim
  } else {
    sim = "warn"
    if (rawSim !== "") {
      notes.push(`simChangeAction «${rawSim}» غير معروف — استُخدم warn`)
    }
  }

  return { rules: { unlockFailLimit: Math.round(limit), simChangeAction: sim }, notes }
}

export interface EscalationInput {
  /** هل الجهاز مقتول أصلًا (الحسم الأول بلا منازعة). */
  killed: boolean
  /** عدد محاولات فتح الشاشة الفاشلة المتتالية. */
  unlockFails: number
  /** هل رُصد تغيير شريحة منذ آخر حالة معروفة. */
  simChanged: boolean
}

export interface EscalationDecision {
  action: "none" | "kill"
  /** سبب حتمي مفسر — الترتيب جزء من العقد لا تفصيلًا. */
  reason: "already-killed" | "unlock-fails" | "sim-changed" | "armed-no-trigger"
}

/**
 * التصعيد الذاتي المحلي (48.د) — حتمي الترتيب على الهاتف نفسه بلا شبكة:
 *   1. already-killed — المقتول يبقى مقتولًا (أحادية الاتجاه بنيويًا)
 *   2. unlock-fails   — محاولات الفتح بلغت الحد المُسلَّح
 *   3. sim-changed    — رصد تغيير الشريحة والقاعدة kill
 * لا شيء غير ذلك يقتل: النواة لا تعرف «مشبوهًا» ولا «يشبه» — أرقام فقط.
 * القواعد null (غير مسلَّح) → لا تصعيد أبدًا (armed-no-trigger).
 */
export function decideSelfEscalation(input: EscalationInput, rules: ArmRules | null): EscalationDecision {
  if (input.killed) return { action: "kill", reason: "already-killed" }
  if (rules) {
    if (input.unlockFails >= rules.unlockFailLimit) return { action: "kill", reason: "unlock-fails" }
    if (input.simChanged && rules.simChangeAction === "kill") return { action: "kill", reason: "sim-changed" }
  }
  return { action: "none", reason: "armed-no-trigger" }
}

/**
 * بصمة القتل — 16 محرفًا سداسيًا عشرية حتمية (48.ب).
 * دورا FNV-1a بقيم أولية مختلفة ثم ربطهما: 8+8=16 محرفًا.
 * درس الجولة الموثق: XOR بلا «>>>0» أنتج عددًا سالبًا فظهر «-» في hex
 * (8+9 محارف) وأسقط مدقق القائمة — العلاج: >>>0 قبل toString(16) دائمًا،
 * والفحص يقوى على 16 محرفًا حرفيًا (أدناه في البوابة).
 */
export function killFingerprint(seed: string): string {
  const s = String(seed)
  const h1 = fnv1a(s, 0x811c9dc5)
  const h2 = fnv1a(s + "\u200f" + s.length.toString(10), 0x01000193)
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")
}

/** FNV-1a ‏32-بت — حتمي، صفر اعتماد، أسرع من أي بديل مقروء. */
function fnv1a(s: string, basis: number): number {
  let h = basis >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xffff
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}
