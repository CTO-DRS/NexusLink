// النسخ الاحتياطي والاستعادة الشاملة — إعدادات + أجهزة موثوقة + ملفات تعريف + أزواج مزامنة
// §54: بناء التصدير وتطبيق الاستعادة انتقلا للمكتبة المشتركة backup-export.ts
// (مصدر حقيقة واحد — مسار prod والعقد المشفّر §54 كلاهما منها حرفيًا)
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { buildExport, applyRestore } from "@/lib/nexus/backup-export"
import { prodEmit } from "@/lib/nexus/productivity-bridge"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get("download") === "1") {
    const data = await buildExport()
    const json = JSON.stringify(data, null, 2)
    const date = new Date().toISOString().slice(0, 10)
    return new Response(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="nexuslink-backup-${date}.json"`,
      },
    })
  }
  const snapshots = await db.prodBackup.findMany({
    orderBy: { createdAt: "desc" }, take: 12,
    select: { id: true, label: true, sizeBytes: true, devicesCount: true, profilesCount: true, pairsCount: true, createdAt: true },
  })
  return Response.json({
    snapshots: snapshots.map((s) => ({ ...s, createdAt: s.createdAt.getTime() })),
    preview: await buildExport(),
  })
}

export async function POST(req: Request) {
  const d = await req.json().catch(() => null)
  if (!d?.action) return Response.json({ ok: false, error: "إجراء مفقود" }, { status: 400 })

  // ==== إنشاء نقطة استعادة داخلية ====
  if (d.action === "snapshot") {
    const data = await buildExport()
    const json = JSON.stringify(data)
    const label = d.label || `نقطة استعادة ${new Date().toLocaleString("ar", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
    const snap = await db.prodBackup.create({
      data: {
        label,
        sizeBytes: json.length,
        devicesCount: data.devices.length,
        profilesCount: data.profiles.length,
        pairsCount: data.pairs.length,
        dataJson: json,
      },
    })
    prodEmit("prod:log", { id: String(Date.now()), text: `نقطة استعادة أُنشئت: ${label}`, kind: "ok", at: Date.now() })
    return Response.json({ ok: true, snapshot: { ...snap, dataJson: undefined, createdAt: snap.createdAt.getTime() } })
  }

  // ==== استعادة ====
  if (d.action === "restore") {
    let data: Record<string, unknown> | null = null
    if (d.snapshotId) {
      const snap = await db.prodBackup.findUnique({ where: { id: d.snapshotId } })
      if (!snap) return Response.json({ ok: false, error: "نقطة الاستعادة غير موجودة" }, { status: 404 })
      data = JSON.parse(snap.dataJson) as Record<string, unknown>
    } else if (d.data) {
      data = d.data as Record<string, unknown>
    }
    if (!data || data.type !== "nexuslink-backup") {
      return Response.json({ ok: false, error: "ملف نسخة احتياطية غير صالح (NexusLink Backup متوقع)" }, { status: 400 })
    }

    const mode: "merge" | "replace" = d.mode === "replace" ? "replace" : "merge"
    const result = await applyRestore(data, mode)
    return Response.json({ ok: true, ...result })
  }

  return Response.json({ ok: false, error: "إجراء غير معروف" }, { status: 400 })
}

export async function DELETE(req: Request) {
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  await db.prodBackup.delete({ where: { id } })
  return Response.json({ ok: true })
}
