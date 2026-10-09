"use client"

import { useNexus, type ViewId } from "@/lib/store"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Smartphone, FolderOpen, ArrowLeftRight, HardDrive, Settings2, MonitorSmartphone,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const ITEMS: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "devices", label: "الأجهزة", icon: Smartphone },
  { id: "files", label: "الملفات", icon: FolderOpen },
  { id: "transfers", label: "النقل", icon: ArrowLeftRight },
  { id: "storage", label: "التخزين", icon: HardDrive },
  { id: "settings", label: "الإعدادات", icon: Settings2 },
]

export function Dock() {
  const { view, setView, transfers } = useNexus()
  const activeCount = transfers.filter((t) => t.status === "active" || t.status === "queued").length

  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed bottom-3 inset-x-0 z-50 flex justify-center px-3"
    >
      <div className="flex items-end gap-1 rounded-3xl border bg-card/90 backdrop-blur-xl shadow-2xl shadow-black/10 px-2 py-1.5">
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
                  className={`relative flex flex-col items-center gap-0.5 rounded-2xl px-3.5 sm:px-5 py-2 transition-all duration-200 ${
                    active
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-[1.04]"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} />
                  <span className="text-[10px] font-medium">{it.label}</span>
                  {it.id === "transfers" && activeCount > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-[9px] font-bold text-white grid place-items-center">
                      {activeCount}
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

export function DockIcon() {
  return <MonitorSmartphone className="w-4 h-4" />
}
