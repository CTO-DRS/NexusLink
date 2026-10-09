"use client"
// الماوس الهوائي — حركة الهاتف + الجيروسكوب تحرّك مؤشر الكمبيوتر
// يعمل بالجيروسكوب الحقيقي على الهاتف، وبوضع محاكاة داخل المتصفح
import { useEffect, useRef, useState } from "react"
import { Radar, Crosshair, Vibrate, Ruler, CircleDot } from "lucide-react"
import { rcMove, rcClick } from "@/lib/remote-socket"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"

export function AirMouseMode() {
  const [streaming, setStreaming] = useState(false)
  const [gain, setGain] = useState(1.6)
  const [shake, setShake] = useState(true)
  const [noGyro, setNoGyro] = useState(false)
  const [live, setLive] = useState({ beta: 0, gamma: 0 })
  const [label, setLabel] = useState("أمل هاتفك مثل جهاز تحكم تلفاز ووجّه")

  const calib = useRef({ beta: 0, gamma: 0 })
  const lastSent = useRef(0)
  const lastShake = useRef(0)
  const gotEvent = useRef(false)
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flash(text: string) {
    setLabel(text)
    if (labelTimer.current) clearTimeout(labelTimer.current)
    labelTimer.current = setTimeout(() => setLabel("أمل هاتفك مثل جهاز تحكم تلفاز ووجّه"), 1600)
  }

  // مستشعرات التوجيه + الاهتزاز
  useEffect(() => {
    if (!streaming) return
    const onOrient = (e: DeviceOrientationEvent) => {
      // متصفحات الحاسوب تطلق حدثاً فارغاً (null) — لا يُحتسب كجيروسكوب
      if (e.beta == null && e.gamma == null) return
      gotEvent.current = true
      setNoGyro(false)
      const beta = e.beta ?? 0
      const gamma = e.gamma ?? 0
      setLive({ beta, gamma })
      const now = performance.now()
      if (now - lastSent.current < 38) return
      lastSent.current = now
      const dx = (gamma - calib.current.gamma) * 0.0016 * gain
      const dy = (beta - calib.current.beta) * 0.0016 * gain
      rcMove(dx, dy, "airmouse")
    }
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration
      if (!a || a.x == null) return
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0)
      const now = Date.now()
      if (shake && mag > 26 && now - lastShake.current > 900) {
        lastShake.current = now
        rcClick("left")
        flash("اهتزاز → نقرة يسرى!")
      }
    }
    window.addEventListener("deviceorientation", onOrient)
    window.addEventListener("devicemotion", onMotion)
    const check = setTimeout(() => {
      if (!gotEvent.current) setNoGyro(true)
    }, 1300)
    return () => {
      window.removeEventListener("deviceorientation", onOrient)
      window.removeEventListener("devicemotion", onMotion)
      clearTimeout(check)
    }
  }, [streaming, gain, shake])

  async function enable() {
    // إذن iOS 13+
    type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
    const DOE2 = DeviceOrientationEvent as DOE
    try {
      if (typeof DOE2.requestPermission === "function") {
        const r = await DOE2.requestPermission()
        if (r !== "granted") {
          flash("لم يُمنح إذن مستشعر الحركة — جرّب وضع المحاكاة")
          return
        }
      }
    } catch { /* تجاهل — أجهزة غير مدعومة */ }
    gotEvent.current = false
    calib.current = { beta: live.beta, gamma: live.gamma }
    setStreaming(true)
    setTimeout(() => { if (!gotEvent.current) setNoGyro(true) }, 1300)
  }

  // ===== وضع المحاكاة (متصفح الحاسوب) =====
  const simRef = useRef<HTMLDivElement>(null)
  const simDot = useRef({ x: 0.5, y: 0.5 })

  function simMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = simRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    const dx = (nx - simDot.current.x) * 1.35 * gain
    const dy = (ny - simDot.current.y) * 1.35 * gain
    simDot.current = { x: nx, y: ny }
    setLive({ beta: (ny - 0.5) * 60, gamma: (nx - 0.5) * 60 })
    rcMove(dx, dy, "airmouse")
  }

  const bx = Math.min(1, Math.max(-1, live.gamma / 45))
  const by = Math.min(1, Math.max(-1, (live.beta - 40) / 45))

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      {/* مستوى الفقاعة */}
      <div className="rounded-2xl border bg-card p-3 grid grid-cols-[92px_1fr] gap-3 items-center">
        <div className="relative w-[92px] h-[92px] rounded-full border-2 border-dashed bg-accent/40 grid place-items-center overflow-hidden">
          <span className="absolute w-0.5 h-full bg-border" />
          <span className="absolute h-0.5 w-full bg-border" />
          <span
            className="absolute w-6 h-6 rounded-full bg-gradient-to-br from-teal-400 to-cyan-600 shadow-lg shadow-teal-500/30 transition-all duration-75"
            style={{ left: `${50 + bx * 34}%`, top: `${50 + by * 34}%`, transform: "translate(-50%,-50%)" }}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 text-[11.5px] font-bold">
            <Radar className={`w-4 h-4 ${streaming ? "text-emerald-500" : "text-muted-foreground"}`} />
            {streaming ? (noGyro ? "وضع المحاكاة نشط" : "بث الجيروسكوب نشط") : "البث متوقف"}
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">{label}</p>
          <p className="text-[9.5px] tabular-nums text-muted-foreground/70" dir="ltr">
            β {live.beta.toFixed(1)}° · γ {live.gamma.toFixed(1)}° · ~{Math.round(26 / Math.max(0.2, gain * 0.6))}Hz
          </p>
        </div>
      </div>

      {/* أزرار */}
      <div className="grid grid-cols-2 gap-1.5">
        {streaming ? (
          <Button variant="secondary" className="h-9 rounded-xl text-[11.5px]" onClick={() => { setStreaming(false); setNoGyro(false) }}>
            إيقاف البث
          </Button>
        ) : (
          <Button className="h-9 rounded-xl text-[11.5px]" onClick={enable}>
            <Radar className="w-3.5 h-3.5" /> تفعيل الجيروسكوب
          </Button>
        )}
        <Button
          variant="outline"
          className="h-9 rounded-xl text-[11.5px] gap-1"
          onClick={() => { calib.current = { ...live }; flash("تمت المعايرة — هذا الوضع هو المنتصف") }}
        >
          <Crosshair className="w-3.5 h-3.5" /> معايرة المنتصف
        </Button>
      </div>

      {/* الحساسية والاهتزاز */}
      <div className="rounded-xl border bg-card px-3 py-2 space-y-2">
        <div className="flex items-center justify-between text-[10px] font-semibold">
          <span className="flex items-center gap-1"><Ruler className="w-3 h-3" /> الحساسية</span>
          <span className="text-primary tabular-nums" dir="ltr">{gain.toFixed(1)}×</span>
        </div>
        <Slider value={[gain]} min={0.6} max={3.2} step={0.1} onValueChange={([v]) => setGain(v)} />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold">
            <Vibrate className="w-3.5 h-3.5 text-amber-500" /> اهتزاز الهاتف = نقرة
          </span>
          <Switch checked={shake} onCheckedChange={setShake} aria-label="اهتزاز للنقر" />
        </div>
      </div>

      {/* وضع المحاكاة */}
      {(noGyro || (!streaming && typeof window !== "undefined" && !("DeviceOrientationEvent" in window))) && (
        <div
          ref={simRef}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); simMove(e) }}
          onPointerMove={(e) => { if (e.buttons > 0 || e.pointerType === "touch") simMove(e) }}
          className="relative flex-1 min-h-[120px] rounded-2xl border-2 border-dashed bg-accent/30 grid place-items-center touch-none select-none"
          role="application"
          aria-label="لوحة محاكاة الميلان"
        >
          <div className="text-center pointer-events-none px-4">
            <CircleDot className="w-5 h-5 mx-auto text-muted-foreground/60 mb-1" />
            <p className="text-[11px] font-semibold text-muted-foreground">وضع المحاكاة — اسحب داخل الدائرة</p>
            <p className="text-[9px] text-muted-foreground/60">على هاتف حقيقي يعمل هذا بجيروسكوب فعلي دون لمس</p>
          </div>
        </div>
      )}
    </div>
  )
}
