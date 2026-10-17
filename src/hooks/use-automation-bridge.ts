"use client"
// NexusLink — خطاف واجهة محرك الروتينات (عقد §26)
// يُركَّب في جذر nexus-app — الاتصال عالمي فتعمل الروتينات وتظهر تنبيهاتها
// من أي تبويب، لا من تبويب الروتينات حصرًا.
import { useEffect } from "react"
import { useAutomation } from "@/lib/automation-store"
import { getAutomationSocket } from "@/lib/automation-socket"
import { toast } from "sonner"

// ربط مستمعي المقبس مرة واحدة (المقبس singleton — حماية من double-mount في dev)
let listenersBound = false

export function useAutomationBridge() {
  useEffect(() => {
    fetch("/api/automation/boot").catch(() => { /* ignore */ })
    const socket = getAutomationSocket()
    const st = () => useAutomation.getState()

    socket.on("connect", () => st().setOnline(true))
    socket.on("disconnect", () => st().setOnline(false))

    if (!listenersBound) {
      listenersBound = true
      socket.on("auto:state", (s: Parameters<ReturnType<typeof useAutomation.getState>["applyState"]>[0]) => {
        st().applyState(s)
      })
      socket.on("auto:fired", (p: { ruleId: string; ruleName: string; ok: boolean; detail: string; manual: boolean }) => {
        toast[p.ok ? "success" : "error"](p.ruleName, { description: p.detail })
      })
      socket.on("auto:rejected", (d: { error?: string }) => {
        toast.error("المحرك رفض الطلب", { description: d?.error || "" })
      })
    }
  }, [])
}
