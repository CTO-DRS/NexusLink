"use client"
// جهاز تحكم العروض التقديمية — تقليب الشرائح + مؤشر ليزري + مؤقّت
import { useEffect, useRef, useState } from "react"
import { ChevronRight, ChevronLeft, Circle, CircleStop, Timer, Presentation as PresIcon } from "lucide-react"
import { rcPresenter } from "@/lib/remote-socket"
import { useRcMirror } from "@/lib/remote-store"
import { Button } from "@/components/ui/button"

export function PresenterMode() {
  const report = useRcMirror((s) => s.report)
  const index = report?.presenter.index ?? 0
  const total = report?.presenter.total ?? 5
  const black = report?.presenter.black ?? false

  const [laser, setLaser] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const laserPad = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(iv)
  }, [running])

  function laserMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = laserPad.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    rcPresenter({ action: "laser-move", x, y })
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0")
  const ss = String(seconds % 60).padStart(2, "0")

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      {/* العداد */}
      <div className="rounded-2xl border bg-card px-3 py-2.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
          <PresIcon className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-bold">الشريحة {index + 1} من {total}</p>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
        <div className="text-center shrink-0">
          <p className="text-[16px] font-black tabular-nums" dir="ltr">{mm}:{ss}</p>
          <p className="text-[8px] text-muted-foreground">مؤقّت العرض</p>
        </div>
      </div>

      {/* أزرار التقليب */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-14 rounded-2xl flex-col gap-0.5 text-[11px] font-bold active:scale-95 transition-transform"
          onClick={() => rcPresenter({ action: "prev" })}
        >
          <ChevronRight className="w-5 h-5" />
          الشريحة السابقة
        </Button>
        <Button
          className="h-14 rounded-2xl flex-col gap-0.5 text-[11px] font-bold active:scale-95 transition-transform"
          onClick={() => rcPresenter({ action: "next" })}
        >
          <ChevronLeft className="w-5 h-5" />
          الشريحة التالية
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={black ? "destructive" : "secondary"}
          className="h-10 rounded-2xl text-[11px] font-bold"
          onClick={() => rcPresenter({ action: "black", value: !black })}
        >
          {black ? "إلغاء الشاشة السوداء" : "شاشة سوداء"}
        </Button>
        <Button
          variant={laser ? "default" : "secondary"}
          className="h-10 rounded-2xl text-[11px] font-bold"
          onClick={() => {
            const v = !laser
            setLaser(v)
            rcPresenter({ action: v ? "laser-on" : "laser-off" })
          }}
        >
          {laser ? "إيقاف الليزر" : "المؤشر الليزري"}
        </Button>
      </div>

      {/* لوحة الليزر */}
      {laser && (
        <div
          ref={laserPad}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); laserMove(e) }}
          onPointerMove={(e) => { if (e.buttons > 0 || e.pointerType === "touch") laserMove(e) }}
          onPointerUp={() => { /* يبقى الوضع نشطاً */ }}
          className="relative flex-1 min-h-[110px] rounded-2xl border-2 border-dashed bg-accent/30 touch-none select-none overflow-hidden"
          role="application"
          aria-label="لوحة المؤشر الليزري"
        >
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <p className="text-[10.5px] text-muted-foreground font-semibold">اسحب لتوجيه النقطة الحمراء على الشريحة</p>
          </div>
          <span className="absolute left-1/2 top-1/2 w-3 h-3 rounded-full bg-red-500 nexus-laser pointer-events-none" aria-hidden />
        </div>
      )}

      {/* المؤقت */}
      <div className="grid grid-cols-3 gap-1.5 shrink-0">
        <Button variant="outline" className="h-9 rounded-xl text-[11px] font-bold gap-1" onClick={() => setRunning((r) => !r)}>
          {running ? <CircleStop className="w-3.5 h-3.5" /> : <Timer className="w-3.5 h-3.5" />}
          {running ? "إيقاف" : "ابدأ"}
        </Button>
        <Button variant="ghost" className="h-9 rounded-xl text-[11px] font-bold" onClick={() => { setRunning(false); setSeconds(0) }}>
          تصفير
        </Button>
        <p className="h-9 rounded-xl border bg-card grid place-items-center text-[9px] text-muted-foreground font-semibold leading-tight text-center px-1">
          يعمل على العرض المفتوح بالكمبيوتر
        </p>
      </div>
      <span className="hidden"><Circle className="w-3 h-3" /></span>
    </div>
  )
}
