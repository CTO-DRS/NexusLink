"use client"

import { useNexus, type ViewId } from "@/lib/store"
import { useComms } from "@/lib/comms-store"
import { useGuard } from "@/lib/guard-store"
import { useProd } from "@/lib/prod-store"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Smartphone, FolderOpen, ArrowLeftRight, HardDrive, Settings2, MonitorSmartphone,
  MessagesSquare, Bot, MousePointer2, Video, ShieldCheck, Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const ITEMS: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "devices", label: "الأجهزة", icon: Smartphone },
  { id: "files", label: "الملفات", icon: FolderOpen },
  { id: "transfers", label: "النقل", icon: ArrowLeftRight },
  { id: "storage", label: "التخزين", icon: HardDrive },
  { id: "comms", label: "الاتصالات", icon: MessagesSquare },
  { id: "remote", label: "التحكم", icon: MousePointer2 },
  { id: "media", label: "الوسائط", icon: Video },
  { id: "guard", label: "الحماية", icon: ShieldCheck },
  { id: "prod", label: "الإنتاجية", icon: Zap },
  { id: "simulator", label: "هاتف افتراضي", icon: Bot },
  { id: "settings", label: "الإعدادات", icon: Settings2 },
]

export function Dock() {
  const { view, setView, transfers } = useNexus()
  const unreadNotifs = useComms((s) => s.notifications.filter((n) => n.status === "new").length)
  const unreadMsgs = useComms((s) => s.conversations.reduce((acc, c) => acc + c.unread, 0))
  const liveCall = useComms((s) => s.liveCall)
  const ringing = useGuard((s) => s.ringing)
  const lostActive = useGuard((s) => s.lost.active)
  const unseenClips = useProd((s) => s.unseenClips)
  const activeCount = transfers.filter((t) => t.status === "active" || t.status === "queued").length
  const commsBadge = unreadNotifs + unreadMsgs

  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed bottom-3 inset-x-0 z-50 flex justify-center px-2"
    >
      <div className="flex items-end gap-0.5 sm:gap-1 rounded-3xl border bg-card/90 backdrop-blur-xl shadow-2xl shadow-black/10 px-1.5 py-1.5 max-w-[98vw]">
        {ITEMS.map((it) => {
          const active = view === it.id
          const Icon = it.icon
          return (
            <Tooltip key={it.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setView(it.id)}
                  aria-label={it.label}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center gap-0.5 rounded-2xl px-2 sm:px-4 py-2 transition-all duration-200 ${
                    active
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-[1.04]"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} />
                  <span className="text-[9px] sm:text-[10px] font-medium hidden min-[420px]:block">{it.label}</span>
                  {it.id === "transfers" && activeCount > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-[9px] font-bold text-white grid place-items-center">
                      {activeCount}
                    </span>
                  )}
                  {it.id === "comms" && commsBadge > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white grid place-items-center">
                      {commsBadge > 99 ? "99+" : commsBadge}
                    </span>
                  )}
                  {it.id === "simulator" && liveCall && (
                    <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-emerald-500 text-[9px] font-bold text-white grid place-items-center">
                      <PhoneCallDot />
                    </span>
                  )}
                  {it.id === "guard" && (ringing || lostActive) && (
                    <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 grid place-items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                    </span>
                  )}
                  {it.id === "prod" && unseenClips > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-4 h-4 px-1 rounded-full bg-violet-500 text-[9px] font-bold text-white grid place-items-center">
                      {unseenClips > 9 ? "9+" : unseenClips}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{it.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </nav>
  )
}

function PhoneCallDot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
}

export function DockIcon() {
  return <MonitorSmartphone className="w-4 h-4" />
}
