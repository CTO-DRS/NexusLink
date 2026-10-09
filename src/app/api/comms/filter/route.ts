// /api/comms/filter — قواعد فلترة الإشعارات: إخفاء تطبيقات، تجميع، صامت لفترة، الصوت
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getFilter } from "@/lib/nexus/comms-server"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ filter: await getFilter() })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const data: {
    hiddenApps?: string
    grouping?: boolean
    quietUntil?: Date | null
    soundEnabled?: boolean
  } = {}

  if (Array.isArray(body.hiddenApps)) data.hiddenApps = JSON.stringify(body.hiddenApps)
  if (typeof body.grouping === "boolean") data.grouping = body.grouping
  if (typeof body.soundEnabled === "boolean") data.soundEnabled = body.soundEnabled
  if ("quietUntil" in body) {
    data.quietUntil = body.quietUntil ? new Date(body.quietUntil) : null
  }

  await db.nexusFilter.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  })
  return NextResponse.json({ ok: true, filter: await getFilter() })
}
