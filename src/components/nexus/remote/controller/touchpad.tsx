"use client"
// لوحة اللمس اللاسلكية — إيماءات متعددة اللمس: سحب، نقرة، نقرة أيمن، تمرير، قرص
import { useRef, useState } from "react"
import { MousePointerClick, Move, ZoomIn, Hand } from "lucide-react"
import { rcMove, rcClick, rcScroll, rcPinch } from "@/lib/remote-socket"
import { Slider } from "@/components/ui/slider"

type P = { x: number; y: number; sx: number; sy: number; t: number }

export function TouchpadMode() {
  const [speed, setSpeed] = useState(1.4)
  const [label, setLabel] = useState("اسحب إصبعك لتحريك المؤشر")
  const pointers = useRef<Map<number, P>>(new Map())
  const pinch = useRef<{ last: number } | null>(null)
  const twoStart = useRef<{ t: number; moved: number } | null>(null)
  const moved = useRef(0)
  const lastTap = useRef(0)
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flash(text: string) {
    setLabel(text)
    if (labelTimer.current) clearTimeout(labelTimer.current)
    labelTimer.current = setTimeout(() => setLabel("اسحب إصبعك لتحريك المؤشر"), 1400)
  }
  const buzz = (ms = 8) => { try { navigator.vibrate?.(ms) } catch { /* ignore */ } }

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: Date.now() })
    if (pointers.current.size === 2) {
      twoStart.current = { t: Date.now(), moved: 0 }
      const [a, b] = [...pointers.current.values()]
      pinch.current = { last: Math.hypot(a.x - b.x, a.y - b.y) }
      flash("إصبعان — تمرير أو قرص")
    }
  }

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY

    if (pointers.current.size === 1) {
      moved.current += Math.abs(dx) + Math.abs(dy)
      rcMove((dx / 430) * speed, (dy / 430) * speed, "touchpad")
    } else if (pointers.current.size === 2 && twoStart.current) {
      twoStart.current.moved += Math.abs(dx) + Math.abs(dy)
      const pts = [...pointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const avgDy = dy
      if (pinch.current && dist > 20) {
        const scale = dist / pinch.current.last
        if (Math.abs(dist - pinch.current.last) > 2) {
          rcPinch(scale)
          pinch.current.last = dist
          flash("قرص — تكبير/تصغير سطح المكتب")
          return
        }
      }
      if (Math.abs(avgDy) > 1.5) {
        rcScroll(avgDy / 260)
        flash(avgDy > 0 ? "تمرير للأسفل" : "تمرير للأعلى")
      }
    }
  }

  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    pointers.current.delete(e.pointerId)

    if (twoStart.current && pointers.current.size === 0) {
      // نقر بإصبعين → زر أيمن
      if (Date.now() - twoStart.current.t < 320 && twoStart.current.moved < 22) {
        rcClick("right")
        flash("نقرة أيمن (إصبعان)")
        buzz(14)
      }
      twoStart.current = null
      pinch.current = null
      moved.current = 0
      return
    }

    if (pointers.current.size === 0 && p) {
      const dt = Date.now() - p.t
      const localMove = Math.hypot(e.clientX - p.sx, e.clientY - p.sy)
      if (dt < 280 && localMove < 10 && moved.current < 26) {
        const now = Date.now()
        if (now - lastTap.current < 380) {
          rcClick("left", "double")
          flash("نقرة مزدوجة")
          buzz(16)
          lastTap.current = 0
        } else {
          rcClick("left")
          flash("نقرة يسرى")
          buzz(10)
          lastTap.current = now
        }
      }
      moved.current = 0
    }
  }

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      {/* المنطقة */}
      <div
        className="nexus-touchpad relative flex-1 min-h-[230px] rounded-2xl border-2 border-dashed bg-accent/30 select-none touch-none grid place-items-center active:bg-accent/50 transition-colors"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="application"
        aria-label="لوحة اللمس — اسحب لتحريك مؤشر الكمبيوتر"
        data-testid="touchpad-area"
      >
        <div className="text-center pointer-events-none px-4">
          <Move className="w-7 h-7 mx-auto text-muted-foreground/60 mb-1.5" />
          <p className="text-[11.5px] font-semibold text-muted-foreground">{label}</p>
          <p className="text-[9px] text-muted-foreground/60 mt-1 leading-relaxed">
            نقرة واحدة = زر أيسر · نقرة مزدوجة سريعة = فتح<br />
            إصبعان + تمرير = Scroll · إصبعان + قرص = Zoom · نقر بإصبعين = زر أيمن
          </p>
        </div>
      </div>

      {/* أزرار سريعة */}
      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => { rcClick("left"); flash("نقرة يسرى"); buzz() }}
          className="rounded-xl border bg-card py-2 text-[10.5px] font-semibold flex items-center justify-center gap-1 hover:bg-accent active:scale-95 transition-all"
        >
          <MousePointerClick className="w-3.5 h-3.5 text-teal-500" /> زر أيسر
        </button>
        <button
          onClick={() => { rcClick("right"); flash("نقرة أيمن"); buzz() }}
          className="rounded-xl border bg-card py-2 text-[10.5px] font-semibold flex items-center justify-center gap-1 hover:bg-accent active:scale-95 transition-all"
        >
          <Hand className="w-3.5 h-3.5 text-amber-500" /> زر أيمن
        </button>
        <button
          onClick={() => { rcClick("left", "double"); flash("نقرة مزدوجة"); buzz() }}
          className="rounded-xl border bg-card py-2 text-[10.5px] font-semibold flex items-center justify-center gap-1 hover:bg-accent active:scale-95 transition-all"
        >
          <ZoomIn className="w-3.5 h-3.5 text-sky-500" /> مزدوج
        </button>
      </div>

      {/* السرعة */}
      <div className="rounded-xl border bg-card px-3 py-2">
        <div className="flex items-center justify-between text-[10px] font-semibold mb-1">
          <span>سرعة المؤشر</span>
          <span className="text-primary tabular-nums" dir="ltr">{speed.toFixed(1)}×</span>
        </div>
        <Slider value={[speed]} min={0.5} max={2.6} step={0.1} onValueChange={([v]) => setSpeed(v)} />
      </div>
    </div>
  )
}
