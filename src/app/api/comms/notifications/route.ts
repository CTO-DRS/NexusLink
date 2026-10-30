// /api/comms/notifications — قائمة الإشعارات المنعكسة + استقبال إشعار جديد من الجسر (مع تطبيق قواعد الفلترة)
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ensureSeed, serNotification, evaluateIngest } from "@/lib/nexus/comms-server"
import { ensureFocusRestored, readFocusState, bumpFocusSuppressed } from "@/lib/nexus/focus-state"
import { focusActive } from "@/lib/nexus/focus-core"

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
  // §52 — كتم وضع التركيز: الإشعار يُخزَّن ولا يُفقد أبدًا — يُعلَّم «مكتوم»
  // ويزيد عدّاد المكبوت في حالة التركيز (لا مؤقتات — القراءة الكسولة تحسم).
  // المكتوم عبر DND (المصدر focus) يُحسب للتركيز أيضًا — المخفي بقواعد الفلترة
  // يبقى ملكها (لا يُنسب للتركيز أبدًا).
  let status = await evaluateIngest(String(body.appId))
  let suppressedByFocus = false
  await ensureFocusRestored()
  const fstate = readFocusState()
  if (fstate && focusActive(fstate, Date.now()) && fstate.suppressMirroring && status !== "hidden") {
    if (status === "new") status = "muted"
    suppressedByFocus = true
    await bumpFocusSuppressed()
  }
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
  return NextResponse.json({ ok: true, notification: serNotification(n), suppressedByFocus })
}
