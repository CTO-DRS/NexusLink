import { NextResponse } from "next/server"
import { db, dbReady } from "@/lib/db"
import { pairStats } from "@/lib/pair-math"
import { listPairMetrics } from "@/lib/nexus/pair-metrics"

export const dynamic = "force-dynamic"

// لوحة رؤى الاستخدام المحلية (عقد §33.د — M2.4)
// ==============================================
// تجميعات من الجداول المحلية القائمة حصرًا — بلا أي جدول جديد وبلا أي بايت
// خارج الجهاز: نافذة 14 يومًا للعمليات والإطلاقات والمزامنة، و7 أيام للرسائل،
// ومقاييس الاقتران (نفس رياضيات §30 pairStats)، وأعلى الأجهزة نشاطًا.
// كل الأرقام أعداد/أزمنة/أحجام — لا محتوى رسائل ولا نصوص حافظة (F6 متوافق).

const DAY_MS = 864e5
const DAYS = 14

function dayKey(at: Date): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export interface InsightsPayload {
  ok: boolean
  windowDays: number
  generatedAt: number
  opsDaily: Array<{ day: string; total: number }>
  opsKinds: Array<{ kind: string; count: number }>
  firesDaily: Array<{ day: string; total: number }>
  firesTotal: number
  clips: { total: number; last7d: number; bytes: number }
  sync: { events14d: number; bytes14d: number }
  messages: { in7d: number; out7d: number }
  pairs: { count: number; completed: number; pass: number; p95Ms: number | null }
  health: { samples: number; devicesReporting: number }
  topDevices: Array<{ deviceId: string; count: number }>
}

export async function GET() {
  try {
    await dbReady
    const since14 = new Date(Date.now() - DAYS * DAY_MS)
    const since7 = new Date(Date.now() - 7 * DAY_MS)

    const [ops, fires, clipsTotal, clips7, clipsAgg, syncAgg, msgsAgg, pairs, samplesAgg, opsByDev] = await Promise.all([
      db.prodOpLog.findMany({ where: { at: { gte: since14 } }, select: { at: true, kind: true, deviceId: true } }),
      db.nexusAutomationFire.findMany({ where: { at: { gte: since14 } }, select: { at: true } }),
      db.prodClip.count(),
      db.prodClip.count({ where: { createdAt: { gte: since7 } } }),
      db.prodClip.aggregate({ _sum: { size: true } }),
      db.syncEvent.aggregate({ where: { at: { gte: since14 } }, _count: { _all: true }, _sum: { bytes: true } }),
      db.nexusMessage.groupBy({ by: ["direction"], where: { createdAt: { gte: since7 } }, _count: { _all: true } }),
      listPairMetrics(200),
      db.nexusHealthSample.aggregate({ _count: { _all: true } }),
      db.prodOpLog.groupBy({ by: ["deviceId"], _count: { _all: true }, orderBy: { _count: { deviceId: "desc" } }, take: 5 }),
    ])

    // سلاسل يومية متصلة (14 يومًا كاملة — الأيام الفارغة صفر بصدق لا حذف)
    const opsDailyMap = new Map<string, number>()
    const firesDailyMap = new Map<string, number>()
    for (let i = DAYS - 1; i >= 0; i--) {
      const key = dayKey(new Date(Date.now() - i * DAY_MS))
      opsDailyMap.set(key, 0)
      firesDailyMap.set(key, 0)
    }
    for (const op of ops) {
      const k = dayKey(op.at)
      if (opsDailyMap.has(k)) opsDailyMap.set(k, (opsDailyMap.get(k) ?? 0) + 1)
    }
    for (const f of fires) {
      const k = dayKey(f.at)
      if (firesDailyMap.has(k)) firesDailyMap.set(k, (firesDailyMap.get(k) ?? 0) + 1)
    }
    const kindMap = new Map<string, number>()
    for (const op of ops) kindMap.set(op.kind, (kindMap.get(op.kind) ?? 0) + 1)

    const devicesReporting = await db.nexusHealthSample.groupBy({ by: ["deviceId"], _count: { _all: true } })
    const ps = pairStats(pairs)

    const payload: InsightsPayload = {
      ok: true,
      windowDays: DAYS,
      generatedAt: Date.now(),
      opsDaily: [...opsDailyMap].map(([day, total]) => ({ day, total })),
      opsKinds: [...kindMap].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      firesDaily: [...firesDailyMap].map(([day, total]) => ({ day, total })),
      firesTotal: fires.length,
      clips: { total: clipsTotal, last7d: clips7, bytes: clipsAgg._sum.size ?? 0 },
      sync: { events14d: syncAgg._count._all, bytes14d: syncAgg._sum.bytes ?? 0 },
      messages: {
        in7d: Number(msgsAgg.find((m) => m.direction === "in")?._count._all ?? 0),
        out7d: Number(msgsAgg.find((m) => m.direction === "out")?._count._all ?? 0),
      },
      pairs: { count: pairs.length, completed: pairs.filter((p) => p.pairToFirstValueMs != null).length, pass: pairs.filter((p) => p.pass === true).length, p95Ms: ps.p95 ?? null },
      health: { samples: samplesAgg._count._all, devicesReporting: devicesReporting.length },
      topDevices: opsByDev.map((d) => ({ deviceId: d.deviceId, count: d._count._all })),
    }
    return NextResponse.json(payload)
  } catch {
    const empty: InsightsPayload = {
      ok: false, windowDays: DAYS, generatedAt: Date.now(),
      opsDaily: [], opsKinds: [], firesDaily: [], firesTotal: 0,
      clips: { total: 0, last7d: 0, bytes: 0 }, sync: { events14d: 0, bytes14d: 0 },
      messages: { in7d: 0, out7d: 0 }, pairs: { count: 0, completed: 0, pass: 0, p95Ms: null },
      health: { samples: 0, devicesReporting: 0 }, topDevices: [],
    }
    return NextResponse.json(empty, { status: 200 })
  }
}
