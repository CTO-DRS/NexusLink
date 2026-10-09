// /api/comms/calls — سجل المكالمات: قائمة + تسجيل مكالمة منتهية/فائتة
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ensureSeed, serCall } from "@/lib/nexus/comms-server"

export const dynamic = "force-dynamic"

export async function GET() {
  await ensureSeed()
  const rows = await db.nexusCallLog.findMany({ orderBy: { startedAt: "desc" }, take: 40 })
  return NextResponse.json({ calllog: rows.map(serCall) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const op = body?.op as string

  if (op === "ended") {
    const { direction, number, contactName, durationSec } = body
    const c = await db.nexusCallLog.create({
      data: {
        number: String(number ?? ""),
        contactName: contactName ?? null,
        direction: direction === "out" ? "out" : "in",
        startedAt: new Date(),
        durationSec: Math.max(0, Math.round(Number(durationSec) || 0)),
      },
    })
    return NextResponse.json({ ok: true, call: serCall(c) })
  }

  if (op === "missed") {
    const { number, contactName } = body
    const c = await db.nexusCallLog.create({
      data: {
        number: String(number ?? ""),
        contactName: contactName ?? null,
        direction: "missed",
        startedAt: new Date(),
        durationSec: 0,
      },
    })
    return NextResponse.json({ ok: true, call: serCall(c) })
  }

  return NextResponse.json({ error: "عملية غير معروفة" }, { status: 400 })
}
