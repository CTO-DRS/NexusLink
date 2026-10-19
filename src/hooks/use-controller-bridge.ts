"use client"
// NexusLink — خطاف جهة الهاتف: إرسال الأوامر + مرآة حالة الكمبيوتر
import { useEffect } from "react"
import { toast } from "sonner"
import { useRcMirror } from "@/lib/remote-store"
import { usePerf } from "@/lib/perf-store"
import { getRemoteSocket, rcPing, consumeAck } from "@/lib/remote-socket"
import type { DesktopStateReport } from "@/lib/remote-types"

const REJECT_AR: Record<string, string> = {
  off: "الكمبيوتر مطفأ — أرسل حزمة Wake-on-LAN من تبويب «النظام»",
  hibernating: "الكمبيوتر في الإسبات — أرسل Wake-on-LAN للاستيقاظ",
  mac: "عنوان MAC غير مطابق للكمبيوتر المسجل",
  "already-on": "الكمبيوتر يعمل بالفعل — لا حاجة لإيقاظه",
}

export function useControllerBridge(controllerName = "هاتف التحكم") {
  useEffect(() => {
    // إقلاع الجسر داخل خادم Next (idempotent) ثم الاتصال
    fetch("/api/remote/boot").catch(() => { /* ignore */ })
    const socket = getRemoteSocket()
    const m = () => useRcMirror.getState()

    socket.on("connect", () => {
      m().setOnline(true)
      socket.emit("rc:hello-controller", { name: controllerName })
    })
    socket.on("disconnect", () => m().setOnline(false))

    socket.on("rc:hello", (d: { desktop?: { name?: string; mac?: string; power?: string } }) => {
      if (d?.desktop) m().setDesktopInfo(d.desktop.name ?? "NEXUS-PC", d.desktop.mac ?? "")
    })

    socket.on("desktop:state", (report: DesktopStateReport) => {
      if (report && typeof report === "object" && "power" in report) {
        m().setReport(report)
      }
    })

    socket.on("rc:rejected", (d: { reason: string }) => {
      m().setRejected(d.reason)
      toast.error(REJECT_AR[d.reason] ?? "تم رفض الأمر", { description: "Nexus Protocol · بوابة الطاقة" })
    })

    socket.on("desktop:clipboard", (d: { text: string }) => {
      if (d?.text) {
        m().pushClipboardInbox(d.text)
        toast.success("وصل نص من حافظة الكمبيوتر", { description: d.text.slice(0, 60) })
      }
    })

    // قياس زمن الاستجابة — PERF (عقد §29):
    //  · rc:ack — إقرار جسر الكمبيوتر لأمر مقيس: RTT من ساعة المرسل عبر المسار كاملًا
    //  · rc:pong — نبض صحة القناة (صدى الخدمة بلا كمبيوتر) — سلسلة ثانوية
    let pingT = 0
    socket.on("rc:ack", (d: { mid?: string }) => {
      const mid = String(d?.mid ?? "")
      if (!mid) return
      const p = consumeAck(mid)
      if (p) usePerf.getState().recordControl(Date.now() - p.t0, p.ev)
    })
    socket.on("rc:pong", (d: { t: number }) => {
      if (d.t === pingT) {
        const rtt = Date.now() - d.t
        m().setLatency(rtt)
        usePerf.getState().recordPing(rtt)
      }
    })
    const pv = setInterval(() => {
      pingT = Date.now()
      rcPing(pingT)
    }, 4000)

    return () => {
      socket.off()
      clearInterval(pv)
    }
  }, [controllerName])
}
