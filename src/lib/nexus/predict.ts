import { db, dbReady } from "@/lib/db"

// محرك التنبؤ الاستباقي (عقد §35.ج — عمق M2 الاختياري المعلن «روتينات
// استباقية أعمق بالتنبؤ»)
// ============================================================
// قراءة حصرًا من الجداول القائمة — **صفر تغيير مخطط** وصفر بايت يغادر
// الجهاز: توقعات إطلاق الروتينات من تاريخ الإطلاق المرسوخ (§26.ح)،
// واقتراحات روتينات جديدة من أنماط سجل العمليات وعينات الصحة — كلها
// حساب حتمي بالكامل (بلا نماذج وبلا عشوائية) بذليل «الدليل:» لكل بند
// — والاقتراح لا يُنشئ شيئًا تلقائيًا: إنشاء القاعدة بيد المستخدم دائمًا.

const DAY_MS = 864e5
export const PREDICT_WINDOW_DAYS = 14

export interface PredictForecast {
  ruleId: string
  ruleName: string
  /** daily = النمط اليومي بذات اللحظة · interval = وسيط الفترات بين الإطلاقات */
  pattern: "daily" | "interval"
  nextPredictedAt: number
  basis: {
    fires: number
    distinctDays: number
    /** للنمط اليومي: اللحظة المتكررة hh:mm */
    hhmm?: string
    /** لنمط الفترات: وسيط الفترة بين إطلاقين بالدقائق */
    medianIntervalMin?: number
    lastFiredAt: number
  }
  /** توقع فترات تأخر موعده (وسيط الفترة يضع التوقع في الماضي) — يُعرض بصدق */
  stale: boolean
}

export interface PredictSuggestion {
  id: string
  source: "oplog" | "battery"
  /** نوع العملية المرصودة (oplog) أو «battery» لعينات الصحة */
  kind: string
  deviceId: string | null
  suggestedTrigger: { kind: "time.daily"; hh: number; mm: number } | { kind: "battery.below"; threshold: number }
  occurrences: number
  distinctDays: number
  reason: string
}

export interface PredictPayload {
  ok: boolean
  generatedAt: number
  windowDays: number
  forecasts: PredictForecast[]
  suggestions: PredictSuggestion[]
  sources: { fires: number; oplog: number; healthSamples: number }
}

function dayKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** فئة نصف-ساعة لحظة معينة (بساعة الخادم المحلية — نفس دلالة time.daily) */
function bucket30(at: Date): { hh: number; mm: number } {
  const total = at.getHours() * 60 + at.getMinutes()
  const floored = Math.floor(total / 30) * 30
  return { hh: Math.floor(floored / 60), mm: floored % 60 }
}

// ---------- (أ) توقعات إطلاق الروتينات ----------

/** نمط يومي: إطلاقات ≥3 على أيام ≥3 مختلفة كلها بنفس اللحظة hh:mm حرفيًا
 *  (الإطلاق المرسوخ يحمل ثانية لكن time.daily يطلق عند دقيقة معينة —
 *  نقارن hh:mm وحدهما فتتجانس الإطلاقات على الأيام). */
function isDailyPattern(times: Date[]): { hh: number; mm: number } | null {
  if (times.length < 3) return null
  const days = new Set(times.map(dayKey))
  if (days.size < 3) return null
  const first = times[0]
  const hh = first.getHours(), mm = first.getMinutes()
  return times.every((t) => t.getHours() === hh && t.getMinutes() === mm) ? { hh, mm } : null
}

export async function computeForecasts(now = Date.now()): Promise<PredictForecast[]> {
  await dbReady
  const since = new Date(now - PREDICT_WINDOW_DAYS * DAY_MS)
  const fires = await db.nexusAutomationFire.findMany({
    where: { at: { gte: since }, ok: true, manual: false },
    select: { ruleId: true, ruleName: true, at: true },
    orderBy: { at: "asc" },
  })
  const byRule = new Map<string, { ruleName: string; times: Date[] }>()
  for (const f of fires) {
    const e = byRule.get(f.ruleId) ?? { ruleName: f.ruleName, times: [] }
    e.times.push(f.at)
    byRule.set(f.ruleId, e)
  }
  const out: PredictForecast[] = []
  for (const [ruleId, e] of byRule) {
    const times = e.times
    if (times.length < 3) continue
    const lastFiredAt = times[times.length - 1].getTime()
    const days = new Set(times.map(dayKey))
    const daily = isDailyPattern(times)
    if (daily) {
      // الموعد التالي: أول لحظة hh:mm قادمة — حلقة حتى المستقبل (لو مرّ اليوم
      // على تلك اللحظة فالتوقع غدًا، لا اليوم الماضي أبدًا)
      let next = new Date(lastFiredAt)
      next.setHours(daily.hh, daily.mm, 0, 0)
      while (next.getTime() <= now) next = new Date(next.getTime() + DAY_MS)
      out.push({
        ruleId, ruleName: e.ruleName, pattern: "daily", nextPredictedAt: next.getTime(), stale: false,
        basis: { fires: times.length, distinctDays: days.size, hhmm: `${String(daily.hh).padStart(2, "0")}:${String(daily.mm).padStart(2, "0")}`, lastFiredAt },
      })
    } else {
      // نمط الفترات: وسيط الفواصل بين الإطلاقات المتتالية
      const gaps: number[] = []
      for (let i = 1; i < times.length; i++) gaps.push(times[i].getTime() - times[i - 1].getTime())
      const med = median(gaps)
      if (!Number.isFinite(med) || med <= 0) continue
      const next = lastFiredAt + med
      out.push({
        ruleId, ruleName: e.ruleName, pattern: "interval", nextPredictedAt: next, stale: next <= now,
        basis: { fires: times.length, distinctDays: days.size, medianIntervalMin: Math.round(med / 60000), lastFiredAt },
      })
    }
  }
  return out.sort((a, b) => a.nextPredictedAt - b.nextPredictedAt).slice(0, 12)
}

// ---------- (ب) اقتراحات روتينات جديدة (بيد المستخدم دائمًا) ----------

export async function computeSuggestions(now = Date.now()): Promise<PredictSuggestion[]> {
  await dbReady
  const since = new Date(now - PREDICT_WINDOW_DAYS * DAY_MS)
  const [ops, health] = await Promise.all([
    db.prodOpLog.findMany({ where: { at: { gte: since } }, select: { kind: true, deviceId: true, at: true } }),
    db.nexusHealthSample.findMany({
      where: { createdAt: { gte: since }, battery: { lte: 30 } },
      select: { deviceId: true, battery: true, createdAt: true },
    }),
  ])

  const out: PredictSuggestion[] = []

  // (ب-1) عمليات متكررة في نفس فئة نصف الساعة على أيام مختلفة → تذكير يومي
  const opGroups = new Map<string, { kind: string; deviceId: string; hh: number; mm: number; n: number; days: Set<string> }>()
  for (const o of ops) {
    const b = bucket30(o.at)
    const key = `${o.kind}|${o.deviceId}|${b.hh}:${b.mm}`
    const e = opGroups.get(key) ?? { kind: o.kind, deviceId: o.deviceId, hh: b.hh, mm: b.mm, n: 0, days: new Set<string>() }
    e.n++
    e.days.add(dayKey(o.at))
    opGroups.set(key, e)
  }
  const opHits = [...opGroups.values()].filter((e) => e.n >= 3 && e.days.size >= 2)
    .sort((a, b) => b.n - a.n).slice(0, 4)
  for (const h of opHits) {
    const hhS = String(h.hh).padStart(2, "0"), mmS = String(h.mm).padStart(2, "0")
    out.push({
      id: `oplog-${h.kind}-${h.deviceId}-${h.hh}-${h.mm}`.replace(/[^a-z0-9-]/gi, "-"),
      source: "oplog", kind: h.kind, deviceId: h.deviceId,
      suggestedTrigger: { kind: "time.daily", hh: h.hh, mm: h.mm },
      occurrences: h.n, distinctDays: h.days.size,
      reason: `الدليل: ${h.n} مشاهدات لنوع «${h.kind}» من «${h.deviceId}» حول ${hhS}:${mmS} على ${h.days.size} أيام مختلفة`,
    })
  }

  // (ب-2) بطارية تهبط ≤30 على أيام مختلفة → روتين battery.below بعتبة يغطي الملاحظ
  const batGroups = new Map<string, { n: number; days: Set<string>; maxLow: number }>()
  for (const s of health) {
    const e = batGroups.get(s.deviceId) ?? { n: 0, days: new Set<string>(), maxLow: 0 }
    e.n++
    e.days.add(dayKey(s.createdAt))
    e.maxLow = Math.max(e.maxLow, s.battery)
    batGroups.set(s.deviceId, e)
  }
  const batHits = [...batGroups.entries()].filter(([, e]) => e.n >= 3 && e.days.size >= 2).slice(0, 2)
  for (const [deviceId, e] of batHits) {
    // العتبة: أعلى بطارية منخفضة ملاحظة مقربة لأعلى 5 — تغطي كل المشاهدات، سقف 30
    const threshold = Math.min(30, Math.max(10, Math.ceil(e.maxLow / 5) * 5))
    out.push({
      id: `battery-${deviceId}`.replace(/[^a-z0-9-]/gi, "-"),
      source: "battery", kind: "battery", deviceId,
      suggestedTrigger: { kind: "battery.below", threshold },
      occurrences: e.n, distinctDays: e.days.size,
      reason: `الدليل: ${e.n} عينات بطارية ≤ 30 للجهاز «${deviceId}» على ${e.days.size} أيام مختلفة — عتبة مقترحة ${threshold}%`,
    })
  }

  return out.slice(0, 6)
}

export async function buildPredictPayload(): Promise<PredictPayload> {
  const now = Date.now()
  const [forecasts, suggestions] = await Promise.all([computeForecasts(now), computeSuggestions(now)])
  const since = new Date(now - PREDICT_WINDOW_DAYS * DAY_MS)
  await dbReady
  const [fires, oplog, healthSamples] = await Promise.all([
    db.nexusAutomationFire.count({ where: { at: { gte: since } } }),
    db.prodOpLog.count({ where: { at: { gte: since } } }),
    db.nexusHealthSample.count({ where: { createdAt: { gte: since } } }),
  ])
  return {
    ok: true, generatedAt: now, windowDays: PREDICT_WINDOW_DAYS,
    forecasts, suggestions,
    sources: { fires, oplog, healthSamples },
  }
}
