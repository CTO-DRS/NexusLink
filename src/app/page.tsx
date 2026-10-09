"use client"

import { useEffect } from "react"
import { useNexus } from "@/lib/store"
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
import { LockScreen } from "@/components/nexus/guard/lock-screen"
import { CallOverlay } from "@/components/nexus/comms/call-overlay"
import { CommsToaster } from "@/components/nexus/comms/comms-toaster"
import { useCommsBridge } from "@/hooks/use-comms"
import { useRemoteBridge } from "@/hooks/use-remote-bridge"
import { useMediaBridge } from "@/hooks/use-media-bridge"
import { useGuardBridge } from "@/hooks/use-guard-bridge"

export default function NexusPage() {
  const { view, theme, setDevices, setTransfers } = useNexus()

  // جسر الاتصالات: أحداث فورية (إشعارات، SMS، مكالمات، DND)
  useCommsBridge()
  // جسر التحكم عن بُعد: أوامر الهاتف الواردة (لمس/كيبورد/وسائط/نظام)
  useRemoteBridge()
  // جسر الوسائط والكاميرا: بث الهاتف الحقيقي + التنبيهات
  useMediaBridge()
  // جسر الحماية: منارة القرب + القفل التلقائي + أوامر الهاتف
  useGuardBridge()

  // sync theme class from the pre-hydration script
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark")
    useNexus.setState({ theme: isDark ? "dark" : "light" })
  }, [])

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
      <TopBar />
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 pb-28 pt-4">
        <div key={view} className="nexus-enter">
          {view === "devices" && <DevicesView />}
          {view === "files" && <FilesView />}
          {view === "transfers" && <TransfersView />}
          {view === "storage" && <StorageView />}
          {view === "comms" && <CommsView />}
          {view === "remote" && <RemoteView />}
          {view === "media" && <MediaView />}
          {view === "guard" && <GuardView />}
          {view === "simulator" && <SimulatorView />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>
      <Dock />
      <PreviewModal />
      <CallOverlay />
      <CommsToaster />
      <LockScreen />
      <Toaster position="bottom-center" richColors />
    </div>
  )
}
