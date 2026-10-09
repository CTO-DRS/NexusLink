"use client"

/**
 * لوحة الأوامر (Ctrl+K) + دليل الاختصارات (?) — المرحلة 11 (بند 5)
 */
import { useEffect } from "react"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useNexus, SHORTCUT_META, type ShortcutAction, type ViewId } from "@/lib/store"
import { useComms } from "@/lib/comms-store"
import { useI18n } from "@/lib/i18n"
import { syncDnd } from "@/hooks/use-comms"
import {
  Smartphone, FolderOpen, ArrowLeftRight, HardDrive, MessagesSquare,
  MousePointer2, Video, ShieldCheck, Zap, Shield, Bot, Settings2, Wrench,
  Lock, Moon, Sun, Languages, Contrast, BellOff, Bell, Gauge, Stethoscope,
  Sparkles, FilePlus2, Terminal,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const VIEWS: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "devices", label: "الأجهزة", icon: Smartphone },
  { id: "files", label: "الملفات", icon: FolderOpen },
  { id: "transfers", label: "النقل", icon: ArrowLeftRight },
  { id: "storage", label: "التخزين", icon: HardDrive },
  { id: "comms", label: "الاتصالات", icon: MessagesSquare },
  { id: "remote", label: "التحكم", icon: MousePointer2 },
  { id: "media", label: "الوسائط", icon: Video },
  { id: "guard", label: "الحماية", icon: ShieldCheck },
  { id: "prod", label: "الإنتاجية", icon: Zap },
  { id: "security", label: "الأمان", icon: Shield },
  { id: "tools", label: "الأدوات", icon: Wrench },
  { id: "simulator", label: "الهاتف الافتراضي", icon: Bot },
  { id: "settings", label: "الإعدادات", icon: Settings2 },
]

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setView, theme, toggleTheme, contrast, setContrast, setOnboardingOpen, setShortcutsHelpOpen } = useNexus()
  const { t, lang, setLang } = useI18n()
  const dnd = useComms((s) => s.phone.dnd)

  const run = (fn: () => void) => {
    setPaletteOpen(false)
    fn()
  }

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <CommandInput placeholder={t("اكتب أمراً أو ابحث…")} />
      <CommandList className="nexus-scroll">
        <CommandEmpty>{t("لا نتائج")}</CommandEmpty>
        <CommandGroup heading={t("التنقل")}>
          {VIEWS.map((v) => (
            <CommandItem key={v.id} onSelect={() => run(() => setView(v.id))}>
              <v.icon className="w-4 h-4 text-muted-foreground" />
              {t(v.label)}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("إجراءات")}>
          <CommandItem onSelect={() => run(() => { setView("transfers") })}>
            <FilePlus2 className="w-4 h-4 text-muted-foreground" />
            {t("إرسال ملف سريع")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => { setView("tools"); })}>
            <Gauge className="w-4 h-4 text-muted-foreground" />
            {t("اختبار السرعة")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => { setView("tools") })}>
            <Stethoscope className="w-4 h-4 text-muted-foreground" />
            {t("تشخيص المشاكل")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => { setOnboardingOpen(true) })}>
            <Sparkles className="w-4 h-4 text-muted-foreground" />
            {t("إعادة جولة الترحيب")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => { setShortcutsHelpOpen(true) })}>
            <Terminal className="w-4 h-4 text-muted-foreground" />
            {t("دليل الاختصارات")}
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("المظهر واللغة")}>
          <CommandItem onSelect={() => run(toggleTheme)}>
            {theme === "dark" ? <Sun className="w-4 h-4 text-muted-foreground" /> : <Moon className="w-4 h-4 text-muted-foreground" />}
            {t("تبديل المظهر")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => setContrast(contrast === "high" ? "normal" : "high"))}>
            <Contrast className="w-4 h-4 text-muted-foreground" />
            {t("تبديل التباين العالي")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => setLang(lang === "ar" ? "en" : "ar"))}>
            <Languages className="w-4 h-4 text-muted-foreground" />
            {lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
          </CommandItem>
          <CommandItem onSelect={() => run(() => syncDnd(!dnd))}>
            {dnd ? <Bell className="w-4 h-4 text-muted-foreground" /> : <BellOff className="w-4 h-4 text-muted-foreground" />}
            {t("تبديل عدم الإزعاج")}
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("الأمان")}>
          <CommandItem onSelect={() => run(() => {
            import("@/lib/guard-store").then(({ useGuard }) => {
              useGuard.getState().setPcLocked({ reason: "قفل يدوي من لوحة الأوامر", at: Date.now() })
            })
          })}>
            <Lock className="w-4 h-4 text-muted-foreground" />
            {t("قفل التطبيق")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

export function ShortcutsOverlay() {
  const { shortcutsHelpOpen, setShortcutsHelpOpen, shortcuts } = useNexus()
  const { t } = useI18n()

  useEffect(() => {
    if (!shortcutsHelpOpen) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShortcutsHelpOpen(false)
    }
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [shortcutsHelpOpen, setShortcutsHelpOpen])

  const order: ShortcutAction[] = [
    "palette", "help", "sendFile", "lock", "theme", "lang", "contrast", "speedtest", "dnd",
    "devices", "files", "transfers", "comms", "security", "tools", "settings",
  ]

  return (
    <Dialog open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-base font-bold">{t("دليل اختصارات الكيبورد")}</DialogTitle>
        <div className="space-y-1 mt-2 max-h-[60vh] overflow-y-auto nexus-scroll">
          {order.map((a) => (
            <div key={a} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-accent/60">
              <span className="text-sm">{t(SHORTCUT_META[a])}</span>
              <kbd className="inline-flex items-center rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold" data-no-i18n>{shortcuts[a]}</kbd>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          {t("يمكنك تخصيص كل اختصار من: الإعدادات ← الاختصارات")}
        </p>
      </DialogContent>
    </Dialog>
  )
}
