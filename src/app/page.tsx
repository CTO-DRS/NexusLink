"use client"

import { useEffect, useRef } from "react"
import { useNexus, initPolishPrefs, type ShortcutAction } from "@/lib/store"
import { useI18n, initLang, announce } from "@/lib/i18n"
import { Toaster } from "@/components/ui/sonner"
import { TopBar } from "@/components/nexus/top-bar"
import { Dock } from "@/components/nexus/dock"
import { DevicesView } from "@/components/nexus/devices-view"
import { FilesView } from "@/components/nexus/files-view"
import { TransfersView } from "@/components/nexus/transfers-view"
import { StorageView } from "@/components/nexus/storage-view"
import { SettingsView } from "@/components/nexus/settings-view"
import { PreviewModal } from "@/components/nexus/preview-modal"
import { CommsView } from "@/components/nexus/comms-view"
import { SimulatorView } from "@/components/nexus/comms/simulator-view"
import { RemoteView } from "@/components/nexus/remote/remote-view"
import { MediaView } from "@/components/nexus/media/media-view"
import { GuardView } from "@/components/nexus/guard/guard-view"
import { ProdView } from "@/components/nexus/prod/prod-view"
import { SecView } from "@/components/nexus/sec/sec-view"
import { ToolsView } from "@/components/nexus/tools/tools-view"
import { Onboarding } from "@/components/nexus/onboarding"
import { CommandPalette, ShortcutsOverlay } from "@/components/nexus/command-palette"
import { DesktopBridge } from "@/components/nexus/desktop-bridge"
import { LockScreen } from "@/components/nexus/guard/lock-screen"
import { CallOverlay } from "@/components/nexus/comms/call-overlay"
import { CommsToaster } from "@/components/nexus/comms/comms-toaster"
import { useCommsBridge, syncDnd } from "@/hooks/use-comms"
import { useComms } from "@/lib/comms-store"
import { useGuard } from "@/lib/guard-store"
import { useRemoteBridge } from "@/hooks/use-remote-bridge"
import { useMediaBridge } from "@/hooks/use-media-bridge"
import { useGuardBridge } from "@/hooks/use-guard-bridge"
import { useProdBridge } from "@/hooks/use-prod-bridge"

/** build a normalized combo string from a keyboard event */
function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl")
  if (e.altKey) parts.push("Alt")
  if (e.shiftKey) parts.push("Shift")
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return parts.join("+")
}

export default function NexusPage() {
  const { view, theme, shortcuts } = useNexus()
  const { lang, setLang } = useI18n()
  const srMode = useNexus((s) => s.srMode)
  const onboarded = useNexus((s) => s.onboarded)
  const setDevices = useNexus((s) => s.setDevices)
  const setTransfers = useNexus((s) => s.setTransfers)
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
      else if (byCombo("lang")) setLang(document.documentElement.dir === "rtl" ? "en" : "ar")
      else if (byCombo("speedtest")) st.setView("tools")
      else if (byCombo("dnd")) syncDnd(!useComms.getState().phone.dnd)
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setLang, shortcuts])

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
          {lang === "ar" ? "تخطَّ إلى المحتوى الرئيسي" : "Skip to main content"}
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
            {view === "tools" && <ToolsView />}
            {view === "simulator" && <SimulatorView />}
            {view === "settings" && <SettingsView />}
          </div>
        </main>
        <Dock />
      </div>
      <PreviewModal />
      <CallOverlay />
      <CommsToaster />
      <Onboarding />
      <CommandPalette />
      <ShortcutsOverlay />
      <LockScreen />
      <Toaster position="bottom-center" richColors />
      <DesktopBridge />
      {!onboarded && <span className="sr-only" aria-hidden />}
    </div>
  )
}
