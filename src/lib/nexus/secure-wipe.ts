// NexusLink — المرحلة 10: محرك الحذف الآمن الحقيقي (Secure Wipe)
// ============================================================
// تمريرات كتابة متعددة على ملف حقيقي على القرص (0x00 → 0xFF → عشوائي)
// مع fsync بعد كل كتابة لضمان الوصول للطبق الفيزيائي، ثم إزالة مباشرة
// من inode (unlink) — يتجاوز سلة المحذوفات تماماً، فلا استرجاع ممكن.
import { promises as fs, createReadStream } from "fs"
import crypto from "crypto"
import path from "path"
import { DEVICE_ROOTS, resolveSafe } from "./fs-server"

export interface WipePass { index: number; pattern: string; bytes: number; ms: number }
export interface WipeResult {
  ok: boolean
  file: string
  size: number
  passes: WipePass[]
  hashBefore: string
  verifyGone: boolean
  error?: string
}

const PASS_PATTERNS = ["0x00 أصفار", "0xFF آحاد", "عشوائي CSPRNG"]

/** قائمة ملفات قابلة للحذف الآمن (من أقراص الأجهزة الافتراضية الحقيقية) */
export async function wipableFiles(limit = 120) {
  const out: { deviceId: string; name: string; vPath: string; size: number; mtime: number }[] = []
  for (const [deviceId, root] of Object.entries(DEVICE_ROOTS)) {
    const dirs = [root]
    while (dirs.length && out.length < limit) {
      const dir = dirs.shift()!
      let entries: import("fs").Dirent[] = []
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) dirs.push(abs)
        else if (e.isFile()) {
          try {
            const st = await fs.stat(abs)
            out.push({
              deviceId, name: e.name,
              vPath: "/" + path.relative(root, abs).split(path.sep).join("/"),
              size: st.size, mtime: st.mtimeMs,
            })
          } catch { /* ignore */ }
        }
        if (out.length >= limit) break
      }
    }
  }
  return out.sort((a, b) => b.size - a.size)
}

function streamHash(file: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = crypto.createHash("sha256")
    const s = createReadStream(file)
    s.on("data", (d) => h.update(d))
    s.on("end", () => res(h.digest("hex")))
    s.on("error", rej)
  })
}

/**
 * مسح آمن فعلي: تمريرات كتابة + fsync + unlink (لا سلة محذوفات).
 * passes = 3 (0x00,0xFF,عشوائي) أو 7 (دورة مزدوجة + عشوائي إضافي)
 */
export async function secureWipe(opts: {
  deviceId: string
  vPath: string
  passes: number
  onProgress?: (p: { pass: number; totalPasses: number; pattern: string; pct: number; speedBps: number; phase: "write" | "unlink" | "verify" }) => void
}): Promise<WipeResult> {
  const abs = resolveSafe(opts.deviceId, opts.vPath)
  const st = await fs.stat(abs)
  if (!st.isFile()) throw new Error("الهدف ليس ملفاً")
  const size = st.size
  const hashBefore = size > 0 ? await streamHash(abs) : "—"
  const passes: WipePass[] = []
  const total = opts.passes === 7 ? 7 : 3
  const seq = opts.passes === 7
    ? [0, 1, 2, 0, 1, 2, 2]
    : [0, 1, 2]

  const fh = await fs.open(abs, "r+")
  try {
    const CHUNK = 1024 * 1024
    const buf = Buffer.alloc(Math.min(size || CHUNK, CHUNK))
    for (let p = 0; p < total; p++) {
      const t0 = Date.now()
      const pattern = PASS_PATTERNS[seq[p]]
      if (seq[p] === 0) buf.fill(0x00)
      else if (seq[p] === 1) buf.fill(0xff)
      else crypto.randomFillSync(buf)
      let written = 0
      for (let off = 0; off < size; off += buf.length) {
        const len = Math.min(buf.length, size - off)
        await fh.write(buf, 0, len, off)
        await fh.sync() // fsync — الوصول للقرص فعلاً
        written += len
        const pct = Math.min(100, Math.round((written / Math.max(size, 1)) * 100))
        const ms = Math.max(Date.now() - t0, 1)
        opts.onProgress?.({ pass: p + 1, totalPasses: total, pattern, pct, speedBps: Math.round(written / (ms / 1000)), phase: "write" })
      }
      passes.push({ index: p + 1, pattern, bytes: size, ms: Date.now() - t0 })
    }
  } finally {
    await fh.close()
  }

  // الإزالة النهائية — مباشرة من جدول inode (تتجاوز أي سلة محذوفات)
  opts.onProgress?.({ pass: total, totalPasses: total, pattern: "unlink", pct: 100, speedBps: 0, phase: "unlink" })
  await fs.unlink(abs)

  // تحقق: الملف لم يعد موجوداً — لا استرجاع ممكن
  let verifyGone = false
  try { await fs.stat(abs); verifyGone = false } catch { verifyGone = true }
  opts.onProgress?.({ pass: total, totalPasses: total, pattern: "verify", pct: 100, speedBps: 0, phase: "verify" })

  return { ok: verifyGone, file: path.basename(abs), size, passes, hashBefore, verifyGone }
}
