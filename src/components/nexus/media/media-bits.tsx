"use client"
// NexusLink — عناصر مشتركة لواجهة الوسائط: إطارات الأجهزة، شارات البث،
// مقاييس المستوى، وفيديو حي
import { useEffect, useRef, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Wifi, BatteryFull, VideoOff, Radio, MonitorPlay, Smartphone, Tv } from "lucide-react"

/** فيديو حي يربط MediaStream تلقائياً */
export function LiveVideo({
  stream, className, muted = true, mirror = false, fallback,
}: {
  stream: MediaStream | null | undefined
  className?: string
  muted?: boolean
  mirror?: boolean
  fallback?: ReactNode
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cur = el.srcObject as MediaStream | null
    if (cur !== stream) el.srcObject = stream ?? null
    if (stream) void el.play().catch(() => { /* سيُشغّل عند تفاعل */ })
  }, [stream])
  if (!stream && fallback) return <>{fallback}</>
  return (
    <video
      ref={ref}
      playsInline
      muted={muted}
      className={cn("h-full w-full object-cover", className)}
      style={{ transform: mirror ? "scaleX(-1)" : undefined }}
    />
  )
}

/** شارة بث حي */
export function LiveBadge({ mode, className }: { mode?: string | null; className?: string }) {
  return (
    <Badge className={cn("gap-1.5 rounded-full bg-red-500 hover:bg-red-500 text-white ps-2 pe-2.5", className)}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-60 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      LIVE{mode ? ` · ${mode}` : ""}
    </Badge>
  )
}

/** مقياس مستوى أفقي (صوت/حركة) */
export function LevelBar({ level, peak, className, tone = "teal" }: { level: number; peak?: number; className?: string; tone?: "teal" | "amber" | "red" }) {
  const color = tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : "bg-teal-500"
  const peakColor = tone === "red" ? "bg-red-300" : tone === "amber" ? "bg-amber-300" : "bg-teal-300"
  return (
    <div className={cn("relative h-2.5 w-full rounded-full bg-muted overflow-hidden", className)}>
      <div
        className={cn("absolute inset-y-0 start-0 rounded-full transition-all duration-150", color)}
        style={{ width: `${Math.min(100, level)}%` }}
      />
      {typeof peak === "number" && peak > 0 && (
        <div
          className={cn("absolute inset-y-0 w-1 rounded-full transition-all duration-150", peakColor)}
          style={{ insetInlineStart: `${Math.min(99, peak)}%` }}
        />
      )}
    </div>
  )
}

/** إطار هاتف بشاشة قابلة للتخصيص */
export function PhoneFrame({
  children, name, sub, className, screenClassName, hud, active,
}: {
  children: ReactNode
  name: string
  sub?: string
  className?: string
  screenClassName?: string
  hud?: ReactNode
  active?: boolean
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="relative w-full max-w-[240px] rounded-[2rem] border-[6px] border-zinc-800 dark:border-zinc-700 bg-black shadow-2xl overflow-hidden">
        {/* نوتش */}
        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-20 h-4 rounded-full bg-black z-20 border border-zinc-800" />
        <div className={cn("relative aspect-[9/19] bg-zinc-950 overflow-hidden", screenClassName)}>
          {children}
          {hud}
        </div>
        {/* شريط حالة */}
        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4 pt-1.5 text-[9px] text-white/90 bg-gradient-to-b from-black/50 to-transparent pointer-events-none">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <Wifi className="w-2.5 h-2.5" />
            <BatteryFull className="w-3 h-3" />
          </span>
        </div>
        {active && (
          <span className="absolute top-9 end-2 z-20 flex items-center gap-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> LIVE
          </span>
        )}
      </div>
      <div className="text-center -mt-1">
        <div className="text-[12px] font-bold flex items-center justify-center gap-1">
          <Smartphone className="w-3 h-3 text-primary" /> {name}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  )
}

/** شاشة تلفاز كبيرة */
export function TvFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="relative w-full rounded-2xl border-[10px] border-zinc-900 dark:border-zinc-800 bg-black shadow-2xl overflow-hidden">
        <div className="relative aspect-video bg-zinc-950 overflow-hidden">{children}</div>
        <div className="absolute bottom-2 start-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[10px] text-white/90">
          <Tv className="w-3 h-3" /> Nexus-TV · 55"
        </div>
      </div>
      <div className="h-1.5 w-24 rounded-b-xl bg-zinc-300 dark:bg-zinc-700" />
    </div>
  )
}

/** نافذة كمبيوتر (تطبيق على سطح المكتب) */
export function PcWindow({
  title, children, className, headerExtra,
}: { title: string; children: ReactNode; className?: string; headerExtra?: ReactNode }) {
  return (
    <div className={cn("rounded-xl border bg-card shadow-xl overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[12px] font-semibold flex items-center gap-1.5 truncate">
          <MonitorPlay className="w-3.5 h-3.5 text-primary" /> {title}
        </span>
        <span className="ms-auto flex items-center gap-1.5">{headerExtra}</span>
      </div>
      <div className="relative">{children}</div>
    </div>
  )
}

/** حالة لا يوجد بث */
export function NoStream({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-zinc-900 text-zinc-500">
      <div className="text-center space-y-2">
        <VideoOff className="w-8 h-8 mx-auto opacity-60" />
        <p className="text-[11px] px-4 opacity-80">{text}</p>
      </div>
    </div>
  )
}

/** شريط حالة بث صغير */
export function StreamChip({ label, on }: { label: string; on: boolean }) {
  return (
    <Badge variant="outline" className={cn("gap-1 rounded-full text-[10px]", on ? "border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-400" : "text-muted-foreground")}>
      <Radio className={cn("w-3 h-3", on && "text-teal-500")} />
      {label}
    </Badge>
  )
}
