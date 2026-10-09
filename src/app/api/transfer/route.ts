import { NextRequest, NextResponse } from "next/server"
import { jobs, verifyChunkHash } from "@/lib/nexus/transfer-engine"

export const dynamic = "force-dynamic"

export async function GET() {
  const list = [...jobs().values()].sort((a, b) => b.startedAt - a.startedAt)
  return NextResponse.json({ jobs: list })
}

export async function POST(req: NextRequest) {
  const { action, id } = await req.json()
  const job = jobs().get(id)
  if (!job) return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 })
  switch (action) {
    case "pause":
      job.status = "paused"
      return NextResponse.json({ ok: true, job })
    case "resume":
      job.status = "active"
      return NextResponse.json({ ok: true, job })
    case "cancel":
      job.status = "error"
      job.error = "أُلغيت بواسطة المستخدم"
      jobs().delete(id)
      return NextResponse.json({ ok: true })
    case "verify":
      return NextResponse.json(await verifyChunkHash(id))
    default:
      return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 })
  }
}
