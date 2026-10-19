// NexusLink — SEC (M0.3) — حارس مآخذ الجسور المدمجة: CORS + IP العميل الحقيقي
// ============================================================
// توثيق كامل في docs/security-audit.md (F4 + F8). ثلاث أدوات:
//
// 1) socketCors() — بديل `origin: "*"`: المتصفحات الواردة من الإنترنت
//    (Origin خارجي مثل https://evil.com) تُرفض عند المصافحة حصرًا — وهي
//    مصدر هجوم «اختطاف WebSocket عبر الموقع» الذي يجعل صفحة خبيثة تتحكم
//    بجسور الشبكة المحلية. العملاء الأصليون (Flutter/Node/E2E) بلا ترويسة
//    Origin فيُسمح لهم، وواجهتنا تصل عبر البوابة/نفس الأصل (localhost أو
//    IP خاص) فيُسمح له. القائمة: بلا Origin · localhost/127.0.0.1/::1 ·
//    النطاقات الخاصة 10/172.16-31/192.168 بأي منفذ · أسماء mDNS *.local.
//
// 2) realClientIp(handshake) — IP العميل الحقيقي مع البوابة: الواصل عبر
//    البوابة يصل من loopback ويحمل x-gw-client-ip (البوابة تستبدله حرفيًا
//    فلا يُثق بترويسة من عميل مباشر) — والواصل مباشرة يبقى بعنوانه.
//
// 3) isLocalSocket(socket) — هل العميل من الجهاز نفسه (loopback فعلي أو
//    عبر بوابة محلية من loopback)؟ بوابة desktop:register (دور الكمبيوتر
//    صاحب الجهاز — أحداثه تُنفَّذ دائمًا) لا تُفتح إلا له.
// ------------------------------------------------------------
import type { IncomingHttpHeaders } from "http"

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"])

/** Origin مسموح لمتصفح؟ (عملاء بلا Origin = أصليون — مسموحون دائمًا) */
export function originAllowed(origin: string | undefined): boolean {
  const o = String(origin ?? "").trim()
  if (!o) return true // عميل أصلي (Flutter/Node/E2E) — لا ترويسة Origin
  let u: URL
  try {
    u = new URL(o)
  } catch {
    return false
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false
  const host = u.hostname.toLowerCase()
  if (LOOPBACK.has(host)) return true
  if (host.endsWith(".local")) return true // mDNS — اسم الكمبيوتر المحلي
  // نطاقات خاصة (IPv4): 10/8 · 172.16-31 · 192.168 — شبكة المنزل/المكتب
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 192) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (host.startsWith("[::ffff:")) return true
  }
  if (host.startsWith("::ffff:")) return true // IPv4-mapped IPv6
  return false
}

/** إعدادات CORS الموحدة لكل جسور socket.io (بديل origin:"*") */
export function socketCors(): { origin: (o: string | undefined, cb: (e: Error | null, ok: boolean) => void) => void; methods: string[] } {
  return {
    origin: (o, cb) => cb(null, originAllowed(o)),
    methods: ["GET", "POST"],
  }
}

/** IP العميل الحقيقي من مصافحة socket.io (loopback عبر البوابة → الترويسة الموثوقة) */
export function realClientIp(handshake: { address?: string; headers?: IncomingHttpHeaders }): string {
  const remote = String(handshake?.address ?? "").replace(/^::ffff:/, "")
  if (LOOPBACK.has(remote)) {
    const fwd = String(handshake?.headers?.["x-gw-client-ip"] ?? "").trim().replace(/^::ffff:/, "")
    return fwd || "127.0.0.1"
  }
  return remote
}

/** هل هذا السوكِت من الجهاز نفسه؟ (loopback فعليًا — عبر البوابة المحلية أو مباشرة) */
export function isLocalSocket(handshake: { address?: string; headers?: IncomingHttpHeaders }): boolean {
  return LOOPBACK.has(realClientIp(handshake))
}
