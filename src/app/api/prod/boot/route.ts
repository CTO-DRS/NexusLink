// تشغيل جسر الإنتاجية + البذور (idempotent) — يُستدعى من الصفحات عند الإقلاع
import { ensureProdBridge, prodBridgeStatus } from "@/lib/nexus/productivity-bridge"
import { ensureProdSeed } from "@/lib/nexus/prod-seed"

export const dynamic = "force-dynamic"

export async function GET() {
  const status = ensureProdBridge()
  try { await ensureProdSeed() } catch { /* ignore */ }
  return Response.json({ ok: true, ...status })
}

export async function POST() {
  const status = ensureProdBridge()
  try { await ensureProdSeed() } catch { /* ignore */ }
  return Response.json({ ok: true, ...status })
}
