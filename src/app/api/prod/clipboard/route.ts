// الحافظة الموحدة — قائمة/إضافة/مسح
// FA-clipboard-sync: السجل التعاقدي = آخر 50 عنصرًا (عقد §11)
import { promises as fs } from "fs"
import path from "path"
import { db } from "@/lib/db"
import { resolveSafe } from "@/lib/nexus/fs-server"
import { prodEmit } from "@/lib/nexus/productivity-bridge"
import { syncDeviceName } from "@/lib/nexus/sync-engine"
import { writeServerAudit } from "@/lib/nexus/desktop-hardening"

export const dynamic = "force-dynamic"

export async function GET() {
  const items = await db.prodClip.findMany({ orderBy: { createdAt: "desc" }, take: 50 })
  return Response.json({
    items: items.map((i) => ({ ...i, createdAt: i.createdAt.getTime() })),
  })
}

export async function POST(req: Request) {
  const d = await req.json().catch(() => null)
  if (!d) return Response.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 })

  const deviceId = d.deviceId || "pc-office"
  const item = await db.prodClip.create({
    data: {
      deviceId,
      deviceName: d.deviceName || syncDeviceName(deviceId),
      kind: d.kind || "text",
      content: (d.content || "").slice(0, 4_000_000),
      fileName: d.fileName || null,
      filePath: d.filePath || null,
      size: d.size || (d.content?.length ?? 0),
      mode: d.mode || "manual",
    },
  })
  prodEmit("clip:new", { ...item, createdAt: item.createdAt.getTime() })
  // FA-harden (عقد §16) — تدقيق الحافظة (أصل: هاتف/ويب/المراقب الأصلي)
  void writeServerAudit({
    action: "clipboard",
    detail: `مشاركة حافظة (${item.kind}${item.size ? `, ${item.size} بايت` : ""}) — وضع ${item.mode}`,
    actor: item.deviceName || item.deviceId,
    deviceId: item.deviceId,
  }).catch(() => null)
  return Response.json({ ok: true, item: { ...item, createdAt: item.createdAt.getTime() } })
}

export async function DELETE() {
  await db.prodClip.deleteMany({})
  prodEmit("clip:cleared", { at: Date.now() })
  return Response.json({ ok: true })
}

/** استلام ملف فعلي: نسخ بايتات الملف من جهاز المصدر إلى تنزيلات الكمبيوتر */
export async function PUT(req: Request) {
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const item = await db.prodClip.findUnique({ where: { id } })
  if (!item || item.kind !== "file" || !item.filePath) {
    return Response.json({ ok: false, error: "عنصر غير صالح" }, { status: 404 })
  }
  try {
    const src = resolveSafe(item.deviceId, item.filePath)
    const dstDir = resolveSafe("pc-office", "/Downloads")
    let target = path.join(dstDir, item.fileName || path.basename(item.filePath))
    // اسم بديل عند وجود ملف بنفس الاسم
    for (let i = 1; i < 50; i++) {
      try {
        await fs.access(target)
        const dot = (item.fileName || "").lastIndexOf(".")
        const stem = dot > 0 ? (item.fileName || "").slice(0, dot) : item.fileName || "ملف"
        const ext = dot > 0 ? (item.fileName || "").slice(dot) : ""
        target = path.join(dstDir, `${stem} (${i})${ext}`)
      } catch { break }
    }
    await fs.copyFile(src, target)
    const st = await fs.stat(target)
    const updated = await db.prodClip.update({ where: { id }, data: { received: true } })
    prodEmit("clip:received", { id, name: path.basename(target), bytes: st.size, at: Date.now() })
    return Response.json({ ok: true, name: path.basename(target), bytes: st.size, item: updated })
  } catch (e) {
    return Response.json({ ok: false, error: "تعذر نسخ الملف: " + String(e) }, { status: 500 })
  }
}
