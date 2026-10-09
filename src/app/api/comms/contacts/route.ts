// GET /api/comms/contacts — جهات الاتصال (مزامنة من الهاتف)
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ensureSeed, serContact } from "@/lib/nexus/comms-server"

export const dynamic = "force-dynamic"

export async function GET() {
  await ensureSeed()
  const rows = await db.nexusContact.findMany({ orderBy: [{ favorite: "desc" }, { name: "asc" }] })
  return NextResponse.json({ contacts: rows.map(serContact) })
}
