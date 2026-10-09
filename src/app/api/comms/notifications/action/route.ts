// POST /api/comms/notifications/action — إجراء على إشعار: قراءة / أرشفة / حذف / رد سريع
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { serNotification } from "@/lib/nexus/comms-server"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.id || !body?.action) {
    return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 })
  }
  const { id, action } = body as { id: string; action: string; text?: string }

  let n
  switch (action) {
    case "read":
      n = await db.nexusNotification.update({ where: { id }, data: { status: "read" } })
      break
    case "archive":
      n = await db.nexusNotification.update({ where: { id }, data: { status: "archived" } })
      break
    case "restore":
      n = await db.nexusNotification.update({ where: { id }, data: { status: "new" } })
      break
    case "reply":
      if (!body.text?.trim()) return NextResponse.json({ error: "نص الرد فارغ" }, { status: 400 })
      n = await db.nexusNotification.update({
        where: { id },
        data: { status: "replied", replyText: String(body.text).trim() },
      })
      break
    case "delete":
      await db.nexusNotification.delete({ where: { id } })
      return NextResponse.json({ ok: true, deleted: id })
    case "clear-read": {
      await db.nexusNotification.deleteMany({
        where: { status: { in: ["read", "replied", "muted"] } },
      })
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 })
  }
  return NextResponse.json({ ok: true, notification: serNotification(n) })
}
