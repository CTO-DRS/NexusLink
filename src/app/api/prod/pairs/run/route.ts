// تشغيل مزامنة زوج الآن
import { runPairSync } from "@/lib/nexus/sync-engine"
import { prodEmit } from "@/lib/nexus/productivity-bridge"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const r = await runPairSync(id, prodEmit)
  return Response.json({ ok: r.ok, copied: r.copied, bytes: r.bytes })
}
