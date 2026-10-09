// تشغيل جسر التحكم عن بُعد (idempotent) — يُستدعى من الصفحتين عند الإقلاع
import { ensureRemoteBridge, remoteBridgeStatus } from "@/lib/nexus/remote-bridge"

export const dynamic = "force-dynamic"

export async function GET() {
  const status = ensureRemoteBridge()
  return Response.json({ ok: true, ...status })
}

export async function POST() {
  const status = ensureRemoteBridge()
  return Response.json({ ok: true, ...status })
}
