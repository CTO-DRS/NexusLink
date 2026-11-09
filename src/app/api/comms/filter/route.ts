// /api/comms/filter — قواعد فلترة الإشعارات: إخفاء تطبيقات، تجميع، صامت لفترة، الصوت
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getFilter } from "@/lib/nexus/comms-server"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ filter: await getFilter() })
}

export async function PATCH(req: NextRequest) {
  // FA-16 (تكليف 43): filter-rules فعل المالك على الكمبيوتر — loopback حصرًا
  if (!guardPcOnly(req, "comms.denied", "filter-rules")) {
    return NextResponse.json(
      { ok: false, error: "pc-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

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
