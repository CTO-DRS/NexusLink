import { NextRequest } from "next/server"
import sharp from "sharp"
import { resolveSafe } from "@/lib/nexus/fs-server"

export const dynamic = "force-dynamic"

const cache = new Map<string, Buffer>()

/** Real image thumbnails via sharp (for the grid view). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const deviceId = sp.get("device") || "galaxy-s24"
  const vpath = sp.get("path") || ""
  const key = `${deviceId}:${vpath}`

  const hit = cache.get(key)
  if (hit) return png(hit)

  try {
    const abs = resolveSafe(deviceId, vpath)
    const buf = await sharp(abs)
      .rotate()
      .resize(420, 420, { fit: "cover" })
      .webp({ quality: 78 })
      .toBuffer()
    cache.set(key, buf)
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" },
    })
  } catch {
    return new Response("No thumb", { status: 404 })
  }
}

function png(buf: Buffer) {
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" },
  })
}
