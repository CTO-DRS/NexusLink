"use client"
// NexusLink — مخزن أداء التحكم المقيس (عقد §29 — بند M1.3)
// ============================================================
// نافذة منزلقة من عينات زمن الاستجابة (ذهاب-إياب) تُغذيها قناتان:
//  · control — أوامر تحكم متقطعة حقيقية (click/key/presenter/media/power/
//    clipboard/handoff/gamepad-button) مقيسة بإقرار `rc:ack` من جسر الكمبيوتر
//    عبر مسار البوابة والمرحّل كاملًا (الهاتف → 8180 → 3004 → الجسر → عودة).
//  · ping — نبض صحة القناة (rc:ping/rc:pong — صدى الخدمة بلا كمبيوتر).
// الحساب دالٍّ نقي (pct/perfStats) قابل للاستيراد في الفحوص —
// والعتبة التعاقدية: p95 < 80ms داخل الشبكة المحلية (M1.3).
import { create } from "zustand"

export interface PerfSample {
  at: number
  rtt: number
  kind: "control" | "ping"
  ev?: string
}

/** حجم النافذة المنزلقة (عينات) — عقد §29 */
export const PERF_WINDOW = 240
/** العتبة التعاقدية M1.3 — استجابة تحكم p95 داخل الشبكة المحلية */
export const PERF_TARGET_MS = 80

/**
 * مئين بأقرب رتبة (nearest-rank) على مصفوفة مصنفة تصاعديًا —
 * p95 من 100 عينة = العنصر رقم 95 (فهرس 94) — دالٌّ نقي للفحص.
 */
export function pct(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length
  if (n === 0) return null
  const rank = Math.max(1, Math.ceil((p / 100) * n))
  return sortedAsc[Math.min(rank, n) - 1] ?? sortedAsc[n - 1]
}

export interface PerfSeries {
  n: number
  last: number | null
  p50: number | null
  p95: number | null
  max: number | null
}

export interface PerfSnapshot {
  control: PerfSeries
  ping: PerfSeries
  /** العتبة مستوفاة؟ p95 للتحكم < PERF_TARGET_MS (بحد أدنى من العينات) */
  pass: boolean
}

export function seriesStats(samples: PerfSample[]): PerfSeries {
  if (!samples.length) return { n: 0, last: null, p50: null, p95: null, max: null }
  const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b)
  return {
    n: samples.length,
    last: samples[samples.length - 1]?.rtt ?? null,
    p50: pct(rtts, 50),
    p95: pct(rtts, 95),
    max: rtts[rtts.length - 1] ?? null,
  }
}

/** دالٌّ نقي: لقطة كاملة من عينات خام — الأحدث آخرًا */
export function perfStats(samples: PerfSample[], minControl = 5): PerfSnapshot {
  const control = seriesStats(samples.filter((s) => s.kind === "control"))
  const ping = seriesStats(samples.filter((s) => s.kind === "ping"))
  const pass = control.p95 != null && control.n >= minControl && control.p95 < PERF_TARGET_MS
  return { control, ping, pass }
}

interface PerfState {
  samples: PerfSample[]
  recordControl: (rtt: number, ev: string, at?: number) => void
  recordPing: (rtt: number, at?: number) => void
  reset: () => void
  stats: () => PerfSnapshot
}

export const usePerf = create<PerfState>((set, get) => ({
  samples: [],
  recordControl: (rtt, ev, at = Date.now()) =>
    set((s) => {
      if (!Number.isFinite(rtt) || rtt < 0) return s
      const sample: PerfSample = { at, rtt, kind: "control", ev }
      return { samples: [...s.samples, sample].slice(-PERF_WINDOW) }
    }),
  recordPing: (rtt, at = Date.now()) =>
    set((s) => {
      if (!Number.isFinite(rtt) || rtt < 0) return s
      const sample: PerfSample = { at, rtt, kind: "ping" }
      return { samples: [...s.samples, sample].slice(-PERF_WINDOW) }
    }),
  reset: () => set({ samples: [] }),
  stats: () => perfStats(get().samples),
}))
