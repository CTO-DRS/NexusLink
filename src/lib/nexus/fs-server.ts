// NexusLink — server-side virtual device filesystem engine.
// Each paired device maps to a real directory on disk, so list/ops/previews
// work against real bytes (not mocks).
import { promises as fs } from "fs"
import path from "path"
import type { FsCategory, FsEntry } from "./types"

export const DATA_ROOT = path.join(process.cwd(), "data", "nexus-storage")

export const DEVICE_ROOTS: Record<string, string> = {
  "galaxy-s24": path.join(DATA_ROOT, "media"),
  "pc-office": path.join(DATA_ROOT, "pc-fs"),
  "ipad-pro": path.join(DATA_ROOT, "tab-fs"),
  "redmi-note13": path.join(DATA_ROOT, "media"),
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".mp4": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm",
  ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".m4a": "audio/mp4", ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".txt": "text/plain", ".md": "text/plain", ".log": "text/plain",
  ".json": "text/plain", ".js": "text/plain", ".ts": "text/plain",
  ".csv": "text/plain", ".xml": "text/plain", ".html": "text/plain",
  ".apk": "application/vnd.android.package-archive",
  ".zip": "application/zip", ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
}

const CATEGORY: Record<string, FsCategory> = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", bmp: "image",
  mp4: "video", mkv: "video", webm: "video", mov: "video", avi: "video",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio",
  pdf: "pdf",
  txt: "text", md: "text", log: "text", json: "text", js: "text", ts: "text", csv: "text", xml: "text", html: "text",
  apk: "apk",
  zip: "zip", rar: "zip", "7z": "zip",
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".")
  return i > 0 ? name.slice(i + 1).toLowerCase() : ""
}

export function mimeOf(name: string): string {
  return MIME["." + extOf(name)] ?? "application/octet-stream"
}

export function categoryOf(name: string): FsCategory {
  return CATEGORY[extOf(name)] ?? "other"
}

/** Resolve a virtual path ("/DCIM/Camera") to a real absolute path, safely. */
export function resolveSafe(deviceId: string, vpath: string): string {
  const root = DEVICE_ROOTS[deviceId]
  if (!root) throw new Error("جهاز غير معروف")
  const rel = (vpath || "/").replace(/\\/g, "/")
  const abs = path.resolve(root, "." + rel)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("مسار غير صالح")
  }
  return abs
}

export function toVpath(deviceId: string, abs: string): string {
  const root = DEVICE_ROOTS[deviceId]
  return abs.slice(root.length).replace(/\\/g, "/") || "/"
}

export async function listDir(
  deviceId: string,
  vpath: string
): Promise<FsEntry[]> {
  const abs = resolveSafe(deviceId, vpath)
  const dirents = await fs.readdir(abs, { withFileTypes: true })
  const out: FsEntry[] = []
  for (const d of dirents) {
    if (d.name.startsWith(".")) continue
    const full = path.join(abs, d.name)
    try {
      const st = await fs.stat(full)
      out.push({
        name: d.name,
        path: joinV(vpath, d.name),
        type: d.isDirectory() ? "dir" : "file",
        size: d.isDirectory() ? 0 : st.size,
        mtime: st.mtimeMs,
        ext: d.isDirectory() ? "" : extOf(d.name),
        category: d.isDirectory() ? "other" : categoryOf(d.name),
        mime: d.isDirectory() ? undefined : mimeOf(d.name),
      })
    } catch {
      /* unreadable entry — skip */
    }
  }
  return out
}

export function joinV(base: string, name: string): string {
  return (base === "/" ? "" : base) + "/" + name
}

export async function walk(
  deviceId: string,
  vpath: string,
  cb: (e: FsEntry, abs: string) => void | Promise<void>
) {
  const abs = resolveSafe(deviceId, vpath)
  let items: import("fs").Dirent[]
  try {
    items = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of items) {
    if (d.name.startsWith(".")) continue
    const full = path.join(abs, d.name)
    const vp = joinV(vpath, d.name)
    if (d.isDirectory()) {
      cb({
        name: d.name, path: vp, type: "dir", size: 0, mtime: 0,
        ext: "", category: "other",
      }, full)
      await walk(deviceId, vp, cb)
    } else {
      try {
        const st = await fs.stat(full)
        cb({
          name: d.name, path: vp, type: "file", size: st.size,
          mtime: st.mtimeMs, ext: extOf(d.name),
          category: categoryOf(d.name), mime: mimeOf(d.name),
        }, full)
      } catch { /* skip */ }
    }
  }
}

export async function dirStats(
  deviceId: string,
  vpath: string
): Promise<{ bytes: number; count: number; dirs: number }> {
  let bytes = 0, count = 0, dirs = 0
  await walk(deviceId, vpath, (e) => {
    if (e.type === "file") { bytes += e.size; count++ } else dirs++
  })
  return { bytes, count, dirs }
}

export async function searchFs(
  deviceId: string,
  query: string,
  limit = 200
): Promise<FsEntry[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: FsEntry[] = []
  await walk(deviceId, "/", (e) => {
    if (hits.length < limit && e.name.toLowerCase().includes(q)) hits.push(e)
  })
  return hits
}

export interface OpsPayload {
  op: "mkdir" | "rename" | "delete" | "copy" | "move" | "zip" | "extract"
  deviceId: string
  path?: string          // target dir or the file itself
  name?: string          // new folder name / new name
  paths?: string[]       // multi-select sources
  dest?: string          // destination dir for copy/move
  zipName?: string
}

export async function runOps(p: OpsPayload): Promise<{ ok: boolean; message: string }> {
  const { op, deviceId } = p
  switch (op) {
    case "mkdir": {
      const abs = resolveSafe(deviceId, joinV(p.path || "/", uniqueName(p.name || "مجلد جديد", deviceId, p.path || "/")))
      await fs.mkdir(abs, { recursive: true })
      return { ok: true, message: "تم إنشاء المجلد" }
    }
    case "rename": {
      const srcAbs = resolveSafe(deviceId, p.path!)
      const parentV = parentOf(p.path!)
      const dstAbs = resolveSafe(deviceId, joinV(parentV, p.name!))
      await fs.rename(srcAbs, dstAbs)
      return { ok: true, message: "تمت إعادة التسمية" }
    }
    case "delete": {
      for (const vp of p.paths || [p.path!]) {
        const abs = resolveSafe(deviceId, vp)
        await fs.rm(abs, { recursive: true, force: true })
      }
      return { ok: true, message: `تم حذف ${(p.paths || []).length} عنصر` }
    }
    case "copy":
    case "move": {
      const destDir = p.dest || "/"
      let n = 0
      for (const vp of p.paths || []) {
        const srcAbs = resolveSafe(deviceId, vp)
        const base = path.basename(vp)
        let target = resolveSafe(deviceId, joinV(destDir, base))
        try { await fs.access(target); target = resolveSafe(deviceId, joinV(destDir, uniqueName(base, deviceId, destDir))) } catch { /* free */ }
        await fs.cp(srcAbs, target, { recursive: true })
        if (op === "move") await fs.rm(srcAbs, { recursive: true, force: true })
        n++
      }
      return { ok: true, message: op === "copy" ? `تم نسخ ${n} عنصر` : `تم نقل ${n} عنصر` }
    }
    case "zip": {
      const parentV = parentOf(p.paths![0])
      const zipName = p.zipName || "archive.zip"
      const zipAbs = resolveSafe(deviceId, joinV(parentV, zipName))
      const { execFile } = await import("child_process")
      const { promisify } = await import("util")
      const exec = promisify(execFile)
      const names = (p.paths || []).map((vp) => path.basename(vp))
      await exec("zip", ["-q", "-r", zipAbs, ...names], { cwd: resolveSafe(deviceId, parentV) })
      return { ok: true, message: `تم إنشاء ${zipName}` }
    }
    case "extract": {
      const srcAbs = resolveSafe(deviceId, p.path!)
      const parentV = parentOf(p.path!)
      const outDir = joinV(parentV, path.basename(p.path!).replace(/\.(zip|rar|7z)$/i, "_extracted"))
      const outAbs = resolveSafe(deviceId, outDir)
      await fs.mkdir(outAbs, { recursive: true })
      const { execFile } = await import("child_process")
      const { promisify } = await import("util")
      const exec = promisify(execFile)
      await exec("unzip", ["-q", "-o", srcAbs, "-d", outAbs])
      return { ok: true, message: "تم فك الضغط" }
    }
    default:
      return { ok: false, message: "عملية غير معروفة" }
  }
}

export function parentOf(vp: string): string {
  const i = vp.lastIndexOf("/")
  return i <= 0 ? "/" : vp.slice(0, i)
}

function uniqueName(base: string, deviceId: string, dirV: string): string {
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ""
  return `${stem}_جديد${ext}` // simplified; collisions resolved by caller for mkdir
}
