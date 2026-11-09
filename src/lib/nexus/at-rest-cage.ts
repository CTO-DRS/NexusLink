// عقد §58 — قفل الخزنة الساكن (CLIP-AT-REST) — قفص التخزين الساكن الموحد
// ============================================================
// تعميم نواة §57 (درس الصفر-ازدواج): مصنع قفص واحد يُنتج ختم/فتح/كشف
// AES-256-GCM بعلامة مخصصة لكل مستخدم — §57 يستعمله بعلامة "handoff.at-rest"
// و§58 بعلامة "clip.at-rest" — الشكل واحد والمفاتيح والعلامات مستقلة.
// أي مستقبل (مزامنة/تسليم/أرشيف) يأخذ قفصه بعلامته دون نسخ كود.
//
// ضمانات القفص (نمط §57 حرفيًا):
//  - مغلف JSON بعلامة t ونسخة v وخوارزمية alg وIV طازج كل ختم ووسم مصادقة
//    مستقل (درس §54/§57: بلا setAuthTag لا فتح).
//  - كشف الشكل بالعلامة حصرًا: JSON بلا العلامة = نص عاري يبقى مقروءًا
//    (ترحيل صامت عند أول كتابة — بلا فقدان قراءة).
//  - الأخطاء الثلاثة مغلقة: bad-envelope (الشكل) / no-key (المفتاح الغائب) /
//    auth-failed (عبث أو مفتاح غلط) — لا انهيار أبدًا.
//  - المفتاح: base64url يفك إلى 32 بايت بالضبط — فحص صارم قبل أي عملية.
//
// §59 — معرّف المفتاح kid (إضافة خالصة — §57 سليم حرفيًا): مغلف قد يحمل
//  kid نصيًا بعد الوسم (ترتيب المفاتيح محفوظ — البادئة الأمامية لا تُمس) فيحل
//  به عنوان المفتاح في حلقة مفاتيح الأجهزة المتعددة (خزنة الحافظة: مفتاح لكل
//  جهاز). الفتح يقبل مفتاحًا مفردًا (نمط §57/§58 التاريخي — يتجاهل kid) أو
//  حلالًا (kid ← مفتاح). kid الغائب في الحلقة = no-key بصدق، وkid الفاسد
//  شكلًا = bad-envelope — ولا مسار انهيار جديد.

import crypto from "node:crypto"
import { newLocalKey } from "./backup-secure-core"

/** طول IV بالبايت (توصية GCM القياسية) — واحد لكل الأقفاص */
export const AT_REST_IV_BYTES = 12

/** مفتاح محلي سليم: base64url يفك إلى 32 بايت بالضبط */
export function isValidLocalKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0) return false
  try {
    const raw = Buffer.from(key, "base64url")
    return raw.length === 32
  } catch {
    return false
  }
}

export interface AtRestEnvelope {
  t: string
  v: number
  alg: "a256gcm"
  iv: string
  ct: string
  /** وسم المصادقة GCM (16 بايت base64url) — بلا وسم لا فتح */
  tag: string
  /** §59: معرّف المفتاح (اختياري) — عنوان في حلقة الأقفال لا مادة سرية */
  kid?: string
}

/** §59 — معرّف مفتاح سالم: 1–64 محرفًا من [A-Za-z0-9._-] بمبدئ أبجد-رقمي */
export function isValidKid(kid: unknown): kid is string {
  return typeof kid === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(kid)
}

/** §59 — مصدر المفتاح عند الفتح: مفتاح مفرد (النمط التاريخي — يتجاهل kid)
 *  أو حلال (kid ← مفتاح) لحلقات الأجهزة المتعددة */
export type AtRestKeySource = string | null | ((kid: string | null) => string | null)

/** §59 — استخراج kid من مغلف (قراءة شكل حصرًا — بلا فتح): غير الموجود أو
 *  الفاسد يعود null — تُستخدم للتقارير وقرارات إعادة الختم الموجّه */
export function atRestKid(payload: unknown): string | null {
  if (typeof payload !== "string" || payload.length === 0) return null
  try {
    const j = JSON.parse(payload) as Record<string, unknown>
    const kid = j.kid
    return typeof kid === "string" && isValidKid(kid) ? kid : null
  } catch {
    return null
  }
}

export type AtRestOpenOutcome =
  | { ok: true; payload: string }
  | { ok: false; error: "bad-envelope" | "no-key" | "auth-failed" }

export interface AtRestCage {
  /** علامة المغلف — تُميّز الحمولة المختومة لهذا القفص عن غيره والنص العاري */
  readonly MARKER: string
  readonly VERSION: number
  /** سقف طول المغلف نصيًا — دفاع في العمق فوق أسوأ حالة تعاقدية للمستخدم */
  readonly SEALED_MAX: number
  /** هل هذه الحمولة مغلّف هذا القفص؟ (الشكل حصرًا — لا محاولة فتح) */
  inspect(payload: unknown): "plain" | "sealed"
  /** ختم حمولة: نص + مفتاح سليم → مغلف JSON نصي — IV عشوائي كل ختم
   *  §59: kid اختياري يُلحق بعد الوسم (البادئة الأمامية لا تُمس) */
  seal(plain: string, key: string, kid?: string | null): string
  /** فتح حمولة مختومة: الشكل ← المفتاح ← GCM — الأسباب الثلاثة مغلقة
   *  §59: المفتاح مفرد أو حلال (kid ← مفتاح) لحلقات الأجهزة */
  open(payload: string, keys: AtRestKeySource): AtRestOpenOutcome
  /** ختم دفعة نصوص: العاري يُختم والمختوم يُترك وبلا مفتاح لا شيء (ترحيل نقي) */
  sealTextsPure(items: Array<{ content: string }>, key: string | null): { sealed: number }
}

export function createAtRestCage(opts: {
  marker: string
  sealedMax: number
  version?: number
  /** أدنى طول قناغة مشروع بالبايت — GCM تدفقي فالقناغة بطول النص نفسه،
   *  و16 هو حرس §57 التاريخي (حمولاته الطويلة) — الأقفاص القصيرة (رموز OTP)
   *  ترفعه إلى 1 حصرًا (الصفر مستبعد بنمط الختم — الفارغ لا يُختم). */
  minCtBytes?: number
}): AtRestCage {
  const MARKER = opts.marker
  const VERSION = opts.version ?? 1
  const SEALED_MAX = opts.sealedMax
  const MIN_CT_BYTES = opts.minCtBytes ?? 16
  // مسار سريع دقيق: JSON.stringify يحفظ ترتيب المفاتيح الحرفي للمغلف —
  // كل مغلف يبدأ بهذه البادئة بالضبط فلا JSON.parse لأي نص آخر مهما كبُر.
  const PREFIX = `{"t":${JSON.stringify(MARKER)},"v":${VERSION},`

  function inspect(payload: unknown): "plain" | "sealed" {
    if (typeof payload !== "string" || payload.length === 0 || payload.length > SEALED_MAX) return "plain"
    if (!payload.startsWith(PREFIX)) return "plain"
    try {
      const j = JSON.parse(payload) as unknown
      if (!j || typeof j !== "object" || Array.isArray(j)) return "plain"
      const o = j as Record<string, unknown>
      if (o.t !== MARKER || o.v !== VERSION || o.alg !== "a256gcm") return "plain"
      if (typeof o.iv !== "string" || typeof o.ct !== "string" || typeof o.tag !== "string") return "plain"
      if (o.iv.length === 0 || o.ct.length === 0 || o.tag.length === 0) return "plain"
      return "sealed"
    } catch {
      return "plain"
    }
  }

  function seal(plain: string, key: string, kid?: string | null): string {
    if (!isValidLocalKey(key)) throw new Error("bad-key")
    const iv = crypto.randomBytes(AT_REST_IV_BYTES)
    const keyBuf = Buffer.from(key, "base64url")
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv)
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
    const env: AtRestEnvelope = {
      t: MARKER,
      v: VERSION,
      alg: "a256gcm",
      iv: iv.toString("base64url"),
      ct: ct.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    }
    // §59: kid يُلحق أخيرًا — ترتيب المفاتيح محفوظ فالبادئة الأمامية ثابتة
    if (typeof kid === "string" && isValidKid(kid)) env.kid = kid
    return JSON.stringify(env)
  }

  function open(payload: string, keys: AtRestKeySource): AtRestOpenOutcome {
    if (inspect(payload) !== "sealed") return { ok: false, error: "bad-envelope" }
    let env: AtRestEnvelope
    try { env = JSON.parse(payload) as AtRestEnvelope } catch { return { ok: false, error: "bad-envelope" } }
    // §59: kid إن وُجد يجب أن يكون سالم الشكل — الفاسد مغلف فاسد بصدق
    let kid: string | null = null
    if (env.kid !== undefined) {
      if (!isValidKid(env.kid)) return { ok: false, error: "bad-envelope" }
      kid = env.kid
    }
    const key = typeof keys === "function" ? keys(kid) : keys
    if (!isValidLocalKey(key)) return { ok: false, error: "no-key" }
    let iv: Buffer
    let ct: Buffer
    let tag: Buffer
    try {
      iv = Buffer.from(env.iv, "base64url")
      ct = Buffer.from(env.ct, "base64url")
      tag = Buffer.from(env.tag, "base64url")
    } catch {
      return { ok: false, error: "bad-envelope" }
    }
    if (iv.length !== AT_REST_IV_BYTES || ct.length < MIN_CT_BYTES || tag.length !== 16) return { ok: false, error: "bad-envelope" }
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "base64url"), iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
      return { ok: true, payload: plain }
    } catch {
      return { ok: false, error: "auth-failed" }
    }
  }

  function sealTextsPure(items: Array<{ content: string }>, key: string | null): { sealed: number } {
    if (!isValidLocalKey(key)) return { sealed: 0 }
    let sealed = 0
    for (const it of items) {
      // الفارغ لا يُختم: لا سر فيه وختمه تضخيم بلا معنى (حد معلن)
      if (typeof it.content === "string" && it.content.length > 0 && inspect(it.content) === "plain") {
        it.content = seal(it.content, key)
        sealed++
      }
    }
    return { sealed }
  }

  return { MARKER, VERSION, SEALED_MAX, inspect, seal, open, sealTextsPure }
}

export { newLocalKey }
