"use client"
// NexusLink — لوحة قياس أداء التحكم الحية (عقد §29 — بند M1.3)
// ============================================================
// شارة مصغّرة دائمة (الحالي + p95 بلون العتبة) + لوحة موسّعة عند اللمس:
// p50/p95/الأقصى/عدد العينات لكل سلسلة (تحكم حقيقي عبر الإقرارات + نبض
// القناة) وحالة العتبة التعاقدية 80ms داخل الشبكة المحلية.
import { useState } from "react"
import { Activity, ChevronDown, ChevronUp } from "lucide-react"
import { usePerf, perfStats, PERF_TARGET_MS, PERF_WINDOW, type PerfSnapshot } from "@/lib/perf-store"

function ms(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}ms`
}

function thresholdCls(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground"
  return v < PERF_TARGET_MS ? "text-emerald-500" : v < PERF_TARGET_MS * 2 ? "text-amber-500" : "text-red-500"
}

/** الصف الداخلي للوحة الموسّعة — سلسلة واحدة */
function SeriesRow({ label, s }: { label: string; s: PerfSnapshot["control"] }) {
  return (
    <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr] gap-1.5 items-baseline text-[9.5px] tabular-nums" dir="rtl">
      <span className="font-bold text-foreground/80">{label}</span>
      <span className="text-muted-foreground" title="آخر قياس">{ms(s.last)}</span>
      <span title="الوسيط p50">{ms(s.p50)}</span>
      <span className={`font-bold ${thresholdCls(s.p95)}`} title="الشريط المئيني 95">{ms(s.p95)}</span>
      <span className="text-muted-foreground" title="الأقصى">{ms(s.max)}</span>
    </div>
  )
}

/**
 * شارة الأداء الحية — تُدمج في شريط حالة وحدة التحكم.
 * `expanded` يعرض اللوحة الكاملة (تُستعمل منفصلة في واجهة الكمبيوتر أيضًا).
 */
export function PerfBadge({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  // مرجع مستقر للعينات (يتغير عند التسجيل حصرًا) + حساب نقي محلي —
  // لا منتقي يعيد كائنًا جديدًا كل لقطة (درس zustand)
  const samples = usePerf((s) => s.samples)
  const stats = perfStats(samples)
  const c = stats.control
  const cls = thresholdCls(c.p95)

  return (
    <div className={compact ? "inline-flex" : ""}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={`لوحة الأداء — عتبة ${PERF_TARGET_MS}ms (M1.3)`}
        className={`flex items-center gap-1 text-[9px] font-bold rounded-full border px-1.5 py-0.5 transition-colors ${
          c.p95 == null
            ? "border-border text-muted-foreground"
            : stats.pass
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-amber-500/40 bg-amber-500/10"
        }`}
      >
        <Activity className="w-2.5 h-2.5" />
        <span className={`tabular-nums ${cls}`} dir="ltr">p95 {ms(c.p95)}</span>
        <span className="text-muted-foreground tabular-nums" dir="ltr">·{c.n}</span>
        {open ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
      </button>
      {open && (
        <div className="mt-1.5 rounded-xl border bg-card/80 backdrop-blur px-2.5 py-2 shadow-sm w-[min(92vw,340px)]" dir="rtl">
          <p className="text-[10px] font-bold flex items-center gap-1 mb-1.5">
            <Activity className="w-3 h-3 text-primary" />
            أداء التحكم الحي — النافذة الأخيرة {PERF_WINDOW} قياسًا
          </p>
          <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr] gap-1.5 text-[8.5px] text-muted-foreground mb-0.5" dir="rtl">
            <span>السلسلة</span><span>الآن</span><span>p50</span><span>p95</span><span>الأقصى</span>
          </div>
          <SeriesRow label="تحكم (إقرار)" s={c} />
          <SeriesRow label="نبض القناة" s={stats.ping} />
          <p className="mt-1.5 text-[8.5px] leading-relaxed text-muted-foreground border-t pt-1.5">
            العتبة التعاقدية: استجابة تحكم p95 &lt; {PERF_TARGET_MS}ms داخل الشبكة المحلية (M1.3) —{" "}
            <span className={`font-bold ${stats.pass ? "text-emerald-500" : "text-amber-500"}`}>
              {stats.pass ? "مستوفاة ✓" : c.p95 == null ? "بانتظار عينات" : "تجاوزت"}
            </span>
            {" "}— القياس ذهاب-إياب حقيقي عبر البوابة والمرحّل حتى تطبيق الجسر (عقد §29).
          </p>
        </div>
      )}
    </div>
  )
}
