"use client"
// NexusLink — خطاف واجهة محرك الروتينات (عقد §26 + §26.ح)
// يُركَّب في جذر nexus-app — الاتصال عالمي فتعمل الروتينات وتظهر تنبيهاتها
// من أي تبويب، لا من تبويب الروتينات حصرًا.
// §26.ح: عند العودة (كل اتصال) يظهر مرة واحدة ملخص «تنبيهات لم تُرَ» للإطلاقات
// التي أُطلقت أثناء الغياب (بلا أي واجهة متصلة) — الإكمال الحي لـ §27.هـ.
import { useEffect } from "react"
import { useAutomation } from "@/lib/automation-store"
import { getAutomationSocket } from "@/lib/automation-socket"
import { useI18n } from "@/lib/i18n"
import { toast } from "sonner"

// ربط مستمعي المقبس مرة واحدة (المقبس singleton — حماية من double-mount في dev)
let listenersBound = false

export function useAutomationBridge() {
  const { t } = useI18n()

  useEffect(() => {
    fetch("/api/automation/boot").catch(() => { /* ignore */ })
    const socket = getAutomationSocket()
    const st = () => useAutomation.getState()

    // ملخص العودة يظهر مرة واحدة لكل اتصال — لا إزعاج بالتكرار مع كل broadcast
    let digestShown = false

    socket.on("connect", () => {
      st().setOnline(true)
      digestShown = false
    })
    socket.on("disconnect", () => st().setOnline(false))

    if (!listenersBound) {
      listenersBound = true
      socket.on("auto:state", (s: Parameters<ReturnType<typeof useAutomation.getState>["applyState"]>[0]) => {
        st().applyState(s)
        if (!digestShown && s?.alerts && s.alerts.unseen > 0) {
          digestShown = true
          const latest = s.alerts.latest?.[0]
          toast.info(t("تنبيهات روتين لم تُرَ"), {
            description: `${t("أُطلقت أثناء غيابك — آخرها")}: ${latest ? `${latest.ruleName} — ${latest.detail}` : "…"}`,
          })
        }
      })
      socket.on("auto:fired", (p: { ruleId: string; ruleName: string; ok: boolean; detail: string; manual: boolean }) => {
        toast[p.ok ? "success" : "error"](p.ruleName, { description: p.detail })
      })
      socket.on("auto:rejected", (d: { error?: string }) => {
        toast.error(t("المحرك رفض الطلب"), { description: d?.error || "" })
      })
    }
  }, [t])
}
