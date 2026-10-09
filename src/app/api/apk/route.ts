import { NextRequest, NextResponse } from "next/server"
import { resolveSafe } from "@/lib/nexus/fs-server"
import { execFile } from "child_process"
import { promisify } from "util"

const exec = promisify(execFile)
export const dynamic = "force-dynamic"

/** Inspect an APK: real zip listing + naive manifest parsing. */
export async function POST(req: NextRequest) {
  const { deviceId, path } = await req.json()
  try {
    const abs = resolveSafe(deviceId, path)
    const { stdout } = await exec("unzip", ["-l", abs])
    const lines = stdout.trim().split("\n").slice(3)
    const files: { name: string; size: string }[] = []
    for (const ln of lines) {
      const m = ln.trim().match(/^(\d+)\s+[\d-]+\s+[\d:]+\s+(.+)$/)
      if (m) files.push({ size: m[1], name: m[2] })
    }
    const manifest = files.find((f) => f.name.includes("AndroidManifest"))
    return NextResponse.json({
      ok: true,
      fileName: path.split("/").pop(),
      entries: files.length,
      hasManifest: !!manifest,
      files: files.slice(0, 20),
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "تعذر قراءة الحزمة" },
      { status: 400 }
    )
  }
}
