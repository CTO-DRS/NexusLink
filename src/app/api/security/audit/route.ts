// سجل التدقيق — قراءة وتفريغ عبر HTTP (البث الفوري عبر الجسر)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 250), 400)
  const rows = await db.auditEvent.findMany({ orderBy: { at: "desc" }, take: limit })
  return Response.json({ ok: true, events: rows.map((r) => ({ ...r, at: r.at.getTime() })) })
}

export async function DELETE(req: Request) {
  // FA-16 (تكليف 43): audit-clear-all فعل المالك على الكمبيوتر — loopback حصرًا
  if (!guardPcOnly(req, "audit.denied", "audit-clear-all")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }

  await db.auditEvent.deleteMany({})
  return Response.json({ ok: true })
}
