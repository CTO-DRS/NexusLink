// NexusLink — مركز صحة الأجهزة (عقد §27): محرك القياس الزمني والتنبيهات
// ============================================================
// كل نبضة GET /api/devices تمرّ هنا (تكة قياس): تسجيل عينات (بطارية/استجابة/
// إتاحة) بخانقة 30 ثانية لكل جهاز + كشف العبورات (انقطاع/عودة/بطارية منخفضة/
// استجابة متدهورة/تخزين ممتلئ) → أحداث صحة في SQLite. الاحتفاظ 24 ساعة
// (تنقية دورية كل 5 دقائق) — تُغطي نوافذ العرض 1h/6h/24h.
// مسار الوكيل الحقيقي: POST /api/devices/health {action:"report"} يحدّث القيم
// من الجهاز فعليًا ثم يجبر تكة — فتُسجَّل القيم الحقيقية لا المحاكاة.
import { db, dbReady } from "@/lib/db"
import { store, ensureServicePulse } from "./devices"
import type { NexusDevice } from "./types"

export const SAMPLE_INTERVAL_MS = 30_000 // خانقة العينات لكل جهاز
export const RETENTION_MS = 24 * 3600_000 // الاحتفاظ 24 ساعة
export const PRUNE_EVERY_MS = 5 * 60_000 // دورية التنقية
export const LOW_BATTERY_PCT = 15 // عتبة البطارية المنخفضة (warn)
export const RTT_DEGRADED_MS = 150 // عتبة الاستجابة المتدهورة (warn)
export const STORAGE_HIGH_PCT = 90 // عتبة التخزين الممتلئ (warn)
export const MAX_POINTS = 120 // سقف نقاط السلسلة لكل جهاز (تصغير)

export const WINDOWS = { "1h": 3600_000, "6h": 6 * 3600_000, "24h": 24 * 3600_000 } as const
export type HealthWindow = keyof typeof WINDOWS

export const HEALTH_EVENT_TYPES = ["offline", "online", "low-battery", "rtt-degraded", "storage-high"] as const
export type HealthEventType = (typeof HEALTH_EVENT_TYPES)[number]

interface DevicePrev {
  online: boolean
  battery: number
  rttMs: number
  storagePct: number
}

interface HealthState {
  lastSampleAt: Map<string, number> // خانقة العينات لكل جهاز
  prev: Map<string, DevicePrev> // الحالة السابقة (كشف العبورات)
  lowBatteryWarned: Map<string, boolean> // علم العبور — حدث واحد لكل عبور
  rttWarned: Map<string, boolean>
  storageWarned: Map<string, boolean>
  lastPruneAt: number
  booted: boolean
}

const g = globalThis as unknown as { __nexusHealth?: HealthState }

function state(): HealthState {
  if (!g.__nexusHealth) {
    g.__nexusHealth = {
      lastSampleAt: new Map(),
      prev: new Map(),
      lowBatteryWarned: new Map(),
      rttWarned: new Map(),
      storageWarned: new Map(),
      lastPruneAt: 0,
      booted: false,
    }
  }
  return g.__nexusHealth
}

function snapDevice(d: NexusDevice): DevicePrev {
  return {
    online: d.state === "connected",
    battery: d.battery,
    rttMs: d.rttMs,
    storagePct: d.storageTotal ? Math.round((d.storageUsed / d.storageTotal) * 100) : 0,
  }
}

/** تكة قياس الصحة — لا تُهلِك مستدعيها أبدًا (نمط fire-and-forget الآمن):
 *  ترجع {ok, recorded, events} أو {ok:false, error} بعد الالتقاط في السجل. */
export async function recordHealthTick(
  devices: NexusDevice[],
  opts?: { force?: boolean },
): Promise<{ ok: boolean; recorded: number; events: number; error?: string }> {
  try {
    await dbReady
    ensureServicePulse() // §27.هـ: أي تكة (force/report/نبضة) تشعل النبض الذاتي الدائم
    const st = state()
    const now = Date.now()
    let events = 0

    // أول تكة بعد الإقلاع: ترسيخ الحالة السابقة بلا أحداث (منع فيض «عودة» زائف
    // عند كل إقلاع سيرفر) — إلا إذا كانت force (اختبار/زر يدوي): سجّل العينات.
    if (!st.booted) {
      st.booted = true
      st.prev = new Map(devices.map((d) => [d.id, snapDevice(d)]))
      if (!opts?.force) return { ok: true, recorded: 0, events: 0 }
    }

    // 1) كشف العبورات — على كل نبضة (قبل خانقة العينات ليبقى الكشف لحظيًا)
    for (const d of devices) {
      const p = st.prev.get(d.id)
      const cur = snapDevice(d)
      if (!p) {
        st.prev.set(d.id, cur)
        continue
      }
      // انتقال الإتافة: كل انتقال حدث مستقل بطبيعته (edge-triggered)
      if (cur.online && !p.online) {
        await db.nexusHealthEvent.create({
          data: { deviceId: d.id, deviceName: d.name, type: "online", level: "info", message: `عاد ${d.name} للاتصال` },
        })
        events++
      }
      if (!cur.online && p.online) {
        await db.nexusHealthEvent.create({
          data: { deviceId: d.id, deviceName: d.name, type: "offline", level: "warn", message: `انقطع اتصال ${d.name}` },
        })
        events++
      }
      // البطارية المنخفضة: تنبيه واحد عند العبور للأسفل، صفاء عند الصعود
      if (d.battery <= LOW_BATTERY_PCT && !st.lowBatteryWarned.get(d.id)) {
        st.lowBatteryWarned.set(d.id, true)
        await db.nexusHealthEvent.create({
          data: {
            deviceId: d.id, deviceName: d.name, type: "low-battery", level: "warn",
            message: `بطارية ${d.name} منخفضة (${d.battery}%)`,
          },
        })
        events++
      }
      if (d.battery > LOW_BATTERY_PCT) st.lowBatteryWarned.set(d.id, false)
      // الاستجابة المتدهورة: للجهاز المتصل فقط (rtt الجهاز المقطوع قيمة باقية)
      if (cur.online && d.rttMs > RTT_DEGRADED_MS && !st.rttWarned.get(d.id)) {
        st.rttWarned.set(d.id, true)
        await db.nexusHealthEvent.create({
          data: {
            deviceId: d.id, deviceName: d.name, type: "rtt-degraded", level: "warn",
            message: `استجابة ${d.name} متدهورة (${d.rttMs}ms)`,
          },
        })
        events++
      }
      if (!cur.online || d.rttMs <= RTT_DEGRADED_MS) st.rttWarned.set(d.id, false)
      // التخزين شبه الممتلئ
      if (cur.storagePct >= STORAGE_HIGH_PCT && !st.storageWarned.get(d.id)) {
        st.storageWarned.set(d.id, true)
        await db.nexusHealthEvent.create({
          data: {
            deviceId: d.id, deviceName: d.name, type: "storage-high", level: "warn",
            message: `تخزين ${d.name} شبه ممتلئ (${cur.storagePct}%)`,
          },
        })
        events++
      }
      if (cur.storagePct < STORAGE_HIGH_PCT) st.storageWarned.set(d.id, false)
      st.prev.set(d.id, cur)
    }

    // 2) العينات — خانقة SAMPLE_INTERVAL_MS لكل جهاز (force يتجاوز الخانقة)
    // storagePct يُؤرشف مع كل عينة (§26.ط) — دليل التخزين التاريخي لمشغّل
    // health.storage.sustained: «بقاء التخزين فوق عتبة لمدة».
    const rows: { deviceId: string; battery: number; rttMs: number; online: boolean; storagePct: number }[] = []
    for (const d of devices) {
      if (!opts?.force && now - (st.lastSampleAt.get(d.id) ?? 0) < SAMPLE_INTERVAL_MS) continue
      st.lastSampleAt.set(d.id, now)
      rows.push({ deviceId: d.id, battery: d.battery, rttMs: d.rttMs, online: d.state === "connected", storagePct: d.storageTotal ? Math.round((d.storageUsed / d.storageTotal) * 100) : 0 })
    }
    if (rows.length) await db.nexusHealthSample.createMany({ data: rows })

    // 3) تنقية دورية فوق 24 ساعة (عينات + أحداث)
    if (now - st.lastPruneAt > PRUNE_EVERY_MS) {
      st.lastPruneAt = now
      const cutoff = new Date(now - RETENTION_MS)
      await db.nexusHealthSample.deleteMany({ where: { createdAt: { lt: cutoff } } })
      await db.nexusHealthEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
    }

    return { ok: true, recorded: rows.length, events }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error("[health] tick failed:", error)
    return { ok: false, recorded: 0, events: 0, error }
  }
}

export interface HealthPoint {
  t: number
  battery: number
  rttMs: number
  online: boolean
}

export interface HealthDeviceSeries {
  deviceId: string
  name: string
  kind: string
  online: boolean
  points: HealthPoint[]
  uptimePct: number | null // إتاحة النافذة (null = لا عينات)
  avgRttMs: number | null
  minBattery: number | null
  samples: number
}

export interface HealthSnapshot {
  window: HealthWindow
  since: number
  devices: HealthDeviceSeries[]
  series: {
    battery: { t: number; [deviceId: string]: number | null }[]
    rtt: { t: number; [deviceId: string]: number | null }[]
  }
  events: { id: string; deviceId: string; deviceName: string; type: string; level: string; message: string; createdAt: number }[]
  alerts: { id: string; deviceId: string; deviceName: string; type: string; level: string; message: string; createdAt: number }[]
  counts: { samples: number; events: number }
}

/** لقطة الصحة: سلاسل مخففة (≤60 دلوًا زمنيًا) للمخططات + ملخص لكل جهاز + أحداث النافذة. */
export async function getHealthSnapshot(window: HealthWindow, deviceId: string): Promise<HealthSnapshot> {
  await dbReady
  const span = WINDOWS[window] ?? WINDOWS["1h"]
  const since = new Date(Date.now() - span)
  const only = deviceId && deviceId !== "all" ? deviceId : null

  const [samples, events] = await Promise.all([
    db.nexusHealthSample.findMany({
      where: { createdAt: { gte: since }, ...(only ? { deviceId: only } : {}) },
      orderBy: { createdAt: "asc" },
    }),
    db.nexusHealthEvent.findMany({
      where: { createdAt: { gte: since }, ...(only ? { deviceId: only } : {}) },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ])

  const s = store()
  const byId = new Map<string, NexusDevice>(s.devices.map((d) => [d.id, d]))
  const ids: string[] = only
    ? [only]
    : // كل الأجهزة المقترنة + أي أجهزة لها عينات (حذف اقتران لا يمحو التاريخ)
      [...new Set([...s.devices.map((d) => d.id), ...new Set(samples.map((x) => x.deviceId))])]

  // سلاسل لكل جهاز (تصغير ≤ MAX_POINTS للملخص)
  const per = new Map<string, HealthPoint[]>()
  for (const id of ids) per.set(id, [])
  for (const x of samples) {
    const arr = per.get(x.deviceId)
    if (arr) arr.push({ t: x.createdAt.getTime(), battery: x.battery, rttMs: x.rttMs, online: x.online })
  }

  const devices: HealthDeviceSeries[] = ids.map((id) => {
    const pts = per.get(id) ?? []
    const d = byId.get(id)
    const onlineCount = pts.filter((p) => p.online).length
    return {
      deviceId: id,
      name: d?.name ?? id,
      kind: d?.kind ?? "phone",
      online: d ? d.state === "connected" : false,
      points: downsample(pts, MAX_POINTS),
      uptimePct: pts.length ? Math.round((onlineCount / pts.length) * 1000) / 10 : null,
      avgRttMs: pts.length ? Math.round(pts.reduce((a, p) => a + p.rttMs, 0) / pts.length) : null,
      minBattery: pts.length ? Math.min(...pts.map((p) => p.battery)) : null,
      samples: pts.length,
    }
  })

  // دلو زمني موحّد للمخططات (60 دلوًا عبر النافذة): قيمة كل جهاز = متوسط دلوِه —
  // rtt من العينات المتصلة فقط (قيمة الجهاز المقطوع باقية ولا تُضلّل المخطط).
  const BUCKETS = 60
  const bucketMs = Math.max(1000, Math.floor(span / BUCKETS))
  const t0 = since.getTime()
  const batteryRows: { t: number; [k: string]: number | null }[] = []
  const rttRows: { t: number; [k: string]: number | null }[] = []
  for (let i = 0; i < BUCKETS; i++) {
    const bt = t0 + i * bucketMs
    const bend = bt + bucketMs
    const brow: { t: number; [k: string]: number | null } = { t: bt }
    const rrow: { t: number; [k: string]: number | null } = { t: bt }
    let anyB = false
    let anyR = false
    for (const id of ids) {
      const inBucket = (per.get(id) ?? []).filter((p) => p.t >= bt && p.t < bend)
      if (inBucket.length) {
        brow[id] = Math.round(inBucket.reduce((a, p) => a + p.battery, 0) / inBucket.length)
        anyB = true
        const on = inBucket.filter((p) => p.online)
        if (on.length) {
          rrow[id] = Math.round(on.reduce((a, p) => a + p.rttMs, 0) / on.length)
          anyR = true
        } else {
          rrow[id] = null
        }
      } else {
        brow[id] = null
        rrow[id] = null
      }
    }
    // صفوف بلا أي قيمة تُهمل (بداية النافذة قبل أول عينة)
    if (anyB) batteryRows.push(brow)
    if (anyR) rttRows.push(rrow)
  }

  return {
    window,
    since: since.getTime(),
    devices,
    series: { battery: batteryRows, rtt: rttRows },
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.getTime() })),
    alerts: events.filter((e) => e.level === "warn").slice(0, 12).map((e) => ({ ...e, createdAt: e.createdAt.getTime() })),
    counts: { samples: samples.length, events: events.length },
  }
}

function downsample(pts: HealthPoint[], max: number): HealthPoint[] {
  if (pts.length <= max) return pts
  const bucket = Math.ceil(pts.length / max)
  const out: HealthPoint[] = []
  for (let i = 0; i < pts.length; i += bucket) {
    const slice = pts.slice(i, i + bucket)
    out.push({
      t: slice[0].t,
      battery: Math.round(slice.reduce((a, p) => a + p.battery, 0) / slice.length),
      rttMs: Math.round(slice.reduce((a, p) => a + p.rttMs, 0) / slice.length),
      online: slice.filter((p) => p.online).length > slice.length / 2,
    })
  }
  return out
}
