// NexusLink — مشغلات الصحة التاريخية للروتينات (عقد §26.و)
// ============================================================
// الربط بين «محرك الروتينات» (§26) و«مركز صحة الأجهزة» (§27): تقييم قواعد
// «شرط مستمر لمدة زمنية» من العينات المؤرشفة في NexusHealthSample — لا من
// اللحظة الحالية. مثال المالك: «نبّهني إذا كانت بطارية X تحت 15% لمدة ساعة».
//
// دلالات «سلسلة الدليل» (للبطارية/الاستجابة):
//   المرساة anchor = آخر عينة قبل بداية المدة (تثبت أن الشرط محقق عند البداية)
//   النافذة  = عينات [الآن − المدة، الآن] — كلها يجب أن تستوفي الشرط + ≥ 2
//   الفجوات  = تسامح max(5 دقائق، المدة/4) بسقف 60 دقيقة — فجوة أكبر تقطع
//              سلسلة الاستمرارية (لا يمكن إثبات الشرط أثناء الصمت)
//   التقادم  = المرساة الأقدم من المدة + 10 دقائق دليل متقادم (الجهاز توقف
//              عن الإبلاغ طويلًا — لا يُحسب تاريخًا حاضرًا)
// الصمت (health.silence.sustained): لا عينات خلال المدة لجهاز معروف الإبلاغ
//   (له عينة داخل آخر 24 ساعة) — الجهاز الذي لم يُبلّغ قط لا يُطلق صمتًا زائفًا.
// البطارية تُقرأ من كل العينات (آخر قيمة معروولة حتى أثناء الانقطاع)، والاستجابة
// من العينات المتصلة فقط (نمط §27 — rtt الجهاز المقطوع قيمة باقية لا تُضلّل).
// التخزين (§26.ط) يُقرأ من العينات المتصلة فقط — القيمة المؤرشفة للجهاز المقطوع باقية (آخر
// قيمة معروفة) وقد تُضلّل بعد تفريغ مساحة خارجيًا؛ متطلب الاتصال يجعل الامتلاء المستمر
// دليلًا حاضرًا لا قيمة باقية — نمط rtt نفسه (§27).
import { db, dbReady } from "@/lib/db"
import { isSustainedTrigger, type AutoTrigger, type TriggerKind } from "./automation-types"

/** سقف المدة = سقف الاحتفاظ بالعينات في §27 (24 ساعة). */
export const MAX_DURATION_MIN = 1440
export const MIN_DURATION_MIN = 1
/** المرساة الأقدم من المدة + هذا الحد = دليل متقادم. */
export const ANCHOR_STALE_MS = 10 * 60_000
/** تسامح الفجوة: ربع المدة بأدنى 5 دقائق وبسقف 60 دقيقة. */
export function gapAllowanceMs(durationMin: number): number {
  return Math.min(Math.max(5 * 60_000, (durationMin * 60_000) / 4), 60 * 60_000)
}

export interface SustainedEvidence {
  samples: number
  spanMin: number | null
  anchorAgeMin: number | null
  lastAgeMin: number | null
}

export interface SustainedVerdict {
  satisfied: boolean
  /** تفصيل عربي صادق — يظهر في سجل التشغيل وفي تفصيل الإشعار. */
  reason: string
  evidence: SustainedEvidence
}

const NO_EV: SustainedEvidence = { samples: 0, spanMin: null, anchorAgeMin: null, lastAgeMin: null }

function mins(ms: number) { return Math.round(ms / 60_000) }

function condMet(kind: TriggerKind, threshold: number, s: { battery: number; rttMs: number; online: boolean; storagePct: number }): boolean {
  if (kind === "health.battery.sustained") return s.battery <= threshold
  if (kind === "health.rtt.sustained") return s.online && s.rttMs >= threshold
  if (kind === "health.storage.sustained") return s.online && s.storagePct >= threshold
  return true
}

function describeCond(kind: TriggerKind, threshold: number, deviceId: string): string {
  if (kind === "health.battery.sustained") return `بطارية «${deviceId}» تحت ${threshold}%`
  if (kind === "health.rtt.sustained") return `استجابة «${deviceId}» فوق ${threshold}ms`
  if (kind === "health.storage.sustained") return `تخزين «${deviceId}» فوق ${threshold}%`
  return `صمت «${deviceId}» عن تقارير الصحة`
}

/** قيمة العينة الجوهرية للنوع — تظهر في تفاصيل المخالفة والأدلة. */
function sampleValue(kind: TriggerKind, s: { battery: number; rttMs: number; storagePct: number }): string {
  if (kind === "health.battery.sustained") return `${s.battery}%`
  if (kind === "health.rtt.sustained") return `${s.rttMs}ms`
  return `${s.storagePct}%`
}

/** تقييم شرط مستمر لجهاز واحد من عيناته المؤرشفة. */
async function evalForDevice(
  kind: TriggerKind, threshold: number, durationMin: number, deviceId: string, now: number,
): Promise<SustainedVerdict> {
  const D = durationMin * 60_000
  const winStart = now - D
  const gap = gapAllowanceMs(durationMin)

  // ---- الصمت: لا عينات خلال المدة لجهاز معروف الإبلاغ ----
  if (kind === "health.silence.sustained") {
    const [lastInWin, lastKnown] = await Promise.all([
      db.nexusHealthSample.findFirst({ where: { deviceId, createdAt: { gte: new Date(winStart) } }, orderBy: { createdAt: "desc" } }),
      db.nexusHealthSample.findFirst({ where: { deviceId }, orderBy: { createdAt: "desc" } }),
    ])
    if (!lastKnown) {
      return { satisfied: false, reason: `«${deviceId}» لم يُبلّغ صحة قط — لا معنى لصمت مقيس`, evidence: NO_EV }
    }
    if (lastInWin) {
      return {
        satisfied: false,
        reason: `«${deviceId}» أبلغ صحة قبل ${mins(now - lastInWin.createdAt.getTime())} دقيقة — الصمت لم يكتمل`,
        evidence: { ...NO_EV, samples: 1, lastAgeMin: mins(now - lastInWin.createdAt.getTime()) },
      }
    }
    const silenceMin = mins(now - lastKnown.createdAt.getTime())
    if (silenceMin < durationMin) {
      return {
        satisfied: false,
        reason: `صمت «${deviceId}» ${silenceMin} دقيقة — أقل من المدة المطلوبة (${durationMin})`,
        evidence: { ...NO_EV, samples: 1, lastAgeMin: silenceMin },
      }
    }
    return {
      satisfied: true,
      reason: `«${deviceId}» بلا تقارير صحة منذ ${silenceMin} دقيقة (المطلوب ${durationMin})`,
      evidence: { samples: 1, spanMin: silenceMin, anchorAgeMin: silenceMin, lastAgeMin: silenceMin },
    }
  }

  // ---- البطارية/الاستجابة: سلسلة الدليل ----
  const rows = await db.nexusHealthSample.findMany({
    where: { deviceId, createdAt: { gte: new Date(winStart - ANCHOR_STALE_MS - gap) } },
    orderBy: { createdAt: "asc" },
  })
  const anchor = [...rows].reverse().find((s) => s.createdAt.getTime() <= winStart)
  const inWin = rows.filter((s) => s.createdAt.getTime() > winStart)

  if (!anchor) {
    return {
      satisfied: false,
      reason: `${describeCond(kind, threshold, deviceId)}: لا دليل تاريخي يسبق بداية المدة — لا يمكن إثبات الاستمرارية بعد`,
      evidence: NO_EV,
    }
  }
  const anchorAge = now - anchor.createdAt.getTime()
  if (anchorAge > D + ANCHOR_STALE_MS) {
    return {
      satisfied: false,
      reason: `${describeCond(kind, threshold, deviceId)}: أقدم دليل متقادم (${mins(anchorAge)} دقيقة) — الجهاز توقف عن الإبلاغ`,
      evidence: { samples: rows.length, spanMin: null, anchorAgeMin: mins(anchorAge), lastAgeMin: null },
    }
  }
  if (!condMet(kind, threshold, anchor)) {
    const val = sampleValue(kind, anchor)
    return {
      satisfied: false,
      reason: `${describeCond(kind, threshold, deviceId)}: الدليل عند بداية المدة مخالف (${val})`,
      evidence: { samples: rows.length, spanMin: mins(now - anchor.createdAt.getTime()), anchorAgeMin: mins(anchorAge), lastAgeMin: null },
    }
  }
  if (inWin.length < 2) {
    return {
      satisfied: false,
      reason: `${describeCond(kind, threshold, deviceId)}: عينات داخل المدة أقل من اثنتين — لا دليل نشاط كافٍ`,
      evidence: { samples: rows.length, spanMin: mins(now - anchor.createdAt.getTime()), anchorAgeMin: mins(anchorAge), lastAgeMin: null },
    }
  }
  const bad = inWin.find((s) => !condMet(kind, threshold, s))
  if (bad) {
    const val = sampleValue(kind, bad)
    return {
      satisfied: false,
      reason: `${describeCond(kind, threshold, deviceId)}: عينة مخالفة داخل المدة (${val} قبل ${mins(now - bad.createdAt.getTime())} دقيقة)`,
      evidence: { samples: rows.length, spanMin: mins(now - anchor.createdAt.getTime()), anchorAgeMin: mins(anchorAge), lastAgeMin: mins(now - bad.createdAt.getTime()) },
    }
  }
  const chain = [anchor, ...inWin]
  let maxGap = 0
  for (let i = 1; i < chain.length; i++) maxGap = Math.max(maxGap, chain[i].createdAt.getTime() - chain[i - 1].createdAt.getTime())
  maxGap = Math.max(maxGap, now - chain[chain.length - 1].createdAt.getTime())
  if (maxGap > gap) {
    return {
      satisfied: false,
      reason: `${describeCond(kind, threshold, deviceId)}: فجوة عينات ${mins(maxGap)} دقيقة تتجاوز التسامح (${mins(gap)}) — الاستمرارية غير مثبتة`,
      evidence: { samples: chain.length, spanMin: mins(now - anchor.createdAt.getTime()), anchorAgeMin: mins(anchorAge), lastAgeMin: mins(now - chain[chain.length - 1].createdAt.getTime()) },
    }
  }
  return {
    satisfied: true,
    reason: `${describeCond(kind, threshold, deviceId)} مستمر منذ ${durationMin} دقيقة وفق التاريخ المسجل (${chain.length} عينة دليل)`,
    evidence: {
      samples: chain.length,
      spanMin: mins(now - anchor.createdAt.getTime()),
      anchorAgeMin: mins(anchorAge),
      lastAgeMin: mins(now - chain[chain.length - 1].createdAt.getTime()),
    },
  }
}

/** تقييم مشغل تاريخي مستمر — جهاز محدد أو أي جهاز يستوفي الشرط من التاريخ الحالي. */
export async function evalSustainedTrigger(trigger: AutoTrigger, now = Date.now()): Promise<SustainedVerdict> {
  try {
    await dbReady
    if (!isSustainedTrigger(trigger.kind)) {
      return { satisfied: false, reason: `ليس مشغلًا تاريخيًا: ${trigger.kind}`, evidence: NO_EV }
    }
    const durationMin = Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Math.round(trigger.durationMin ?? 60)))
    const threshold = Math.round(trigger.threshold ?? 0)
    if (trigger.deviceId) {
      return await evalForDevice(trigger.kind, threshold, durationMin, trigger.deviceId, now)
    }
    // أي جهاز: المرشحون = أجهزة السجل + كل من له عينات داخل آخر 24 ساعة
    const idRows = await db.nexusHealthSample.findMany({
      where: { createdAt: { gte: new Date(now - 24 * 3600_000) } },
      select: { deviceId: true },
      distinct: ["deviceId"],
    })
    const ids = [...new Set(idRows.map((r) => r.deviceId))]
    for (const id of ids) {
      const v = await evalForDevice(trigger.kind, threshold, durationMin, id, now)
      if (v.satisfied) return v
    }
    return {
      satisfied: false,
      reason: "لا جهاز يستوفي الشرط المستمر من التاريخ الحالي",
      evidence: NO_EV,
    }
  } catch (e) {
    return { satisfied: false, reason: `فشل تقييم التاريخ: ${e instanceof Error ? e.message : String(e)}`, evidence: NO_EV }
  }
}
