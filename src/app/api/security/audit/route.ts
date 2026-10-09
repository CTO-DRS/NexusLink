// سجل التدقيق — قراءة وتفريغ عبر HTTP (البث الفوري عبر الجسر)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 250), 400)
  const rows = await db.auditEvent.findMany({ orderBy: { at: "desc" }, take: limit })
  return Response.json({ ok: true, events: rows.map((r) => ({ ...r, at: r.at.getTime() })) })
}

export async function DELETE() {
  await db.auditEvent.deleteMany({})
  return Response.json({ ok: true })
}
