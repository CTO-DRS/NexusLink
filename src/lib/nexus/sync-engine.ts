// NexusLink — محرك المزامنة الحقيقي (المرحلة 9)
// ============================================================
// مزامنة مجلدات ثنائية الاتجاه بنسخ بايتات فعلية بين أجهزة افتراضية
// (كل جهاز مجلد حقيقي على القرص) + مزامنة الصور الجديدة تلقائياً.
import { promises as fs } from "fs"
import path from "path"
import { db } from "@/lib/db"
import { store as deviceStore } from "./devices"
import { DEVICE_ROOTS, resolveSafe } from "./fs-server"

export interface SyncEmit {
  (event: string, payload: Record<string, unknown>): void
}

const noEmit: SyncEmit = () => {}

function deviceOnline(id: string): boolean {
  const d = deviceStore().devices.find((x) => x.id === id)
  return !!d && d.state === "connected"
}

function deviceName(id: string): string {
  return deviceStore().devices.find((x) => x.id === id)?.name ?? id
}

interface FileMapEntry {
  rel: string
  abs: string
  size: number
  mtime: number
}

/** بناء خريطة كل الملفات تحت مجلد (نسبي ← بيانات) */
async function buildFileMap(deviceId: string, folder: string): Promise<Map<string, FileMapEntry>> {
  const map = new Map<string, FileMapEntry>()
  const rootAbs = resolveSafe(deviceId, folder)
  await walkAbs(rootAbs, rootAbs, map)
  return map
}

async function walkAbs(rootAbs: string, dirAbs: string, map: Map<string, FileMapEntry>) {
  let items: import("fs").Dirent[]
  try {
    items = await fs.readdir(dirAbs, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of items) {
    if (d.name.startsWith(".") || d.name === "Thumbs.db" || d.name === ".DS_Store") continue
    const full = path.join(dirAbs, d.name)
    const rel = path.relative(rootAbs, full).replace(/\\/g, "/")
    if (d.isDirectory()) {
      await walkAbs(rootAbs, full, map)
    } else {
      try {
        const st = await fs.stat(full)
        map.set(rel, { rel, abs: full, size: st.size, mtime: st.mtimeMs })
      } catch { /* skip */ }
    }
  }
}

async function ensureDirFor(absFile: string) {
  await fs.mkdir(path.dirname(absFile), { recursive: true })
}

/** نسخ بمزامنة: يكتب فوق الوجهة دائماً (نفس المسار النسبي) ويحفظ زمن التعديل لمنع الترحال */
async function syncCopy(src: FileMapEntry, dstAbs: string) {
  await ensureDirFor(dstAbs)
  await fs.copyFile(src.abs, dstAbs)
  // حفظ mtime الأصلي — ليُعتبر الملفان متطابقين في الجولة التالية
  await fs.utimes(dstAbs, new Date(src.mtime), new Date(src.mtime))
}

/**
 * تشغيل مزامنة ثنائية الاتجاه لزوج معيّن — نسخ حقيقي للبايتات.
 * القاعدة: الأحدث يفوز، والموجود في طرف فقط يُنسخ للطرف الآخر.
 */
export async function runPairSync(pairId: string, emit: SyncEmit = noEmit) {
  const pair = await db.syncPair.findUnique({ where: { id: pairId } })
  if (!pair || pair.running) return { ok: false, copied: 0, bytes: 0 }

  await db.syncPair.update({ where: { id: pairId }, data: { running: true, progress: 0 } })

  const onlineA = deviceOnline(pair.deviceA)
  const onlineB = deviceOnline(pair.deviceB)
  if (!onlineA || !onlineB) {
    await db.syncPair.update({ where: { id: pairId }, data: { running: false, progress: 0 } })
    emit("sync:done", { pairId, skipped: true, reason: offlineReason(onlineA, onlineB, pair) })
    return { ok: false, copied: 0, bytes: 0 }
  }

  try {
    const mapA = await buildFileMap(pair.deviceA, pair.folderA)
    const mapB = await buildFileMap(pair.deviceB, pair.folderB)
    const rels = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort()

    const rootB = resolveSafe(pair.deviceB, pair.folderB)
    const rootA = resolveSafe(pair.deviceA, pair.folderA)
    await fs.mkdir(rootA, { recursive: true })
    await fs.mkdir(rootB, { recursive: true })

    const lastSync = pair.lastSyncAt?.getTime() ?? 0
    let copied = 0
    let bytes = 0
    const events: { relPath: string; action: string; bytes: number }[] = []

    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i]
      const a = mapA.get(rel)
      const b = mapB.get(rel)
      let action: string | null = null
      let src: FileMapEntry | null = null
      let dstAbs = ""

      if (a && !b) {
        // موجود في A فقط → انسخ A→B
        action = "new-A2B"
        src = a
        dstAbs = path.join(rootB, rel)
      } else if (!a && b) {
        action = "new-B2A"
        src = b
        dstAbs = path.join(rootA, rel)
      } else if (a && b) {
        if (a.size === b.size && Math.abs(a.mtime - b.mtime) < 1500) {
          continue // متطابقان
        }
        if (a.mtime > b.mtime) {
          action = "upd-A2B"
          src = a
          dstAbs = path.join(rootB, rel)
        } else {
          action = "upd-B2A"
          src = b
          dstAbs = path.join(rootA, rel)
        }
        // تعارض: الطرفان تغيّرا منذ آخر مزامنة → نختار الأحدث لكن نسجل التعارض
        if (a.mtime > lastSync && b.mtime > lastSync && action) {
          action = action === "upd-A2B" ? "conflict" : "conflict"
        }
      }

      if (action && src && dstAbs) {
        await syncCopy(src, dstAbs)
        copied++
        bytes += src.size
        events.push({ relPath: rel, action, bytes: src.size })
        emit("sync:progress", {
          pairId, done: i + 1, total: rels.length, current: rel,
          action, copied, bytes,
        })
        // توقف قصير واقعي لتحديثات الواجهة
        if (copied % 3 === 0) await new Promise((r) => setTimeout(r, 120))
      }
    }

    await db.syncPair.update({
      where: { id: pairId },
      data: { running: false, progress: 100, lastSyncAt: new Date(), lastCount: copied, lastBytes: bytes },
    })
    if (events.length) {
      await db.syncEvent.createMany({
        data: events.map((e) => ({ pairId, relPath: e.relPath, action: e.action, bytes: e.bytes })),
      })
    }

    emit("sync:done", { pairId, copied, bytes, events, at: Date.now() })
    return { ok: true, copied, bytes, events }
  } catch (e) {
    await db.syncPair.update({ where: { id: pairId }, data: { running: false, progress: 0 } })
    emit("sync:done", { pairId, error: String(e) })
    return { ok: false, copied: 0, bytes: 0 }
  }
}

function offlineReason(a: boolean, b: boolean, pair: { deviceA: string; deviceB: string }): string {
  const names = []
  if (!a) names.push(deviceName(pair.deviceA))
  if (!b) names.push(deviceName(pair.deviceB))
  return `${names.join(" و ")} غير متصل — ستجري المزامنة تلقائياً عند عودته`
}

// ============================================================
// مزامنة الصور التلقائية — صور جديدة في كاميرا الهاتف تُنسخ للكمبيوتر
// ============================================================

export const PHOTO_SRC_DEVICE = "galaxy-s24"
export const PHOTO_SRC_DIR = "/DCIM/Camera"

export interface PhotoSyncResult {
  copied: number
  names: string[]
  bytes: number
  paused?: string
}

/** نبضة مزامنة الصور: فحص كاميرا الهاتف ونسخ الجديد إلى الكمبيوتر */
export async function photoSyncTick(emit: SyncEmit = noEmit): Promise<PhotoSyncResult> {
  const state = await db.prodState.findUnique({ where: { id: "main" } })
  if (!state) return { copied: 0, names: [], bytes: 0 }

  if (!state.photoSync) return { copied: 0, names: [], bytes: 0, paused: "مزامنة الصور متوقفة" }

  // الملف الشخصي يتحكم: (العمل = إشعارات فقط) يوقف مزامنة الصور
  if (state.activeProfileId) {
    const prof = await db.netProfile.findUnique({ where: { id: state.activeProfileId } })
    if (prof && !prof.photoSync) {
      return { copied: 0, names: [], bytes: 0, paused: `الملف الشخصي «${prof.name}» يوقف مزامنة الصور` }
    }
  }

  if (!deviceOnline(PHOTO_SRC_DEVICE)) {
    return { copied: 0, names: [], bytes: 0, paused: "الهاتف غير متصل" }
  }

  const srcRoot = resolveSafe(PHOTO_SRC_DEVICE, PHOTO_SRC_DIR)
  const targetRoot = resolveSafe("pc-office", state.photoTarget)
  let since = state.photoLastAt.getTime()
  const now = Date.now()

  let items: import("fs").Dirent[]
  try {
    items = await fs.readdir(srcRoot, { withFileTypes: true })
  } catch {
    return { copied: 0, names: [], bytes: 0 }
  }

  const fresh = items
    .filter((d) => d.isFile() && /\.(jpe?g|png)$/i.test(d.name))
    .map((d) => d.name)
  const results: PhotoSyncResult = { copied: 0, names: [], bytes: 0 }

  for (const name of fresh) {
    const abs = path.join(srcRoot, name)
    try {
      const st = await fs.stat(abs)
      if (st.mtimeMs <= since || st.mtimeMs > now + 5000) continue
      await fs.mkdir(targetRoot, { recursive: true })
      await fs.copyFile(abs, path.join(targetRoot, name))
      results.copied++
      results.names.push(name)
      results.bytes += st.size
      since = Math.max(since, st.mtimeMs)
      emit("photo:synced", { name, bytes: st.size, target: state.photoTarget, at: Date.now() })
    } catch { /* skip */ }
  }

  if (results.copied > 0) {
    await db.prodState.update({ where: { id: "main" }, data: { photoLastAt: new Date() } })
  }
  return results
}

/** توليد صورة جديدة على الهاتف (محاكاة التقاط) — ملف JPEG حقيقي عبر sharp */
export async function generatePhonePhoto(): Promise<{ name: string; bytes: number }> {
  const sharp = (await import("sharp")).default
  const w = 720 + Math.floor(Math.random() * 480)
  const h = 960
  const hue = Math.floor(Math.random() * 360)
  const stamp = new Date()
  const name = `IMG_${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}_${String(stamp.getHours()).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}${String(stamp.getSeconds()).padStart(2, "0")}.jpg`

  const scenes = [
    { stops: [{ stop: 0, color: `hsl(${hue},72%,62%)` }, { stop: 1, color: `hsl(${(hue + 60) % 360},68%,32%)` }], label: "غروب" },
    { stops: [{ stop: 0, color: `hsl(${hue},55%,28%)` }, { stop: 1, color: `hsl(${(hue + 140) % 360},60%,58%)` }], label: "جبال" },
    { stops: [{ stop: 0, color: `hsl(${hue},80%,72%)` }, { stop: 1, color: `hsl(${(hue + 200) % 360},70%,40%)` }], label: "بحر" },
  ]
  const scene = scenes[Math.floor(Math.random() * scenes.length)]

  const svg = Buffer.from(
    `<svg width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${scene.stops[0].color}"/>
        <stop offset="1" stop-color="${scene.stops[1].color}"/>
      </linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w * 0.72}" cy="${h * 0.24}" r="${w * 0.11}" fill="rgba(255,255,255,0.85)"/>
      <polygon points="0,${h} ${w * 0.32},${h * 0.62} ${w * 0.55},${h} " fill="rgba(0,0,0,0.22)"/>
      <polygon points="${w * 0.35},${h} ${w * 0.68},${h * 0.55} ${w},${h}" fill="rgba(0,0,0,0.32)"/>
      <rect x="0" y="${h - 88}" width="${w}" height="88" fill="rgba(0,0,0,0.35)"/>
      <text x="${w - 24}" y="${h - 46}" text-anchor="end" font-size="30" font-family="sans-serif" fill="rgba(255,255,255,0.95)" font-weight="bold">${scene.label} · Galaxy S24</text>
      <text x="${w - 24}" y="${h - 14}" text-anchor="end" font-size="20" font-family="sans-serif" fill="rgba(255,255,255,0.7)">${stamp.toLocaleTimeString("ar")}</text>
    </svg>`
  )

  const abs = path.join(resolveSafe(PHOTO_SRC_DEVICE, PHOTO_SRC_DIR), name)
  const buf = await sharp(svg).jpeg({ quality: 88 }).toBuffer()
  await fs.writeFile(abs, buf)
  // mtime الآن — ليُلتقط كموقع جديد
  const now = new Date()
  await fs.utimes(abs, now, now)
  return { name, bytes: buf.length }
}

export { deviceName as syncDeviceName }
