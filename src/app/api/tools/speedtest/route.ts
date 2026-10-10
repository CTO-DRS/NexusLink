import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "node:crypto"

// 4MB pool generated once and reused (fast, zero allocation per request)
const POOL_BYTES = 4 * 1024 * 1024
let pool: Buffer | null = null
function getPool() {
  if (!pool) pool = randomBytes(POOL_BYTES)
  return pool
}

// GET /api/tools/speedtest?bytes=8388608 — download test (random payload)
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  let bytes = Number(url.searchParams.get("bytes") || 8 * 1024 * 1024)
  bytes = Math.max(64 * 1024, Math.min(bytes, 48 * 1024 * 1024))
  const p = getPool()
  const chunks: Buffer[] = []
  let left = bytes
  while (left > 0) {
    const take = Math.min(left, POOL_BYTES)
    chunks.push(take === POOL_BYTES ? p : p.subarray(0, take))
    left -= take
  }
  const body = Buffer.concat(chunks)
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
      "X-Nexus-Payload": String(body.length),
    },
  })
}

// POST /api/tools/speedtest — upload test (server counts received bytes)
export async function POST(req: NextRequest) {
  let received = 0
  const body = req.body
  if (body) {
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value?.length ?? 0
    }
  } else {
    const buf = await req.arrayBuffer()
    received = buf.byteLength
  }
  return NextResponse.json(
    { received, t: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  )
}
