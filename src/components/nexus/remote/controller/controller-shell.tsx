"use client"
// هيكل جهاز التحكم — 8 أنماط تحكم يبدل بينها المستخدم (يُستخدم داخل التطبيق وفي صفحة الهاتف المستقلة)
import { useState } from "react"
import {
  Move, Keyboard, Radar, Gamepad2, Presentation, Music4, Power, ClipboardList,
  Wifi, WifiOff, Gauge, MonitorSmartphone,
} from "lucide-react"
import { useRcMirror } from "@/lib/remote-store"
import { TouchpadMode } from "./touchpad"
import { PerfBadge } from "./perf-panel"
import { KeyboardMode } from "./keyboard"
import { AirMouseMode } from "./airmouse"
import { GamepadMode } from "./gamepad"
import { PresenterMode } from "./presenter"
import { MediaRemoteMode } from "./media-remote"
import { SystemRemoteMode } from "./system-remote"
import { ClipboardRemoteMode } from "./clipboard-remote"

export type RcMode =
  | "touchpad" | "keyboard" | "airmouse" | "gamepad"
  | "presenter" | "media" | "system" | "clipboard"

const MODES: { id: RcMode; label: string; icon: typeof Move }[] = [
  { id: "touchpad", label: "لمس", icon: Move },
  { id: "keyboard", label: "كيبورد", icon: Keyboard },
  { id: "airmouse", label: "ماوس هوائي", icon: Radar },
  { id: "gamepad", label: "يد ألعاب", icon: Gamepad2 },
  { id: "presenter", label: "عروض", icon: Presentation },
  { id: "media", label: "وسائط", icon: Music4 },
  { id: "system", label: "نظام", icon: Power },
  { id: "clipboard", label: "حافظة", icon: ClipboardList },
]

const POWER_BADGE: Record<string, { text: string; cls: string }> = {
  on: { text: "يعمل", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  "shutting-down": { text: "جارٍ الإيقاف", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  off: { text: "مطفأ", cls: "bg-red-500/15 text-red-600 border-red-500/30" },
  booting: { text: "إقلاع", cls: "bg-sky-500/15 text-sky-600 border-sky-500/30" },
  sleeping: { text: "سكون", cls: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30" },
  hibernating: { text: "إسبات", cls: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30" },
  locked: { text: "مقفل", cls: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30" },
}

export function ControllerShell({ standalone = false }: { standalone?: boolean }) {
  const [mode, setMode] = useState<RcMode>("touchpad")
  const online = useRcMirror((s) => s.online)
  const latency = useRcMirror((s) => s.latency)
  const desktopName = useRcMirror((s) => s.desktopName)
  const report = useRcMirror((s) => s.report)
  const power = report?.power ?? "on"
  const badge = POWER_BADGE[power] ?? POWER_BADGE.on

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* شريط الحالة */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card/50 shrink-0">
        <MonitorSmartphone className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[11.5px] font-bold truncate">{desktopName}</p>
          <p className="text-[9px] text-muted-foreground">متصل عبر Nexus Protocol</p>
        </div>
        {report && (
          <span className={`text-[9px] font-bold rounded-full border px-2 py-0.5 ${badge.cls}`}>{badge.text}</span>
        )}
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground shrink-0">
          {online ? <Wifi className="w-3 h-3 text-emerald-500" /> : <WifiOff className="w-3 h-3 text-red-400" />}
          {latency != null && <span className="tabular-nums" dir="ltr">{latency}ms</span>}
        </span>
        {/* PERF (عقد §29) — شارة الأداء الحية: p95 تحكم + لوحة موسّعة عند اللمس */}
        <PerfBadge compact />
      </div>

      {/* المحتوى */}
      <div className={`flex-1 min-h-0 overflow-auto nexus-scroll ${standalone ? "px-2.5 py-2.5" : "px-3 py-3"}`}>
        {mode === "touchpad" && <TouchpadMode />}
        {mode === "keyboard" && <KeyboardMode />}
        {mode === "airmouse" && <AirMouseMode />}
        {mode === "gamepad" && <GamepadMode />}
        {mode === "presenter" && <PresenterMode />}
        {mode === "media" && <MediaRemoteMode />}
        {mode === "system" && <SystemRemoteMode />}
        {mode === "clipboard" && <ClipboardRemoteMode />}
      </div>

      {/* مبدّل الأنماط */}
      <div className="shrink-0 border-t bg-card/50 px-1.5 py-1.5">
        <div className="grid grid-cols-4 gap-1">
          {MODES.map((m) => {
            const Icon = m.icon
            const active = mode === m.id
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 transition-all ${
                  active ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={active ? 2.4 : 2} />
                <span className="text-[8.5px] font-medium leading-none">{m.label}</span>
              </button>
            )
          })}
        </div>
        <p className="flex items-center justify-center gap-1 text-[8.5px] text-muted-foreground mt-1">
          <Gauge className="w-2.5 h-2.5" />
          كل أمر يمر عبر جسر Nexus Protocol المشفّر داخل الشبكة المحلية
        </p>
      </div>
    </div>
  )
}
