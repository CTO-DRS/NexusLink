// NexusLink — وسيط حرس الأصل للـAPI (تكليف 38 — CSRF على الخدمة المحلية)
// + FA-18 (تكليف 45) — الطبقة الثالثة للمتصفح: CSP بالـnonce لمستندات HTML
// =====================================================================
// الثغرة المغلقة (38): صفحة إنترنت خبيثة في متصفح المالك تستطيع إرسال POST
// إلى http://localhost:3000/api/fs (أو أي مسار API) — المتصفح يبعث الطلب
// والمسارات تفك JSON بلا نظر لنوع المحتوى (Request.json() يحلل دائمًا) —
// «هجوم بالتنقل» drive-by يفتح ملفات وينسخ ويمسح بلا نقرة واحدة من المالك.
//
// الثغرة المغلقة (FA-18): الواجهة بلا CSP إطلاقًا — أي XSS في مكون React
// ينفذ سكربتًا بحرية كاملة فوق سطح API المالك كله (fs/backup/input/comms).
// العقيدة: `script-src 'self' 'nonce-…' 'strict-dynamic'` — أي سكربت بلا
// nonce (مُحقن بالـDOM أو تعليق HTML) لا ينفذ، والـstrict-dynamic يمنع
// الانتشار من سكربت موثوق إلى سكربت حقنه المهاجم. Next يطبّع nonce سكربتاته
// تلقائيًا من ترويسة CSP المُمررة مع الطلب (النمط الرسمي الموثق في وثائق Next).
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

/**
 * FA-18 — سياسة CSP للمستندات الحية (مستندات HTML حصرًا).
 * · script-src: nonce لكل طلب + strict-dynamic — القفل الحقيقي ضد XSS.
 *   (وضع التطوير يحتاج 'unsafe-eval' — نحن إنتاج حصرًا، موثق لا مخفي).
 * · style-src 'unsafe-inline': سمات style من مكتبات الواجهة + عنصر <style> في الرسوم.
 * · img/media/frame: self + data:/blob: — معاينات محلية وQR وPDF فقط.
 * · connect-src 'self' حصرًا: كل الجسور تعبر إعادة كتابة المسار نفس الأصل،
 *   وقائمة وسائط الهاتف عبر وكيل /api/phone-media/list المحلي (FA-18).
 * · object-src none + base-uri/form-action self + frame-ancestors self: تعميق.
 */
function cspFor(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ")
}

function isHtmlDoc(req: NextRequest): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  const accept = req.headers.get("accept") ?? ""
  return accept.includes("text/html")
}

export function middleware(req: NextRequest) {
  // FA-18 — مستند HTML: nonce جديد لكل طلب + CSP على الاستجابة، وترويسة
  // CSP/x-nonce تُمرر مع الطلب كي يطبّع Next سكربتاته بنفس الـnonce.
  if (isHtmlDoc(req)) {
    const nonce = crypto.randomUUID()
    const csp = cspFor(nonce)
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set("x-nonce", nonce)
    requestHeaders.set("content-security-policy", csp)
    const res = NextResponse.next({ request: { headers: requestHeaders } })
    res.headers.set("content-security-policy", csp)
    return res
  }

  // حرس الأصل — مسارات API حصرًا (GET/HEAD/OPTIONS تمر دائمًا)
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
  // كل المسارات ما عدا الأصول الساكنة المتجاهلة — فرع HTML يفرّق المستندات
  // وفرع الأصل يحمي API حصرًا (الأصول بلا منطق ولا CSP).
  matcher: ["/((?!_next/static|_next/image|fonts/|favicon.ico|logo.svg|robots.txt|seo/).*)"],
}
