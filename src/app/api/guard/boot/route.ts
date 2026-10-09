// تشغيل جسر الحماية (idempotent) — يُستدعى من الصفحات عند الإقلاع
import { ensureGuardBridge, guardBridgeStatus } from "@/lib/nexus/guard-bridge"

export const dynamic = "force-dynamic"

export async function GET() {
  const status = ensureGuardBridge()
  return Response.json({ ok: true, ...status })
}

export async function POST() {
  const status = ensureGuardBridge()
  return Response.json({ ok: true, ...status })
}
