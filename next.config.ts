import type { NextConfig } from "next";

// NexusLink — تطبيق محلي أولًا: الإنترنت ليس أبدًا على مسار البيانات،
// فالترويسات الأمنية هنا تحصين إضافي بلا أي اعتماديات خارجية.
// tsc مصفَّر (تكليف 29) فُرفع خافض أخطاء البناء — فحص الأنواع صار حاجزًا في البناء نفسه.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "no-referrer" },
  // الكاميرا والميكروفون واللصق من التطبيق نفسه حصرًا (ويب كام · ميكروفون · حافظة)
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), clipboard-write=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
]

// G7 — الأصول الساكنة التي يتجاوزها الوسيط (matcher في src/middleware.ts) تأخذ CSP
// ثابتة صارمة هنا، فلا مسار واحد بلا CSP. مستندات HTML ومسارات API يضبطها الوسيط
// (nonce لكل طلب / سياسة API بلا مصادر) — لا تتكرر الترويسة على المسار نفسه.
// worker-src/script-src 'self' تبقيان كي لا تنكسر أي سكربتات عاملة تُخدم من _next/static.
const STATIC_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ")

// يجب أن تطابق الاستثناءات في matcher الوسيط حرفيًا
const STATIC_SOURCES = [
  "/_next/static/:path*",
  "/_next/image",
  "/fonts/:path*",
  "/favicon.ico",
  "/logo.svg",
  "/robots.txt",
  "/seo/:path*",
]

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // G7 — لا ترويسة X-Powered-By تكشف إطار الخادم
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      ...STATIC_SOURCES.map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: STATIC_CSP }],
      })),
    ]
  },
};

export default nextConfig;
