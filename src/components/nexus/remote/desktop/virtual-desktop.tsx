"use client"
// سطح المكتب الافتراضي — الشاشة التي يتحكم بها الهاتف عبر Nexus Protocol
import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Moon, Lock, MonitorX, Loader2, Presentation, Music4, NotebookPen, Gamepad2, Link2, Wifi, Volume2, VolumeX, Clipboard } from "lucide-react"
import { useDesktop } from "@/lib/remote-store"
import type { AppId } from "@/lib/remote-types"
import { PresentationWindow } from "./presentation"
import { MediaPlayerWindow } from "./media-player"
import { NotepadWindow } from "./notepad"
import { GameWindow } from "./game"

const APP_META: Record<AppId, { label: string; icon: typeof Presentation }> = {
  presentation: { label: "العرض التقديمي", icon: Presentation },
  media: { label: "مشغل الوسائط", icon: Music4 },
  notepad: { label: "المفكرة", icon: NotebookPen },
  game: { label: "لعبة السباق", icon: Gamepad2 },
}

function Cursor() {
  const cursor = useDesktop((s) => s.cursor)
  return (
    <div
      className="absolute z-50 pointer-events-none transition-transform duration-75"
      style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
      aria-hidden
    >
      <svg width="22" height="30" viewBox="0 0 22 30" className="nexus-cursor-shadow -translate-y-1 -translate-x-1">
        <path d="M3 1 L3 23 L8.5 18 L12 28 L15.5 26.5 L12 17 L19 16.5 Z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function Ripples() {
  const ripples = useDesktop((s) => s.ripples)
  return (
    <>
      {ripples.map((r) => (
        <span
          key={r.id}
          className="absolute z-40 pointer-events-none nexus-ripple rounded-full"
          style={{
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: r.kind === "double" ? 64 : 44,
            height: r.kind === "double" ? 64 : 44,
            border: `3px solid ${r.kind === "right" ? "#f59e0b" : "#22d3ee"}`,
          }}
          aria-hidden
        />
      ))}
    </>
  )
}

function PowerOverlay() {
  const power = useDesktop((s) => s.power)
  const stage = useDesktop((s) => s.powerStage)
  if (power === "on") return null
  return (
    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black text-white/90" dir="rtl">
      {(power === "shutting-down" || power === "booting") && (
        <>
          <div className="w-14 h-14 rounded-2xl bg-primary grid place-items-center shadow-lg">
            <Link2 className="w-7 h-7 text-primary-foreground" />
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-white/80" />
          <p className="text-sm font-medium">{stage || (power === "booting" ? "بدء التشغيل…" : "…")}</p>
          <p className="text-[10px] text-white/40">NEXUS-PC · UEFI v2.6</p>
        </>
      )}
      {power === "off" && (
        <>
          <MonitorX className="w-10 h-10 text-white/25" />
          <p className="text-sm text-white/50">لا توجد إشارة — الكمبيوتر مطفأ</p>
          <p className="text-[10px] text-white/35">أرسل حزمة Wake-on-LAN من هاتفك لتشغيله</p>
        </>
      )}
      {power === "hibernating" && (
        <>
          <Moon className="w-10 h-10 text-white/30" />
          <p className="text-sm text-white/55">الجهاز في وضع الإسبات — الجلسة محفوظة على القرص</p>
          <p className="text-[10px] text-white/35">يستيقظ فقط بحزمة Wake-on-LAN</p>
        </>
      )}
      {power === "sleeping" && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
          <Moon className="w-10 h-10 text-white/50" />
          <p className="text-sm text-white/70">وضع السكون — أي إدخال من الهاتف سيوقظه</p>
        </div>
      )}
      {power === "locked" && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center gap-3">
          <div className="w-16 h-16 rounded-full bg-white/10 grid place-items-center">
            <Lock className="w-7 h-7 text-white/80" />
          </div>
          <p className="text-base font-bold">الشاشة مقفلة</p>
          <p className="text-[11px] text-white/50">انقر من لوحة لمس الهاتف لفتح القفل</p>
        </div>
      )}
      {(power === "off" || power === "hibernating") && (
        <span className="absolute bottom-3 end-4 w-2.5 h-2.5 rounded-full bg-red-500/80 shadow" aria-label="مؤشر الطاقة" />
      )}
    </div>
  )
}

function Taskbar() {
  const { activeApp, setActiveApp, clipboard } = useDesktop()
  const [clock, setClock] = useState("")
  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit" }).format(new Date()))
    tick()
    const iv = setInterval(tick, 20000)
    return () => clearInterval(iv)
  }, [])
  const volume = useDesktop((s) => (s.mediaMuted ? 0 : s.mediaVolume))
  const zoom = useDesktop((s) => s.desktopZoom)
  const isOn = useDesktop((s) => s.power) === "on"

  return (
    <div className="absolute bottom-0 inset-x-0 z-30 h-10 bg-black/45 backdrop-blur-md border-t border-white/10 flex items-center px-2 gap-1">
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-600 grid place-items-center shrink-0">
        <Link2 className="w-3.5 h-3.5 text-white" />
      </div>
      {(Object.keys(APP_META) as AppId[]).map((id) => {
        const meta = APP_META[id]
        const Icon = meta.icon
        const active = activeApp === id
        return (
          <button
            key={id}
            onClick={() => setActiveApp(id)}
            className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-[10.5px] font-medium transition-colors ${
              active ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{meta.label}</span>
            {active && <span className="w-1 h-1 rounded-full bg-teal-300" />}
          </button>
        )
      })}
      <div className="flex-1" />
      {zoom !== 1 && (
        <span className="text-[9.5px] text-teal-300 font-bold px-1.5">{Math.round(zoom * 100)}%</span>
      )}
      {clipboard && (
        <span className="relative" title={`حافظة: ${clipboard.text.slice(0, 24)}`}>
          <Clipboard className="w-3.5 h-3.5 text-teal-300" />
          <span className="absolute -top-1 -end-1 w-1.5 h-1.5 rounded-full bg-teal-300" />
        </span>
      )}
      {isOn && (
        <span className="flex items-center gap-0.5 text-white/70">
          {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          <span className="text-[9.5px] hidden sm:inline">{volume}%</span>
        </span>
      )}
      <Wifi className="w-3.5 h-3.5 text-white/70" />
      <span className="text-[11px] text-white/85 font-semibold tabular-nums">{clock}</span>
    </div>
  )
}

function DesktopIcons() {
  return (
    <div className="absolute top-3 start-3 z-10 flex flex-col gap-3 opacity-90" dir="rtl">
      {(Object.keys(APP_META) as AppId[]).map((id) => {
        const meta = APP_META[id]
        const Icon = meta.icon
        return (
          <div key={id} className="flex flex-col items-center gap-1 w-16">
            <div className="w-9 h-9 rounded-xl bg-white/12 border border-white/20 grid place-items-center backdrop-blur-sm">
              <Icon className="w-4.5 h-4.5 text-white/90" />
            </div>
            <span className="text-[8.5px] text-white/75 text-center leading-tight">{meta.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export function VirtualDesktop() {
  const power = useDesktop((s) => s.power)
  const activeApp = useDesktop((s) => s.activeApp)
  const zoom = useDesktop((s) => s.desktopZoom)
  const showUI = power === "on" || power === "locked" || power === "sleeping"

  return (
    <div
      className="relative rounded-[1.6rem] border-[6px] border-foreground/75 bg-black shadow-2xl shadow-black/30 overflow-hidden aspect-[16/9.6]"
      dir="ltr"
      data-testid="virtual-desktop"
    >
      {/* خلفية */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_20%_10%,#134e4a_0%,#0f172a_55%,#020617_100%)]" />
      <div className="absolute inset-0 opacity-40 bg-[conic-gradient(from_180deg_at_70%_30%,rgba(45,212,191,0.12),transparent_30%,rgba(99,102,241,0.1)_60%,transparent)]" />

      {showUI && (
        <div
          className="absolute inset-0 transition-transform duration-200 origin-center"
          style={{ transform: `scale(${zoom})` }}
        >
          <DesktopIcons />

          {/* النافذة النشطة */}
          <div className="absolute inset-x-14 top-3 bottom-12 md:inset-x-20">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeApp}
                initial={{ opacity: 0, y: 14, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.99 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="w-full h-full rounded-xl bg-background/95 border border-border shadow-2xl overflow-hidden flex flex-col"
                dir="rtl"
              >
                {activeApp === "presentation" && <PresentationWindow />}
                {activeApp === "media" && <MediaPlayerWindow />}
                {activeApp === "notepad" && <NotepadWindow />}
                {activeApp === "game" && <GameWindow />}
              </motion.div>
            </AnimatePresence>
          </div>

          <Ripples />
          <Taskbar />
        </div>
      )}

      <Cursor />
      <PowerOverlay />
    </div>
  )
}
