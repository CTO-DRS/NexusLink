"use client"

import { useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import { useNexus, initPolishPrefs, type ShortcutAction } from "@/lib/store"
import { useI18n, initLang, announce, cycleLang, langMeta } from "@/lib/i18n"
import { Toaster } from "@/components/ui/sonner"
import { TopBar } from "@/components/nexus/top-bar"
import { Dock } from "@/components/nexus/dock"
import { DevicesView } from "@/components/nexus/devices-view"
import { DesktopBridge } from "@/components/nexus/desktop-bridge"
import { useCommsBridge, syncDnd } from "@/hooks/use-comms"
import { useComms } from "@/lib/comms-store"
import { useGuard } from "@/lib/guard-store"
import { useRemoteBridge } from "@/hooks/use-remote-bridge"
import { useMediaBridge } from "@/hooks/use-media-bridge"
import { useGuardBridge } from "@/hooks/use-guard-bridge"
import { useProdBridge } from "@/hooks/use-prod-bridge"
import { useAutomationBridge } from "@/hooks/use-automation-bridge"

/**
 * تكليف 49 (M1 PERF): كانت الوحدات الخمس عشرة (~5,900 سطر) وrecharts كله
 * تُستورد ثابتًا رغم أن وحدة واحدة تُعرض في كل لحظة — أول تحميل كان ينقل
 * ~3MB JS ويفسّرها قبل أول رسم. الآن: الوحدة الافتراضية (devices) والهيكل
 * المرئي فورًا يبقيان متزامنين، وكل وحدة أخرى تُحمّل عند أول فتح لها
 * (next/dynamic — chunk مستقل لكل وحدة) والنوافذ العلوية عند أول حاجة.
 * سلوك الواجهة كما هو: نفس المكونات، نفس الحالة، نفس الاختصارات —
 * التغيير في موعد وصول الكود لا في ما يفعله.
 */
/** هيكل تحميل مصغّر — نفس ارتفاع المنطقة تقريبًا بلا قفز تخطيط */
function ViewFallback() {
  return (
    <div className="nexus-enter space-y-3" aria-busy="true">
      <div className="h-8 w-64 rounded-lg bg-muted/60 animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
const FilesView = dynamic(() => import("@/components/nexus/files-view").then((m) => m.FilesView), { loading: ViewFallback })
const TransfersView = dynamic(() => import("@/components/nexus/transfers-view").then((m) => m.TransfersView), { loading: ViewFallback })
const StorageView = dynamic(() => import("@/components/nexus/storage-view").then((m) => m.StorageView), { loading: ViewFallback })
const SettingsView = dynamic(() => import("@/components/nexus/settings-view").then((m) => m.SettingsView), { loading: ViewFallback })
const CommsView = dynamic(() => import("@/components/nexus/comms-view").then((m) => m.CommsView), { loading: ViewFallback })
const SimulatorView = dynamic(() => import("@/components/nexus/comms/simulator-view").then((m) => m.SimulatorView), { loading: ViewFallback })
const RemoteView = dynamic(() => import("@/components/nexus/remote/remote-view").then((m) => m.RemoteView), { loading: ViewFallback })
const MediaView = dynamic(() => import("@/components/nexus/media/media-view").then((m) => m.MediaView), { loading: ViewFallback })
const GuardView = dynamic(() => import("@/components/nexus/guard/guard-view").then((m) => m.GuardView), { loading: ViewFallback })
const ProdView = dynamic(() => import("@/components/nexus/prod/prod-view").then((m) => m.ProdView), { loading: ViewFallback })
const SecView = dynamic(() => import("@/components/nexus/sec/sec-view").then((m) => m.SecView), { loading: ViewFallback })
const AutomationView = dynamic(() => import("@/components/nexus/automation/automation-view").then((m) => m.AutomationView), { loading: ViewFallback })
const IntelView = dynamic(() => import("@/components/nexus/intel/intel-view").then((m) => m.IntelView), { loading: ViewFallback })
const ToolsView = dynamic(() => import("@/components/nexus/tools/tools-view").then((m) => m.ToolsView), { loading: ViewFallback })

// النوافذ العلوية — أول حاجة فقط (مفتوحة بقيمة حالة، لا تُرى في أول رسم)
const PreviewModal = dynamic(() => import("@/components/nexus/preview-modal").then((m) => m.PreviewModal), { ssr: false })
const Onboarding = dynamic(() => import("@/components/nexus/onboarding").then((m) => m.Onboarding), { ssr: false })
const CommandPalette = dynamic(() => import("@/components/nexus/command-palette").then((m) => m.CommandPalette), { ssr: false })
const ShortcutsOverlay = dynamic(() => import("@/components/nexus/command-palette").then((m) => m.ShortcutsOverlay), { ssr: false })
const UnifiedSearch = dynamic(() => import("@/components/nexus/unified-search").then((m) => m.UnifiedSearch), { ssr: false })
const LockScreen = dynamic(() => import("@/components/nexus/guard/lock-screen").then((m) => m.LockScreen), { ssr: false })
const CallOverlay = dynamic(() => import("@/components/nexus/comms/call-overlay").then((m) => m.CallOverlay), { ssr: false })
const CommsToaster = dynamic(() => import("@/components/nexus/comms/comms-toaster").then((m) => m.CommsToaster), { ssr: false })

/**
 * واجهة تطبيق NexusLink الكاملة (12 وحدة).
 * تُعرض على:
 *   · /?desktop=1 — نافذة تطبيق سطح المكتب (procman يضبط الوسم؛ DesktopBridge يعمل)
 *   · /?app=1     — المتصفح/الهاتف عندما نريد التطبيق مباشرة دون جسر سطح المكتب
 * المسار / بدون وسوم يعرض الموقع الرسمي (src/components/site).
 * لا تغيير على عقد سطح المكتب: procman يفتح /?desktop=1 دائمًا — حرفيًا كما هو.
 */

/** build a normalized combo string from a keyboard event */
function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl")
  if (e.altKey) parts.push("Alt")
  if (e.shiftKey) parts.push("Shift")
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return parts.join("+")
}

export function NexusApp() {
  const { view, theme, shortcuts } = useNexus()
  const { lang, t } = useI18n()
  const srMode = useNexus((s) => s.srMode)
  const onboarded = useNexus((s) => s.onboarded)
  const setDevices = useNexus((s) => s.setDevices)
  const setTransfers = useNexus((s) => s.setTransfers)
  // تكليف 49: أعلام النوافذ العلوية — التركيب عند الحاجة لا عند الإقلاع
  // (next/dynamic يبدأ جلب الchunk لحظة التركيب حتى لو يرسم null —
  // التركيب الشرطي يجعل الجلب نفسه عند أول فتح فعلي).
  const previewEntry = useNexus((s) => s.previewEntry)
  const onboardingOpen = useNexus((s) => s.onboardingOpen)
  const paletteOpen = useNexus((s) => s.paletteOpen)
  const unifiedSearchOpen = useNexus((s) => s.unifiedSearchOpen)
  const shortcutsHelpOpen = useNexus((s) => s.shortcutsHelpOpen)
  const pcLocked = useGuard((s) => s.pcLocked)
  const liveCall = useComms((s) => s.liveCall)
  const toastCount = useComms((s) => s.toasts.length)
  const bootedRef = useRef(false)

  // جسر الاتصالات: أحداث فورية (إشعارات، SMS، مكالمات، DND)
  useCommsBridge()
  // جسر التحكم عن بُعد
  useRemoteBridge()
  // جسر الوسائط والكاميرا
  useMediaBridge()
  // جسر الحماية
  useGuardBridge()
  // جسر الإنتاجية
  useProdBridge()
  useAutomationBridge()

  // boot once: theme sync + lang + polish prefs + first-run onboarding
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    const isDark = document.documentElement.classList.contains("dark")
    useNexus.setState({ theme: isDark ? "dark" : "light" })
    initLang()
    initPolishPrefs()
    // first run → onboarding after paint
    if (!useNexus.getState().onboarded) {
      const tm = setTimeout(() => useNexus.getState().setOnboardingOpen(true), 600)
      return () => clearTimeout(tm)
    }
  }, [])

  // sync sr attribute for focus CSS
  useEffect(() => {
    document.documentElement.dataset.sr = srMode ? "on" : "off"
  }, [srMode])

  // global keyboard shortcuts (customizable)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const st = useNexus.getState()
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
      const combo = comboOf(e)

      // "?" help shortcut (plain or shift+/)
      const isHelp = combo === st.shortcuts.help || (e.key === "?" && !typing)
      // palette works even while typing
      if (combo === st.shortcuts.palette) {
        e.preventDefault()
        st.setPaletteOpen(true)
        return
      }
      // البحث الموحد (§33.أ): Ctrl+Shift+F — يعمل حتى أثناء الكتابة
      if (e.shiftKey && (combo === "ctrl+f" || (e.ctrlKey && e.key.toLowerCase() === "f"))) {
        e.preventDefault()
        st.setUnifiedSearchOpen(true)
        return
      }
      if (isHelp && !typing) {
        e.preventDefault()
        st.setShortcutsHelpOpen(true)
        return
      }
      if (typing) return

      const byCombo = (a: ShortcutAction) => st.shortcuts[a] === combo
      let handled = true
      if (byCombo("devices")) st.setView("devices")
      else if (byCombo("files")) st.setView("files")
      else if (byCombo("transfers")) st.setView("transfers")
      else if (byCombo("comms")) st.setView("comms")
      else if (byCombo("security")) st.setView("security")
      else if (byCombo("tools")) st.setView("tools")
      else if (byCombo("settings")) st.setView("settings")
      else if (byCombo("sendFile")) st.setView("transfers")
      else if (byCombo("lock")) {
        useGuard.getState().setPcLocked({ reason: "قفل يدوي — اختصار لوحة المفاتيح", at: Date.now() })
      }
      else if (byCombo("theme")) st.toggleTheme()
      else if (byCombo("contrast")) st.setContrast(st.contrast === "high" ? "normal" : "high")
      else if (byCombo("lang")) {
        const next = cycleLang()
        announce(t("تم تبديل اللغة إلى") + " " + langMeta(next).native)
      }
      else if (byCombo("speedtest")) st.setView("tools")
      else if (byCombo("dnd")) syncDnd(!useComms.getState().phone.dnd)
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [t, shortcuts])

  // poll devices (heartbeat feel)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch("/api/devices")
        const j = await r.json()
        if (alive && j.devices) setDevices(j.devices)
      } catch { /* ignore */ }
    }
    load()
    const iv = setInterval(load, 4000)
    return () => { alive = false; clearInterval(iv) }
  }, [setDevices])

  // poll transfers
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch("/api/transfer")
        const j = await r.json()
        if (alive && j.jobs) setTransfers(j.jobs)
      } catch { /* ignore */ }
    }
    load()
    const iv = setInterval(load, 900)
    return () => { alive = false; clearInterval(iv) }
  }, [setTransfers])

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-secondary/60 to-background">
      {srMode && (
        <a href="#nexus-main" className="nexus-skip-link">
          {t("تخطَّ إلى المحتوى الرئيسي")}
        </a>
      )}
      <div key={lang} className="contents">
        <TopBar />
        <main id="nexus-main" className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 pb-28 pt-4">
          <div key={view} className="nexus-enter">
            {view === "devices" && <DevicesView />}
            {view === "files" && <FilesView />}
            {view === "transfers" && <TransfersView />}
            {view === "storage" && <StorageView />}
            {view === "comms" && <CommsView />}
            {view === "remote" && <RemoteView />}
            {view === "media" && <MediaView />}
            {view === "guard" && <GuardView />}
            {view === "prod" && <ProdView />}
            {view === "security" && <SecView />}
            {view === "automation" && <AutomationView />}
            {view === "intel" && <IntelView />}
            {view === "tools" && <ToolsView />}
            {view === "simulator" && <SimulatorView />}
            {view === "settings" && <SettingsView />}
          </div>
        </main>
        <Dock />
      </div>
      {previewEntry && <PreviewModal />}
      {liveCall && <CallOverlay />}
      {toastCount > 0 && <CommsToaster />}
      {onboardingOpen && <Onboarding />}
      {paletteOpen && <CommandPalette />}
      {unifiedSearchOpen && <UnifiedSearch />}
      {shortcutsHelpOpen && <ShortcutsOverlay />}
      {pcLocked && <LockScreen />}
      <Toaster position="bottom-center" richColors />
      <DesktopBridge />
      {!onboarded && <span className="sr-only" aria-hidden />}
    </div>
  )
}
