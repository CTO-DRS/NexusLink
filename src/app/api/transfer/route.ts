import { NextRequest, NextResponse } from "next/server"
import { jobs, verifyChunkHash } from "@/lib/nexus/transfer-engine"
import { abortSession, uploadSessions } from "@/lib/nexus/upload-sessions"
import { guardEmitToAgent } from "@/lib/nexus/guard-bridge"

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
      // مهمة تنزيل على وكيل حقيقي → أبلغ الهاتف بإيقاف التنزيل
      if (job.agent && !job.uploadId) guardEmitToAgent("tx:pause", { id })
      // جلسة رفع من هاتف → PUT التالي يُرفض بـ paused فيوقف الطابور عنده
      if (job.uploadId) {
        for (const s of uploadSessions().values()) if (s.jobId === id) { /* الحالة على المهمة تكفي */ }
      }
      return NextResponse.json({ ok: true, job })
    case "resume":
      job.status = "active"
      if (job.agent && !job.uploadId) guardEmitToAgent("tx:resume", { id })
      return NextResponse.json({ ok: true, job })
    case "cancel":
      // جلسة رفع → أجهض الجزئي وامسح المهمة
      if (job.uploadId) {
        await abortSession(job.uploadId, "أُلغيت بواسطة المستخدم")
        return NextResponse.json({ ok: true })
      }
      // تنزيل لدى وكيل حقيقي → اطلب منه إيقاف التنزيل
      if (job.agent) guardEmitToAgent("tx:cancel", { id })
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
