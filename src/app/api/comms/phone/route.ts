// /api/comms/phone — حالة الهاتف: مزامنة وضع عدم الإزعاج
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET() {
  const p = await db.nexusPhone.upsert({ where: { id: "main" }, update: {}, create: { id: "main" } })
  return NextResponse.json({ phone: { dnd: p.dnd, dndSource: p.dndSource } })
}

export async function PATCH(req: NextRequest) {
  // FA-16 (تكليف 43): phone-dnd فعل المالك على الكمبيوتر — loopback حصرًا
  if (!guardPcOnly(req, "comms.denied", "phone-dnd")) {
    return NextResponse.json(
      { ok: false, error: "pc-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const data: { dnd?: boolean; dndSource?: string | null } = {}
  if (typeof body.dnd === "boolean") {
    data.dnd = body.dnd
    data.dndSource = body.dnd === false ? null : (body.dndSource ?? "pc")
  }
  const p = await db.nexusPhone.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  })
  return NextResponse.json({ ok: true, phone: { dnd: p.dnd, dndSource: p.dndSource } })
}
