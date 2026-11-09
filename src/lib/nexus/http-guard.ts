// FA-14 (تكليف 41) — بوابة عمليات الكمبيوتر المدمرة على HTTP
// ============================================================
// عقيدة FA-13 نقلت إلى طبقة REST: الجسور (socket) صارت أوامر الكمبيوتر
// loopback حصرًا — لكن نقاط HTTP المدمرة (مسح/نقل/حذف نسخ/إلغاء مهام)
// بقيت مفتوحة لأي عميل عبر البوابة (ترويسة x-gw-client-ip غير loopback).
// هذا الملف هو الحرس الموحّد لها: نمط guardLocal (§54) المعمم.
//
// · Next يُصغي على 127.0.0.1 حصرًا — الاتصال المباشر من الجهاز لا يحمل
//   الترويسة → محلي.
// · الواصل عبر البوابة تحمل ترويسته عنوان نظيره الحقيقي الذي تستبدله
//   البوابة دائمًا (F4/§37 — لا تزييف ممكن من الشبكة) → loopback يمرّ
//   وما سواه يُرفض.
// · القراءات (GET) تبقى مفتوحة بمستوى كشف مساوٍ لواجهة الأجهزة القائمة
//   (حدود صادقة §36.هـ — «منظر لا باب») — البوابة هنا للأفعال المدمرة حصرًا.
import { appendAudit, type AuditKind } from "@/lib/enterprise-audit"

export function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

/** الاتصال المباشر (بلا ترويسة) أو عبر البوابة من loopback → محلي. */
export function isLocalRequest(req: Request): boolean {
  const fwd = req.headers.get("x-gw-client-ip")
  return !fwd || isLoopbackIp(fwd)
}

// خفض ضجيج السجل: رفض متكرر للعملية نفسها يُوثق كل 3 ثوانٍ (نمط الجسور FA-13)
const rejLast = new Map<string, number>()

/**
 * بوابة FA-14 — تعيد true إذا مُدِر الطلب محليًا. خلاف ذلك تُوثق رفضًا
 * (بمخفف 3 ثوانٍ) وتعيد false — المستدعي يجيب 403 { ok:false, error:"pc-only" }.
 */
export function guardPcOnly(req: Request, auditKind: AuditKind, action: string): boolean {
  if (isLocalRequest(req)) return true
  const key = `${auditKind}:${action}`
  const now = Date.now()
  if (now - (rejLast.get(key) || 0) > 3000) {
    rejLast.set(key, now)
    void appendAudit(auditKind, false, "remote", { reason: "pc-only", action: action.slice(0, 32) })
  }
  return false
}
