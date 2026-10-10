import { NextRequest } from "next/server"
import { createReadStream, promises as fs, statSync } from "fs"
import { Readable } from "stream"
import { resolveSafe, mimeOf } from "@/lib/nexus/fs-server"

export const dynamic = "force-dynamic"

/**
 * Streams a file for preview with full HTTP Range support —
 * this is what makes video/audio seeking actually work.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const deviceId = sp.get("device") || "galaxy-s24"
  const vpath = sp.get("path") || ""
  const download = sp.get("download") === "1"

  let abs: string
  try {
    abs = resolveSafe(deviceId, vpath)
    const st = await fs.stat(abs)
    if (!st.isFile()) return new Response("Not a file", { status: 400 })
    const size = st.size
    const mime = mimeOf(abs)
    const name = abs.split(/[\\/]/).pop() || "file"

    const baseHeaders: Record<string, string> = {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "Content-Disposition": download
        ? `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
        : `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    }

    const range = req.headers.get("range")
    // Range مُلبّى أيضًا مع download=1 — يحتاجه وكيل الجهاز لاستئناف التنزيل
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/)
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0
        const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
        if (start >= size || start > end) {
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          })
        }
        const stream = createReadStream(abs, { start, end })
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
          },
        })
      }
    }

    const stream = createReadStream(abs)
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) },
    })
  } catch {
    return new Response("File not found", { status: 404 })
  }
}
