// NexusLink — حالة موحدة لسطح المكتب (Tauri): إقلاع كل الجسور + إشارة حياة الهاتف + أحداث الطبقة الأصلية
// ============================================================
// نقطة واحدة يستعلمها مدير العمليات في تطبيق سطح المكتب كل ثانيتين (كل 5 دورات ≈ 10 ثوانٍ):
// 1) تضمن إقلاع كل الجسور الداخلية (idempotent — نفس آلية boot في الصفحات).
// 2) تعيد حالة كل جسر + إشارة «الهاتف متصل» من منارة القرب (phoneGuardOnline).
// هذا يجعل أيقونة الـ Tray (متصل/منتظر) تعتمد على نفس إشارة الحياة التي
// يستخدمها محرك الحماية — لا مصدر حقيقة ثانٍ.
// 3) حزمة desktop التكميلية (كلها إضافية/اختيارية للعملاء القديمة):
//    - shortcuts: خريطة الاختصارات العالمية (يديرها المخزن المشترك عبر /api/desktop/shortcuts)
//    - transfers: مهام الاستقبال المنتهية (اتجاه in) — تُشغّل إشعار «حفظ في» الأصلي
//    - notifs: آخر إشعارات الهاتف الجديدة — تُشغّل إشعارات النظام بأزرار (فتح/رد)
//    - agentId: هوية الوكيل الحقيقي المتصل (هدف إرسال الملفات من سطح المكتب)
import { promises as fsSyncPromises } from "fs"
import path from "path"
import { ensureMediaBridge } from "@/lib/nexus/media-bridge"
import { ensureGuardBridge, getAgentDeviceId } from "@/lib/nexus/guard-bridge"
import { ensureProdBridge } from "@/lib/nexus/productivity-bridge"
import { ensureRemoteBridge } from "@/lib/nexus/remote-bridge"
import { ensureSecurityBridge } from "@/lib/nexus/security-bridge"
import { jobs } from "@/lib/nexus/transfer-engine"
import { db } from "@/lib/db"
import { serNotification } from "@/lib/nexus/comms-server"
import { readShortcuts } from "@/lib/nexus/desktop-shortcuts"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const media = ensureMediaBridge()
    const guard = ensureGuardBridge()
    const prod = ensureProdBridge()
    const remote = ensureRemoteBridge()
    const security = ensureSecurityBridge()

    // أحداث الطبقة الأصلية — كل استدعاء محمي (فشلها لا يُسقط الحالة الأساسية)
    const transfers = [...jobs().values()]
      .filter((j) => j.direction === "in" && j.status === "done")
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5)
      .map((j) => ({
        id: j.id,
        fileName: j.fileName,
        destPath: j.destPath,
        totalBytes: j.totalBytes,
        startedAt: j.startedAt,
      }))
    let notifs: ReturnType<typeof serNotification>[] = []
    try {
      const rows = await db.nexusNotification.findMany({
        where: { status: "new" },
        orderBy: { createdAt: "desc" },
        take: 8,
      })
      notifs = rows.map(serNotification)
    } catch {
      /* قاعدة البيانات غير جاهزة بعد — لا إشعارات الآن */
    }

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
      desktop: {
        agentId: getAgentDeviceId(),
        shortcuts: await readShortcuts(),
        transfers,
        notifs,
      },
    })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "status failed" },
      { status: 500 },
    )
  }
}
