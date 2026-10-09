// التسليم — أكمل من حيث توقفت + فتح رابط على جهاز آخر
import { db } from "@/lib/db"
import { prodEmit } from "@/lib/nexus/productivity-bridge"
import { syncDeviceName } from "@/lib/nexus/sync-engine"

export const dynamic = "force-dynamic"

export async function GET() {
  const items = await db.handoffItem.findMany({ orderBy: { createdAt: "desc" }, take: 40 })
  return Response.json({ items: items.map((i) => ({ ...i, createdAt: i.createdAt.getTime(), openedAt: i.openedAt?.getTime() ?? null })) })
}

/** إنشاء عنصر تسليم (من الهاتف أو الكمبيوتر) وبثّه فوراً */
export async function POST(req: Request) {
  const d = await req.json().catch(() => null)
  const url = String(d?.url || "").trim()
  if (!url || !/^(https?:\/\/|nexu)/i.test(url)) {
    return Response.json({ ok: false, error: "أدخل رابطاً صالحاً" }, { status: 400 })
  }
  const deviceId = d.deviceId || "galaxy-s24"
  const item = await db.handoffItem.create({
    data: {
      deviceId,
      deviceName: d.deviceName || syncDeviceName(deviceId),
      kind: d.kind || "link",
      title: d.title || url.replace(/^https?:\/\//, "").slice(0, 60),
      url,
      position: Number(d.position) || 0,
    },
  })
  const payload = { ...item, createdAt: item.createdAt.getTime() }
  prodEmit("hand:new", payload)
  return Response.json({ ok: true, item: payload })
}

/** تعليم عنصر كمفتوح (أُكمل) على جهاز */
export async function PATCH(req: Request) {
  const { id, openedOn } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const item = await db.handoffItem.update({
    where: { id },
    data: { status: "opened", openedOn: openedOn || "PC-OFFICE", openedAt: new Date() },
  })
  prodEmit("hand:opened", { id, openedOn: item.openedOn, at: Date.now() })
  prodEmit("prod:log", { id: String(Date.now()), text: `أُكمل على ${item.openedOn}: «${item.title.slice(0, 36)}»`, kind: "ok", at: Date.now() })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  await db.handoffItem.delete({ where: { id } })
  return Response.json({ ok: true })
}
