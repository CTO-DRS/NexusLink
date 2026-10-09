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
      socket.on("cam:shutter", (data: { timer: number }) => {
        const t = Math.max(0, Math.min(30, Number(data?.timer ?? 0)))
        io2.emit("cam:shutter", { timer: t, at: Date.now() })
        io2.emit("media:log", {
          id: uid(),
          text: t > 0 ? `مصراع عن بُعد: التقط بعد ${t} ثانية` : "مصراع عن بُعد: التقط الآن",
          kind: "in",
          at: Date.now(),
        })
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
