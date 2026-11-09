// NexusLink — وسيط حرس الأصل للـAPI (تكليف 38 — CSRF على الخدمة المحلية)
// =====================================================================
// الثغرة المغلقة: صفحة إنترنت خبيثة في متصفح المالك تستطيع إرسال POST
// إلى http://localhost:3000/api/fs (أو أي مسار API) — المتصفح يبعث الطلب
// والمسارات تفك JSON بلا نظر لنوع المحتوى (Request.json() يحلل دائمًا) —
// «هجوم بالتنقل» drive-by يفتح ملفات وينسخ ويمسح بلا نقرة واحدة من المالك.
//
// العقيدة — نفس منطق socketCors() في socket-security.ts حرفيًا (نمط SEC M0.3 F4):
//  · بلا ترويسة Origin (curl · وكيل الهاتف · سطح المكتب) → مسموح — عميل غير متصفح
//  · Origin محلي/شبكة منزلية (loopback · .local · 10/8 · 172.16-31 · 192.168) → مسموح
//  · Origin عام (إنترنت) على طريقة غير آمنة → 403 cross-origin-blocked
//  · GET/HEAD/OPTIONS تمر دائمًا (بلا أثر جانبي تعاقديًا)
//
// Edge-safe بصدق: صفر استيراد من node — المنطق منسوخ متعمدًا عن socket-security
// (التي تستورد أنواع http) لأن الوسيط يجري على حافة Next — الازدواج موثق بحارس
// موحد: أي تعديل قادم على المنطق يجب أن يمس الموضعين معًا.

import { NextRequest, NextResponse } from "next/server"

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function originAllowed(o: string): boolean {
  let u: URL
  try {
    u = new URL(o)
  } catch {
    return false
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false
  const host = u.hostname.toLowerCase()
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true
  if (host.endsWith(".local")) return true // mDNS — اسم الكمبيوتر المحلي
  // نطاقات خاصة (IPv4): 10/8 · 172.16-31 · 192.168 — شبكة المنزل/المكتب
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 192) return true
    if (a === 172 && b >= 16 && b <= 31) return true
  }
  if (host.startsWith("::ffff:") || host.startsWith("[::ffff:")) return true // IPv4-mapped
  return false
}

export function middleware(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) return NextResponse.next()
  const origin = req.headers.get("origin")
  if (!origin) return NextResponse.next() // curl · الوكيل · سطح المكتب — بلا متصفح
  if (originAllowed(origin)) return NextResponse.next()
  // وميض توحيد: Origin على نفس المضيف المطلَق يمر وإن لم يصنفه المنطق (أسماء جديدة)
  try {
    const host = req.headers.get("host")
    if (host && new URL(origin).host === host) return NextResponse.next()
  } catch { /* أصل فاسد → الرفض */ }
  return NextResponse.json(
    { ok: false, error: "cross-origin-blocked" },
    { status: 403 },
  )
}

export const config = {
  matcher: "/api/:path*",
}
