// NexusLink — رياضيات رمز المساعدة (عقد §46 — المساعدة عن بعد)
// ============================================================
// دالٌّ نقي مشترك المنطق (ويب/خادم/فحص) — بلا I/O ولا React ولا حالة:
//  · رمز مساعدة عددي من ست خانات مشتق من سرّ آخر QR مُصدَر (HMAC-SHA256) —
//    لا حالة إضافية ولا تخزين: تدوير QR يُدوّر الرمز حتمًا.
//  · مقارنة زمن-ثابت (درس §6/§37) وسقف محاولات صارم قابل للاختبار.
//  · سيناريو العائلة: يُقرأ الرمز هاتفيًا على المكالمة، وهاتف من تُساعد
//    يُدخله، والموافقة النهائية بيد مالك سطح المكتب (باب موافقة §46.ج).

import crypto from "crypto"

/** نافذة رمز المساعدة = نافذة سر الاقتران نفسها (G-1) — عقد §46.أ */
export const ASSIST_CODE_TTL_MS = 10 * 60_000

/** سقف محاولات إدخال الرمز الخاطئ قبل موت الجلسة (إعادة إصدار QR) — عقد §46.د */
export const MAX_ASSIST_ATTEMPTS = 5

/** مجال الرمز — سلسلة ثابتة تمنع إعادة استخدام سر الاقتران كمفتاح مباشر */
const ASSIST_DOMAIN = "nexuslink/assist-code/v1"

export type AssistRejectReason =
  | "no-window"   // لم يُصدر QR إطلاقًا
  | "missing"     // الطلب بلا رمز
  | "expired"     // فاتت نافذة العشر دقائق
  | "invalid"     // رمز لا يطابق (زمن-ثابت)
  | "locked"      // استُنفد سقف المحاولات — إعادة إصدار QR إجبارية
  | "malformed"   // ليس ستّ خانات رقمية بعد التطبيع

/** تطبيع إدخال بشري: حذف الفراغات والشرطات والفواصل — قبول «123 456» و«123-456» */
export function normalizeAssistCode(input: unknown): string {
  if (typeof input !== "string") return ""
  return input.replace(/[\s\-–—]/g, "").replace(/\D/g, "")
}

/** اشتقاق رمز المساعدة من سر الاقتران — حتمي (نفس السر = نفس الرمز) */
export function deriveAssistCode(secret: string): string {
  const mac = crypto.createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(ASSIST_DOMAIN)
    .digest()
  // 6 خانات عشرية من أول 4 بايت (mod 10 لكل بايت — تحيّز أقل من 2⁵³ غير ملموس هنا
  // والغرض قابلية نطق لا عشوائية تشفيرية؛ العشوائية الحقيقية في السر 128-بت)
  let code = ""
  for (let i = 0; i < 6; i++) code += String(mac[i] % 10)
  return code
}

/** فحص الشكل: ستّ خانات رقمية بالضبط بعد التطبيع */
export function isWellFormedCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

/** تحقق رمز المساعدة — مقارنة زمن-ثابت على طول متساوٍ (نمط verifyPairingSecret) */
export function verifyAssistCode(
  provided: unknown,
  secret: string | null,
  issuedAt: number,
  attemptsUsed: number,
  now = Date.now(),
): { ok: true } | { ok: false; reason: AssistRejectReason } {
  if (!secret) return { ok: false, reason: "no-window" }
  if (attemptsUsed >= MAX_ASSIST_ATTEMPTS) return { ok: false, reason: "locked" }
  if (now - issuedAt > ASSIST_CODE_TTL_MS) return { ok: false, reason: "expired" }
  const normalized = normalizeAssistCode(provided)
  if (!normalized) return { ok: false, reason: "missing" }
  if (!isWellFormedCode(normalized)) return { ok: false, reason: "malformed" }
  const a = Buffer.from(normalized, "utf8")
  const b = Buffer.from(deriveAssistCode(secret), "utf8")
  const match = a.length === b.length && crypto.timingSafeEqual(a, b)
  return match ? { ok: true } : { ok: false, reason: "invalid" }
}
