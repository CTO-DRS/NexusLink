// أزواج مزامنة المجلدات — CRUD
import { db } from "@/lib/db"
import { resolveSafe, listDir } from "@/lib/nexus/fs-server"
import { prodEmit } from "@/lib/nexus/productivity-bridge"

export const dynamic = "force-dynamic"

export async function GET() {
  const pairs = await db.syncPair.findMany({
    orderBy: { createdAt: "asc" },
    include: { events: { orderBy: { at: "desc" }, take: 12 } },
  })
  return Response.json({ pairs })
}

export async function POST(req: Request) {
  const d = await req.json().catch(() => null)
  if (!d?.deviceA || !d?.folderA || !d?.deviceB || !d?.folderB) {
    return Response.json({ ok: false, error: "حدّد الجهازين والمجلدين" }, { status: 400 })
  }
  if (d.deviceA === d.deviceB && d.folderA === d.folderB) {
    return Response.json({ ok: false, error: "اختر مجلدين مختلفين" }, { status: 400 })
  }
  try {
    // تحقق من وجود المجلدين (أنشئهما إن لم يوجدوا)
    for (const [dev, folder] of [[d.deviceA, d.folderA], [d.deviceB, d.folderB]] as const) {
      const abs = resolveSafe(dev, folder)
      await (await import("fs")).promises.mkdir(abs, { recursive: true })
    }
  } catch {
    return Response.json({ ok: false, error: "مسار غير صالح" }, { status: 400 })
  }
  const pair = await db.syncPair.create({
    data: {
      deviceA: d.deviceA, folderA: d.folderA,
      deviceB: d.deviceB, folderB: d.folderB,
      active: d.active !== false, autoSync: d.autoSync !== false,
    },
  })
  prodEmit("prod:log", { id: String(Date.now()), text: `زوج مزامنة جديد: ${d.folderA} ↔ ${d.folderB}`, kind: "ok", at: Date.now() })
  return Response.json({ ok: true, pair })
}

export async function PATCH(req: Request) {
  const d = await req.json().catch(() => null)
  if (!d?.id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const data: Record<string, unknown> = {}
  if (typeof d.active === "boolean") data.active = d.active
  if (typeof d.autoSync === "boolean") data.autoSync = d.autoSync
  const pair = await db.syncPair.update({ where: { id: d.id }, data })
  return Response.json({ ok: true, pair })
}

export async function DELETE(req: Request) {
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  await db.syncPair.delete({ where: { id } })
  return Response.json({ ok: true })
}

/** استعراض مجلدات جهاز لاختيار زوج المزامنة */
export async function PUT(req: Request) {
  const { deviceId, path } = await req.json().catch(() => ({}))
  if (!deviceId) return Response.json({ ok: false, error: "جهاز مفقود" }, { status: 400 })
  try {
    const entries = await listDir(deviceId, path || "/")
    const dirs = entries.filter((e) => e.type === "dir").map((e) => ({ name: e.name, path: e.path }))
    return Response.json({ ok: true, dirs })
  } catch {
    return Response.json({ ok: false, error: "تعذر قراءة المجلد" }, { status: 400 })
  }
}
