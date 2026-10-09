// /api/comms/sms — المحادثات والرسائل: قائمة، محادثة كاملة، إرسال، وارد، حالة، قراءة
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ensureSeed, serConversation, serMessage } from "@/lib/nexus/comms-server"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  await ensureSeed()
  const conversationId = req.nextUrl.searchParams.get("conversationId")
  if (conversationId) {
    const conv = await db.nexusConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return NextResponse.json({ error: "المحادثة غير موجودة" }, { status: 404 })
    return NextResponse.json({
      conversation: serConversation(conv),
      messages: conv.messages.map(serMessage),
    })
  }
  const convs = await db.nexusConversation.findMany({
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  })
  return NextResponse.json({ conversations: convs.map(serConversation) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const op = body?.op as string

  // ---- إرسال SMS من الكمبيوتر ----
  if (op === "send") {
    const { conversationId, text } = body
    if (!conversationId || !text?.trim()) {
      return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 })
    }
    const conv = await db.nexusConversation.findUnique({ where: { id: conversationId } })
    if (!conv) return NextResponse.json({ error: "المحادثة غير موجودة" }, { status: 404 })
    const msg = await db.nexusMessage.create({
      data: { conversationId, body: String(text).trim(), direction: "out", status: "sending" },
    })
    await db.nexusConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
    return NextResponse.json({ ok: true, message: serMessage(msg), conversation: serConversation({ ...conv, unread: conv.unread }) })
  }

  // ---- SMS وارد من الجسر (الجسر يرسلها عند وصول رسالة للهاتف) ----
  if (op === "incoming") {
    const { address, contactName } = body
    const text = body.text ?? body.body // الجسر يرسل body — نقبل الاثنين
    if (!address || !text) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 })
    await ensureSeed()
    const conv = await db.nexusConversation.upsert({
      where: { address: String(address) },
      update: { unread: { increment: 1 }, contactName: contactName ?? undefined, updatedAt: new Date() },
      create: { address: String(address), contactName: contactName ?? null, unread: 1 },
    })
    const msg = await db.nexusMessage.create({
      data: { conversationId: conv.id, body: String(text), direction: "in", status: "delivered" },
    })
    return NextResponse.json({
      ok: true,
      conversation: serConversation({ ...conv, unread: conv.unread }),
      message: serMessage(msg),
    })
  }

  // ---- تحديث حالة رسالة صادرة (sent/delivered) من الجسر ----
  if (op === "status") {
    const { messageId, status } = body
    if (!messageId || !status) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 })
    const msg = await db.nexusMessage.update({ where: { id: messageId }, data: { status: String(status) } })
    return NextResponse.json({ ok: true, message: serMessage(msg) })
  }

  // ---- فتح محادثة = تعليم كمقروءة ----
  if (op === "read") {
    const { conversationId } = body
    if (!conversationId) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 })
    const conv = await db.nexusConversation.update({
      where: { id: conversationId },
      data: { unread: 0 },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    await db.nexusMessage.updateMany({
      where: { conversationId, direction: "in" },
      data: { status: "read" },
    })
    return NextResponse.json({
      ok: true,
      conversation: serConversation(conv),
      messages: conv.messages.map(serMessage),
    })
  }

  return NextResponse.json({ error: "عملية غير معروفة" }, { status: 400 })
}
