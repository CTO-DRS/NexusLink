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
// 6) FA-power (عقد §12) — سوكِتا 3004/3006 دائمان (يعملان والنافذة مخفية).
// 7) FA-input (عقد §13) — «شاشة Touchpad تتحكم بالكمبيوتر فعليًا»:
//    · أحداث rc:move/click/scroll/pinch/key/presenter/media من 3004 → input_exec
//      (enigo) — تجميع دفعات للحركة (30ms) لتفضيق زمن الاستجابة.
//    · بوابة المصدر: __src=desktop (واجهة الكمبيوتر نفسها) تنفَّذ دائمًا،
//      __src=controller (هاتف موثوق) خلال جلسة نشطة فقط، unknown يُرفض.
//    · دورة حياة جلسة التحكم (rc:session) → input_session + لافتة دائمة
//      + إنهاء فوري من اللافتة أو الشريط + تدفق إرشاد العربية على ماك.
// كل ذلك معطّل خارج وضع سطح المكتب (?desktop=1 — تضبطه procman عند فتح النافذة).
import { useEffect, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { getProdSocket } from "@/lib/prod-socket"
import { useProd } from "@/lib/prod-store"
import { useNexus, type ShortcutAction, type ViewId } from "@/lib/store"
import { tauriInvoke } from "@/lib/tauri"

const DESKTOP_DEFAULTS: Partial<Record<ShortcutAction, string>> = {
  sendClipboard: "Ctrl+Shift+N",
  toggleWindow: "Ctrl+Shift+D",
}

// أحداث الإدخال التي تُنفَّذ أصليًا (نفس قائمة RC_INPUT في الجسر — عقد §4.2)
const RC_INPUT_EVENTS = [
  "rc:move", "rc:click", "rc:scroll", "rc:pinch", "rc:key",
  "rc:presenter", "rc:media",
] as const

interface SessionBanner {
  name: string
}

export function DesktopBridge() {
  // لافتة جلسة التحكم الدائمة (بند 7 — إشعار مرئي دائم) + تدفق إذن ماك (بند 6)
  const [session, setSession] = useState<SessionBanner | null>(null)
  const [macGuidance, setMacGuidance] = useState(false)

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

    // 5) FA-clipboard-sync — استقبال حافظة الهاتف → حافظة النظام (عقد §11.ب)
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
    const rcSock: Socket = io("/?XTransformPort=3004", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      timeout: 10000,
    })
    const registerDesktop = () => {
      void tauriInvoke<string>("system_mac")
        .then((mac) => {
          if (mac) rcSock.emit("desktop:register", { name: "NEXUS-PC", mac })
        })
        .catch(() => null)
      rcSock.emit("desktop:state", { power: "on" })
    }
    rcSock.on("connect", registerDesktop)
    const onRcPower = (d: { action?: string }) => {
      const action = String(d?.action ?? "").trim()
      if (!action) return
      void tauriInvoke("power_request", { action, source: "phone" }).catch((e) => {
        console.warn("[desktop-bridge] power_request:", e)
      })
    }
    rcSock.on("rc:power", onRcPower)

    // ------------------------------------------------------------------
    // FA-input (عقد §13) — تنفيذ أحداث اللمس/الكيبورد/الوسائط عبر enigo
    // ------------------------------------------------------------------
    let sessionActive = false
    let sessionName = ""
    const pendingMoves: Record<string, unknown>[] = []
    let pendingSource = "desktop-local"
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    let volumeLastSent = 0

    const flushMoves = () => {
      flushTimer = null
      if (!pendingMoves.length) return
      const events = pendingMoves.splice(0, pendingMoves.length)
      void tauriInvoke("input_exec", { events, source: pendingSource }).catch(() => null)
    }

    const onRcInput = (d: Record<string, unknown> | undefined, ev: string) => {
      // بوابة المصدر (بند 7): desktop = واجهة الكمبيوتر نفسها (صاحب الجهاز —
      // دائمًا)؛ controller = هاتف موثوق خلال جلسة نشطة فقط؛ unknown مرفوض.
      const src = String(d?.__src ?? "unknown")
      if (src !== "desktop" && src !== "controller") return
      if (src === "controller" && !sessionActive) return
      const source = src === "desktop" ? "desktop-local" : "controller"
      const data = { ...d }
      delete data.__src
      const payload: Record<string, unknown> = { ...data, kind: ev.replace("rc:", "") }
      if (ev === "rc:move") {
        // تجميع الحركة في دفعات 30ms — سلاسة بلا فيض استدعاءات IPC
        if (pendingSource !== source) flushMoves()
        pendingSource = source
        pendingMoves.push(payload)
        if (!flushTimer) flushTimer = setTimeout(flushMoves, 30)
        return
      }
      if (ev === "rc:media" && payload.action === "volume") {
        // مستوى الصوت يصل متصلًا من الشريط — نخففه إلى 150ms (آخر قيمة)
        const now = Date.now()
        if (now - volumeLastSent < 150) return
        volumeLastSent = now
      }
      flushMoves() // حفظ ترتيب الأحداث: ما قبل الحركة يُنفَّذ أولًا
      void tauriInvoke("input_exec", { events: [payload], source }).catch(() => null)
    }
    for (const ev of RC_INPUT_EVENTS) {
      rcSock.on(ev, (d: Record<string, unknown>) => onRcInput(d, ev))
    }

    // دورة حياة جلسة التحكم (عقد §13): start/hb من الهاتف — stop من أي طرف
    const endSessionLocal = (reason?: string) => {
      sessionActive = false
      setSession(null)
      if (reason === "desktop-stop") return // بدأنا نحن الإنهاء — لا صدى
      rcSock.emit("rc:session", { action: "stop" })
    }
    const onRcSession = (d: { active?: boolean; controller?: { name?: string }; reason?: string }) => {
      if (d?.active) {
        sessionActive = true
        sessionName = String(d?.controller?.name ?? "جهاز تحكم")
        setSession({ name: sessionName })
        // بند 6 — تدفق إذن Accessibility على ماك: فحص فوري + فتح الإعدادات مع الإرشاد
        void tauriInvoke<{ granted: boolean; platform: string }>("input_permission")
          .then((p) => {
            if (!p.granted) {
              void tauriInvoke("input_open_permissions").catch(() => null)
              setMacGuidance(true)
            }
          })
          .catch(() => null)
      } else {
        endSessionLocal(d?.reason)
      }
    }
    rcSock.on("rc:session", onRcSession)

    // أحداث الطبقة الأصلية: إنهاء من الشريط/watchdog + أخطاء الحقن (إرشاد ماك)
    type Unlisten = () => void
    let unlisteners: Unlisten[] = []
    void (async () => {
      try {
        const ev = (window as unknown as {
          __TAURI__?: { event?: { listen?: <T>(n: string, f: (e: { payload: T }) => void) => Promise<() => void> } }
        }).__TAURI__?.event
        if (!ev?.listen) return
        // إنهاء من الشريط (قطع فوري) أو watchdog محلي → بلاغ الجسر للهاتف
        const un1 = await ev.listen<{ active: boolean; reason?: string }>("desktop://input-session", (e) => {
          if (!e.payload?.active) endSessionLocal("desktop-stop")
        })
        // أخطاء الحقن — على ماك تعني غالبًا صلاحية Accessibility غائبة
        const un2 = await ev.listen<{ error: string }>("desktop://input-error", (e) => {
          void tauriInvoke<{ granted: boolean; platform: string }>("input_permission")
            .then((p) => {
              if (!p.granted) setMacGuidance(true)
              else console.warn("[desktop-bridge] input error:", e.payload?.error)
            })
            .catch(() => console.warn("[desktop-bridge] input error:", e.payload?.error))
        })
        unlisteners = [un1, un2]
      } catch {
        /* خارج Tauri — لا شيء */
      }
    })()

    // تحديثات الطبقة الأصلية للطاقة → تقرير الحالة للهواتف (desktop:state على 3004)
    const onPowerEvent = (e: { power?: string }) => {
      const power = String(e?.power ?? "")
      if (power) rcSock.emit("desktop:state", { power })
    }
    let powerUn: Unlisten | null = null
    void (async () => {
      try {
        const ev = (window as unknown as {
          __TAURI__?: { event?: { listen?: <T>(n: string, f: (e: { payload: T }) => void) => Promise<() => void> } }
        }).__TAURI__?.event
        if (ev?.listen) {
          const un = await ev.listen<{ power?: string }>("desktop://power", (e) => onPowerEvent(e.payload))
          powerUn = un
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
      for (const ev of RC_INPUT_EVENTS) rcSock.off(ev)
      rcSock.off("rc:session", onRcSession)
      rcSock.disconnect()
      powerUn?.()
      for (const un of unlisteners) un()
      guardSock.off("pc:lock", onPcLock)
      guardSock.disconnect()
    }
  }, [])

  // القطع الفوري من اللافتة (بند 7) — الطبقة الأصلية توقف التنفيذ فورًا
  const cutSession = () => {
    void tauriInvoke("input_session", { active: false, name: session?.name ?? "" }).catch(() => null)
    setSession(null)
  }

  return (
    <>
      {session && (
        <div
          dir="rtl"
          style={{
            position: "fixed", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
            display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
            borderRadius: 12, border: "1px solid rgba(167,139,250,.55)",
            background: "rgba(46,16,101,.92)", color: "#fff",
            boxShadow: "0 8px 28px rgba(0,0,0,.45)", fontSize: 13, fontWeight: 600,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "#A78BFA", boxShadow: "0 0 8px #A78BFA" }} />
          جلسة تحكم نشطة من «{session.name}» — مؤشر ولوحة مفاتيح الكمبيوتر يعملان الآن
          <button
            onClick={cutSession}
            style={{
              border: 0, borderRadius: 8, padding: "5px 12px", cursor: "pointer",
              background: "#ef4444", color: "#fff", fontWeight: 700, fontSize: 12,
            }}
          >
            إنهاء فوري
          </button>
        </div>
      )}
      {macGuidance && (
        <div
          dir="rtl"
          style={{
            position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center",
            justifyContent: "center", background: "rgba(0,0,0,.62)", backdropFilter: "blur(3px)",
          }}
        >
          <div
            style={{
              width: 460, maxWidth: "92vw", padding: 22, borderRadius: 16, color: "#fff",
              background: "#101728", border: "1px solid rgba(96,165,250,.4)", lineHeight: 1.9,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
              صلاحية مطلوبة على macOS: Accessibility
            </div>
            <div style={{ fontSize: 13, opacity: 0.92 }}>
              لكي يعمل تحريك المؤشر ولوحة المفاتيح من هاتفك، يحتاج NexusLink إذن
              «Accessibility». افتح: إعدادات النظام ← الخصوصية والأمان ← Accessibility،
              ثم فعّل NexusLink وأعد المحاولة. (فتحنا الإعدادات لك — إن لم تُفتح اضغط الزر أدناه).
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                onClick={() => void tauriInvoke("input_open_permissions").catch(() => null)}
                style={{ border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer", background: "#2563eb", color: "#fff", fontWeight: 700 }}
              >
                فتح إعدادات النظام
              </button>
              <button
                onClick={() => setMacGuidance(false)}
                style={{ border: "1px solid rgba(255,255,255,.25)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", background: "transparent", color: "#fff" }}
              >
                حسنًا
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
