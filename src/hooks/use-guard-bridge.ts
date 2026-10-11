"use client"
// NexusLink — خطاف جهة الكمبيوتر لطبقة الحماية (المرحلة 8)
// منارة قرب محاكاة + استقبال حالة القرب + القفل/الفتح التلقائي + مقاييس حية
import { useEffect } from "react"
import { useGuard, type ProxInfo } from "@/lib/guard-store"
import { getGuardSocket, guardSettings, proxSim, devState } from "@/lib/guard-socket"
import { playNotifSound, playConnectSound } from "@/lib/nexus/sounds"
import { toast } from "sonner"

const LS_PIN = "nexus-guard-pin"
const LS_PROX = "nexus-guard-prox"
const LS_SIM = "nexus-guard-sim"

// نقطة تشخيص للاختبار من الكونسول: تغيير قوة منارة المحاكاة برمجياً
if (typeof window !== "undefined") {
  ;(window as unknown as { __nexusGuardDebug?: unknown }).__nexusGuardDebug = {
    setSimRssi: (v: number) => useGuard.getState().setSimRssi(v),
    simNear: () => useGuard.getState().setSimRssi(-48),
    simAway: () => useGuard.getState().setSimRssi(-94),
  }
}

export function useGuardBridge() {
  useEffect(() => {
    fetch("/api/guard/boot").catch(() => { /* ignore */ })
    const socket = getGuardSocket()
    const st = () => useGuard.getState()

    socket.on("connect", () => {
      st().setBridgeOnline(true)

      // استعادة الإعدادات المحفوظة (داخل callback لتفادي setState-in-effect)
      try {
        const pin = localStorage.getItem(LS_PIN)
        if (pin) st().setPin(pin)
        const simRaw = localStorage.getItem(LS_SIM)
        if (simRaw) st().setSimMode(simRaw === "1")
        const proxRaw = localStorage.getItem(LS_PROX)
        const p = proxRaw ? (JSON.parse(proxRaw) as Record<string, unknown>) : null
        if (p) {
          st().setProx({
            enabled: !!p.enabled,
            thresholdRssi: Number(p.thresholdRssi ?? -68),
            graceSec: Number(p.graceSec ?? 8),
            autoUnlock: p.autoUnlock !== false,
          })
        }
        // مزامنة الإعدادات مع الجسر
        const cur = useGuard.getState()
        guardSettings({
          enabled: cur.prox.enabled,
          thresholdRssi: cur.prox.thresholdRssi,
          graceSec: cur.prox.graceSec,
          autoUnlock: cur.prox.autoUnlock,
        })
      } catch { /* ignore */ }
    })
    socket.on("disconnect", () => st().setBridgeOnline(false))

    // ==== حالة القرب من المحرك المركزي ====
    socket.on("prox:state", (d: { state: string; rssi: number | null; source: "real" | "sim" | null; leftMs: number | null; settings?: { enabled: boolean; thresholdRssi: number; graceSec: number; autoUnlock: boolean } }) => {
      const patch: Partial<ProxInfo> = {
        rssi: d.rssi,
        state: d.state as never,
        leftMs: d.leftMs,
        source: d.source,
      }
      if (d.settings) {
        patch.enabled = d.settings.enabled
        patch.thresholdRssi = d.settings.thresholdRssi
        patch.graceSec = d.settings.graceSec
        patch.autoUnlock = d.settings.autoUnlock
      }
      st().setProx(patch)
    })

    // ==== القفل التلقائي للكمبيوتر — اختبار النجاح ====
    socket.on("pc:lock", (d: { reason: string; at: number }) => {
      const wasLocked = !!st().pcLocked
      st().setPcLocked({ reason: d.reason, at: d.at })
      if (!wasLocked) playConnectSound()
      if (d.reason === "no-beacon" || d.reason === "weak-signal") {
        st().pushLog("تم قفل الكمبيوتر تلقائياً — الهاتف خارج نطاق القرب", "warn")
        st().setCheck("lock")
      } else {
        st().pushLog("تم قفل الكمبيوتر يدوياً", "info")
      }
    })
    socket.on("pc:unlock", (d: { reason: string }) => {
      const wasProx = st().pcLocked?.reason === "no-beacon" || st().pcLocked?.reason === "weak-signal"
      st().setPcLocked(null)
      playNotifSound()
      if (wasProx && d.reason === "proximity") {
        st().pushLog("عاد الهاتف للنطاق — فُتح القفل تلقائياً", "ok")
        st().setCheck("unlock")
      }
    })

    // ==== سجل الأحداث من الجسر ====
    socket.on("dev:log", (e: { id: string; text: string; kind: "in" | "ok" | "info" | "warn"; at: number }) => {
      st().pushLog(e.text, e.kind)
    })

    // ==== حضور الهاتف في طبقة الحماية ====
    socket.on("guard:phone-online", (d: { online: boolean }) => st().setPhoneOnline(d.online))
    socket.on("guard:hello", (d: { phoneGuardOnline?: boolean; screen?: import("@/lib/guard-store").PhoneScreenInfo | null }) => {
      if (typeof d?.phoneGuardOnline === "boolean") st().setPhoneOnline(d.phoneGuardOnline)
      if (d?.screen && d.screen.w > 0) st().setPhoneScreen(d.screen)
    })

    // ==== FA-7: جلسة التحكم + أبعاد الشاشة + إقرارات التنفيذ ====
    socket.on("guard:screen", (d: import("@/lib/guard-store").PhoneScreenInfo) => {
      if (d?.w > 0 && d?.h > 0) st().setPhoneScreen(d)
    })
    socket.on("dev:ctl-state", (d: { active: boolean; controller?: string; name?: string; reason?: string; at?: number }) => {
      st().setCtl({
        active: !!d.active,
        controller: d.controller ?? "",
        name: d.name ?? "",
        reason: d.reason ?? "",
        at: d.at ?? Date.now(),
      })
      st().setCtlPending(false)
      if (d.active) {
        st().pushLog(`بدأ التحكم باللمس من ${d.name ?? d.controller ?? "الكمبيوتر"} — الهاتف يقبل الآن أوامر الإدخال`, "warn")
        st().setCheck("touch")
        toast.warning(`التحكم باللمس مفعّل من ${d.name ?? d.controller ?? "الكمبيوتر"}`, {
          description: "يمكن للهاتف القطع فوريًا من التطبيق في أي وقت",
        })
      } else {
        const why = (d.reason ?? "stopped") as string
        st().pushLog(
          why === "denied" ? "رُفض طلب التحكم على الهاتف" : why === "phone-stop" ? "قُطعت جلسة التحكم من الهاتف" : `انتهت جلسة التحكم (${why})`,
          why === "denied" ? "warn" : "ok",
        )
      }
    })
    socket.on("dev:ctl-rejected", (d: { reason: string; from?: string }) => {
      st().setCtlPending(false)
      const msg = d.reason === "untrusted"
        ? "رُفض الطلب: جهاز التحكم غير موثوق في سجل الأجهزة"
        : d.reason === "target-untrusted"
          ? "رُفض الطلب: جهاز الهاتف غير موثوق"
          : "لا هاتف وكيل متصل الآن لبدء التحكم"
      st().pushLog(msg, "warn")
      toast.error(msg)
    })
    socket.on("dev:touch-ack", (d: { op: string; ok: boolean; err?: string; seq?: number }) => {
      if (!d?.ok && d?.err === "accessibility-off") {
        st().pushLog("تعذّر التنفيذ: خدمة الإتاحة غير مفعّلة على الهاتف", "warn")
      }
    })

    // ==== تقارير الهاتف (مرآة الحالة) ====
    socket.on("dev:state", (d: {
      ringing?: boolean; strobe?: boolean
      lost?: { active: boolean; message?: string; callback?: string }
      wipe?: { stage: "idle" | "wiping" | "wiped"; progress?: number }
      qs?: Record<string, boolean | number>
      accessibility?: boolean
      ctl?: { active?: boolean; controller?: string; name?: string }
    }) => {
      if (typeof d?.accessibility === "boolean") st().setPhoneAccessibility(d.accessibility)
      if (d?.ctl && typeof d.ctl.active === "boolean") {
        // مزامنة الجلسة من تقرير الهاتف (مثلاً بعد إعادة تحميل الويب وسط جلسة)
        const cur = st().ctl
        if (cur.active !== d.ctl.active) {
          st().setCtl({
            active: !!d.ctl.active,
            controller: d.ctl.controller ?? cur.controller,
            name: d.ctl.name ?? cur.name,
            reason: "sync",
            at: Date.now(),
          })
        }
      }
      if (typeof d?.ringing === "boolean") st().setRinging(d.ringing)
      if (typeof d?.strobe === "boolean") st().setStrobe(d.strobe)
      if (d?.lost && d.lost.active !== st().lost.active) {
        st().setLost(d.lost.active, d.lost.message, d.lost.callback)
        if (d.lost.active) st().setCheck("lost")
      }
      if (d?.wipe) st().setWipe({ stage: d.wipe.stage, progress: d.wipe.progress ?? 0 })
      if (d?.qs) {
        for (const [k, v] of Object.entries(d.qs)) {
          st().setQsKey(k as keyof import("@/lib/guard-store").QSState, v)
        }
      }
    })

    // ==== طلب مزامنة من هاتف متصل جديد → دفع الحالة الكاملة ====
    socket.on("dev:sync-request", () => {
      const s = useGuard.getState()
      devState({
        alarms: s.alarms,
        qs: s.qs,
        ringing: s.ringing,
        lost: { active: s.lost.active, message: s.lost.message, callback: s.lost.callback },
        wipe: { stage: s.wipe.stage, progress: s.wipe.progress },
      })
    })

    // ==== حفظ الإعدادات عند تغييرها ====
    let lastSig = ""
    const unsub = useGuard.subscribe((s) => {
      const sig = `${s.pin}|${s.simMode}|${s.prox.enabled}|${s.prox.thresholdRssi}|${s.prox.graceSec}|${s.prox.autoUnlock}`
      if (sig === lastSig) return
      const first = lastSig === ""
      lastSig = sig
      try {
        localStorage.setItem(LS_PIN, s.pin)
        localStorage.setItem(LS_SIM, s.simMode ? "1" : "0")
        localStorage.setItem(LS_PROX, JSON.stringify({ enabled: s.prox.enabled, thresholdRssi: s.prox.thresholdRssi, graceSec: s.prox.graceSec, autoUnlock: s.prox.autoUnlock }))
      } catch { /* ignore */ }
      if (!first) {
        guardSettings({ enabled: s.prox.enabled, thresholdRssi: s.prox.thresholdRssi, graceSec: s.prox.graceSec, autoUnlock: s.prox.autoUnlock })
      }
    })

    // ==== مقاييس حية + منارة محاكاة ====
    const metricsIv = setInterval(() => st().tickMetrics(), 1000)
    const simIv = setInterval(() => {
      const s = useGuard.getState()
      if (s.simMode && s.bridgeOnline) proxSim(s.simRssi + Math.round(Math.random() * 4 - 2))
    }, 1500)

    return () => {
      unsub()
      socket.off()
      clearInterval(metricsIv)
      clearInterval(simIv)
    }
  }, [])
}
