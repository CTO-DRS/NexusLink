import { NextRequest, NextResponse } from "next/server"
import { listDir, runOps, searchFs, dirStats, OpsPayload } from "@/lib/nexus/fs-server"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const deviceId = sp.get("device") || "galaxy-s24"
  const vpath = sp.get("path") || "/"
  const q = sp.get("q")

  try {
    if (q) {
      const results = await searchFs(deviceId, q)
      return NextResponse.json({ entries: results, path: vpath })
    }
    const entries = await listDir(deviceId, vpath)
    return NextResponse.json({ entries, path: vpath })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطأ في القراءة" },
      { status: 400 }
    )
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as OpsPayload | null
  if (!body) return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 })
  try {
    const r = await runOps(body)
    if (!r.ok) return NextResponse.json(r, { status: 400 })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "فشلت العملية" },
      { status: 500 }
    )
  }
}

// quick dir stats used by the file browser footer
export async function PUT(req: NextRequest) {
  const { deviceId, path } = await req.json()
  try {
    const s = await dirStats(deviceId, path || "/")
    return NextResponse.json(s)
  } catch {
    return NextResponse.json({ bytes: 0, count: 0, dirs: 0 })
  }
}
