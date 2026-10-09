// /api/comms/notifications — قائمة الإشعارات المنعكسة + استقبال إشعار جديد من الجسر (مع تطبيق قواعد الفلترة)
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ensureSeed, serNotification, evaluateIngest } from "@/lib/nexus/comms-server"

export const dynamic = "force-dynamic"

export async function GET() {
  await ensureSeed()
  const rows = await db.nexusNotification.findMany({ orderBy: { createdAt: "desc" }, take: 60 })
  return NextResponse.json({ notifications: rows.map(serNotification) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.appId || !body?.title) {
    return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 })
  }
  await ensureSeed()
  const status = await evaluateIngest(String(body.appId))
  const n = await db.nexusNotification.create({
    data: {
      appId: String(body.appId),
      appName: String(body.appName ?? body.appId),
      title: String(body.title),
      body: String(body.body ?? ""),
      actionable: body.actionable !== false,
      status,
    },
  })
  return NextResponse.json({ ok: true, notification: serNotification(n) })
}
