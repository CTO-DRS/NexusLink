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
  /** ختم حمولة: نص + مفتاح سليم → مغلف JSON نصي — IV عشوائي كل ختم */
  seal(plain: string, key: string): string
  /** فتح حمولة مختومة: الشكل ← المفتاح ← GCM — الأسباب الثلاثة مغلقة */
  open(payload: string, key: string | null): AtRestOpenOutcome
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

  function seal(plain: string, key: string): string {
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
    return JSON.stringify(env)
  }

  function open(payload: string, key: string | null): AtRestOpenOutcome {
    if (inspect(payload) !== "sealed") return { ok: false, error: "bad-envelope" }
    if (!isValidLocalKey(key)) return { ok: false, error: "no-key" }
    let env: AtRestEnvelope
    try { env = JSON.parse(payload) as AtRestEnvelope } catch { return { ok: false, error: "bad-envelope" } }
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
