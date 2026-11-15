// تشغيل جسر الأمان (idempotent) + بذر الصلاحيات الافتراضية
import { ensureSecurityBridge, securityBridgeStatus } from "@/lib/nexus/security-bridge"
import { db } from "@/lib/db"
import { isDemoMode } from "@/lib/nexus/demo-mode"

export const dynamic = "force-dynamic"

const DEFAULT_FEATURES = ["file_transfer", "clipboard", "remote_input", "notifications", "media", "system_commands"]

async function seedPerms() {
  // G2: الصلاحيات المزروعة تخص جهاز العرض الوهمي galaxy-s24 — للعرض التوضيحي فقط
  if (!isDemoMode()) return
  const count = await db.permRule.count()
  if (count > 0) return
  // الهاتف الموثوق: كل الميزات مفعّلة افتراضياً (يمكن إيقاف أي واحدة لاحقاً)
  await db.permRule.createMany({
    data: DEFAULT_FEATURES.map((feature) => ({ feature, deviceId: "galaxy-s24", enabled: true })),
  })
}

export async function GET() {
  const status = ensureSecurityBridge()
  await seedPerms()
  return Response.json({ ok: true, ...status })
}

export async function POST() {
  const status = ensureSecurityBridge()
  await seedPerms()
  return Response.json({ ok: true, ...status })
}
