// تشغيل محرك الروتينات (idempotent) — يُستدعى من الصفحات عند الإقلاع (عقد §26)
import { ensureAutomationBridge, automationBridgeStatus } from "@/lib/nexus/automation-bridge"

export const dynamic = "force-dynamic"

export async function GET() {
  const status = ensureAutomationBridge()
  return Response.json({ ok: true, ...status })
}

export async function POST() {
  const status = ensureAutomationBridge()
  return Response.json({ ok: true, ...status })
}
