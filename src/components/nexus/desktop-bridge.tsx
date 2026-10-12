"use client"
// NexusLink — جسر سطح المكتب (يعمل داخل نافذة Tauri فقط)
// ============================================================
// حارس واحد لكل ما يخص وضع سطح المكتب في الواجهة المشتركة:
// 1) كتم إشعارات المتصفح (Notification API) — الطبقة الأصلية في Rust تتولى
//    إشعارات النظام بأزرارها التفاعلية (متطلب تعاقدي: «بدل إشعارات المتصفح»).
// 2) مزامنة اختصارات سطح المكتب: نفس المخزن (zustand/localStorage) يُدفع إلى
//    /api/desktop/shortcuts عند كل تغيير — وRust يستطلعه ويُسجّله عالميًا.
// 3) تنفيذ داخل التطبيق لإجراء sendClipboard (عند تركيز النافذة، حيث الاختصار
//    العالمي غير مسجّل عمدًا — راجع تعاقد التركيز في shortcuts.rs).
// 4) تفسير معاملات ?view= القادمة من deep-link/الإشعارات الأصلية.
// 5) FA-clipboard-sync — استقبال حافظة الهاتف → clip_apply (arboard).
// 6) FA-power (عقد §12) — سوكِتا 3004/3006 دائمان (يعملان والنافذة مخفية):
//    · 3004: إعلان هوية الكمبيوتر (desktop:register {name, mac}) + تقرير
//      desktop:state عند الاتصال + استقبال rc:power → power_request (Rust) +
//      بث desktop:state عند كل حدث desktop://power من الطبقة الأصلية.
//    · 3006: استقبال pc:lock (منارة القرب/الابتعاد) → power_request {lock, auto-lock}
//      — بوابة autoLock يديرها Rust نفسه (من status.desktop.security).
// كل ذلك معطّل خارج وضع سطح المكتب (?desktop=1 — تضبطه procman عند فتح النافذة).
import { useEffect } from "react"
import { io, type Socket } from "socket.io-client"
import { getProdSocket } from "@/lib/prod-socket"
import { useProd } from "@/lib/prod-store"
import { useNexus, type ShortcutAction, type ViewId } from "@/lib/store"
import { tauriInvoke } from "@/lib/tauri"

const DESKTOP_DEFAULTS: Partial<Record<ShortcutAction, string>> = {
  sendClipboard: "Ctrl+Shift+N",
  toggleWindow: "Ctrl+Shift+D",
}

export function DesktopBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return
    const sp = new URLSearchParams(window.location.search)
    if (!sp.has("desktop")) return // متصفح/هاتف — لا شيء يخص سطح المكتب هنا

    // 0) علم وضع سطح المكتب — تقرأه بقية الطبقات (use-prod-bridge: Rust يملك الحافظة)
    ;(window as unknown as { __NEXUS_DESKTOP__?: boolean }).__NEXUS_DESKTOP__ = true

    // 1) كتم إشعارات المتصفح داخل الويبفيو (المصدر الأصلي يتولاه Rust)
    try {
      Object.defineProperty(window, "Notification", { value: undefined, configurable: true })
    } catch {
      /* بيئة لا تسمح — تُتجاهل بهدوء */
    }

    // 2) مزامنة خريطة الاختصارات إلى السيرفر (المخزن نفسه — صفر تكرار حقيقة)
    const putShortcuts = (map: Record<string, string>) => {
      const payload: Record<string, string> = { ...DESKTOP_DEFAULTS }
      for (const [k, v] of Object.entries(DESKTOP_DEFAULTS)) {
        if (map[k]) payload[k] = map[k]
      }
      void fetch("/api/desktop/shortcuts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortcuts: payload }),
      }).catch(() => null)
    }
    putShortcuts(useNexus.getState().shortcuts)
    const unsub = useNexus.subscribe((state, prev) => {
      if (state.shortcuts !== prev.shortcuts) putShortcuts(state.shortcuts)
    })

    // 3) داخل التركيز: تنفيذ sendClipboard محليًا (السلوك العالمي غير مسجّل حينها)
    const comboOf = (e: KeyboardEvent): string => {
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl")
      if (e.altKey) parts.push("Alt")
      if (e.shiftKey) parts.push("Shift")
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key
      if (k && k !== "Control" && k !== "Shift" && k !== "Alt" && k !== "Meta") parts.push(k)
      return parts.join("+")
    }
    const sendClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (!text?.trim()) return
        const r = await fetch("/api/prod/clipboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: "pc-office",
            deviceName: "هذا الكمبيوتر",
            kind: "text",
            content: text,
            mode: "auto",
          }),
        })
        if (!r.ok) throw new Error(String(r.status))
      } catch {
        /* الحافظة مرفوضة/فارغة — هدوء (المسار العالمي هو التعاقدي) */
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const sc = useNexus.getState().shortcuts
      const combo = comboOf(e)
      // الإجراء الجديد مُنمذج في المخزن المشترك — الافتراضي احتياط لو استخدم عميل قديم
      const target = sc.sendClipboard ?? DESKTOP_DEFAULTS.sendClipboard
      if (combo && combo === target) void sendClipboard()
    }
    window.addEventListener("keydown", onKey)

    // 4) ?view= — تنقل تعمّق الروابط/الإشعارات الأصلية إلى شاشة محددة
    const v = sp.get("view")
    if (v) {
      const views: ViewId[] = [
        "devices", "files", "transfers", "storage", "comms", "simulator",
        "remote", "media", "guard", "prod", "security", "tools", "settings",
      ]
      if (views.includes(v as ViewId)) useNexus.getState().setView(v as ViewId)
    }

    // 4) FA-clipboard-sync — استقبال حافظة الهاتف → حافظة النظام (عقد §11.ب):
    //    clip:new من جهاز غريب + وضع تلقائي → clip_apply (arboard) — يعمل والنافذة
    //    مخفية في الـ Tray. حرس الصدى: deviceId === pc-office يُتجاهل (إرسالنا نحن).
    //    إعادة الاشتراك عند تغيّر وضع الحافظة (التبديل في واجهة الإنتاجية).
    const applyIncoming = (item: { deviceId?: string; kind?: string; content?: string }) => {
      if (!item || item.deviceId === "pc-office") return
      const clipAllowed = useProd.getState().state.clipMode === "auto"
      if (!clipAllowed) return
      if (item.kind === "text" && item.content) {
        void tauriInvoke("clip_apply", { kind: "text", content: item.content }).catch(() => null)
      } else if (item.kind === "image" && item.content?.startsWith("data:image/png;base64,")) {
        void tauriInvoke("clip_apply", { kind: "image", content: item.content }).catch(() => null)
      }
    }
    const sock = getProdSocket()
    sock.on("clip:new", applyIncoming)

    // ------------------------------------------------------------------
    // FA-power (عقد §12) — الطبقة الأصلية تنفّذ أوامر النظام/الطاقة الحقيقية
    // ------------------------------------------------------------------
    // سوكِت 3004: نحن الطرف "desktop" — إعلان الهوية + الحالة + تنفيذ rc:power
    const rcSock: Socket = io("/?XTransformPort=3004", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      timeout: 10000,
    })
    const registerDesktop = () => {
      // إعلان MAC الحقيقي للأجهزة الموثوقة (Wake-on-LAN) + تقرير الحالة
      void tauriInvoke<string>("system_mac")
        .then((mac) => {
          if (mac) rcSock.emit("desktop:register", { name: "NEXUS-PC", mac })
        })
        .catch(() => null)
      rcSock.emit("desktop:state", { power: "on" })
    }
    rcSock.on("connect", registerDesktop)
    // أمر نظام من الهاتف → الطبقة الأصلية (فوري أو عدّاد 10ث قابل للإلغاء من الشريط)
    const onRcPower = (d: { action?: string }) => {
      const action = String(d?.action ?? "").trim()
      if (!action) return
      void tauriInvoke("power_request", { action, source: "phone" }).catch((e) => {
        console.warn("[desktop-bridge] power_request:", e)
      })
    }
    rcSock.on("rc:power", onRcPower)
    // تحديثات الطبقة الأصلية → تقرير الحالة للهواتف (desktop:state على 3004)
    const onPowerEvent = (e: { power?: string }) => {
      const power = String(e?.power ?? "")
      if (power) rcSock.emit("desktop:state", { power })
    }
    type PowerUnsub = { unlisten: () => void }
    let powerUn: PowerUnsub | null = null
    void (async () => {
      try {
        const ev = (window as unknown as {
          __TAURI__?: { event?: { listen?: <T>(n: string, f: (e: { payload: T }) => void) => Promise<() => void> } }
        }).__TAURI__?.event
        if (ev?.listen) {
          const un = await ev.listen<{ power?: string }>("desktop://power", (e) => onPowerEvent(e.payload))
          powerUn = { unlisten: un }
        }
      } catch {
        /* خارج Tauri — لا شيء */
      }
    })()

    // سوكِت 3006: القفل التلقائي عند ابتعاد الهاتف (منارة القرب → pc:lock)
    const guardSock: Socket = io("/?XTransformPort=3006", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      timeout: 10000,
    })
    const onPcLock = () => {
      void tauriInvoke("power_request", { action: "lock", source: "auto-lock" }).catch(() => null)
    }
    guardSock.on("pc:lock", onPcLock)

    return () => {
      unsub()
      window.removeEventListener("keydown", onKey)
      sock.off("clip:new", applyIncoming)
      rcSock.off("connect", registerDesktop)
      rcSock.off("rc:power", onRcPower)
      rcSock.disconnect()
      powerUn?.unlisten()
      guardSock.off("pc:lock", onPcLock)
      guardSock.disconnect()
    }
  }, [])

  return null
}
