"use client"
// عقد §52 — وضع التركيز الموحد — بطاقة أعلى مركز الإشعارات
// مفتاح واحد يكتم: تعكيس إشعارات الهاتف + «عدم الإزعاج» المكتبي — بانتهاء
// ذاتي واستعادة الحالة السابقة، وعدّاد ما كُتم أثناءه (لا شيء يُفقد أبدًا).
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Focus, Plus, Square, TimerReset, BellOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const PRESETS = [
  { label: "25", value: 25 },
  { label: "45", value: 45 },
  { label: "60", value: 60 },
  { label: "90", value: 90 },
]

interface FocusView {
  active: boolean
  remainingMs: number
  until: number | null
  suppressMirroring: boolean
  autoReplyText: string | null
  suppressed: number
  restoredJustNow?: boolean
  dnd: { dnd: boolean; source: string | null }
  quietOverlap: boolean
}

export function FocusCard() {
  const { t } = useI18n()
  const [st, setSt] = useState<FocusView | null>(null)
  const [minutes, setMinutes] = useState(45)
  const [suppress, setSuppress] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/focus", { cache: "no-store" })
      const j = await r.json()
      setSt(j)
      if (j?.restoredJustNow) toast(t("انقضى وضع التركيز واستُعيدت الحالة السابقة"))
    } catch { /* الشبكة سقطت */ }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    timer.current = setInterval(() => setTick((x) => x + 1), 1000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [])

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    try {
      const r = await fetch("/api/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      })
      const j = await r.json()
      if (!j.ok) {
        if (j.error === "already-active") toast.error(t("التركيز نشط بالفعل — استعمل التمديد"))
        else toast.error(j.error || t("فشل الإجراء"))
        return
      }
      setSt(j)
      if (action === "start") toast.success(t("بدأ وضع التركيز"), { description: suppress ? t("الكتم موحد: التعكيس + عدم الإزعاج") : t("بدون كتم التعكيس") })
      if (action === "stop") toast(t("أُوقف التركيز واستُعيدت الحالة السابقة"))
      if (action === "extend") toast.success(t("مُددت جلسة التركيز"))
    } finally {
      setBusy(false)
    }
  }

  const remaining = st?.active && st.until ? Math.max(0, st.until - Date.now()) : 0
  void tick // إعادة الحساب كل ثانية
  const mm = Math.floor(remaining / 60_000)
  const ss = Math.floor((remaining % 60_000) / 1000)

  return (
    <div className={cn("rounded-2xl border p-4 transition-colors", st?.active ? "border-violet-500/60 bg-violet-500/5" : "bg-card")}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-9 h-9 rounded-xl grid place-items-center", st?.active ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : "bg-muted text-muted-foreground")}>
            <Focus className="w-4.5 h-4.5" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-bold flex items-center gap-2 flex-wrap">
              {t("وضع التركيز الموحد")}
              {st?.active && (
                <Badge className="rounded-full text-[9.5px] bg-violet-500 hover:bg-violet-500 gap-1">
                  <TimerReset className="w-3 h-3" /> {mm}:{String(ss).padStart(2, "0")}
                </Badge>
              )}
              {st?.active && st.suppressed > 0 && (
                <Badge variant="secondary" className="rounded-full text-[9.5px] gap-1">
                  <BellOff className="w-3 h-3" /> {t("كُتم")} {st.suppressed}
                </Badge>
              )}
              {st?.quietOverlap && st.active && (
                <Badge variant="secondary" className="rounded-full text-[9px]">{t("يتداخل مع ساعات الهدوء")}</Badge>
              )}
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              {st?.active
                ? (st.suppressMirroring ? t("الكتم موحد — الإشعارات تُحفظ مكتمة ولا يُفقد شيء") : t("نشط بلا كتم التعكيس — الجلسة تُعدّ فقط"))
                : t("مفتاح واحد لكتم التعكيس وعدم الإزعاج عبر أجهزتك — بانتهاء ذاتي واستعادة تلقائية")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {st?.active ? (
            <>
              <Button size="sm" variant="outline" className="rounded-xl h-8 gap-1.5 text-[11px]" disabled={busy} onClick={() => void act("extend", { minutes: 30 })}>
                <Plus className="w-3.5 h-3.5" /> {t("تمديد 30 دقيقة")}
              </Button>
              <Button size="sm" variant="outline" className="rounded-xl h-8 gap-1.5 text-[11px] text-red-500 hover:text-red-600" disabled={busy} onClick={() => void act("stop")}>
                <Square className="w-3.5 h-3.5" /> {t("إيقاف")}
              </Button>
            </>
          ) : (
            <>
              <div className="flex rounded-xl border overflow-hidden">
                {PRESETS.map((o) => (
                  <button key={o.value} onClick={() => setMinutes(o.value)} className={cn("px-2.5 h-8 text-[10.5px]", minutes === o.value ? "bg-violet-500 text-white" : "bg-background hover:bg-muted text-muted-foreground")} aria-pressed={minutes === o.value}>
                    {o.label} {t("د")}
                  </button>
                ))}
              </div>
              <span className="text-[10.5px] text-muted-foreground">{t("كتم التعكيس")}</span>
              <Switch checked={suppress} onCheckedChange={setSuppress} aria-label={t("كتم تعكيس الإشعارات")} />
              <Button size="sm" className="rounded-xl h-8 gap-1.5 text-[11px]" disabled={busy} onClick={() => void act("start", { minutes, suppressMirroring: suppress })}>
                <Focus className="w-3.5 h-3.5" /> {t("ابدأ التركيز")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
