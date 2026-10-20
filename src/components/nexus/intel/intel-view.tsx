"use client"

/**
 * عرض الذكاء (عقد §33 — M2 + §35.ج — التنبؤ الاستباقي): تبويبات ثلاثة —
 *  المساعد (§33.ب): محادثة مع مساعد الجهاز الحتمي (NLU محلي + إجابات من
 *    الفهرس المحلي + محول LLM محلي اختياري) عبر /api/assistant.
 *  الرؤى (§33.د): لوحة استخدام محلية من /api/insights — أشرطة CSS خالصة
 *    بلا أي اعتماد رسومي خارجي.
 *  التنبؤ (§35.ج): توقعات إطلاق الروتينات واقتراحات مسبّبة بالدليل من
 *    /api/predictions — قراءة حصرًا والإنشاء بيد المستخدم حصرًا.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sparkles, SendHorizontal, Bot, Cpu, BarChart3, MessageSquare, Zap, ClipboardCopy, ArrowLeftRight, HeartPulse, Link2, TrendingUp } from "lucide-react"
import { useI18n } from "@/lib/i18n"

interface AssistantSource { kind: string; label: string; count: number }
interface AssistantPayload { ok: boolean; intent: string; confidence: number; answer: string; sources: AssistantSource[]; took: number; llm: { available: boolean; runtime: string | null; model?: string } }
interface Turn { role: "user" | "assistant"; text: string; meta?: string }

const QUICK_PROMPTS = ["ما حالة الأجهزة؟", "اقترح روتينًا", "لماذا آخر تنبيه؟", "ابحث عن تقرير"]
const INTENT_BADGES: Record<string, string> = { status: "status", find: "find", suggest: "suggest", explain: "explain", help: "help" }

interface InsightsPayload {
  ok: boolean
  windowDays: number
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

function fmtBytes(n: number): string {
  if (!n) return "0"
  const units = ["B", "KB", "MB", "GB"]
  let v = n, u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v.toFixed(v >= 10 || u === 0 ? 0 : 1)} ${units[u]}`
}

function Bars({ data, color }: { data: Array<{ day: string; total: number }>; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.total))
  return (
    <div className="flex items-end gap-1 h-24" dir="ltr" role="img" aria-label={`daily bars max=${max}`}>
      {data.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div
            className={`w-full rounded-t-md ${color} transition-all`}
            style={{ height: `${Math.max(4, (d.total / max) * 72)}px` }}
            title={`${d.day}: ${d.total}`}
          />
          <span className="text-[8px] text-muted-foreground truncate w-full text-center">{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Zap; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3.5 space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

interface PredictPayload {
  ok: boolean
  windowDays: number
  forecasts: Array<{
    ruleId: string
    ruleName: string
    pattern: "daily" | "interval"
    nextPredictedAt: number
    stale: boolean
    basis: { fires: number; distinctDays: number; hhmm?: string; medianIntervalMin?: number }
  }>
  suggestions: Array<{
    id: string
    source: "oplog" | "battery"
    kind: string
    deviceId: string | null
    suggestedTrigger: Record<string, unknown>
    occurrences: number
    distinctDays: number
    reason: string
  }>
}

function PredictionsPanel() {
  const { t } = useI18n()
  const [pred, setPred] = useState<PredictPayload | null>(null)
  const [created, setCreated] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    fetch("/api/predictions", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: PredictPayload) => { if (alive) setPred(j) })
      .catch(() => { if (alive) setPred({ ok: false } as PredictPayload) })
    return () => { alive = false }
  }, [])
  const createFromSuggestion = useCallback(async (s: PredictPayload["suggestions"][number]) => {
    const name = `${s.kind === "battery" ? t("تذكير بطارية") : t("تذكير عمليات")} · ${s.deviceId ?? ""}`.trim().slice(0, 80)
    const rule = {
      name,
      trigger: s.suggestedTrigger,
      action: { kind: "notify", text: s.reason.slice(0, 200) },
    }
    const res = await fetch("/api/automation/rules", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "upsert", rule }),
    })
    if (res.ok) setCreated((prev) => [...prev, s.id])
  }, [t])
  if (!pred) return <div className="text-[12px] text-muted-foreground py-8 text-center">{t("…جارٍ حساب التوقعات")}</div>
  if (!pred.ok) return <div className="text-[12px] text-destructive py-8 text-center">{t("تعذّر حساب التوقعات الآن")}</div>
  return (
    <div className="space-y-3" data-predictions-panel>
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="text-[12px] font-semibold flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          {t("توقعات إطلاق الروتينات")}
          <Badge variant="secondary" className="text-[9px]">{t("حتمي من تاريخ 14 يومًا")}</Badge>
        </div>
        {pred.forecasts.length === 0 && <div className="text-[11px] text-muted-foreground py-2">{t("لا توقعات بعد — ثلاثة إطلاقات فأكثر تبني النمط")}</div>}
        <div className="space-y-1.5">
          {pred.forecasts.map((f) => (
            <div key={f.ruleId} className="flex items-center gap-2 rounded-xl border px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate" dir="auto">{f.ruleName}</div>
                <div className="text-[10px] text-muted-foreground" dir="auto">
                  {f.pattern === "daily"
                    ? `${t("النمط اليومي")} · ${f.basis.hhmm} · ${f.basis.fires} ${t("إطلاقات")}`
                    : `${t("وسيط الفترة")} · ${f.basis.medianIntervalMin} ${t("دقيقة")} · ${f.basis.fires} ${t("إطلاقات")}`}
                </div>
              </div>
              {f.stale && <Badge variant="outline" className="text-[9px]">{t("توقع متأخر")}</Badge>}
              <div className="text-[11px] tabular-nums text-primary font-semibold whitespace-nowrap" dir="ltr">
                {new Date(f.nextPredictedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="text-[12px] font-semibold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          {t("اقتراحات روتينات مسبّبة")}
          <Badge variant="secondary" className="text-[9px]">{t("الإنشاء بيدك حصرًا")}</Badge>
        </div>
        {pred.suggestions.length === 0 && <div className="text-[11px] text-muted-foreground py-2">{t("لا اقتراحات بعد — الأنماط تحتاج 3 مشاهدات على يومين مختلفين")}</div>}
        <div className="space-y-1.5">
          {pred.suggestions.map((s) => (
            <div key={s.id} className="rounded-xl border px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px]">
                  {s.source === "oplog" ? t("من تاريخ العمليات") : t("من عينات الصحة")}
                </Badge>
                <span className="text-[11px] text-muted-foreground truncate flex-1" dir="ltr">{s.deviceId ?? s.kind}</span>
                <Button size="sm" variant="secondary" className="h-6 text-[10px] rounded-lg" disabled={created.includes(s.id)} onClick={() => void createFromSuggestion(s)}>
                  {created.includes(s.id) ? t("أُنشئت القاعدة") : t("إنشاء قاعدة")}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed" dir="auto">{s.reason}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground text-center">{t("توقعات حتمية من تاريخك المحلي — بلا نماذج وبلا مغادرة أي بايت")}</p>
    </div>
  )
}

export function IntelView() {
  const { t } = useI18n()
  const [tab, setTab] = useState<"assistant" | "insights" | "predictions">("assistant")

  // ---- المساعد ----
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [llmBadge, setLlmBadge] = useState<{ available: boolean; runtime: string | null; model?: string } | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // شارة النموذج المحلي عند الفتح (كشف localhost حصرًا)
    let alive = true
    fetch("/api/assistant", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { llm?: { available: boolean; runtime: string | null; model?: string } }) => { if (alive && j?.llm) setLlmBadge(j.llm) })
      .catch(() => { /* بلا شارة — المحرك الحتمي يعمل */ })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [turns])

  const ask = useCallback(async (question: string) => {
    const text = question.trim().slice(0, 300)
    if (!text || busy) return
    setQ("")
    setTurns((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "…", meta: "pending" }])
    setBusy(true)
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text }) })
      const j = (await res.json()) as AssistantPayload
      const meta = j?.ok
        ? `${t("نية")}: ${INTENT_BADGES[j.intent] ?? j.intent} · ${j.took}ms · ${j.llm.available ? `LLM ${j.llm.runtime}` : t("محرك حتمي محلي")}`
        : t("تعذّرت الإجابة")
      setTurns((prev) => [...prev.slice(0, -1), { role: "assistant", text: j?.answer || t("تعذّرت الإجابة"), meta }])
    } catch {
      setTurns((prev) => [...prev.slice(0, -1), { role: "assistant", text: t("تعذّرت الإجابة") }])
    } finally {
      setBusy(false)
    }
  }, [busy, t])

  // ---- الرؤى ----
  const [insights, setInsights] = useState<InsightsPayload | null>(null)
  useEffect(() => {
    if (tab !== "insights" || insights) return
    let alive = true
    fetch("/api/insights", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: InsightsPayload) => { if (alive) setInsights(j) })
      .catch(() => { if (alive) setInsights({ ok: false } as InsightsPayload) })
    return () => { alive = false }
  }, [tab, insights])

  return (
    <div className="space-y-4 p-4 max-w-5xl mx-auto" data-intel-view>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <Sparkles className="w-4.5 h-4.5" />
          </div>
          <div>
            <h2 className="font-bold text-[15px] leading-tight">{t("الذكاء المحلي")}</h2>
            <p className="text-[11px] text-muted-foreground">{t("مساعد ورؤى على الجهاز — بلا مغادرة أي بايت")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-xl border p-1" role="tablist" aria-label={t("أقسام الذكاء")}>
          <Button variant={tab === "assistant" ? "default" : "ghost"} size="sm" className="h-7 rounded-lg gap-1.5" onClick={() => setTab("assistant")} role="tab" aria-selected={tab === "assistant"}>
            <Bot className="w-3.5 h-3.5" />{t("المساعد")}
          </Button>
          <Button variant={tab === "insights" ? "default" : "ghost"} size="sm" className="h-7 rounded-lg gap-1.5" onClick={() => setTab("insights")} role="tab" aria-selected={tab === "insights"}>
            <BarChart3 className="w-3.5 h-3.5" />{t("الرؤى")}
          </Button>
          <Button variant={tab === "predictions" ? "default" : "ghost"} size="sm" className="h-7 rounded-lg gap-1.5" onClick={() => setTab("predictions")} role="tab" aria-selected={tab === "predictions"} data-tab-predictions>
            <TrendingUp className="w-3.5 h-3.5" />{t("التنبؤ")}
          </Button>
        </div>
      </div>

      {tab === "predictions" && <PredictionsPanel />}

      {tab === "assistant" && (
        <div className="rounded-2xl border bg-card overflow-hidden flex flex-col h-[62vh]">
          <div className="flex items-center justify-between gap-2 px-4 h-11 border-b bg-muted/30">
            <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              {t("محرك حتمي محلي + فهرس الأجهزة والملفات والروتينات")}
            </span>
            {llmBadge && (
              <Badge variant={llmBadge.available ? "default" : "secondary"} className="text-[9px] gap-1">
                {llmBadge.available ? `LLM · ${llmBadge.runtime}${llmBadge.model ? ` · ${llmBadge.model}` : ""}` : t("بلا نموذج — حتمي")}
              </Badge>
            )}
          </div>
          <div ref={transcriptRef} className="flex-1 overflow-y-auto nexus-scroll p-4 space-y-3" aria-live="polite">
            {turns.length === 0 && (
              <div className="text-center text-[12px] text-muted-foreground pt-8 space-y-3">
                <Sparkles className="w-6 h-6 mx-auto text-primary/50" />
                <p>{t("اسألني عن أجهزتك أو ملفاتك أو روتيناتك — كل الإجابات من فهرسك المحلي")}</p>
              </div>
            )}
            {turns.map((turn, i) => (
              <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${turn.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60"}`}>
                  <span dir="auto">{turn.text}</span>
                  {turn.meta && turn.meta !== "pending" && <div className="mt-1.5 text-[9px] text-muted-foreground" dir="auto">{turn.meta}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t p-3 space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {QUICK_PROMPTS.map((p) => (
                <button key={p} onClick={() => void ask(p)} disabled={busy}
                  className="rounded-full border px-2.5 py-1 text-[11px] hover:bg-muted/70 disabled:opacity-50 transition-colors">
                  {p}
                </button>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q) }}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("اسأل المساعد المحلي…")} maxLength={300} aria-label={t("سؤال للمساعد")} className="rounded-xl" />
              <Button type="submit" size="icon" className="rounded-xl h-10 w-10 shrink-0" disabled={busy || !q.trim()} aria-label={t("إرسال")}>
                <SendHorizontal className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>
      )}

      {tab === "insights" && (
        <div className="space-y-3" data-insights-panel>
          {!insights && <div className="text-[12px] text-muted-foreground py-8 text-center">{t("…جارٍ تجميع الرؤى")}</div>}
          {insights && !insights.ok && <div className="text-[12px] text-destructive py-8 text-center">{t("تعذّر جمع الرؤى الآن")}</div>}
          {insights?.ok && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <StatCard icon={Zap} label={t("عمليات 14 يومًا")} value={String(insights.opsDaily.reduce((a, d) => a + d.total, 0))} hint={`${insights.opsKinds.length} ${t("أنواع")}`} />
                <StatCard icon={MessageSquare} label={t("إطلاقات الروتينات")} value={String(insights.firesTotal)} hint={t("خلال 14 يومًا")} />
                <StatCard icon={ClipboardCopy} label={t("مقاطع الحافظة")} value={String(insights.clips.total)} hint={`${insights.clips.last7d} ${t("خلال 7 أيام")}`} />
                <StatCard icon={Link2} label={t("اقترانات مكتملة")} value={`${insights.pairs.completed}/${insights.pairs.count}`} hint={insights.pairs.p95Ms != null ? `p95 ${insights.pairs.p95Ms}ms` : undefined} />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-2xl border bg-card p-4 space-y-2">
                  <div className="text-[12px] font-semibold flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-primary" />{t("العمليات يوميًا (14 يومًا)")}</div>
                  <Bars data={insights.opsDaily} color="bg-primary/70" />
                </div>
                <div className="rounded-2xl border bg-card p-4 space-y-2">
                  <div className="text-[12px] font-semibold flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5 text-primary" />{t("إطلاقات الروتينات يوميًا")}</div>
                  <Bars data={insights.firesDaily} color="bg-emerald-500/70" />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <StatCard icon={ArrowLeftRight} label={t("مزامنة 14 يومًا")} value={String(insights.sync.events14d)} hint={fmtBytes(insights.sync.bytes14d)} />
                <StatCard icon={MessageSquare} label={t("رسائل 7 أيام")} value={`${insights.messages.in7d} / ${insights.messages.out7d}`} hint={t("واردة / صادرة")} />
                <StatCard icon={HeartPulse} label={t("عينات الصحة")} value={String(insights.health.samples)} hint={`${insights.health.devicesReporting} ${t("أجهزة تُبلّغ")}`} />
                <StatCard icon={ClipboardCopy} label={t("حجم الحافظة")} value={fmtBytes(insights.clips.bytes)} />
              </div>
              {insights.topDevices.length > 0 && (
                <div className="rounded-2xl border bg-card p-4 space-y-2">
                  <div className="text-[12px] font-semibold">{t("أكثر الأجهزة نشاطًا (عمليات)")}</div>
                  <div className="space-y-1.5">
                    {insights.topDevices.map((d) => {
                      const max = Math.max(1, ...insights.topDevices.map((x) => x.count))
                      return (
                        <div key={d.deviceId} className="flex items-center gap-2">
                          <span className="text-[11px] font-medium w-28 truncate" dir="ltr">{d.deviceId}</span>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${(d.count / max) * 100}%` }} />
                          </div>
                          <span className="text-[10px] tabular-nums text-muted-foreground w-10 text-end">{d.count}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground text-center">{t("كل الأرقام محسوبة محليًا من قواعد بيانات جهازك — لا يغادر أي محتوى")}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
