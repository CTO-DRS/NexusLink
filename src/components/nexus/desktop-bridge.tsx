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
// 8) FA-media (عقد §15) — «طبقة الوسائط الأصلية»:
//    · سوكِت 3005 دائم (media:role pc) يرحّل إشارات WebRTC بين الجسر ومحرك
//      Rust: screen:req من الهاتف → media_screen_start → rtc:offer kind=screen
//      → إجابة الهاتف/مرشحاته → media_screen_answer / media_screen_ice.
//    · الويب كام: rtc:offer kind=cam/mic من الهاتف (بعد cam:cmd) → media_answer
//      → إجابتنا → الأجهزة الافتراضية تُغذّى أصليًا (v4l2loopback/AkVCam/...).
//    · rc:pointer من الهاتف (مؤشر مطلق على الشاشة المعروضة) — خلال جلسة.
//    · دفع حالة الوسائط إلى المخزن المشترك (status.desktop.media للشريط).
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
  "rc:presenter", "rc:media", "rc:pointer", // rc:pointer — عقد §15 (FA-media)
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

    // ------------------------------------------------------------------
    // الجولة 4 مرحلة ② (عقد §20) — لوحة الرسم: أوامر الهاتف (جلسة موثوقة
    // حصرًا — الجسر ينقّي) → أوامر Tauri ثم بث rc:tablet:state (مصدر الحقيقة)
    // ------------------------------------------------------------------
    rcSock.on("rc:tablet:cmd", (d: Record<string, unknown>) => {
      if (String(d?.__src ?? "") !== "controller") return
      const cmd = String(d?.cmd ?? "")
      if (cmd === "get") {
        void tauriInvoke<Record<string, unknown>>("tablet_config")
          .then((st) => rcSock.emit("rc:tablet:state", st))
          .catch((e) => console.warn("[desktop-bridge] tablet_config:", e))
        return
      }
      if (cmd === "set") {
        const args: Record<string, unknown> = {}
        for (const k of ["mode", "pressure", "decKey", "incKey", "levels", "modifier"]) {
          if (d[k] !== undefined) args[k] = d[k]
        }
        void tauriInvoke<Record<string, unknown>>("tablet_config_set", args)
          .then((st) => rcSock.emit("rc:tablet:state", st))
          .catch((e) => console.warn("[desktop-bridge] tablet_config_set:", e))
      }
    })

    // ------------------------------------------------------------------
    // الجولة 4 مرحلة ③ (عقد §21) — التحكم المتقدم: أوامر الهاتف (جلسة
    // موثوقة حصرًا — الجسر ينقّي) → أوامر Tauri ثم بث rc:gyro:state
    // (مصدر الحقيقة — نمط tablet §20.ج حرفيًا)
    // ------------------------------------------------------------------
    rcSock.on("rc:gyro:cmd", (d: Record<string, unknown>) => {
      if (String(d?.__src ?? "") !== "controller") return
      const cmd = String(d?.cmd ?? "")
      if (cmd === "get") {
        void tauriInvoke<Record<string, unknown>>("gyro_config")
          .then((st) => rcSock.emit("rc:gyro:state", st))
          .catch((e) => console.warn("[desktop-bridge] gyro_config:", e))
        return
      }
      if (cmd === "set") {
        const args: Record<string, unknown> = {}
        for (const k of ["mode", "template", "deadzoneDeg", "sens", "shakeDegS", "tiltDeg", "laser", "calibrate", "keyA", "keyB", "keyX", "keyY", "keyL", "keyR"]) {
          if (d[k] !== undefined) args[k] = d[k]
        }
        void tauriInvoke<Record<string, unknown>>("gyro_config_set", args)
          .then((st) => rcSock.emit("rc:gyro:state", st))
          .catch((e) => console.warn("[desktop-bridge] gyro_config_set:", e))
      }
    })

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

    // ------------------------------------------------------------------
    // FA-media (عقد §15) — سوكِت 3005: رحّالة إشارات WebRTC بين الجسر
    // ومحرك Rust الأصلي (بث الشاشة kind=screen + الويب كام kind=cam/mic)
    // ------------------------------------------------------------------
    const mediaSock: Socket = io("/?XTransformPort=3005", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      timeout: 10000,
    })
    mediaSock.on("connect", () => {
      mediaSock.emit("media:role", { role: "pc", name: "NEXUS-PC" })
    })

    // حالة الوسائط المخزنة — يقرؤها الهاتف/الشريط (status.desktop.media)
    const putMedia = (patch: Record<string, unknown>) => {
      void fetch("/api/desktop/shortcuts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media: patch }),
      }).catch(() => null)
    }
    const onMediaState = (d: { screenOn?: boolean; vcamVideo?: boolean; vcamAudio?: boolean }) => {
      putMedia({
        screen: { on: d?.screenOn === true },
        vcam: { video: d?.vcamVideo === true, audio: d?.vcamAudio === true },
      })
    }
    type Unlisten2 = () => void
    let mediaUnlisteners: Unlisten2[] = []
    void (async () => {
      try {
        const ev = (window as unknown as {
          __TAURI__?: { event?: { listen?: <T>(n: string, f: (e: { payload: T }) => void) => Promise<() => void> } }
        }).__TAURI__?.event
        if (!ev?.listen) return
        // حالة من محرك Rust (بدء/إيقاف/فشل) — تُدفع للمخزن وللجسر
        const un = await ev.listen<{ screenOn?: boolean; vcamVideo?: boolean; vcamAudio?: boolean }>(
          "media://state",
          (e) => {
            onMediaState(e.payload)
            // حالة بث الشاشة للهاتف (screen:state بث عام)
            mediaSock.emit("screen:state", {
              action: "state",
              on: e.payload?.screenOn === true,
              name: "NEXUS-PC",
            })
          },
        )
        mediaUnlisteners = [un]
      } catch {
        /* خارج Tauri */
      }
    })()

    // ---- عرض الشاشة: الهاتف يطلب → نبدأ أصليًا → نعرض/نجيب ----
    // R4 ① (عقد §19) — حالة الشاشة الثانية المحلية: «نحن من فعّلها» فقط
    // يُطفئها انقطاع الهاتف (لا نمس شاشات الطرف الآخر أبدًا)
    let ssActive = false
    const emitSsState = (active: boolean, extra?: Record<string, unknown>) => {
      mediaSock.emit("secondscreen:state", { active, ...extra })
    }
    const ssStartStream = (targetId: string, fps?: number, quality?: string) => {
      void tauriInvoke<{ offer: { type: string; sdp: string }; w: number; h: number; fps: number; quality: string }>(
        "media_screen_start",
        { fps: fps ?? null, quality: quality ?? null, target: targetId },
      )
        .then((r) => {
          ssActive = true
          mediaSock.emit("rtc:offer", { kind: "screen", sdp: r.offer })
          mediaSock.emit("screen:state", { action: "state", on: true, w: r.w, h: r.h, fps: r.fps, quality: r.quality, name: "NEXUS-PC" })
          emitSsState(true, { target: targetId, w: r.w, h: r.h })
        })
        .catch((e) => {
          console.warn("[desktop-bridge] ss screen_start:", e)
          // السائق يعمل والشاشة قائمة حتى لو فشل البث — الحالة صادقة بالخطأ
          emitSsState(ssActive, { error: String(e).slice(0, 200) })
        })
    }
    const ssStopAll = () => {
      void tauriInvoke("media_screen_stop").catch(() => null)
      void tauriInvoke("vdisplay_disable")
        .then(() => emitSsState(false))
        .catch((e) => emitSsState(false, { error: String(e).slice(0, 200) }))
      ssActive = false
    }
    const onScreenReq = (d: { fps?: number; quality?: string; target?: string }) => {
      // R4 ①: اختيار «الشاشة الافتراضية» من قائمة الأهداف — تمكين تلقائي ثم بث
      if (d?.target === "screen:virtual") {
        void tauriInvoke<{ ok: boolean; targetId: string }>("vdisplay_enable", { w: null, h: null })
          .then((r) => ssStartStream(r.targetId, d?.fps, d?.quality))
          .catch((e) => {
            mediaSock.emit("screen:state", { action: "state", on: false, error: String(e).slice(0, 160) })
            emitSsState(false, { error: String(e).slice(0, 200) })
          })
        return
      }
      void tauriInvoke<{ offer: { type: string; sdp: string }; w: number; h: number; fps: number; quality: string }>(
        "media_screen_start",
        { fps: d?.fps ?? null, quality: d?.quality ?? null, target: d?.target ?? null },
      )
        .then((r) => {
          mediaSock.emit("rtc:offer", { kind: "screen", sdp: r.offer })
          mediaSock.emit("screen:state", { action: "state", on: true, w: r.w, h: r.h, fps: r.fps, quality: r.quality, name: "NEXUS-PC" })
        })
        .catch((e) => {
          console.warn("[desktop-bridge] screen_start:", e)
          mediaSock.emit("screen:state", { action: "state", on: false, error: String(e).slice(0, 160) })
        })
    }
    mediaSock.on("screen:req", onScreenReq)
    mediaSock.on("screen:stop", () => {
      void tauriInvoke("media_screen_stop").catch(() => null)
    })
    mediaSock.on("screen:set", (d: { fps?: number; quality?: string }) => {
      void tauriInvoke("media_screen_set", { fps: d?.fps ?? null, quality: d?.quality ?? null }).catch(() => null)
    })

    // ---- R4 ① (عقد §19): أوامر الشاشة الثانية من الهاتف ----
    const onSsCmd = (d: { action?: string; w?: number; h?: number; fps?: number; quality?: string; from?: string }) => {
      if (d?.from === "pc") return // صدى — نستجيب لأوامر الهاتف حصرًا
      if (d?.action === "enable") {
        void tauriInvoke<{ ok: boolean; targetId: string; w: number; h: number }>(
          "vdisplay_enable",
          { w: d?.w ?? null, h: d?.h ?? null },
        )
          .then((r) => ssStartStream(r.targetId, d?.fps, d?.quality))
          .catch((e) => emitSsState(false, { error: String(e).slice(0, 200) }))
      } else if (d?.action === "disable") {
        ssStopAll()
      }
    }
    mediaSock.on("secondscreen:cmd", onSsCmd)

    // ---- R4 ① (البند 8): انقطاع الهاتف → إطفاء الشاشة الافتراضية ----
    // (إزالة العرض تعيد النوافذ للشاشات الباقية سلوك النظام تلقائيًا)
    const onPhoneOffline = () => {
      if (!ssActive) return
      ssStopAll()
    }
    mediaSock.on("media:phone-offline", onPhoneOffline)

    // ---- إجابات/مرشحات الشاشة من الهاتف ----
    const onRtc = (d: Record<string, unknown>, ev: string) => {
      const kind = String(d?.kind ?? "")
      if (kind === "screen") {
        if (ev === "rtc:answer") {
          void tauriInvoke("media_screen_answer", { sdp: d?.sdp }).catch((e) => console.warn("[desktop-bridge] screen answer:", e))
        } else if (ev === "rtc:ice" && d?.candidate) {
          void tauriInvoke("media_screen_ice", { candidate: d?.candidate }).catch(() => null)
        }
        return
      }
      // الويب كام: عرض الهاتف لـ cam/mic — نجيب فقط إن كنا طالبين
      if ((kind === "cam" || kind === "mic") && ev === "rtc:offer") {
        void tauriInvoke<{ answer: { type: string; sdp: string } }>("media_answer", { kind, sdp: d?.sdp })
          .then((r) => {
            mediaSock.emit("rtc:answer", { kind, sdp: r.answer })
          })
          .catch((e) => console.warn(`[desktop-bridge] answer ${kind}:`, e))
      } else if ((kind === "cam" || kind === "mic") && ev === "rtc:ice" && d?.candidate) {
        void tauriInvoke("media_ice", { kind, candidate: d?.candidate }).catch(() => null)
      }
    }
    const offRtcAnswer = (d: Record<string, unknown>) => onRtc(d, "rtc:answer")
    const offRtcIce = (d: Record<string, unknown>) => onRtc(d, "rtc:ice")
    const offRtcOffer = (d: Record<string, unknown>) => onRtc(d, "rtc:offer")
    mediaSock.on("rtc:answer", offRtcAnswer)
    mediaSock.on("rtc:ice", offRtcIce)
    mediaSock.on("rtc:offer", offRtcOffer)

    // حالة كاميرا الهاتف — توقف الهاتف ينهي جلساتنا الأصلية
    const onCamState = (d: { active?: boolean; deviceId?: string }) => {
      if (d?.active === false) {
        void tauriInvoke("media_kind_stop", { kind: "cam" }).catch(() => null)
      }
    }
    mediaSock.on("cam:state", onCamState)

    // بدء الويب كام من محرك Rust (بطاقة الإعدادات) → طلب بث من الهاتف
    let unVcam: Unlisten2 | null = null
    void (async () => {
      try {
        const ev = (window as unknown as {
          __TAURI__?: { event?: { listen?: <T>(n: string, f: (e: { payload: T }) => void) => Promise<() => void> } }
        }).__TAURI__?.event
        if (!ev?.listen) return
        unVcam = await ev.listen<{ video: boolean; audio: boolean }>("media://vcam-start", (e) => {
          // تنقية محرك Rust نجحت → نطلب من الهاتف بدء البث (عقد §4.3)
          if (e.payload?.video) mediaSock.emit("cam:cmd", { action: "cam-start" })
          if (e.payload?.audio) mediaSock.emit("cam:cmd", { action: "mic-start" })
        })
        mediaUnlisteners.push(unVcam)
      } catch {
        /* خارج Tauri */
      }
    })()

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
      mediaSock.off("screen:req", onScreenReq)
      mediaSock.off("secondscreen:cmd", onSsCmd)
      mediaSock.off("media:phone-offline", onPhoneOffline)
      mediaSock.off("rtc:answer", offRtcAnswer)
      mediaSock.off("rtc:ice", offRtcIce)
      mediaSock.off("rtc:offer", offRtcOffer)
      mediaSock.off("cam:state", onCamState)
      mediaSock.disconnect()
      for (const un of mediaUnlisteners) un()
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
