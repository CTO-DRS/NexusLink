// NexusLink — حالة موحدة لسطح المكتب (Tauri): إقلاع كل الجسور + إشارة حياة الهاتف
// ============================================================
// نقطة واحدة يستعلمها مدير العمليات في تطبيق سطح المكتب كل 5 ثوانٍ:
// 1) تضمن إقلاع كل الجسور الداخلية (idempotent — نفس آلية boot في الصفحات).
// 2) تعيد حالة كل جسر + إشارة «الهاتف متصل» من منارة القرب (phoneGuardOnline).
// هذا يجعل أيقونة الـ Tray (متصل/منتظر) تعتمد على نفس إشارة الحياة التي
// يستخدمها محرك الحماية — لا مصدر حقيقة ثانٍ.
import { ensureMediaBridge } from "@/lib/nexus/media-bridge"
import { ensureGuardBridge } from "@/lib/nexus/guard-bridge"
import { ensureProdBridge } from "@/lib/nexus/productivity-bridge"
import { ensureRemoteBridge } from "@/lib/nexus/remote-bridge"
import { ensureSecurityBridge } from "@/lib/nexus/security-bridge"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const media = ensureMediaBridge()
    const guard = ensureGuardBridge()
    const prod = ensureProdBridge()
    const remote = ensureRemoteBridge()
    const security = ensureSecurityBridge()

    return Response.json({
      ok: true,
      proto: "Nexus/1.2",
      ts: Date.now(),
      bridges: { media, guard, prod, remote, security },
      phone: {
        online: guard?.prox?.phoneGuardOnline ?? false,
        state: guard?.prox?.state ?? null,
        rssi: guard?.prox?.rssi ?? null,
      },
    })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "status failed" },
      { status: 500 },
    )
  }
}
