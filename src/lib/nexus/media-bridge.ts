// NexusLink — جسر الوسائط والكاميرا (يعمل داخل عملية Next.js)
// ============================================================
// نفس نمط remote-bridge: socket.io على منفذ مستقل، مدمج في خادم Next
// حتى لا تُقتل العملية تحت إشراف المنصة.
// منفذ 3005 · قنوات: إشارات WebRTC، حالة الكاميرا، مصراع عن بُعد،
// تنبيهات الحركة والبكاء، أوامر البث وعرض الشرائح.
import { createServer } from "http"
import { Server as SocketServer } from "socket.io"

const PORT = 3005

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

// ---------------------------------------------------------------------------
// FA-8 — طبقة الكاميرا والصوت (وكيل الجهاز الحقيقي)
//  · cam:cmd: طلب من الكمبيوتر للهاتف (بدء/إيقاف بث، تبديل، فلاش، مراقبة)
//  · sensor:stream: بث الجيروسكوب/التسارع من الهاتف (للويب كجيمباد لاحقًا)
//  · cam:shutter: تمرير حقلي flash/camera الإضافيين (مؤقت + فلاش + الكاميرا)
// ---------------------------------------------------------------------------

/** أوامر الوسائط المسموح توجيهها للهاتف (قائمة بيضاء). */
const CAM_CMDS = new Set([
  "cam-start", "cam-stop", "switch", "torch", "mic-start", "mic-stop",
  "baby-start", "baby-stop", "watch-start", "watch-stop",
])

// ---------------------------------------------------------------------------
// FA-media (عقد §15) — عرض شاشة الكمبيوتر على الهاتف عبر WebRTC.
// الاتجاه معكوس عن الكاميرا: الكمبيوتر (صاحب الشاشة) ينشئ rtc:offer kind=screen
// استجابةً لطلب الهاتف، والهاتف يجيب. أحداث screen:* تُنقّى وتُبث للجميع.
// ---------------------------------------------------------------------------

/** مستويات الجودة المسموحة للبث (الافتراضي high = 30fps). */
const SCREEN_QUALITIES = new Set(["low", "medium", "high", "ultra"])
/** معدلات الإطارات المسموحة (المطلوب التعاقدي: 30–60). */
const SCREEN_FPS = new Set([15, 24, 30, 45, 60])

/** تنقية حدث عرض الشاشة الوارد — يعيد الحمولة الآمنة أو null للرفض. */
function sanitizeScreenEvent(data: Record<string, unknown> | undefined) {
  if (!data || typeof data !== "object") return null
  const out: Record<string, unknown> = { at: Date.now() }
  const action = data.action === undefined ? undefined : String(data.action)
  if (action !== undefined) {
    if (!"start|stop|set|state".split("|").includes(action)) return null
    out.action = action
  }
  if (data.fps !== undefined) {
    const fps = Math.round(Number(data.fps))
    if (!SCREEN_FPS.has(fps)) return null
    out.fps = fps
  }
  if (data.quality !== undefined) {
    if (typeof data.quality !== "string" || !SCREEN_QUALITIES.has(data.quality)) return null
    out.quality = data.quality
  }
  // R4 مرحلة ① (عقد §19) — اختيار هدف البث يمر الآن فعليًا (كان يُسقط في
  // التنقية فلا يصل سطح المكتب): screen:N | screen:all | screen:virtual | default
  if (data.target !== undefined) {
    const t = String(data.target)
    if (!/^(screen:\d{1,3}|screen:all|screen:virtual|default)$/.test(t)) return null
    out.target = t
  }
  // حقول الحالة الصادرة من الكمبيوتر (screen:state) تمر كما هي بعد التحقق النوعي
  if (data.on !== undefined) out.on = data.on === true
  if (data.w !== undefined) {
    const w = Math.round(Number(data.w))
    if (Number.isFinite(w) && w > 0 && w <= 8192) out.w = w
  }
  if (data.h !== undefined) {
    const h = Math.round(Number(data.h))
    if (Number.isFinite(h) && h > 0 && h <= 8192) out.h = h
  }
  if (typeof data.name === "string" && data.name.length <= 80) out.name = data.name
  if (typeof data.error === "string" && data.error.length <= 200) out.error = data.error
  return out
}

// ---------------------------------------------------------------------------
// R4 مرحلة ① (عقد §19) — الشاشة الثانية: الهاتف شاشة ممتدة فعلية.
// secondscreen:cmd  هاتف→جسر→كمبيوتر: enable/disable (w,h اختيارية للدقة/
//                   الاتجاه — تُطبق في vdisplay_enable على السائق/xrandr).
// secondscreen:state كمبيوتر→الجميع: active/target/w/h/error — حالة صادقة.
// media:phone-offline عند انقطاع الهاتف — الكمبيوتر يطفئ الشاشة الافتراضية
//                   ويعيد النوافذ تلقائيًا (سلوك النظام عند إزالة عرض) — البند 8.
// ---------------------------------------------------------------------------

/** تنقية أمر الشاشة الثانية — الحمولة الآمنة أو null للرفض. */
function sanitizeSecondScreenCmd(data: Record<string, unknown> | undefined) {
  if (!data || typeof data !== "object") return null
  const action = String(data.action ?? "")
  if (action !== "enable" && action !== "disable") return null
  const out: Record<string, unknown> = { action, at: Date.now() }
  if (data.w !== undefined) {
    const w = Math.round(Number(data.w))
    if (!Number.isFinite(w) || w < 320 || w > 8192) return null
    out.w = w
  }
  if (data.h !== undefined) {
    const h = Math.round(Number(data.h))
    if (!Number.isFinite(h) || h < 320 || h > 8192) return null
    out.h = h
  }
  if (data.fps !== undefined) {
    const fps = Math.round(Number(data.fps))
    if (!SCREEN_FPS.has(fps)) return null
    out.fps = fps
  }
  if (data.quality !== undefined) {
    if (typeof data.quality !== "string" || !SCREEN_QUALITIES.has(data.quality)) return null
    out.quality = data.quality
  }
  return out
}

/** تنقية حالة الشاشة الثانية الصادرة من الكمبيوتر. */
function sanitizeSecondScreenState(data: Record<string, unknown> | undefined) {
  if (!data || typeof data !== "object") return null
  const out: Record<string, unknown> = { at: Date.now() }
  out.active = data.active === true
  if (typeof data.target === "string" && /^(screen:\d{1,3}|screen:all)$/.test(data.target)) {
    out.target = data.target
  }
  if (data.w !== undefined) {
    const w = Math.round(Number(data.w))
    if (Number.isFinite(w) && w > 0 && w <= 8192) out.w = w
  }
  if (data.h !== undefined) {
    const h = Math.round(Number(data.h))
    if (Number.isFinite(h) && h > 0 && h <= 8192) out.h = h
  }
  if (typeof data.error === "string" && data.error.length <= 200) out.error = data.error
  return out
}

/** محدد معدل بث المستشعرات — 40 رسالة/ثانية لكل مقبس (20Hz × هامش أمان). */
const sensorBudget = new Map<string, { n: number; win: number }>()
function sensorAllowed(key: string): boolean {
  const now = Date.now()
  const b = sensorBudget.get(key)
  if (!b || now - b.win >= 1000) {
    sensorBudget.set(key, { n: 1, win: now })
    if (sensorBudget.size > 64) {
      for (const [k, v] of sensorBudget) if (now - v.win >= 5000) sensorBudget.delete(k)
    }
    return true
  }
  b.n++
  return b.n <= 40
}

/** تنقية قيم المستشعر إلى مصفوفة [x,y,z] أرقام محدودة. */
function sensorVec(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 3) return null
  const out = v.map((x) => Number(x))
  if (out.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e4)) return null
  return out.map((n) => Math.round(n * 1000) / 1000)
}

// guard ضد الإقلاع المزدوج عند hot-reload
const g = globalThis as unknown as { __nexusMediaBooted?: boolean }
const BOOT_KEY = "__nexusMediaBooted"

let io: SocketServer | null = null

export function mediaBridgeStatus() {
  return { booted: !!g[BOOT_KEY], port: PORT }
}

/** إشعار مركزي يُبث لكل العملاء (تُستخدم من مسارات REST مثل حفظ اللقطات) */
export function mediaBroadcast(event: string, data: unknown) {
  try {
    io?.emit(event, data)
  } catch { /* ignore */ }
}

export function ensureMediaBridge() {
  if (g[BOOT_KEY]) return mediaBridgeStatus()
  g[BOOT_KEY] = true

  try {
    const httpServer = createServer()
    const io2 = new SocketServer(httpServer, {
      path: "/",
      cors: { origin: "*", methods: ["GET", "POST"] },
      pingTimeout: 60000,
      pingInterval: 25000,
    })
    io = io2

    io2.on("connection", (socket) => {
      socket.emit("media:hello", { at: Date.now(), port: PORT })

      // تسجيل الدور: pc | phone | tv
      socket.on("media:role", (data: { role: string; name?: string }) => {
        const role = String(data?.role ?? "pc")
        socket.data.role = role
        if (role === "phone") {
          socket.data.name = String(data?.name ?? "هاتف")
          io2.emit("media:log", {
            id: uid(),
            text: `هاتف وسائط متصل: ${data?.name || "هاتف"} — الكاميرا والميكروفون جاهزان للبث`,
            kind: "ok",
            at: Date.now(),
          })
          io2.emit("media:phone-online", { name: data?.name || "هاتف", at: Date.now() })
        }
        socket.emit("media:role-ack", { role, at: Date.now() })
      })

      // ==== إشارات WebRTC (كاميرا/ميكروفون هاتف حقيقي → كمبيوتر) ====
      // إعادة توجيه شفافة بين أدوار phone و pc دون فهم محتوى العرض
      for (const ev of ["rtc:offer", "rtc:answer", "rtc:ice"]) {
        socket.on(ev, (data: Record<string, unknown>) => {
          const kind = String(data?.kind ?? "cam") // cam | mic | baby
          socket.broadcast.emit(ev, { ...data, kind, from: socket.data.role ?? "unknown" })
        })
      }

      // ==== حالة الكاميرا (المصدر يعلن عن تشغيل/تبديل) ====
      socket.on("cam:state", (data: Record<string, unknown>) => {
        io2.emit("cam:state", { ...data, at: Date.now() })
      })

      // ==== مصراع عن بُعد: الكمبيوتر يطلب التقاط صورة ====
      // FA-8: يُمرَّر flash (فلاش/كشاف أثناء العد) و camera (أمامية/خلفية) للهاتف الحقيقي
      socket.on("cam:shutter", (data: { timer: number; flash?: boolean; camera?: string }) => {
        const t = Math.max(0, Math.min(30, Number(data?.timer ?? 0)))
        const flash = data?.flash === true
        const camera = data?.camera === "front" ? "front" : "back"
        io2.emit("cam:shutter", { timer: t, flash, camera, at: Date.now() })
        io2.emit("media:log", {
          id: uid(),
          text: t > 0
            ? `مصراع عن بُعد: التقط بعد ${t} ثانية${flash ? " (بفلاش)" : ""} — كاميرا ${camera === "front" ? "أمامية" : "خلفية"}`
            : `مصراع عن بُعد: التقط الآن${flash ? " (بفلاش)" : ""} — كاميرا ${camera === "front" ? "أمامية" : "خلفية"}`,
          kind: "in",
          at: Date.now(),
        })
      })

      // ==== FA-8: أوامر وسائط للهاتف الحقيقي — تمرير شفاف مع قائمة بيضاء ====
      socket.on("cam:cmd", (data: Record<string, unknown>) => {
        const action = String(data?.action ?? "")
        if (!CAM_CMDS.has(action)) return
        const out: Record<string, unknown> = { action, at: Date.now() }
        // حقول اختيارية محدودة تمر كما هي (front/back، تشغيل الفلاش، حساسية الحركة)
        if (typeof data?.camera === "string" && ["front", "back"].includes(data.camera)) out.camera = data.camera
        if (typeof data?.on === "boolean") out.on = data.on
        if (typeof data?.sensitivity === "number") out.sensitivity = Math.min(1, Math.max(0.01, data.sensitivity))
        io2.emit("cam:cmd", out)
        io2.emit("media:log", {
          id: uid(),
          text: `أمر وسائط للهاتف: ${action}${out.camera ? ` (${out.camera})` : ""}${out.on === false ? " — إيقاف" : ""}`,
          kind: "in",
          at: Date.now(),
        })
      })

      // ==== FA-8: بث المستشعرات من الهاتف (جيروسكوب/تسارع) — للويب كجيمباد لاحقًا ====
      socket.on("sensor:stream", (data: Record<string, unknown>) => {
        if (socket.data.role !== "phone") return
        if (!sensorAllowed(socket.id)) return
        const a = sensorVec(data?.a)
        const gy = sensorVec(data?.g)
        if (!a && !gy) return
        const out: Record<string, unknown> = { from: socket.data.name ?? "phone", ts: Number(data?.ts) || Date.now() }
        if (a) out.a = a
        if (gy) out.g = gy
        socket.broadcast.emit("sensor:stream", out)
      })

      socket.on("cam:captured", (data: { name?: string; device?: string }) => {
        io2.emit("cam:captured", { ...data, at: Date.now() })
        io2.emit("media:log", {
          id: uid(),
          text: `التُقطت صورة على ${data?.device ?? "الهاتف"}: ${data?.name ?? "IMG"}`,
          kind: "ok",
          at: Date.now(),
        })
      })

      // ==== تنبيهات المراقبة ====
      socket.on("sec:motion", (data: { source?: string; level?: number }) => {
        io2.emit("sec:motion", { ...data, at: Date.now() })
      })

      socket.on("baby:alert", (data: { from?: string; level?: number }) => {
        io2.emit("baby:alert", { ...data, at: Date.now() })
        io2.emit("media:log", {
          id: uid(),
          text: `تنبيه مراقبة الأطفال: صوت مرتفع (${Math.round(Number(data?.level ?? 0))}%) من ${data?.from ?? "غرفة الطفل"}`,
          kind: "warn",
          at: Date.now(),
        })
      })

      // ==== FA-media: عرض شاشة الكمبيوتر (عقد §15) — تنقية + بث شفاف ====
      // screen:req/stop/set من الهاتف؛ screen:state من الكمبيوتر (الطبقة الأصلية
      // عبر الويبفيو). rtc:offer kind=screen يمر عبر مسار rtc:* الشفاف أعلاه.
      for (const ev of ["screen:req", "screen:stop", "screen:set", "screen:state"]) {
        socket.on(ev, (data: Record<string, unknown>) => {
          const out = sanitizeScreenEvent(data)
          if (!out) return
          io2.emit(ev, { ...out, from: socket.data.role ?? "unknown" })
        })
      }

      // ==== R4 ①: الشاشة الثانية (عقد §19) — أوامر الهاتف وحالة الكمبيوتر ====
      socket.on("secondscreen:cmd", (data: Record<string, unknown>) => {
        const out = sanitizeSecondScreenCmd(data)
        if (!out) return
        io2.emit("secondscreen:cmd", { ...out, from: socket.data.role ?? "unknown" })
      })
      socket.on("secondscreen:state", (data: Record<string, unknown>) => {
        // الحالة من الكمبيوتر (دور pc) حصرًا — الهاتف لا يصدر حالة
        if (socket.data.role !== "pc") return
        const out = sanitizeSecondScreenState(data)
        if (!out) return
        io2.emit("secondscreen:state", out)
      })

      // ==== R4 ① (البند 8): انقطاع الهاتف — الكمبيوتر يطفئ الشاشة الافتراضية ====
      socket.on("disconnect", () => {
        if (socket.data.role !== "phone") return
        io2.emit("media:phone-offline", { at: Date.now() })
      })

      // ==== بث الوسائط: أوامر من مرسل (هاتف) إلى مستقبل (TV/كمبيوتر) ====
      socket.on("cast:cmd", (data: Record<string, unknown>) => {
        io2.emit("cast:cmd", { ...data, at: Date.now() })
      })
      socket.on("cast:state", (data: Record<string, unknown>) => {
        socket.broadcast.emit("cast:state", { ...data, at: Date.now() })
      })

      // ==== عرض الشرائح ====
      socket.on("slideshow:cmd", (data: Record<string, unknown>) => {
        io2.emit("slideshow:cmd", { ...data, at: Date.now() })
      })

      // ==== زمن الاستجابة ====
      socket.on("media:ping", (data: { t: number }) => {
        socket.emit("media:pong", { t: data?.t ?? Date.now() })
      })
    })

    httpServer.on("error", () => {
      // المنفذ مشغول (خدمة قائمة) — تجاهل
    })

    httpServer.listen(PORT, () => {
      console.log(`[nexus] Media & Camera Bridge on port ${PORT}`)
    })
  } catch {
    // تجاهل — قد يكون المنفذ مشغولاً
  }
  return mediaBridgeStatus()
}
