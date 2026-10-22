// النسخ الاحتياطي والاستعادة الشاملة — إعدادات + أجهزة موثوقة + ملفات تعريف + أزواج مزامنة
import { db } from "@/lib/db"
import { store as deviceStore } from "@/lib/nexus/devices"
import { prodEmit } from "@/lib/nexus/productivity-bridge"

export const dynamic = "force-dynamic"

const EXPORT_VERSION = 1

async function buildExport() {
  const state = await db.prodState.findUnique({ where: { id: "main" } })
  const profiles = await db.netProfile.findMany()
  const pairs = await db.syncPair.findMany()
  const devices = deviceStore().devices.map((d) => ({
    id: d.id, name: d.name, kind: d.kind, trusted: d.trusted, pairedAt: d.pairedAt,
  }))
  return {
    app: "NexusLink", type: "nexuslink-backup", version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      clipMode: state?.clipMode ?? "auto",
      photoSync: state?.photoSync ?? true,
      photoTarget: state?.photoTarget ?? "/Pictures/FromPhone",
      network: state?.network ?? "منزل-5GHz",
      activeProfileName: profiles.find((p) => p.id === state?.activeProfileId)?.name ?? null,
    },
    devices,
    profiles: profiles.map((p) => ({
      name: p.name, icon: p.icon, networkName: p.networkName,
      photoSync: p.photoSync, notifs: p.notifs, clipboard: p.clipboard, folderSync: p.folderSync, builtin: p.builtin,
    })),
    pairs: pairs.map((p) => ({
      deviceA: p.deviceA, folderA: p.folderA, deviceB: p.deviceB, folderB: p.folderB,
      active: p.active, autoSync: p.autoSync,
    })),
  }
}

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
    const result = { devices: 0, profiles: 0, pairs: 0, settings: false }

    // 1) الأجهزة الموثوقة — إعادة الأجهزة المفقودة وضمان الثقة
    const devices = (data.devices as { id: string; name: string; kind: string; trusted?: boolean; pairedAt?: number }[] | undefined) ?? []
    const reg = deviceStore()
    for (const dv of devices) {
      const existing = reg.devices.find((x) => x.id === dv.id)
      if (!existing) {
        // جهاز من النسخة الاحتياطية غير موجود حالياً → يُعاد بإعدادات افتراضية سليمة
        reg.devices.push({
          id: dv.id, name: dv.name, kind: dv.kind as any, state: "offline",
          mode: "wifi", ip: "192.168.1.9", battery: 80,
          storageTotal: 128 * 1024 ** 3, storageUsed: 64 * 1024 ** 3,
          lastSeen: Date.now(), rttMs: 25, pairedAt: dv.pairedAt ?? Date.now(), trusted: true,
        } as any)
        result.devices++
      } else if (dv.trusted) {
        (existing as any).trusted = true
        result.devices++
      }
    }

    // 2) ملفات التعريف
    const profiles = (data.profiles as Record<string, unknown>[] | undefined) ?? []
    if (mode === "replace") {
      const keepBuiltin = await db.netProfile.findMany({ where: { builtin: true } })
      await db.netProfile.deleteMany({ where: { builtin: false } })
      result.profiles -= 0
      for (const p of keepBuiltin) {
        const src = profiles.find((x) => x.name === p.name)
        if (src) {
          await db.netProfile.update({ where: { id: p.id }, data: { ...(src as never) } })
        }
      }
    }
    for (const p of profiles) {
      const name = String(p.name ?? "")
      if (!name) continue
      const found = await db.netProfile.findFirst({ where: { name } })
      const payload = {
        icon: String(p.icon ?? "laptop"),
        networkName: String(p.networkName ?? ""),
        photoSync: p.photoSync !== false,
        notifs: p.notifs !== false,
        clipboard: p.clipboard !== false,
        folderSync: p.folderSync !== false,
      }
      if (found) await db.netProfile.update({ where: { id: found.id }, data: payload })
      else await db.netProfile.create({ data: { name, ...payload } })
      result.profiles++
    }

    // 3) أزواج المزامنة
    const pairs = (data.pairs as Record<string, unknown>[] | undefined) ?? []
    if (mode === "replace") await db.syncPair.deleteMany({})
    for (const p of pairs) {
      const key = { deviceA: String(p.deviceA ?? ""), folderA: String(p.folderA ?? ""), deviceB: String(p.deviceB ?? ""), folderB: String(p.folderB ?? "") }
      if (!key.deviceA || !key.folderB) continue
      const dup = await db.syncPair.findFirst({ where: key })
      if (!dup) {
        await db.syncPair.create({ data: { ...key, active: p.active !== false, autoSync: p.autoSync !== false } })
        result.pairs++
      }
    }

    // 4) الإعدادات
    const settings = (data.settings ?? {}) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if (typeof settings.clipMode === "string") patch.clipMode = settings.clipMode
    if (typeof settings.photoSync === "boolean") patch.photoSync = settings.photoSync
    if (typeof settings.photoTarget === "string") patch.photoTarget = settings.photoTarget
    if (typeof settings.network === "string") {
      const prof = await db.netProfile.findFirst({ where: { networkName: settings.network } })
      patch.network = settings.network
      patch.activeProfileId = prof?.id ?? null
      patch.notifsPaused = prof ? !prof.notifs : false
    }
    if (Object.keys(patch).length) {
      await db.prodState.update({ where: { id: "main" }, data: patch })
      result.settings = true
    }

    prodEmit("prod:restored", { ...result, mode, at: Date.now() })
    prodEmit("prod:log", { id: String(Date.now()), text: `استعادة (${mode === "replace" ? "استبدال" : "دمج"}): ${result.devices} جهاز، ${result.profiles} ملف تعريف، ${result.pairs} زوج مزامنة`, kind: "ok", at: Date.now() })
    return Response.json({ ok: true, ...result, mode })
  }

  return Response.json({ ok: false, error: "إجراء غير معروف" }, { status: 400 })
}

export async function DELETE(req: Request) {
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  await db.prodBackup.delete({ where: { id } })
  return Response.json({ ok: true })
}
