// GET /api/comms/bootstrap — الحالة الكاملة لطبقة الاتصالات (تحميل أولي)
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ensureSeed, getFilter, serNotification, serConversation, serContact, serCall } from "@/lib/nexus/comms-server"

export const dynamic = "force-dynamic"

export async function GET() {
  await ensureSeed()
  const [notifications, filter, conversations, contacts, calls, phone] = await Promise.all([
    db.nexusNotification.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    getFilter(),
    db.nexusConversation.findMany({
      orderBy: { updatedAt: "desc" },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    db.nexusContact.findMany({ orderBy: { name: "asc" } }),
    db.nexusCallLog.findMany({ orderBy: { startedAt: "desc" }, take: 40 }),
    db.nexusPhone.upsert({ where: { id: "main" }, update: {}, create: { id: "main" } }),
  ])
  return NextResponse.json({
    notifications: notifications.map(serNotification),
    filter,
    conversations: conversations.map(serConversation),
    contacts: contacts.map(serContact),
    calllog: calls.map(serCall),
    phone: { dnd: phone.dnd, dndSource: phone.dndSource },
  })
}
