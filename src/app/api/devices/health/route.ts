// NexusLink — مركز صحة الأجهزة (عقد §27)
// ============================================================
// GET  /api/devices/health?device=<id|all>&window=<1h|6h|24h>
//   → لقطة الصحة: سلاسل مخففة للمخططات (بطارية/استجابة) + ملخص لكل جهاز
//     (إتاحة/متوسط استجابة/أدنى بطارية/عينات) + أحداث وتنبيهات النافذة.
// POST /api/devices/health
//   {action:"force-sample"}                       → يجبر تكة قياس فورية (تجاوز الخانقة) — زر «التقاط عينة الآن» وأدوات التحقق
//   {action:"report", deviceId, battery?, rttMs?} → مسار الوكيل الحقيقي: قيم فعلية من الجهاز تُحدَّث في السجل وتُسجَّل عينة
import { NextRequest, NextResponse } from "next/server"
import { store } from "@/lib/nexus/devices"
import {
  recordHealthTick, getHealthSnapshot, WINDOWS,
  LOW_BATTERY_PCT, RTT_DEGRADED_MS, STORAGE_HIGH_PCT, RETENTION_MS, SAMPLE_INTERVAL_MS,
  type HealthWindow,
} from "@/lib/nexus/health"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const w = (sp.get("window") ?? "1h") as HealthWindow
  const window: HealthWindow = w in WINDOWS ? w : "1h"
  const device = sp.get("device") || "all"
  const snap = await getHealthSnapshot(window, device)
  return NextResponse.json({ ...snap, limits: { LOW_BATTERY_PCT, RTT_DEGRADED_MS, STORAGE_HIGH_PCT, RETENTION_MS, SAMPLE_INTERVAL_MS } })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = body.action as string

  if (action === "force-sample") {
    const r = await recordHealthTick(store().devices, { force: true })
    return NextResponse.json({ ok: r.ok, recorded: r.recorded, events: r.events, error: r.error })
  }

  if (action === "report") {
    // مسار الوكيل الحقيقي (عقد §27): الهاتف يدفع بطارية/استجابة فعليتين —
    // تُحدَّث في سجل الأجهزة ثم تكة force فتُسجَّل العينة وتُقيَّم العبورات.
    const d = store().devices.find((x) => x.id === body.deviceId)
    if (!d) return NextResponse.json({ error: "الجهاز غير موجود" }, { status: 404 })
    if (body.battery === undefined && body.rttMs === undefined) {
      return NextResponse.json({ error: "لا قيم في التقرير — أرسل battery و/أو rttMs" }, { status: 400 })
    }
    if (body.battery !== undefined) {
      if (typeof body.battery !== "number" || !Number.isFinite(body.battery)) {
        return NextResponse.json({ error: "battery يجب أن يكون رقمًا" }, { status: 400 })
      }
      d.battery = Math.max(0, Math.min(100, Math.round(body.battery)))
    }
    if (body.rttMs !== undefined) {
      if (typeof body.rttMs !== "number" || !Number.isFinite(body.rttMs) || body.rttMs < 0) {
        return NextResponse.json({ error: "rttMs يجب أن يكون رقمًا ≥ 0" }, { status: 400 })
      }
      d.rttMs = Math.max(0, Math.round(body.rttMs))
    }
    if (d.state === "connected") d.lastSeen = Date.now()
    const r = await recordHealthTick(store().devices, { force: true })
    return NextResponse.json({ ok: r.ok, device: { id: d.id, name: d.name, battery: d.battery, rttMs: d.rttMs }, recorded: r.recorded, events: r.events })
  }

  return NextResponse.json({ error: "action غير معروف — المتاح: force-sample | report" }, { status: 400 })
}
