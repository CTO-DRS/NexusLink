"use client"

import { useNexus } from "@/lib/store"
import { useComms } from "@/lib/comms-store"
import { useProd } from "@/lib/prod-store"
import { syncDnd } from "@/hooks/use-comms"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Sun, Moon, Link2, Smartphone, BellOff, Bell, MessageSquareText, Zap } from "lucide-react"

export function TopBar() {
  const { theme, toggleTheme, devices, setView } = useNexus()
  const phone = useComms((s) => s.phone)
  const unreadNotifs = useComms((s) => s.notifications.filter((n) => n.status === "new").length)
  const unreadMsgs = useComms((s) => s.conversations.reduce((acc, c) => acc + c.unread, 0))
  const connected = devices.filter((d) => d.state === "connected" && d.kind !== "desktop")
  const livePhone = devices.find((d) => d.kind === "phone" && d.state === "connected")
  const prodNetwork = useProd((s) => s.state.network)
  const prodProfile = useProd((s) => s.profile)

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

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* مزامنة وضع عدم الإزعاج */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={phone.dnd ? "default" : "outline"}
                size="sm"
                className={`h-8 rounded-xl gap-1.5 px-2.5 ${phone.dnd && phone.dndSource === "phone" ? "bg-amber-500 hover:bg-amber-600" : ""}`}
                onClick={() => syncDnd(!phone.dnd)}
                aria-label="مزامنة وضع عدم الإزعاج مع الهاتف"
              >
                {phone.dnd ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                <span className="hidden md:inline text-[11px] font-medium">عدم الإزعاج</span>
                {phone.dnd && phone.dndSource && (
                  <span className="hidden md:inline text-[9px] opacity-80">
                    ({phone.dndSource === "pc" ? "من الكمبيوتر" : "من الهاتف"})
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {phone.dnd
                ? `مفعّل على الهاتف ${phone.dndSource === "pc" ? "(بمزامنة من الكمبيوتر)" : "(من الهاتف)"} — اضغط للإيقاف`
                : "مزامنة وضع عدم الإزعاج مع الهاتف"}
            </TooltipContent>
          </Tooltip>

          {/* الإشعارات غير المقروءة */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 px-2.5 relative" onClick={() => setView("comms")} aria-label="فتح الإشعارات">
                <MessageSquareText className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-[11px] font-medium">الاتصالات</span>
                {unreadNotifs + unreadMsgs > 0 && (
                  <span className="absolute -top-1.5 -end-1.5 min-w-4.5 h-4.5 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white grid place-items-center">
                    {unreadNotifs + unreadMsgs > 99 ? "99+" : unreadNotifs + unreadMsgs}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{unreadNotifs} إشعار و {unreadMsgs} رسالة غير مقروءة</TooltipContent>
          </Tooltip>

          {/* ملف الشبكة النشط — الإنتاجية */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl gap-1.5 px-2.5 hidden md:flex"
                onClick={() => setView("prod")}
                aria-label="ملف تعريف الشبكة النشط"
              >
                <Zap className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-[11px] font-medium">{prodNetwork}</span>
                {prodProfile && <span className="text-[10px] text-violet-600 dark:text-violet-400 font-bold">· {prodProfile.name}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {prodProfile
                ? `الملف الشخصي «${prodProfile.name}» مطبق على شبكة ${prodNetwork}`
                : `شبكة ${prodNetwork} — لا ملف تعريف مطابق`}
            </TooltipContent>
          </Tooltip>

          <Badge
            variant="outline"
            className="gap-1.5 ps-2 pe-2.5 py-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hidden sm:flex"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 nexus-live" />
            <span className="text-[11px] font-medium">
              {connected.length > 0 ? `${connected.length} جهاز متصل` : "لا توجد أجهزة متصلة"}
            </span>
          </Badge>
          {livePhone && (
            <Badge variant="secondary" className="gap-1.5 hidden lg:flex">
              <Smartphone className="w-3 h-3" />
              {livePhone.name} · {livePhone.rttMs}ms
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
