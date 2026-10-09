// تشغيل جسر الوسائط والكاميرا (idempotent) — يُستدعى من الصفحات عند الإقلاع
import { ensureMediaBridge, mediaBridgeStatus } from "@/lib/nexus/media-bridge"

export const dynamic = "force-dynamic"

export async function GET() {
  const status = ensureMediaBridge()
  return Response.json({ ok: true, ...status })
}

export async function POST() {
  const status = ensureMediaBridge()
  return Response.json({ ok: true, ...status })
}
