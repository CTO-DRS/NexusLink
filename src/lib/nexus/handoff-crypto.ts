// عقد §57 — قفل التسليم الساكن (HANDOFF-AT-REST) — النواة النقية (بلا إدخال/إخراج)
// ============================================================
// الخندق التنافسي: #1 الخصوصية المعمارية — حمولات قائمة التسليم اليدوي (§53)
// لا تُكتب على القرص نصًّا عاريًا أبدًا: كل حمولة تُختم AES-256-GCM بمفتاح
// محلي 32 بايت مرسوخ في DesktopSetting (صفر مخطط — نمط §34.ب/§54) لا يغادر
// الجهاز ولا يعود في أي API. من يسرق القرص يرى قناغة لا قائمة.
// مقابل المنافسين مباشرة:
//  - Pushbullet: قائمة الإشعارات على سحابة الغير — هنا القرص وحده ويحمل مغلفات.
//  - سجلات الحافظة المعتادة (Win+V وغيره): نص عاري في ملف/قاعدة — هنا ختم
//    بمصادقة GCM: أي بايت معدَّل يُكشف ويُسقط العنصر بصدق مع تدقيق §39.
//
// القرار المعماري (موثق):
//  - الختم عند حدود القرص حصرًا: في الذاكرة الحمولة نص صريح (العرض والمعاينة
//    والأفعال تحتاجه) — القرص لا يرى إلا المغلف. حد صادق: استجابة API للقائمة
//    تعرض معاينات للمقترن على شبكته المحلية (رمز §37) — القفل للقرص لا للذاكرة.
//  - المغلف داخل حقل payload نفسه (JSON نصي بعلامة t:"handoff.at-rest") —
//    شكل ملف القائمة لا يتغير والقراءة القديمة (نص عاري) تبقى مقروءة وتُختم
//    تلقائيًا عند أول كتابة تالية (ترحيل صامت بصدق).
//  - فقدان المفتاح أو فساد القناغة = إسقاط العنصر المتأثر حصرًا مع تدقيق
//    handoff.crypto.drop — القائمة تبقى حية لا تنهار (نمط الصدق §54).
//  - التدوير يعيد الختم كاملًا بمفتاح جديد — القديم يُنسى ولا يُعرض أبدًا.
//
// حدود صادقة (§57.حدود):
//  - المفتاح في قاعدة الجهاز نفسها — من يملك القرص كله (القاعدة + الملف)
//    مع جلسة كاملة يستطيع الفتح؛ القفل يرفع كلفة سرقة الملف المعزول لا
//    تستحيل هجوم الجهاز الحي (نعلنها — لا نبيع وهمًا).
//  - البيانات الوصفية (id/kind/at/hits/انتهاء) تبقى نصًّا: التقليم والفرز
//    لا يحتاجان فك الختم، وفشل الفك لا يعمي القائمة.

import crypto from "node:crypto"
import { newLocalKey } from "./backup-secure-core"

export const AT_REST_VERSION = 1
/** علامة المغلف — تُميّز الحمولة المختومة عن النص العاري القديم */
export const AT_REST_MARKER = "handoff.at-rest"
/** طول IV بالبايت (توصية GCM القياسية) */
export const AT_REST_IV_BYTES = 12
/** سقف طول الحمولة المختومة نصيًا — أسوأ حالة تعاقدية: نص 8192 محرفًا عربيًا
 *  (3 بايت/محرف UTF-8) × تضخم base64 (×1.34) + المغلف — السقف 48KB دفاع في العمق */
export const AT_REST_SEALED_MAX = 49_152

export interface AtRestEnvelope {
  t: typeof AT_REST_MARKER
  v: number
  alg: "a256gcm"
  iv: string
  ct: string
  /** وسم المصادقة GCM (16 بايت base64url) — بلا وسم لا فتح (درس §54) */
  tag: string
}

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

/** هل هذه الحمولة مغلّف §57 مختوم؟ (الشكل حصرًا — لا محاولة فتح) */
export function inspectPayload(payload: unknown): "plain" | "sealed" {
  if (typeof payload !== "string" || payload.length === 0 || payload.length > AT_REST_SEALED_MAX) return "plain"
  try {
    const j = JSON.parse(payload) as unknown
    if (!j || typeof j !== "object" || Array.isArray(j)) return "plain"
    const o = j as Record<string, unknown>
    if (o.t !== AT_REST_MARKER || o.v !== AT_REST_VERSION || o.alg !== "a256gcm") return "plain"
    if (typeof o.iv !== "string" || typeof o.ct !== "string" || typeof o.tag !== "string") return "plain"
    if (o.iv.length === 0 || o.ct.length === 0 || o.tag.length === 0) return "plain"
    return "sealed"
  } catch {
    return "plain"
  }
}

/** ختم حمولة: نص + مفتاح سليم → مغلف JSON نصي — IV عشوائي كل ختم */
export function sealPayload(plain: string, key: string): string {
  if (!isValidLocalKey(key)) throw new Error("bad-key")
  const iv = crypto.randomBytes(AT_REST_IV_BYTES)
  const keyBuf = Buffer.from(key, "base64url")
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv)
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const env: AtRestEnvelope = {
    t: AT_REST_MARKER,
    v: AT_REST_VERSION,
    alg: "a256gcm",
    iv: iv.toString("base64url"),
    ct: ct.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  }
  return JSON.stringify(env)
}

export type OpenOutcome =
  | { ok: true; payload: string }
  | { ok: false; error: "bad-envelope" | "no-key" | "auth-failed" }

/** فتح حمولة مختومة: الشكل ← المفتاح ← GCM — الأسباب الثلاثة مغلقة */
export function openPayload(payload: string, key: string | null): OpenOutcome {
  if (inspectPayload(payload) !== "sealed") return { ok: false, error: "bad-envelope" }
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
  if (iv.length !== AT_REST_IV_BYTES || ct.length < 16 || tag.length !== 16) return { ok: false, error: "bad-envelope" }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "base64url"), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
    return { ok: true, payload: plain }
  } catch {
    return { ok: false, error: "auth-failed" }
  }
}

/**
 * ترحيل/ختم قائمة كاملة (نقي): النص العاري يُختم، المختوم يُترك (نفس
 * المفتاح في الذاكرة)، والمفتاح الغائب يترك كل شيء كما هو (سقوط صادق).
 */
export function sealItemsPure(items: Array<{ payload: string }>, key: string | null): { sealed: number } {
  if (!isValidLocalKey(key)) return { sealed: 0 }
  let sealed = 0
  for (const it of items) {
    if (inspectPayload(it.payload) === "plain") {
      it.payload = sealPayload(it.payload, key)
      sealed++
    }
  }
  return { sealed }
}

export { newLocalKey }
