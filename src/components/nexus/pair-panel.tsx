"use client"
// NexusLink — لوحة قياس الاقتران الفوري الحية (عقد §30 — بند M1.1)
// ============================================================
// شارة مصغّرة (إجمالي آخر اقتران مكتمل بلون العتبة) + لوحة موسّعة عند
// اللمس: qr→pair / pair→أول قيمة / الإجمالي / p95 / الأقصى / نسبة الاجتياز
// وسجل آخر الاقترانات — قراءة REST دورية عند الفتح (بيانات وصفية حصرًا).
// العتبة التعاقدية: من إصدار QR إلى أول قيمة أقل من 30 ثانية (M1.1).
import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronUp, Zap } from "lucide-react"
import { pairStats, PAIR_TARGET_MS, type PairEntry, type PairSnapshot } from "@/lib/pair-math"

function sec(v: number | null): string {
  if (v == null) return "—"
  return v >= 1000 ? `${(v / 1000).toFixed(1)}ث` : `${v}ms`
}

function thresholdCls(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground"
  return v < PAIR_TARGET_MS ? "text-emerald-500" : v < PAIR_TARGET_MS * 2 ? "text-amber-500" : "text-red-500"
}

interface PairApi {
  ok: boolean
  targetMs: number
  stats: PairSnapshot
  entries: PairEntry[]
}

const KIND_LABEL: Record<string, string> = { prod: "حافظة/تسليم", control: "جلسة تحكم" }

/** لوحة الاقتران الموسّعة — تُستعمل مستقلة في واجهة الأجهزة */
export function PairPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<PairApi | null>(null)

  const load = useCallback(() => {
    fetch("/api/pair-metrics", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: PairApi) => setData(j))
      .catch(() => null)
  }, [])

  useEffect(() => {
    load()
    // نبض حي فقط عند الفتح — بلا استنزاف خلفي (نمط اللوحات الحية §29)
    if (!open) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [open, load])

  const stats = data?.stats ?? pairStats([])
  const last = stats.last
  const cls = thresholdCls(last)

  return (
    <div className="rounded-xl border border-border/60 bg-card/40">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={`قياس الاقتران الفوري — عتبة ${PAIR_TARGET_MS / 1000}ث (M1.1)`}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-start"
      >
        <Zap className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-bold text-foreground/90">اقتران فوري</span>
        <span className={`text-[11px] font-bold tabular-nums ${cls}`} title="إجمالي آخر اقتران مكتمل (QR → أول قيمة)">
          {sec(last)}
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums" title="نسبة الاجتياز على المكتملة">
          {stats.passRate != null ? `${Math.round(stats.passRate * 100)}%` : "—"}
        </span>
        <span className={`ms-auto inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
          stats.pass ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-border text-muted-foreground"
        }`}>
          {stats.pass ? `< ${PAIR_TARGET_MS / 1000}ث ✓` : "عتبة 30ث"}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="grid grid-cols-3 gap-1.5 text-center tabular-nums" dir="rtl">
            <div className="rounded-lg bg-muted/40 px-1.5 py-1.5">
              <div className="text-[8.5px] text-muted-foreground">QR ← اقتران</div>
              <div className="text-[11px] font-bold">{sec(lastPairPhase(data, "qr"))}</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-1.5 py-1.5">
              <div className="text-[8.5px] text-muted-foreground">اقتران ← أول قيمة</div>
              <div className="text-[11px] font-bold">{sec(lastPairPhase(data, "first"))}</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-1.5 py-1.5">
              <div className="text-[8.5px] text-muted-foreground">الإجمالي (العتبة {PAIR_TARGET_MS / 1000}ث)</div>
              <div className={`text-[11px] font-bold ${cls}`}>{sec(last)}</div>
            </div>
          </div>
          <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-1.5 text-[9.5px] tabular-nums text-muted-foreground" dir="rtl">
            <span className="font-bold text-foreground/80">مئين</span>
            <span title="الوسيط p50">p50 {sec(stats.p95 != null && stats.completed ? pct50(data) : null)}</span>
            <span className={`font-bold ${cls}`} title="الشريط المئيني 95">p95 {sec(stats.p95)}</span>
            <span title="الأقصى">الأقصى {sec(stats.max)}</span>
          </div>
          <div className="space-y-1">
            {(data?.entries ?? []).slice(0, 5).map((e) => (
              <div key={e.id} className="flex items-center gap-1.5 text-[9px] tabular-nums" dir="rtl">
                <span className="font-bold text-foreground/80 truncate max-w-[130px]">{e.deviceName}</span>
                <span className="text-muted-foreground">{e.reregister ? "إعادة تسجيل" : "اقتران جديد"}</span>
                <span className="text-muted-foreground">· {KIND_LABEL[e.firstValueKind ?? ""] ?? "بانتظار أول قيمة"}</span>
                <span className={`ms-auto font-bold ${thresholdCls(e.totalMs)}`}>{sec(e.totalMs)}</span>
              </div>
            ))}
            {stats.completed === 0 && (
              <div className="text-[9px] text-muted-foreground">لا قياسات مكتملة بعد — اقترن جهازًا وادفع أول قيمة</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** طور آخر اقتران مكتمل — مساعد قراءة محلي */
function lastPairPhase(d: PairApi | null, phase: "qr" | "first"): number | null {
  const e = (d?.entries ?? []).find((x) => x.totalMs != null)
  if (!e) return null
  return phase === "qr" ? e.qrToPairMs : e.pairToFirstValueMs
}

/** p50 محلي على المكتملة (اللوحة تعرض p95 من pairStats — p50 بنفس المنطق) */
function pct50(d: PairApi | null): number | null {
  const t = (d?.entries ?? []).filter((x) => x.totalMs != null).map((x) => x.totalMs as number).sort((a, b) => a - b)
  if (!t.length) return null
  const rank = Math.max(1, Math.ceil(0.5 * t.length))
  return t[Math.min(rank, t.length) - 1]
}
