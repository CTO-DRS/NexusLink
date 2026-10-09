// /api/comms/phone — حالة الهاتف: مزامنة وضع عدم الإزعاج
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const p = await db.nexusPhone.upsert({ where: { id: "main" }, update: {}, create: { id: "main" } })
  return NextResponse.json({ phone: { dnd: p.dnd, dndSource: p.dndSource } })
}

export async function PATCH(req: NextRequest) {
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
