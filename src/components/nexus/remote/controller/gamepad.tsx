"use client"
// يد الألعاب — عصا تحليلية + أزرار قابلة للتخصيص (ضغط مطول) + توجيه بالجيروسكوب
import { useRef, useState } from "react"
import { Gamepad2, Compass, Settings2, Vibrate } from "lucide-react"
import { rcGamepad } from "@/lib/remote-socket"
import { Switch } from "@/components/ui/switch"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"

type BtnId = "A" | "B" | "X" | "Y"
type ActionId = "boost" | "brake" | "jump" | "horn" | "pause"

const ACTIONS: { id: ActionId; label: string }[] = [
  { id: "boost", label: "تسريع نيترو" },
  { id: "brake", label: "فرملة توقف" },
  { id: "jump", label: "قفزة (+10 نقاط)" },
  { id: "horn", label: "صافرة السيارة" },
  { id: "pause", label: "إيقاف مؤقت" },
]

const BTN_STYLE: Record<BtnId, string> = {
  A: "bg-emerald-500 border-emerald-600",
  B: "bg-red-500 border-red-600",
  X: "bg-sky-500 border-sky-600",
  Y: "bg-amber-500 border-amber-600",
}

function actionLabel(id: ActionId) {
  return ACTIONS.find((a) => a.id === id)?.label ?? id
}

export function GamepadMode() {
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [stickActive, setStickActive] = useState(false)
  const [map, setMap] = useState<Record<BtnId, ActionId>>({ A: "boost", B: "brake", X: "jump", Y: "horn" })
  const [remap, setRemap] = useState<BtnId | null>(null)
  const [gyroSteer, setGyroSteer] = useState(false)
  const [flash, setFlash] = useState("اضغط مطولاً على أي زر لتخصيص وظيفته")

  const stickRef = useRef<HTMLDivElement>(null)
  const touching = useRef(false)
  const lastEmit = useRef(0)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longFired = useRef(false)
  const lastGyro = useRef(0)
  const gyroZero = useRef<number | null>(null)

  const buzz = (ms = 30) => { try { navigator.vibrate?.(ms) } catch { /* ignore */ } }

  // ===== العصا =====
  function stickMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = stickRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let dx = (e.clientX - cx) / (r.width / 2)
    let dy = (e.clientY - cy) / (r.height / 2)
    const mag = Math.hypot(dx, dy)
    if (mag > 1) { dx /= mag; dy /= mag }
    setKnob({ x: dx, y: dy })
    const now = performance.now()
    if (now - lastEmit.current > 55) {
      lastEmit.current = now
      const dead = Math.hypot(dx, dy) < 0.12 ? 0 : 1
      rcGamepad({ kind: "stick", x: dead ? dx : 0, y: dead ? dy : 0 })
    }
  }
  function stickEnd() {
    touching.current = false
    setStickActive(false)
    setKnob({ x: 0, y: 0 })
    rcGamepad({ kind: "stick", x: 0, y: 0 })
  }

  // ===== توجيه الجيروسكوب =====
  function toggleGyro(v: boolean) {
    setGyroSteer(v)
    gyroZero.current = null
    if (v) {
      const onOrient = (e: DeviceOrientationEvent) => {
        if (!gyroSteer) return
        const gamma = e.gamma ?? 0
        if (gyroZero.current == null) gyroZero.current = gamma
        const now = performance.now()
        if (now - lastGyro.current < 80) return
        lastGyro.current = now
        const x = Math.max(-1, Math.min(1, (gamma - gyroZero.current) / 22))
        rcGamepad({ kind: "stick", x, y: 0 })
        setKnob({ x, y: 0 })
      }
      type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
      const DOE2 = DeviceOrientationEvent as DOE
      if (typeof DOE2?.requestPermission === "function") {
        DOE2.requestPermission().then((r) => { if (r === "granted") window.addEventListener("deviceorientation", onOrient) }).catch(() => { /* ignore */ })
      } else {
        window.addEventListener("deviceorientation", onOrient)
      }
      setFlash("أمل الهاتف يميناً ويساراً للتوجيه بالجيروسكوب")
    } else {
      rcGamepad({ kind: "stick", x: 0, y: 0 })
      setKnob({ x: 0, y: 0 })
      setFlash("اضغط مطولاً على أي زر لتخصيص وظيفته")
    }
  }

  // ===== الأزرار =====
  function down(btn: BtnId) {
    longFired.current = false
    longPress.current = setTimeout(() => {
      longFired.current = true
      buzz(60)
      setRemap(btn)
    }, 480)
  }
  function up(btn: BtnId) {
    if (longPress.current) clearTimeout(longPress.current)
    if (longFired.current) return
    buzz(30)
    const action = map[btn]
    rcGamepad({ kind: "button", button: btn, action })
    setFlash(`زر ${btn} → ${actionLabel(action)}`)
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="flex items-center gap-1.5 font-bold">
          <Gamepad2 className="w-4 h-4 text-violet-500" /> يد Nexus الافتراضية
        </span>
        <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
          <Compass className="w-3.5 h-3.5" /> توجيه بالجيروسكوب
          <Switch checked={gyroSteer} onCheckedChange={toggleGyro} aria-label="توجيه بالجيروسكوب" />
        </span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_auto] gap-3 items-center">
        {/* العصا */}
        <div className="flex flex-col items-center gap-2">
          <div
            ref={stickRef}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); touching.current = true; setStickActive(true); stickMove(e) }}
            onPointerMove={(e) => { if (touching.current) stickMove(e) }}
            onPointerUp={stickEnd}
            onPointerCancel={stickEnd}
            className={`relative w-32 h-32 sm:w-36 sm:h-36 rounded-full border-4 bg-accent/40 touch-none select-none grid place-items-center transition-shadow ${stickActive ? "shadow-xl shadow-violet-500/25 border-violet-400/60" : ""}`}
            role="application"
            aria-label="العصا التحليلية"
          >
            <span className="absolute inset-3 rounded-full border-2 border-dashed border-border/60" />
            <span
              className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/40 border-2 border-white/30 transition-transform duration-75"
              style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground">L — حرّك السيارة في اللعبة</span>
        </div>

        {/* ABXY */}
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5 w-[126px]">
          <span />
          <PadBtn id="Y" map={map} down={down} up={up} />
          <span />
          <PadBtn id="X" map={map} down={down} up={up} />
          <span className="grid place-items-center">
            <span className="w-6 h-6 rounded-full bg-foreground/10" />
          </span>
          <PadBtn id="B" map={map} down={down} up={up} />
          <span />
          <PadBtn id="A" map={map} down={down} up={up} />
          <span />
        </div>
      </div>

      {/* L / R / Start */}
      <div className="grid grid-cols-3 gap-1.5">
        <button
          onPointerDown={() => { buzz(20); rcGamepad({ kind: "button", button: "L", action: "pause" }); setFlash("L → إيقاف مؤقت") }}
          className="rounded-xl border bg-card py-2 text-[10.5px] font-bold hover:bg-accent active:scale-95 transition-all"
        >
          L
        </button>
        <button
          onPointerDown={() => { buzz(20); rcGamepad({ kind: "button", button: "Start", action: "pause" }); setFlash("Start → إيقاف مؤقت") }}
          className="rounded-xl border bg-card py-2 text-[10.5px] font-bold hover:bg-accent active:scale-95 transition-all"
        >
          Start
        </button>
        <button
          onPointerDown={() => { buzz(20); rcGamepad({ kind: "button", button: "R", action: "boost" }); setFlash("R → تسريع نيترو") }}
          className="rounded-xl border bg-card py-2 text-[10.5px] font-bold hover:bg-accent active:scale-95 transition-all"
        >
          R
        </button>
      </div>

      <p className="flex items-center gap-1.5 text-[9.5px] text-muted-foreground">
        <Vibrate className="w-3 h-3 shrink-0" /> {flash}
      </p>

      {/* تخصيص الأزرار */}
      <Dialog open={remap != null} onOpenChange={(o) => !o && setRemap(null)}>
        <DialogContent className="max-w-[280px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[14px]">
              <Settings2 className="w-4 h-4 text-primary" /> تخصيص الزر {remap}
            </DialogTitle>
            <DialogDescription className="text-[11px]">اختر الوظيفة التي ينفذها هذا الزر على الكمبيوتر</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  if (remap) { setMap((m) => ({ ...m, [remap]: a.id })); setFlash(`تم: زر ${remap} → ${a.label}`) }
                  setRemap(null)
                }}
                className={`w-full rounded-xl border px-3 py-2 text-[11.5px] font-semibold text-start transition-all hover:bg-accent ${
                  remap && map[remap] === a.id ? "border-primary bg-primary/10 text-primary" : ""
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PadBtn({ id, map, down, up }: { id: BtnId; map: Record<BtnId, ActionId>; down: (b: BtnId) => void; up: (b: BtnId) => void }) {
  return (
    <button
      onPointerDown={() => down(id)}
      onPointerUp={() => up(id)}
      onPointerLeave={() => { /* أمان */ }}
      className={`relative w-11 h-11 rounded-full border-2 text-white text-[15px] font-black shadow-md active:scale-90 transition-transform grid place-items-center ${BTN_STYLE[id]}`}
      aria-label={`زر ${id}`}
    >
      {id}
      <span className="absolute -bottom-5 text-[7.5px] text-muted-foreground font-semibold whitespace-nowrap max-w-14 overflow-hidden text-ellipsis">
        {actionLabel(map[id]).split(" ")[0]}
      </span>
    </button>
  )
}
