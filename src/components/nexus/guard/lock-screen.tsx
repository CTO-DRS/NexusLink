"use client"
// NexusLink — شاشة قفل الكمبيوتر (تُفعَّل تلقائياً عند ابتعاد الهاتف)
// فتح بكلمة مرور أو تلقائياً عند عودة منارة الهاتف
import { useEffect, useState } from "react"
import { Delete, Lock, Smartphone, ShieldCheck, SignalHigh } from "lucide-react"
import { useGuard, type ProxInfo } from "@/lib/guard-store"
import { proxManualUnlock } from "@/lib/guard-socket"
import { RssiMeter } from "./guard-bits"
import { cn } from "@/lib/utils"

export function LockScreen() {
  const pcLocked = useGuard((s) => s.pcLocked)
  const prox = useGuard((s) => s.prox)
  if (!pcLocked) return null
  // مفتاح = لحظة القفل → حالة إدخال جديدة نظيفة لكل قفل
  return (
    <LockInner
      key={pcLocked.at}
      reason={pcLocked.reason}
      prox={prox}
    />
  )
}

function LockInner({ reason, prox }: { reason: string; prox: ProxInfo }) {
  const setPcLocked = useGuard((s) => s.setPcLocked)
  const pushLog = useGuard((s) => s.pushLog)
  const pin = useGuard((s) => s.pin)
  const [entry, setEntry] = useState("")
  const [err, setErr] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  const press = (d: string) => {
    if (entry.length >= 4) return
    const next = entry + d
    setEntry(next)
    if (next.length === 4) {
      if (next === pin) {
        setTimeout(() => {
          setPcLocked(null)
          proxManualUnlock()
          pushLog("فُتح الكمبيوتر بكلمة المرور", "ok")
        }, 160)
      } else {
        setErr(true)
        setTimeout(() => { setEntry(""); setErr(false) }, 550)
      }
    }
  }

  const reasonText =
    reason === "no-beacon" ? "ابتعد هاتفك عن نطاق القرب — قُفل الكمبيوتر تلقائياً لحمايتك"
    : reason === "weak-signal" ? "أصبحت إشارة هاتفك ضعيفة جداً — قُفل الكمبيوتر تلقائياً"
    : "قُفل الكمبيوتر يدوياً من لوحة الحماية"

  const phoneBack = prox.state === "near" && prox.enabled

  return (
    <div className="fixed inset-0 z-[200] bg-gradient-to-br from-zinc-950 via-zinc-900 to-teal-950/60 flex flex-col items-center justify-center select-none" role="dialog" aria-label="شاشة قفل الكمبيوتر">
      {/* الساعة */}
      <div className="text-center mb-8">
        <div className="text-[64px] font-black text-white leading-none tracking-tight" dir="ltr">
          {now.getHours().toString().padStart(2, "0")}:{now.getMinutes().toString().padStart(2, "0")}
        </div>
        <div className="text-white/50 text-[13px] mt-2">
          {new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long" }).format(now)}
        </div>
      </div>

      {/* سبب القفل */}
      <div className="rounded-2xl bg-white/5 border border-white/10 px-5 py-3.5 text-center max-w-sm mb-6 backdrop-blur">
        <div className="flex items-center justify-center gap-2 text-amber-400 mb-1.5">
          <Lock className="w-4 h-4" />
          <span className="text-[12px] font-bold">NEXUS-PC مقفل</span>
        </div>
        <p className="text-white/70 text-[11.5px] leading-relaxed">{reasonText}</p>
        {phoneBack && prox.autoUnlock && (
          <p className="text-emerald-400 text-[11px] mt-1.5 flex items-center justify-center gap-1.5">
            <SignalHigh className="w-3.5 h-3.5 animate-pulse" /> عادت منارة الهاتف — جارٍ الفتح التلقائي…
          </p>
        )}
      </div>

      {/* إدخال كلمة المرور */}
      <div className="flex flex-col items-center gap-4">
        <div className={cn("flex gap-3", err && "animate-bounce")}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "w-3.5 h-3.5 rounded-full border-2 transition-all",
                err ? "border-red-400 bg-red-400/60" : entry.length > i ? "border-teal-400 bg-teal-400" : "border-white/30"
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              onClick={() => press(d)}
              className="w-16 h-16 rounded-2xl bg-white/8 hover:bg-white/15 active:scale-95 text-white text-xl font-bold transition-all"
            >
              {d}
            </button>
          ))}
          <div />
          <button onClick={() => press("0")} className="w-16 h-16 rounded-2xl bg-white/8 hover:bg-white/15 active:scale-95 text-white text-xl font-bold transition-all">0</button>
          <button
            onClick={() => setEntry((e) => e.slice(0, -1))}
            aria-label="حذف"
            className="w-16 h-16 rounded-2xl bg-white/5 hover:bg-white/12 active:scale-95 text-white/70 grid place-items-center transition-all"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <p className="text-white/35 text-[10.5px] flex items-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5" />
          أو أعد هاتفك إلى نطاق القرب ليُفتح تلقائياً
        </p>
        <div className="flex items-center gap-2 text-white/40">
          <RssiMeter rssi={prox.rssi} size="sm" />
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="text-[10px] font-mono dir-ltr">{prox.enabled ? `عتبة ${prox.thresholdRssi}dBm` : "مراقبة متوقفة"}</span>
        </div>
      </div>
    </div>
  )
}
