"use client"

import { useNexus } from "@/lib/store"
import { useComms } from "@/lib/comms-store"
import { useProd } from "@/lib/prod-store"
import { useI18n, LANGS, cycleLang, langMeta } from "@/lib/i18n"
import { syncDnd } from "@/hooks/use-comms"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Sun, Moon, Link2, Smartphone, BellOff, Bell, MessageSquareText, Zap, Languages, Search, ScanSearch } from "lucide-react"

export function TopBar() {
  const { theme, toggleTheme, devices, setView, setPaletteOpen, setUnifiedSearchOpen } = useNexus()
  const { t, lang } = useI18n()
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
            <div className="text-[10px] text-muted-foreground -mt-0.5">{t("منصة إدارة الأجهزة الموحدة")}</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* البحث الموحد (§33.أ) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl gap-1.5 px-2.5 hidden sm:flex"
                onClick={() => setUnifiedSearchOpen(true)}
                aria-label={`${t("بحث موحد")} (Ctrl+Shift+F)`}
              >
                <ScanSearch className="w-3.5 h-3.5" />
                <span className="hidden lg:inline text-[11px] font-medium">{t("بحث موحد")}</span>
                <kbd className="hidden xl:inline-flex items-center rounded border bg-muted px-1 font-mono text-[9px]" data-no-i18n>Ctrl+Shift+F</kbd>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("بحث موحد عبر الأجهزة والملفات والرسائل")} — Ctrl+Shift+F</TooltipContent>
          </Tooltip>

          {/* لوحة الأوامر */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl gap-1.5 px-2.5 hidden sm:flex"
                onClick={() => setPaletteOpen(true)}
                aria-label={`${t("لوحة الأوامر")} (Ctrl+K)`}
              >
                <Search className="w-3.5 h-3.5" />
                <span className="hidden lg:inline text-[11px] font-medium">{t("بحث وأوامر")}</span>
                <kbd className="hidden lg:inline-flex items-center rounded border bg-muted px-1 font-mono text-[9px]" data-no-i18n>Ctrl+K</kbd>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("لوحة الأوامر")} — Ctrl+K</TooltipContent>
          </Tooltip>

          {/* تبديل اللغة */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl gap-1.5 px-2.5"
                onClick={() => cycleLang()}
                aria-label={`${t("تبديل اللغة")} — ${langMeta(lang).native} → ${langMeta(LANGS[(LANGS.findIndex((x) => x.code === lang) + 1) % LANGS.length].code).native}`}
              >
                <Languages className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold" data-no-i18n>
                  {LANGS[(LANGS.findIndex((x) => x.code === lang) + 1) % LANGS.length].code === "ar"
                    ? "ع"
                    : LANGS[(LANGS.findIndex((x) => x.code === lang) + 1) % LANGS.length].code.slice(0, 2).toUpperCase()}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("تبديل اللغة")} — Ctrl+Shift+E</TooltipContent>
          </Tooltip>

          {/* مزامنة وضع عدم الإزعاج */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={phone.dnd ? "default" : "outline"}
                size="sm"
                className={`h-8 rounded-xl gap-1.5 px-2.5 ${phone.dnd && phone.dndSource === "phone" ? "bg-amber-500 hover:bg-amber-600" : ""}`}
                onClick={() => syncDnd(!phone.dnd)}
                aria-label={t("مزامنة وضع عدم الإزعاج مع الهاتف")}
              >
                {phone.dnd ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                <span className="hidden md:inline text-[11px] font-medium">{t("عدم الإزعاج")}</span>
                {phone.dnd && phone.dndSource && (
                  <span className="hidden md:inline text-[9px] opacity-80">
                    ({phone.dndSource === "pc" ? t("من الكمبيوتر") : t("من الهاتف")})
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {phone.dnd
                ? `${t("مفعّل على الهاتف")} ${phone.dndSource === "pc" ? `(${t("بمزامنة من الكمبيوتر")})` : `(${t("من الهاتف")})`} — ${t("اضغط للإيقاف")}`
                : t("مزامنة وضع عدم الإزعاج مع الهاتف")}
            </TooltipContent>
          </Tooltip>

          {/* الإشعارات غير المقروءة */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 px-2.5 relative" onClick={() => setView("comms")} aria-label={t("فتح الإشعارات")}>
                <MessageSquareText className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-[11px] font-medium">{t("الاتصالات")}</span>
                {unreadNotifs + unreadMsgs > 0 && (
                  <span className="absolute -top-1.5 -end-1.5 min-w-4.5 h-4.5 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white grid place-items-center" data-no-i18n>
                    {unreadNotifs + unreadMsgs > 99 ? "99+" : unreadNotifs + unreadMsgs}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{unreadNotifs} {t("إشعار و")} {unreadMsgs} {t("رسالة غير مقروءة")}</TooltipContent>
          </Tooltip>

          {/* ملف الشبكة النشط — الإنتاجية */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl gap-1.5 px-2.5 hidden md:flex"
                onClick={() => setView("prod")}
                aria-label={t("ملف تعريف الشبكة النشط")}
              >
                <Zap className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-[11px] font-medium" data-no-i18n>{prodNetwork}</span>
                {prodProfile && <span className="text-[10px] text-violet-600 dark:text-violet-400 font-bold" data-no-i18n>· {prodProfile.name}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {prodProfile
                ? `${t("الملف الشخصي «")}${prodProfile.name}» ${t("مطبق على شبكة")} ${prodNetwork}`
                : `${t("شبكة")} ${prodNetwork} — ${t("لا ملف تعريف مطابق")}`}
            </TooltipContent>
          </Tooltip>

          <Badge
            variant="outline"
            className="gap-1.5 ps-2 pe-2.5 py-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hidden sm:flex"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 nexus-live" />
            <span className="text-[11px] font-medium">
              {connected.length > 0 ? `${connected.length} ${t("جهاز متصل")}` : t("لا توجد أجهزة متصلة")}
            </span>
          </Badge>
          {livePhone && (
            <Badge variant="secondary" className="gap-1 hidden lg:flex" data-no-i18n>
              <Smartphone className="w-3 h-3" />
              {livePhone.name} · {livePhone.rttMs}ms
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t("تبديل المظهر")}>
                {theme === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{theme === "dark" ? t("المظهر الفاتح") : t("المظهر الداكن")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
