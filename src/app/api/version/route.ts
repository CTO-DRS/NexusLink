import { NextResponse } from "next/server"

// Version + update channel — the ONLY outbound-checkable endpoint in NexusLink.
// Auto-update policy: silent download in background, install on next restart,
// signature-verified (minisign). Fully disableable (offline-only mode).
export async function GET() {
  return NextResponse.json(
    {
      current: "2.4.1",
      latest: "2.4.1",
      channel: "stable",
      updatedAt: "2026-10-09",
      portable: true,
      signature: "minisign (Ed25519)",
      changelog: [
        {
          version: "2.4.1",
          date: "2026-10-09",
          items: [
            "المرحلة 11: Onboarding تفاعلي + i18n عربي/إنجليزي + إتاحة كاملة",
            "اختصارات كيبورد قابلة للتخصيص + لوحة أوامر (Ctrl+K)",
            "اختبار سرعة الشبكة + أداة تشخيص + طرفية CLI",
          ],
        },
        {
          version: "2.4.0",
          date: "2026-10-08",
          items: [
            "المرحلة 10: E2E حقيقي X25519 + AES-256-GCM على كل القنوات",
            "سجل تدقيق كامل + مسح آمن + وضع التخفي",
          ],
        },
        {
          version: "2.3.0",
          date: "2026-10-07",
          items: [
            "المرحلة 9: الحافظة الموحدة + المزامنة الثنائية + استكمال الجلسات",
          ],
        },
      ],
      t: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
