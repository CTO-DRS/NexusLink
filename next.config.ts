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

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
