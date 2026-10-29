"use client"
// NexusLink — وحدة حماية الهاتف الحقيقي (صفحة /phone)
// منارة قرب كل 2ث → ابتعادك بهاتفك يوقف المنارة فيقفل الكمبيوتر تلقائياً
// + استقبال: الرن القوي (صوت + اهتزاز + وميض) · وضع الفقدان · المسح · الإعدادات السريعة
// §48 — التوأم الهاتفي للطوارئ: dev:kill يفتح شاشة القتل الحمراء بلا مسار
// عودة (تُر سّد في localStorage — إعادة التحميل لا تُنقذه)، وكل معالجات
// الأوامر الأخرى تصير لا-عملية بعد القتل (أحادية الاتجاه على الهاتف نفسه)،
// وguard:arm يستقبل قواعد التصعيد الذاتي مع محاكاة معلنة (نمط prox:sim):
// عدّاد محاولات فتح + محاكاة تغيير شريحة — التنفيذ الحقيقي في وكيل Flutter
// (§46.د/§48.د) على جهاز المالك، والتوأم هنا يثبت البروتوكول.
import { useEffect, useRef, useState, useCallback } from "react"
import {
  RadioTower, Smartphone, Footprints, Home, ShieldCheck, BellRing, Wifi, Bluetooth,
  Flashlight, BellOff, RotateCcw, Signal, Router, BatteryCharging, AlarmClock, CheckCircle2,
  OctagonAlert, Cpu, Fingerprint,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { getGuardSocket, proxBeacon, devState, devAcked, devSyncRequest } from "@/lib/guard-socket"
import { RssiMeter, ProxStateBadge } from "./guard-bits"
import { cn } from "@/lib/utils"

// نفس بذور الكمبيوتر كي تتبادل الحالتان
const QS0 = { wifi: true, bluetooth: true, flashlight: false, dnd: false, rotate: false, data: true, hotspot: false, saver: false, brightness: 72, volMedia: 60, volRing: 80 }
const AL0 = [
  { id: "a1", hour: 5, minute: 30, label: "الفجر", days: [] as number[], enabled: true },
  { id: "a2", hour: 6, minute: 45, label: "الاستيقاظ", days: [0, 1, 2, 3, 4], enabled: true },
  { id: "a3", hour: 13, minute: 15, label: "دواء الظهر", days: [] as number[], enabled: false },
  { id: "a4", hour: 22, minute: 30, label: "وقت النوم", days: [] as number[], enabled: true },
]
const QS_TILES = [
  { key: "wifi", label: "Wi-Fi", Icon: Wifi },
  { key: "bluetooth", label: "بلوتوث", Icon: Bluetooth },
  { key: "flashlight", label: "الكشاف", Icon: Flashlight },
  { key: "dnd", label: "الإزعاج", Icon: BellOff },
  { key: "rotate", label: "التدوير", Icon: RotateCcw },
  { key: "data", label: "البيانات", Icon: Signal },
  { key: "hotspot", label: "الاتصال", Icon: Router },
  { key: "saver", label: "الطاقة", Icon: BatteryCharging },
]

export interface PhoneGuardCore {
  online: boolean
  away: boolean
  goAway: () => void
  comeBack: () => void
  proxState: string
  rssi: number | null
  ringing: boolean
  stopRing: () => void
  strobe: boolean
  lost: { active: boolean; message: string; callback: string }
  wipe: { stage: "idle" | "wiping" | "wiped"; progress: number }
  reactivate: () => void
  qs: typeof QS0
  toggleQs: (k: string) => void
  alarms: typeof AL0
  toggleAlarm: (id: string) => void
  // §48 — الطوارئ الذكي على التوأم
  killed: { active: boolean; fingerprint: string; at: number } | null
  arm: { rules: { unlockFailLimit: number; simChangeAction: string }; at: string } | null
  unlockFails: number
  simChangedSim: boolean
  simUnlockFail: () => void
  simSimChange: () => void
  resetSims: () => void
}

export function usePhoneGuard(): PhoneGuardCore {
  const [online, setOnline] = useState(false)
  const [away, setAway] = useState(false)
  const [proxState, setProxState] = useState("near")
  const [rssi, setRssi] = useState<number | null>(null)
  const [ringing, setRinging] = useState(false)
  const [strobe, setStrobe] = useState(false)
  const [lost, setLost] = useState({ active: false, message: "", callback: "" })
  const [wipe, setWipe] = useState<{ stage: "idle" | "wiping" | "wiped"; progress: number }>({ stage: "idle", progress: 0 })
  const [qs, setQs] = useState(QS0)
  const [alarms, setAlarms] = useState(AL0)
  // §48 — حالة الطوارئ على التوأم: القتل مُر سّد (localStorage) والقواعد عرضية
  const [killed, setKilled] = useState<{ active: boolean; fingerprint: string; at: number } | null>(null)
  const [arm, setArm] = useState<{ rules: { unlockFailLimit: number; simChangeAction: string }; at: string } | null>(null)
  const [unlockFails, setUnlockFails] = useState(0)
  const [simChangedSim, setSimChangedSim] = useState(false)

  const killedRef = useRef<{ active: boolean; fingerprint: string; at: number } | null>(null)

  // §48 — استرجاع القتل المُر سّد عند الإقلاع: إعادة التحميل لا تُنقذ المسروق
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nexus.emergency.kill")
      if (raw) {
        const j = JSON.parse(raw)
        if (j && j.active === true) {
          killedRef.current = { active: true, fingerprint: String(j.fingerprint ?? ""), at: Number(j.at ?? 0) }
          setKilled(killedRef.current)
        }
      }
    } catch { /* تخزين تالف — يبدأ نظيفًا (السيرفر يعيد الحسم عند الوصل) */ }
  }, [])

  const awayRef = useRef(false)
  const ringingRef = useRef(false)
  const strobeRef = useRef(false)

  // ==== صافرة الرن القوي (WebAudio) + اهتزاز ====
  const sirenTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const vibTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const startSiren = useCallback(() => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      void ctx.resume()
      const burst = () => {
        for (let i = 0; i < 6; i++) {
          const t0 = ctx.currentTime + i * 0.18
          const osc = ctx.createOscillator()
          const g = ctx.createGain()
          osc.type = "square"
          osc.frequency.setValueAtTime(i % 2 === 0 ? 980 : 720, t0)
          g.gain.setValueAtTime(0.0001, t0)
          g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02)
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
          osc.connect(g).connect(ctx.destination)
          osc.start(t0)
          osc.stop(t0 + 0.18)
        }
      }
      burst()
      sirenTimer.current = setInterval(burst, 1400)
    } catch { /* ignore */ }
    vibTimer.current = setInterval(() => navigator.vibrate?.([420, 160, 420]), 1100)
    navigator.vibrate?.([420, 160, 420])
  }, [])
  const stopSiren = useCallback(() => {
    if (sirenTimer.current) { clearInterval(sirenTimer.current); sirenTimer.current = null }
    if (vibTimer.current) { clearInterval(vibTimer.current); vibTimer.current = null }
    navigator.vibrate?.(0)
  }, [])

  const stopRing = useCallback(() => {
    ringingRef.current = false
    setRinging(false)
    stopSiren()
    devState({ ringing: false })
    devAcked("أوقف الرنين من الهاتف — «أنا هنا!»")
  }, [stopSiren])

  // ==== الاتصال بالجسر + المنارة + استقبال الأوامر ====
  useEffect(() => {
    fetch("/api/guard/boot").catch(() => { /* ignore */ })
    const socket = getGuardSocket()

    socket.on("connect", () => {
      setOnline(true)
      socket.emit("guard:hello-phone", { name: "هاتف Nexus" })
      proxBeacon(-52 + Math.round(Math.random() * 4 - 2))
      // مزامنة أولية: المنبهات والإعدادات من الكمبيوتر
      devSyncRequest()
    })
    socket.on("disconnect", () => setOnline(false))

    // حالة القرب من المحرك
    socket.on("prox:state", (d: { state: string; rssi: number | null }) => {
      setProxState(d.state)
      setRssi(d.rssi)
    })

    // ==== أوامر الكمبيوتر ==== — §48: بعد القتل كلها لا-عملة (أحادية الاتجاه)
    socket.on("dev:ring", () => {
      if (killedRef.current) return
      if (ringingRef.current) return
      ringingRef.current = true
      setRinging(true)
      startSiren()
      devAcked("الهاتف يرن الآن بأقصى صوت — تجاوز الوضع الصامت")
    })
    socket.on("dev:ring-stop", () => {
      if (killedRef.current) return
      if (!ringingRef.current) return
      stopRing()
    })
    socket.on("dev:light", (d: { on?: boolean }) => {
      if (killedRef.current) return
      strobeRef.current = !!d?.on
      setStrobe(!!d?.on)
      devAcked(d?.on ? "إضاءة الشاشة تعمل على الهاتف" : "أُطفئت الإضاءة")
    })
    socket.on("dev:lost", (d: { message?: string; callback?: string }) => {
      if (killedRef.current) return
      setLost({ active: true, message: d?.message ?? "", callback: d?.callback ?? "" })
      devAcked("الهاتف مقفل — وضع الفقدان مفعّل ورسالتك على الشاشة")
    })
    socket.on("dev:lost-off", () => {
      if (killedRef.current) return
      setLost({ active: false, message: "", callback: "" })
      devAcked("فُتح الهاتف — أُلغي وضع الفقدان")
    })
    socket.on("dev:wipe", () => {
      if (killedRef.current) return
      setWipe({ stage: "wiping", progress: 0 })
      devAcked("بدأ مسح بيانات الهاتف عن بُعد")
    })
    socket.on("dev:qs", (d: { key?: string; value?: boolean | number }) => {
      if (killedRef.current) return
      if (!d?.key) return
      setQs((q) => ({ ...q, [d.key as string]: d.value as boolean | number }))
    })
    socket.on("dev:alarm", (d: { action?: string; id?: string; time?: string; label?: string; enabled?: boolean }) => {
      if (killedRef.current) return
      if (!d?.action) return
      if (d.action === "add" && d.time) {
        const [h, m] = d.time.split(":").map((x) => parseInt(x) || 0)
        setAlarms((a) => [...a.filter((x) => !(x.hour === h && x.minute === m)), { id: Math.random().toString(36).slice(2, 8), hour: h, minute: m, label: d.label ?? "منبه من الكمبيوتر", days: [], enabled: true }])
      } else if (d.action === "toggle" && d.id) {
        setAlarms((a) => a.map((x) => (x.id === d.id || alarmTime(x) === d.time ? { ...x, enabled: d.enabled ?? !x.enabled } : x)))
      } else if (d.action === "delete" && d.id) {
        setAlarms((a) => a.filter((x) => x.id !== d.id))
      }
    })

    // ==== §48 — الطوارئ الذكي على التوأم ====
    // القتل النهائي: من الخادم (بعد PIN) أو عند إعادة الاتصال (بلا مصافحة)
    socket.on("dev:kill", (d: { deviceId?: string; fingerprint?: string; at?: number; via?: string }) => {
      const stamp = { active: true, fingerprint: String(d?.fingerprint ?? "server-order"), at: Number(d?.at ?? Date.now()) }
      killedRef.current = stamp
      setKilled(stamp)
      try { localStorage.setItem("nexus.emergency.kill", JSON.stringify(stamp)) } catch { /* تخزين ممتلئ */ }
      // صمت تام بعد القتل: لا إقرار ولا حالة ولا منارة — الجهاز مات
    })
    // قواعد التصعيد الذاتي تصل من الخادم عند التسليح وكل تعديل (48.د)
    socket.on("guard:arm", (d: { rules?: { unlockFailLimit?: number; simChangeAction?: string }; at?: string }) => {
      if (killedRef.current) return
      if (d?.rules && typeof d.rules.unlockFailLimit === "number") {
        setArm({ rules: { unlockFailLimit: d.rules.unlockFailLimit, simChangeAction: String(d.rules.simChangeAction ?? "warn") }, at: String(d?.at ?? new Date().toISOString()) })
      }
    })

    // مزامنة الحالة الكاملة القادمة من الكمبيوتر
    socket.on("dev:state", (d: { alarms?: typeof AL0; qs?: Record<string, boolean | number> }) => {
      if (killedRef.current) return
      if (Array.isArray(d?.alarms)) setAlarms(d.alarms)
      if (d?.qs) setQs((q) => ({ ...q, ...d.qs }))
    })

    // ==== منارة القرب كل ثانيتين ====
    const iv = setInterval(() => {
      if (!awayRef.current) proxBeacon(-50 - Math.round(Math.random() * 8))
    }, 2000)
    proxBeacon(-52)

    return () => {
      socket.off()
      clearInterval(iv)
    }
  }, [startSiren, stopRing])

  // ==== تقدم المسح ====
  useEffect(() => {
    if (wipe.stage !== "wiping") return
    const iv = setInterval(() => {
      setWipe((w) => {
        const next = Math.min(100, w.progress + 3 + Math.random() * 6)
        devState({ wipe: { stage: "wiping", progress: next } })
        if (next >= 100) {
          clearInterval(iv)
          devAcked("اكتمل مسح الهاتف — كل البيانات أُزيلت")
          return { stage: "wiped", progress: 100 }
        }
        return { stage: "wiping", progress: next }
      })
    }, 260)
    return () => clearInterval(iv)
  }, [wipe.stage])

  // ==== وميض الإضاءة ====
  useEffect(() => {
    if (!strobe) return
    const t = setTimeout(() => { /* mount guard */ }, 0)
    return () => clearTimeout(t)
  }, [strobe])

  const goAway = useCallback(() => {
    awayRef.current = true
    setAway(true)
    devAcked("أبتعدت بالهاتف — توقفت منارة القرب")
  }, [])
  const comeBack = useCallback(() => {
    awayRef.current = false
    setAway(false)
    proxBeacon(-52)
    devAcked("عدت بالهاتف — منارة القرب تعمل مجدداً")
  }, [])
  const reactivate = useCallback(() => {
    setWipe({ stage: "idle", progress: 0 })
    devState({ wipe: { stage: "idle", progress: 0 } })
  }, [])
  const toggleQs = useCallback((k: string) => {
    setQs((q) => {
      const next = { ...q, [k]: !q[k as keyof typeof q] }
      devState({ qs: { [k]: next[k as keyof typeof next] } })
      return next
    })
  }, [])
  const toggleAlarm = useCallback((id: string) => {
    setAlarms((a) => a.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))
  }, [])

  // ==== §48 — محاكاة معلنة للتصعيد الذاتي (نمط prox:sim — التنفيذ في Flutter) ====
  const simUnlockFail = useCallback(() => {
    setUnlockFails((n) => n + 1)
  }, [])
  const simSimChange = useCallback(() => {
    setSimChangedSim(true)
  }, [])
  const resetSims = useCallback(() => {
    setUnlockFails(0)
    setSimChangedSim(false)
  }, [])

  return {
    online, away, goAway, comeBack, proxState, rssi,
    ringing, stopRing, strobe,
    lost, wipe, reactivate, qs, toggleQs, alarms, toggleAlarm,
    killed, arm, unlockFails, simChangedSim, simUnlockFail, simSimChange, resetSims,
  }
}

function alarmTime(a: { hour: number; minute: number }) {
  return `${String(a.hour).padStart(2, "0")}:${String(a.minute).padStart(2, "0")}`
}

// ==== تبويب الحماية داخل صفحة الهاتف ====
export function GuardPhoneTab({ guard }: { guard: PhoneGuardCore }) {
  return (
    <div className="space-y-3">
      {/* §48 — بطاقة الطوارئ الذكي (محاكاة معلنة للتوأم — التنفيذ الحقيقي في Flutter) */}
      {guard.arm && (
        <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-4 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-red-500/20 text-red-400 grid place-items-center">
              <OctagonAlert className="w-5 h-5" />
            </div>
            <div className="flex-1 leading-tight">
              <div className="font-bold text-[13px]">الطوارئ الذكي مُسلَّح على هذا الهاتف</div>
              <div className="text-[10px] text-white/50">
                بعد {guard.arm.rules.unlockFailLimit} محاولات فتح فاشلة (أو تغيير الشريحة مع قاعدة القتل) يُغلق الهاتف نهائيًا بلا شبكة — محاكاة معلنة والتنفيذ في وكيل Flutter
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="rounded-xl h-9 text-[10.5px] border-white/20 bg-white/5" onClick={guard.simUnlockFail}>
              محاولة فتح فاشلة ({guard.unlockFails}/{guard.arm.rules.unlockFailLimit})
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl h-9 text-[10.5px] border-white/20 bg-white/5" onClick={guard.simSimChange}>
              <Cpu className="w-3.5 h-3.5 me-1" />{guard.simChangedSim ? "الشريحة تغيّرت" : "محاكاة تغيير شريحة"}
            </Button>
          </div>
          {(guard.unlockFails >= guard.arm.rules.unlockFailLimit || (guard.simChangedSim && guard.arm.rules.simChangeAction === "kill")) && (
            <div className="rounded-2xl bg-red-600/90 text-white text-[11px] font-bold text-center py-2.5 px-3 leading-relaxed">
              ⟁ التصعيد الذاتي: على الهاتف الحقيقي أُغلق الآن نهائيًا بلا شبكة — التوأم يعلن ولا يقتل (حكمة التنفيذ على جهاز المالك)
            </div>
          )}
          <Button variant="ghost" size="sm" className="w-full h-7 text-[9.5px] text-white/40" onClick={guard.resetSims}>
            تصفير عدادات المحاكاة
          </Button>
        </div>
      )}

      {/* حالة المنارة */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-10 h-10 rounded-2xl grid place-items-center", guard.online ? "bg-teal-500/20 text-teal-400" : "bg-white/10 text-white/40")}>
            <RadioTower className={cn("w-5 h-5", guard.online && !guard.away && "animate-pulse")} />
          </div>
          <div className="flex-1 leading-tight">
            <div className="font-bold text-[13px]">منارة القرب</div>
            <div className="text-[10px] text-white/50">
              {guard.away ? "متوقفة — الكمبيوتر سيقفل تلقائياً" : guard.online ? "تبث كل ثانيتين للكمبيوتر" : "بانتظار الاتصال بالجسر…"}
            </div>
          </div>
          <RssiMeter rssi={guard.rssi} size="sm" />
          <ProxStateBadge state={guard.proxState} leftMs={null} />
        </div>

        {/* اختبار الابتعاد الحقيقي */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-2.5">
          <p className="text-[10.5px] text-white/60 leading-relaxed">
            اختبار النجاح: اضغط «ابتعدت» ثم ضع الهاتف جانباً — تتبلد المنارة فيقفل الكمبيوتر تلقائياً. عند العودة اضغط «عدت» فيُفتح.
          </p>
          {guard.away ? (
            <Button className="w-full h-12 rounded-2xl gap-2 font-bold bg-emerald-600 hover:bg-emerald-700" onClick={guard.comeBack}>
              <Home className="w-4.5 h-4.5" /> عدت — قرب الكمبيوتر
            </Button>
          ) : (
            <Button className="w-full h-12 rounded-2xl gap-2 font-bold bg-red-600 hover:bg-red-700" onClick={guard.goAway}>
              <Footprints className="w-4.5 h-4.5" /> ابتعدت بهاتفي (اختبار القفل)
            </Button>
          )}
        </div>
      </div>

      {/* الإعدادات السريعة — من الهاتف تظهر على الكمبيوتر */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-teal-400" />
          <h2 className="font-bold text-[13px]">الإعدادات السريعة — تعكس للكمبيوتر</h2>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {QS_TILES.map((t) => {
            const on = !!guard.qs[t.key as keyof typeof guard.qs]
            return (
              <button
                key={t.key}
                onClick={() => guard.toggleQs(t.key)}
                className={cn("rounded-2xl aspect-square flex flex-col items-center justify-center gap-1 transition-all", on ? "bg-teal-500/25 text-teal-300" : "bg-white/5 text-white/30")}
              >
                <t.Icon className="w-5 h-5" />
                <span className="text-[8px] font-semibold">{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* المنبهات */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <AlarmClock className="w-4 h-4 text-teal-400" />
          <h2 className="font-bold text-[13px]">منبهات الهاتف</h2>
        </div>
        {guard.alarms.map((a) => (
          <div key={a.id} className="flex items-center gap-3 py-1.5">
            <Switch checked={a.enabled} onCheckedChange={() => guard.toggleAlarm(a.id)} />
            <span className="text-[15px] font-black tabular-nums dir-ltr w-12" style={{ opacity: a.enabled ? 1 : 0.4 }}>{alarmTime(a)}</span>
            <span className="text-[11px] flex-1" style={{ opacity: a.enabled ? 1 : 0.5 }}>{a.label}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white/5 border border-white/10 p-3 text-[10px] text-white/50 flex items-start gap-2">
        <Smartphone className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        كل أوامر الحماية من الكمبيوتر (الرن، الفقدان، المسح) تصل هنا فوراً عبر Nexus Protocol على شبكتك المحلية.
      </div>
    </div>
  )
}

// ==== طبقات ملء الشاشة (قتل §48 / رن / فقدان / مسح) ====
export function GuardOverlays({ guard }: { guard: PhoneGuardCore }) {
  // §48 — شاشة القتل أولًا وقبل كل شيء: لا رنين يعلوها ولا فقدان يطمسها ولا
  // مسح يُنافسها — الجهاز مات، والقتل أحادي الاتجاه بلا زر ولا عودة.
  if (guard.killed?.active) {
    return (
      <div className="fixed inset-0 z-[400] bg-gradient-to-b from-red-950 via-red-900 to-black flex flex-col items-center justify-center select-none pointer-events-auto" dir="rtl">
        <div className="bg-black/40 border-y border-red-500/40 w-full text-center py-3 mb-8">
          <div className="text-red-300 text-[11px] font-black tracking-widest">أمر نهائي من المالك — عقد §48</div>
        </div>
        <OctagonAlert className="w-20 h-20 text-red-500 mb-5" />
        <div className="text-white text-2xl font-black mb-2 text-center px-6">هذا الجهاز مُغلق نهائيًا</div>
        <p className="text-white/60 text-sm text-center px-10 leading-relaxed mb-6">
          لا طريق للعودة · الاقتران والرمز أُبطلَا لحظة القتل · أي إعادة اتصال تُقابَل بالقتل فورًا · سجل الأدلة محفوظ عند المالك
        </p>
        <div className="flex items-center gap-2 text-white/40 font-mono text-[11px] px-4 py-2 rounded-xl bg-black/30 border border-white/10" dir="ltr">
          <Fingerprint className="w-3.5 h-3.5" />
          {guard.killed.fingerprint || "server-order"}
        </div>
        <div className="text-white/25 text-[10px] mt-8" dir="ltr">{new Date(guard.killed.at || Date.now()).toISOString()}</div>
        <div className="text-white/20 text-[9px] mt-10 text-center px-8">
          محاكاة التوأم الوِب — على الهاتف الحقيقي الشاشة نفسها تُطبَّق بوكيل Flutter بلا مسار خروج
        </div>
      </div>
    )
  }

  if (guard.ringing) {
    return (
      <div className="fixed inset-0 z-[300] bg-red-600 flex flex-col items-center justify-center select-none" dir="rtl">
        <BellRing className="w-24 h-24 text-white animate-bounce mb-6" />
        <div className="text-white text-2xl font-black mb-2">الهاتف يرن!</div>
        <div className="text-white/80 text-sm mb-8">أين هاتفي — NexusLink · تجاوز الوضع الصامت</div>
        <button
          onClick={guard.stopRing}
          className="rounded-full bg-white text-red-600 font-black text-lg px-10 py-4 active:scale-95 transition-transform shadow-2xl"
        >
          أنا هنا! أوقف الرن
        </button>
      </div>
    )
  }

  if (guard.lost.active) {
    return (
      <div className="fixed inset-0 z-[300] bg-zinc-950 flex flex-col select-none" dir="rtl">
        <div className="bg-amber-500 text-black text-center text-xs font-bold py-2">وضع الفقدان مفعّل — الجهاز مقفل</div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <ShieldCheck className="w-16 h-16 text-amber-400 mb-5" />
          <p className="text-white text-lg font-bold leading-relaxed">{guard.lost.message || "هذا الهاتف مفقود."}</p>
          {guard.lost.callback && <p className="text-white/60 mt-3 font-mono text-sm" dir="ltr">{guard.lost.callback}</p>}
          <p className="text-white/30 text-[11px] mt-8">الإشعارات مخفية · لا يمكن الوصول للبيانات · تتبع الشبكة المحلية مستمر</p>
        </div>
        <div className="text-center text-white/25 text-[10px] pb-6">NexusLink · حماية الأجهزة</div>
      </div>
    )
  }

  if (guard.wipe.stage === "wiping" || guard.wipe.stage === "wiped") {
    return (
      <div className="fixed inset-0 z-[300] bg-black flex flex-col items-center justify-center select-none" dir="rtl">
        {guard.wipe.stage === "wiping" ? (
          <>
            <div className="text-red-500 text-lg font-black mb-4 animate-pulse">جارٍ مسح كل البيانات…</div>
            <div className="w-56 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-red-500 transition-all" style={{ width: `${guard.wipe.progress}%` }} />
            </div>
            <div className="text-white/40 text-xs mt-2" dir="ltr">{Math.round(guard.wipe.progress)}%</div>
          </>
        ) : (
          <div className="text-center px-8">
            <CheckCircle2 className="w-14 h-14 text-white/40 mx-auto mb-4" />
            <div className="text-white text-xl font-black mb-2">تم مسح الجهاز</div>
            <p className="text-white/50 text-sm mb-8">مرحباً بك — أعد تنشيط الجهاز للمتابعة</p>
            <Button variant="outline" className="rounded-2xl border-white/30 text-white" onClick={guard.reactivate}>
              محاكاة إعادة التنشيط
            </Button>
          </div>
        )}
      </div>
    )
  }

  // وميض الإضاءة (شاشة بيضاء نابضة)
  if (guard.strobe) {
    return (
      <div className="fixed inset-0 z-[300] bg-white animate-pulse pointer-events-none" dir="rtl" />
    )
  }

  return null
}
