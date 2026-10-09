// NexusLink — طبقة الاتصالات: طبقة بيانات الخادم (Prisma) + محرك قواعد الفلترة
import { db } from "@/lib/db"
import type {
  MirroredNotification, NotifFilter, SmsConversation, SmsMessage,
  CommsContact, CallLogEntry, NotifStatus,
} from "./comms-types"

// ---------- serializers ----------
type PN = {
  id: string; appId: string; appName: string; title: string; body: string
  deviceId: string; actionable: boolean; status: string; replyText: string | null; createdAt: Date
}
export function serNotification(n: PN): MirroredNotification {
  return {
    id: n.id, appId: n.appId, appName: n.appName, title: n.title, body: n.body,
    deviceId: n.deviceId, actionable: n.actionable,
    status: n.status as NotifStatus, replyText: n.replyText,
    createdAt: n.createdAt.toISOString(),
  }
}

export function serMessage(m: {
  id: string; conversationId: string; body: string; direction: string
  status: string; createdAt: Date
}): SmsMessage {
  return {
    id: m.id, conversationId: m.conversationId, body: m.body,
    direction: m.direction as "in" | "out", status: m.status as SmsMessage["status"],
    createdAt: m.createdAt.toISOString(),
  }
}

export function serConversation(c: {
  id: string; address: string; contactName: string | null; unread: number; updatedAt: Date
  messages?: { body: string; direction: string; createdAt: Date }[]
}): SmsConversation {
  const last = c.messages?.[0]
  return {
    id: c.id, address: c.address, contactName: c.contactName, unread: c.unread,
    updatedAt: c.updatedAt.toISOString(),
    lastMessage: last ? `${last.direction === "out" ? "أنت: " : ""}${last.body}` : undefined,
  }
}

export function serContact(c: {
  id: string; name: string; phone: string; email: string | null; favorite: boolean
}): CommsContact {
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, favorite: c.favorite }
}

export function serCall(c: {
  id: string; number: string; contactName: string | null; direction: string
  startedAt: Date; durationSec: number
}): CallLogEntry {
  return {
    id: c.id, number: c.number, contactName: c.contactName,
    direction: c.direction as CallLogEntry["direction"],
    startedAt: c.startedAt.toISOString(), durationSec: c.durationSec,
  }
}

// ---------- الفلترة ----------
export async function getFilter(): Promise<NotifFilter> {
  const f = await db.nexusFilter.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main" },
  })
  let hiddenApps: string[] = []
  try { hiddenApps = JSON.parse(f.hiddenApps) } catch { hiddenApps = [] }
  return {
    id: f.id, hiddenApps, grouping: f.grouping,
    quietUntil: f.quietUntil ? f.quietUntil.toISOString() : null,
    soundEnabled: f.soundEnabled,
  }
}

export async function getPhoneDnd(): Promise<boolean> {
  const p = await db.nexusPhone.upsert({
    where: { id: "main" }, update: {}, create: { id: "main" },
  })
  return p.dnd
}

/** تقييم إشعار وارد وفق قواعد الفلترة: إخفاء تطبيقات / صامت لفترة / مزامنة عدم الإزعاج */
export async function evaluateIngest(appId: string): Promise<NotifStatus> {
  const [filter, dnd] = await Promise.all([getFilter(), getPhoneDnd()])
  if (filter.hiddenApps.includes(appId)) return "hidden"
  if (dnd) return "muted"
  if (filter.quietUntil && new Date(filter.quietUntil) > new Date()) return "muted"
  return "new"
}

// ---------- البيانات الأولية ----------
let seeded = false

export async function ensureSeed() {
  if (seeded) return
  const [notifs, contacts, convos, calls] = await Promise.all([
    db.nexusNotification.count(),
    db.nexusContact.count(),
    db.nexusConversation.count(),
    db.nexusCallLog.count(),
  ])
  if (notifs === 0) {
    const now = Date.now()
    const rows = [
      { appId: "whatsapp", appName: "واتساب", title: "سارة العتيبي", body: "أرسلت لك النسخة المعدلة من العقد، راجعها وقت ما تحب", status: "read", ago: 55 * 60e3 },
      { appId: "gmail", appName: "Gmail", title: "Gmail", body: "تذكير: اجتماع الفريق السنوي الخميس 10 صباحاً", status: "read", ago: 3 * 3600e3 },
      { appId: "telegram", appName: "تيليجرام", title: "قناة التقنية", body: "تحديث جديد لأدوات التطوير متاح الآن للتحميل", status: "archived", ago: 26 * 3600e3 },
    ]
    for (const r of rows) {
      await db.nexusNotification.create({
        data: { appId: r.appId, appName: r.appName, title: r.title, body: r.body, status: r.status, createdAt: new Date(now - r.ago) },
      })
    }
  }
  if (contacts === 0) {
    const rows = [
      { name: "أحمد الغامدي", phone: "0501234567", email: "ahmed@example.com", favorite: true },
      { name: "سارة العتيبي", phone: "0533445566", email: "sara@example.com", favorite: true },
      { name: "محمد الحربي", phone: "0555667788", email: null, favorite: false },
      { name: "نورة القحطاني", phone: "0566778899", email: "noura@example.com", favorite: false },
      { name: "خالد المطيري", phone: "0522334455", email: null, favorite: false },
      { name: "فاطمة الزهراني", phone: "0599887766", email: null, favorite: true },
      { name: "عبدالله الدوسري", phone: "0544332211", email: null, favorite: false },
      { name: "ريم الشهري", phone: "0577889900", email: "reem@example.com", favorite: false },
    ]
    await db.nexusContact.createMany({ data: rows })
  }
  if (convos === 0) {
    const now = Date.now()
    const threads: {
      address: string; contactName: string; unread: number
      msgs: { body: string; direction: "in" | "out"; ago: number }[]
    }[] = [
      {
        address: "0501234567", contactName: "أحمد الغامدي", unread: 2,
        msgs: [
          { body: "السلام عليكم، جاهزين لاجتماع اليوم؟", direction: "in", ago: 125 * 60e3 },
          { body: "وعليكم السلام، نعم جاهز. العرض جاهز عندي", direction: "out", ago: 120 * 60e3 },
          { body: "ممتاز، أذكّرك أن أرسل لك جدول الأعمال", direction: "in", ago: 118 * 60e3 },
          { body: "تم، استلمته. أشوفك عند الساعة الواحدة", direction: "in", ago: 30 * 60e3 },
        ],
      },
      {
        address: "0533445566", contactName: "سارة العتيبي", unread: 0,
        msgs: [
          { body: "هل أرسلت لك النسخة الأخيرة من التقرير؟", direction: "in", ago: 5 * 3600e3 },
          { body: "نعم وصلتني، شكراً سارة", direction: "out", ago: (5 * 3600e3) - 4 * 60e3 },
          { body: "العفو، بالتوفيق في العرض", direction: "in", ago: (5 * 3600e3) - 8 * 60e3 },
        ],
      },
      {
        address: "0555667788", contactName: "محمد الحربي", unread: 1,
        msgs: [
          { body: "أخي، شنو رمز شبكة المكتب؟", direction: "in", ago: 45 * 60e3 },
          { body: "NexusLink-5G والمفتاح على ظهر الراوتر", direction: "out", ago: 43 * 60e3 },
          { body: "تم، اتصلت. سرعة ممتازة ما شاء الله", direction: "in", ago: 42 * 60e3 },
        ],
      },
      {
        address: "0599887766", contactName: "فاطمة الزهراني", unread: 0,
        msgs: [
          { body: "لا تنسى تحضير ملف التسليم غداً", direction: "in", ago: 28 * 3600e3 },
          { body: "أن شاء الله جاهز، بارسله الليلة", direction: "out", ago: 27 * 3600e3 },
        ],
      },
    ]
    for (const t of threads) {
      const conv = await db.nexusConversation.create({
        data: { address: t.address, contactName: t.contactName, unread: t.unread, updatedAt: new Date(now - t.msgs[0].ago) },
      })
      for (const m of t.msgs) {
        await db.nexusMessage.create({
          data: { conversationId: conv.id, body: m.body, direction: m.direction, status: m.direction === "out" ? "delivered" : "delivered", createdAt: new Date(now - m.ago) },
        })
      }
    }
  }
  if (calls === 0) {
    const now = Date.now()
    await db.nexusCallLog.createMany({
      data: [
        { number: "0501234567", contactName: "أحمد الغامدي", direction: "in", startedAt: new Date(now - 2 * 3600e3), durationSec: 754 },
        { number: "0533445566", contactName: "سارة العتيبي", direction: "out", startedAt: new Date(now - 6 * 3600e3), durationSec: 212 },
        { number: "0577889900", contactName: "ريم الشهري", direction: "missed", startedAt: new Date(now - 9 * 3600e3), durationSec: 0 },
        { number: "0555667788", contactName: "محمد الحربي", direction: "out", startedAt: new Date(now - 26 * 3600e3), durationSec: 96 },
        { number: "0566778899", contactName: "نورة القحطاني", direction: "missed", startedAt: new Date(now - 30 * 3600e3), durationSec: 0 },
        { number: "0522334455", contactName: "خالد المطيري", direction: "in", startedAt: new Date(now - 50 * 3600e3), durationSec: 341 },
      ],
    })
  }
  seeded = true
}
