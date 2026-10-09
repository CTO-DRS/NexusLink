"use client"
// نافذة لعبة السباق — تستجيب لعصا وأزرار يد الألعاب من الهاتف (جيروسكوب / تخصيص)
import { useEffect, useRef, useState } from "react"
import { Gamepad2, Zap, Trophy } from "lucide-react"
import { useDesktop } from "@/lib/remote-store"

function beep(freq: number, ms: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "square"
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.06, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + ms / 1000)
    osc.onended = () => ctx.close()
  } catch { /* ignore */ }
}

export function GameWindow() {
  const stick = useDesktop((s) => s.stick)
  const boost = useDesktop((s) => s.gameBoost)
  const score = useDesktop((s) => s.gameScore)
  const jumpSeq = useDesktop((s) => s.gameJumpSeq)
  const hornSeq = useDesktop((s) => s.gameHornSeq)

  const areaRef = useRef<HTMLDivElement>(null)
  const pos = useRef({ x: 0.5, y: 0.72 })
  const trail = useRef<{ x: number; y: number }[]>([])
  const [tick, setTick] = useState(0)
  const [jumping, setJumping] = useState(false)
  const [hornBubble, setHornBubble] = useState(false)

  // حلقة اللعبة — تقرأ العصا مباشرة من المخزن
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let frame = 0
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const st = useDesktop.getState().stick
      const isBoost = useDesktop.getState().gameBoost
      const speed = 0.34 * (isBoost ? 2.1 : 1)
      pos.current.x = Math.min(0.94, Math.max(0.06, pos.current.x + st.x * speed * dt))
      pos.current.y = Math.min(0.92, Math.max(0.1, pos.current.y + st.y * speed * dt))
      if (Math.abs(st.x) + Math.abs(st.y) > 0.05) {
        trail.current.push({ ...pos.current })
        if (trail.current.length > 14) trail.current.shift()
      } else if (trail.current.length > 0) {
        trail.current.shift()
      }
      if (frame++ % 2 === 0) setTick((t) => t + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // قفزة
  useEffect(() => {
    if (jumpSeq === 0) return
    setJumping(true)
    const t = setTimeout(() => setJumping(false), 650)
    return () => clearTimeout(t)
  }, [jumpSeq])

  // صافرة
  useEffect(() => {
    if (hornSeq === 0) return
    setHornBubble(true)
    beep(520, 160)
    setTimeout(() => beep(660, 180), 170)
    const t = setTimeout(() => setHornBubble(false), 1000)
    return () => clearTimeout(t)
  }, [hornSeq])

  const angle = Math.atan2(stick.x, -stick.y) * (180 / Math.PI)

  return (
    <>
      <div className="flex items-center gap-2 px-3 h-9 border-b bg-card/60 shrink-0">
        <Gamepad2 className="w-3.5 h-3.5 text-violet-500" />
        <span className="text-[12px] font-semibold">لعبة السباق — Nexus Racer</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1 text-[11px] font-bold text-amber-500 tabular-nums">
          <Trophy className="w-3.5 h-3.5" /> {score}
        </span>
        {boost && (
          <span className="flex items-center gap-0.5 text-[9.5px] font-bold text-red-500 bg-red-500/10 rounded-full px-2 py-0.5">
            <Zap className="w-3 h-3" /> نيترو
          </span>
        )}
      </div>

      <div ref={areaRef} className="relative flex-1 m-3 rounded-xl overflow-hidden bg-[linear-gradient(180deg,#0f172a,#1e293b)]">
        {/* الطريق */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[62%] bg-slate-800/80 border-x-4 border-white/25" />
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[repeating-linear-gradient(180deg,transparent_0_18px,rgba(255,255,255,0.35)_18px_34px)]" />

        {/* أثر الحركة */}
        {trail.current.map((p, i) => (
          <span
            key={`${tick}-${i}`}
            className="absolute w-1.5 h-1.5 rounded-full bg-teal-400/40"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%,-50%)", opacity: (i + 1) / trail.current.length * 0.5 }}
          />
        ))}

        {/* السيارة */}
        <div
          className={`absolute transition-[filter] ${jumping ? "scale-125 drop-shadow-[0_14px_8px_rgba(0,0,0,0.55)]" : ""}`}
          style={{
            left: `${pos.current.x * 100}%`,
            top: `${pos.current.y * 100}%`,
            transform: `translate(-50%,-50%) rotate(${angle * 0.25}deg) ${jumping ? "translateY(-26px)" : ""}`,
            transition: "transform 0.12s linear",
            fontSize: 30,
            lineHeight: 1,
          }}
          aria-hidden
        >
          🏎️
        </div>

        {hornBubble && (
          <span
            className="absolute text-[13px] font-bold bg-amber-400 text-amber-950 rounded-full px-2 py-0.5 shadow"
            style={{ left: `${pos.current.x * 100}%`, top: `${Math.max(6, pos.current.y * 100 - 14)}%`, transform: "translate(-50%,-50%)" }}
          >
            📢 بيب بيب!
          </span>
        )}

        {/* HUD */}
        <div className="absolute top-2 start-2 flex gap-1.5" dir="rtl">
          <span className="text-[9.5px] font-bold bg-black/45 text-white/90 rounded-full px-2 py-1 backdrop-blur-sm">
            السرعة: {Math.round(Math.hypot(stick.x, stick.y) * (boost ? 210 : 100))} كم/س
          </span>
          <span className="text-[9.5px] font-bold bg-black/45 text-teal-300 rounded-full px-2 py-1 backdrop-blur-sm">
            تحكم: {Math.abs(stick.x) + Math.abs(stick.y) > 0.05 ? "نشط" : "انتظار العصا"}
          </span>
        </div>
        <p className="absolute bottom-2 inset-x-0 text-center text-[9.5px] text-white/40" dir="rtl">
          حرّك العصا أو أمل الهاتف (توجيه بالجيروسكوب) · اضغط مطولاً على الأزرار لتخصيصها من الهاتف
        </p>
      </div>
    </>
  )
}
