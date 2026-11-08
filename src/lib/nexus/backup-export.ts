// §54 — بناء تصدير النسخة الاحتياطية وتطبيق الاستعادة — مكتبة مشتركة واحدة
// ============================================================
// استخراج جَرَاحي من مسار /api/prod/backup (نمط «مصدر حقيقة واحد — صفر
// ازدواج»): المسار القائم وعقد الدرع المشفّر §54 كلاهما يبنيان التصدير
// ويطبّقان الاستعادة من هنا حرفيًا — أي تحسين مستقبلي يُورث للطريقين.
import { db } from "@/lib/db"
import { store as deviceStore } from "@/lib/nexus/devices"
import { prodEmit } from "@/lib/nexus/productivity-bridge"

export const EXPORT_VERSION = 1

export async function buildExport() {
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

export interface RestoreResult {
  devices: number
  profiles: number
  pairs: number
  settings: boolean
  mode: "merge" | "replace"
}

/** تطبيق استعادة من تصدير nexuslink-backup — نفس سلوك المسار القائم حرفيًا */
export async function applyRestore(data: Record<string, unknown>, mode: "merge" | "replace"): Promise<RestoreResult> {
  const result = { devices: 0, profiles: 0, pairs: 0, settings: false, mode }

  // 1) الأجهزة الموثوقة — إعادة الأجهزة المفقودة وضمان الثقة
  const devices = (data.devices as { id: string; name: string; kind: string; trusted?: boolean; pairedAt?: number }[] | undefined) ?? []
  const reg = deviceStore()
  for (const dv of devices) {
    const existing = reg.devices.find((x) => x.id === dv.id)
    if (!existing) {
      // جهاز من النسخة الاحتياطية غير موجود حالياً → يُعاد بإعدادات افتراضية سليمة
      reg.devices.push({
        id: dv.id, name: dv.name, kind: dv.kind as never, state: "offline",
        mode: "wifi", ip: "192.168.1.9", battery: 80,
        storageTotal: 128 * 1024 ** 3, storageUsed: 64 * 1024 ** 3,
        lastSeen: Date.now(), rttMs: 25, pairedAt: dv.pairedAt ?? Date.now(), trusted: true,
      })
      result.devices++
    } else if (dv.trusted) {
      existing.trusted = true
      result.devices++
    }
  }

  // 2) ملفات التعريف
  const profiles = (data.profiles as Record<string, unknown>[] | undefined) ?? []
  if (mode === "replace") {
    const keepBuiltin = await db.netProfile.findMany({ where: { builtin: true } })
    await db.netProfile.deleteMany({ where: { builtin: false } })
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

  prodEmit("prod:restored", { ...result, at: Date.now() })
  prodEmit("prod:log", { id: String(Date.now()), text: `استعادة (${mode === "replace" ? "استبدال" : "دمج"}): ${result.devices} جهاز، ${result.profiles} ملف تعريف، ${result.pairs} زوج مزامنة`, kind: "ok", at: Date.now() })
  return result
}
