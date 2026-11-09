// تشغيل مزامنة زوج الآن
import { runPairSync } from "@/lib/nexus/sync-engine"
import { prodEmit } from "@/lib/nexus/productivity-bridge"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  // FA-16 (تكليف 43): pair-sync-run فعل المالك على الكمبيوتر — loopback حصرًا
  if (!guardPcOnly(req, "prod.denied", "pair-sync-run")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }

  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const r = await runPairSync(id, prodEmit)
  return Response.json({ ok: r.ok, copied: r.copied, bytes: r.bytes })
}
