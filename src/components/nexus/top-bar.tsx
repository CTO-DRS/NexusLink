"use client"

import { useNexus } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Sun, Moon, Link2, Smartphone } from "lucide-react"

export function TopBar() {
  const { theme, toggleTheme, devices } = useNexus()
  const connected = devices.filter((d) => d.state === "connected" && d.kind !== "desktop")
  const phone = devices.find((d) => d.kind === "phone" && d.state === "connected")

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-md shadow-primary/25">
            <Link2 className="w-4.5 h-4.5" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-[15px] tracking-tight">NexusLink</div>
            <div className="text-[10px] text-muted-foreground -mt-0.5">منصة إدارة الأجهزة الموحدة</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 ps-2 pe-2.5 py-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 nexus-live" />
            <span className="text-[11px] font-medium">
              {connected.length > 0 ? `${connected.length} جهاز متصل` : "لا توجد أجهزة متصلة"}
            </span>
          </Badge>
          {phone && (
            <Badge variant="secondary" className="gap-1.5 hidden sm:flex">
              <Smartphone className="w-3 h-3" />
              {phone.name} · {phone.rttMs}ms
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="تبديل المظهر">
                {theme === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{theme === "dark" ? "المظهر الفاتح" : "المظهر الداكن"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
