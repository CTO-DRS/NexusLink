import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { promises as fs } from "fs"
import { walk, DEVICE_ROOTS } from "@/lib/nexus/fs-server"
import type { DuplicateGroup, StorageAnalysis } from "@/lib/nexus/types"

export const dynamic = "force-dynamic"

const CAT_LABEL: Record<string, string> = {
  image: "صور", video: "فيديو", audio: "صوتيات", pdf: "مستندات PDF",
  text: "نصوص", apk: "تطبيقات APK", zip: "أرشيفات", other: "أخرى",
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") || "analyze"
  const deviceId = req.nextUrl.searchParams.get("device") || "galaxy-s24"
  const root = DEVICE_ROOTS[deviceId]
  if (!root) return NextResponse.json({ error: "جهاز غير معروف" }, { status: 404 })

  if (mode === "analyze") {
    const cats = new Map<string, { bytes: number; count: number }>()
    const folders = new Map<string, { bytes: number; count: number }>()
    let used = 0
    await walk(deviceId, "/", (e) => {
      if (e.type !== "file") return
      used += e.size
      const c = cats.get(e.category) || { bytes: 0, count: 0 }
      c.bytes += e.size; c.count++
      cats.set(e.category, c)
      const top = "/" + e.path.split("/")[1]
      const f = folders.get(top) || { bytes: 0, count: 0 }
      f.bytes += e.size; f.count++
      folders.set(top, f)
    })
    const totalGB = deviceId === "galaxy-s24" ? 256 : deviceId === "pc-office" ? 512 : 128
    const sysUsed = totalGB * 0.18 * 1024 ** 3 // synthetic system usage for realism
    const result: StorageAnalysis = {
      totalBytes: totalGB * 1024 ** 3,
      usedBytes: used + sysUsed,
      freeBytes: totalGB * 1024 ** 3 - used - sysUsed,
      categories: [...cats.entries()].map(([k, v]) => ({
        category: CAT_LABEL[k] || k, ...v,
      })).sort((a, b) => b.bytes - a.bytes),
      folders: [...folders.entries()].map(([p, v]) => ({
        name: p.slice(1), path: p, ...v,
      })).sort((a, b) => b.bytes - a.bytes),
    }
    return NextResponse.json(result)
  }

  if (mode === "duplicates") {
    // collect candidates first (walk callback is sync), then hash sequentially
    const candidates: { e: FsEntry; abs: string }[] = []
    await walk(deviceId, "/", (e, abs) => {
      if (e.type === "file" && e.size >= 1024 && e.size <= 8 * 1024 ** 2) {
        candidates.push({ e, abs })
      }
    })
    const groups = new Map<string, DuplicateGroup>()
    for (const { e, abs } of candidates) {
      try {
        const buf = await fs.readFile(abs)
        const hash = createHash("md5").update(buf).digest("hex")
        const g = groups.get(hash) || { hash, size: e.size, files: [] }
        g.files.push(e)
        groups.set(hash, g)
      } catch { /* skip */ }
    }
    const dups = [...groups.values()].filter((g) => g.files.length > 1)
    const wasted = dups.reduce((s, g) => s + g.size * (g.files.length - 1), 0)
    return NextResponse.json({ groups: dups, wastedBytes: wasted })
  }

  if (mode === "large") {
    const files: FsEntry[] = []
    await walk(deviceId, "/", (e) => { if (e.type === "file") files.push(e) })
    files.sort((a, b) => b.size - a.size)
    return NextResponse.json({ files: files.slice(0, 15) })
  }

  return NextResponse.json({ error: "نمط غير معروف" }, { status: 400 })
}
