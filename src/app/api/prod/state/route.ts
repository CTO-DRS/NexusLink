// حالة الإنتاجية العامة — قراءة/تحديث (وضع الحافظة، مزامنة الصور)
import { db } from "@/lib/db"
import { prodEmit } from "@/lib/nexus/productivity-bridge"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET() {
  const state = await db.prodState.findUnique({ where: { id: "main" } })
  return Response.json({ state })
}

export async function PATCH(req: Request) {
  // FA-22 (تكليف 51): قلب وضع الحافظة/مزامنة الصور فعل المالك — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "prod.denied", "prod-state")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  const d = await req.json().catch(() => null)
  if (!d) return Response.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 })
  const data: Record<string, unknown> = {}
  if (d.clipMode === "auto" || d.clipMode === "manual") data.clipMode = d.clipMode
  if (typeof d.photoSync === "boolean") data.photoSync = d.photoSync
  const state = await db.prodState.update({ where: { id: "main" }, data })
  if (d.clipMode) {
    prodEmit("prod:log", { id: String(Date.now()), text: `وضع الحافظة الموحدة: ${d.clipMode === "auto" ? "تلقائي — النسخ بين الأجهزة بلا ضغطة" : "يدوي — من قائمة النسخ"}`, kind: "info", at: Date.now() })
  }
  return Response.json({ ok: true, state })
}
