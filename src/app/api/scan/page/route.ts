// عقد §55 — الماسح الموثق الحي — رفع صفحة JPEG (multipart حقل file) + ?id=…
// فحص السحر FFD8 حرفيًا لا الثقة بالترويسة (نمط §51: الرفع من متصفح/وكيل)
import { NextResponse } from "next/server"
import { addScanPage } from "@/lib/nexus/scan-server"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  // FA-14 (تكليف 41): رفع صفحات الماسح يكتب بايتات في جلسة المالك — loopback حصرًا
  if (!guardPcOnly(req, "scan.denied", "page")) {
    return NextResponse.json(
      { ok: false, error: "pc-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }
  const url = new URL(req.url)
  const id = url.searchParams.get("id") ?? ""
  if (!id) return NextResponse.json({ ok: false, error: "missing-session" }, { status: 400 })
  let bytes: Buffer
  try {
    const form = await req.formData()
    const f = form.get("file")
    if (!f || typeof f === "string") return NextResponse.json({ ok: false, error: "missing-file" }, { status: 400 })
    bytes = Buffer.from(await (f as File).arrayBuffer())
  } catch {
    return NextResponse.json({ ok: false, error: "bad-upload" }, { status: 400 })
  }
  const r = await addScanPage(id, bytes)
  return NextResponse.json(r, { status: r.ok ? 200 : r.error === "not-found" ? 404 : 400 })
}
