// NexusLink — جسر التحكم عن بُعد (يعمل داخل عملية Next.js)
// ============================================================
// نفس منطق mini-services/remote-service لكن مدمجاً في خادم Next
// كي يعمل تحت إشراف المنصة مباشرة دون عملية منفصلة.
// منفذ 3004 · نقل أحداث الهاتف → الكمبيوتر عبر Nexus Protocol.
// FA-power (عقد §12): أوامر النظام الحقيقية (logout إضافي) + إرسال حزمة
// Wake-on-LAN السحرية فعليًا عبر UDP broadcast (كانت تُصاغ فقط سابقًا).
import { createServer } from "http"
import { createSocket } from "dgram"
import { Server as SocketServer } from "socket.io"

const PORT = 3004

const desktop = {
  name: "NEXUS-PC",
  mac: "A4:5E:60:C1:2D:9F",
  power: "on" as string,
}

const RC_INPUT = new Set([
  "rc:move", "rc:click", "rc:scroll", "rc:pinch", "rc:key",
  "rc:gamepad", "rc:presenter", "rc:media", "rc:clipboard",
])

const POWER_AR_ACTION: Record<string, string> = {
  shutdown: "إيقاف التشغيل",
  restart: "إعادة التشغيل",
  sleep: "السكون",
  hibernate: "الإسبات",
  lock: "قفل الشاشة",
  unlock: "فتح القفل",
  logout: "تسجيل الخروج", // FA-power (عقد §12)
}

/**
 * FA-power — إرسال حزمة Wake-on-LAN السحرية فعليًا عبر UDP broadcast.
 * 102 بايت = 6×FF + MAC×16. الوجهات: NEXUS_WOL_BROADCAST (فاصلة فاصلة،
 * افتراضي 255.255.255.255) والمنفذ NEXUS_WOL_PORT (افتراضي 9 التعاقدي)
 * — قابلة للاستبدال في الاختبار (حاويات بلا صلاحية الربط على <1024).
 */
function sendWolPacket(macNorm: string, cb: (ok: boolean, detail: string) => void) {
  const pkt = Buffer.from("FFFFFFFFFFFF" + macNorm.replace(/:/g, "").repeat(16), "hex")
  const targets = (process.env.NEXUS_WOL_BROADCAST || "255.255.255.255")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4)
  const port = Number(process.env.NEXUS_WOL_PORT || 9) || 9
  if (!targets.length) {
    cb(false, "لا وجهات broadcast")
    return
  }
  const sock = createSocket({ type: "udp4", reuseAddr: true })
  let done = false
  const finish = (ok: boolean, detail: string) => {
    if (done) return
    done = true
    try { sock.close() } catch { /* مغلق بالفعل */ }
    cb(ok, detail)
  }
  sock.on("error", (e) => finish(false, `socket: ${e.message}`))
  sock.bind(() => {
    try { sock.setBroadcast(true) } catch { /* محجوب — نكمل */ }
    let pending = targets.length
    let sent = 0
    for (const t of targets) {
      sock.send(pkt, port, t, (err) => {
        if (!err) sent++
        if (--pending === 0) {
          finish(sent > 0, `${sent}/${targets.length} وجهة → ${targets.join(",")}:${port} (${pkt.length} بايت)`)
        }
      })
    }
  })
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

type MinimalSock = { emit: (ev: string, d?: unknown) => void }

function gateInput(socket: MinimalSock, ev: string): boolean {
  if (desktop.power === "off" || desktop.power === "hibernating") {
    socket.emit("rc:rejected", { reason: desktop.power === "off" ? "off" : "hibernating", ev })
    return false
  }
  if (desktop.power === "sleeping") {
    desktop.power = "on"
    io?.emit("desktop:wake", { source: "input", ev })
    io?.emit("rc:log", { id: uid(), text: "استيقظ الكمبيوتر من السكون بسبب إدخال من الهاتف", kind: "ok", at: Date.now() })
  }
  return true
}

// guard ضد الإقلاع المزدوج عند hot-reload
const g = globalThis as unknown as { __nexusRemoteBooted?: boolean }
const BOOT_KEY = "__nexusRemoteBooted"

export function remoteBridgeStatus() {
  return { booted: !!g[BOOT_KEY], port: PORT, desktop: { ...desktop } }
}

export function ensureRemoteBridge() {
  if (g[BOOT_KEY]) return remoteBridgeStatus()
  g[BOOT_KEY] = true

  try {
    const httpServer = createServer()
    let bindAttempts = 0
    const io2 = new SocketServer(httpServer, {
      path: "/",
      cors: { origin: "*", methods: ["GET", "POST"] },
      pingTimeout: 60000,
      pingInterval: 25000,
    })
    io = io2

    io2.on("connection", (socket) => {
      socket.emit("rc:hello", {
        desktop: { name: desktop.name, mac: desktop.mac, power: desktop.power },
        at: Date.now(),
      })

      socket.on("rc:hello-controller", (data: { name?: string }) => {
        const name = data?.name || "هاتف التحكم"
        io2.emit("rc:log", { id: uid(), text: `هاتف تحكم متصل: ${name} — جاهز لإرسال الأوامر`, kind: "ok", at: Date.now() })
        socket.broadcast.emit("rc:controller-online", { name, at: Date.now() })
      })

      socket.on("desktop:register", (data: { name?: string; mac?: string }) => {
        if (data?.name) desktop.name = data.name
        if (data?.mac) desktop.mac = data.mac
      })

      socket.on("desktop:state", (report: { power?: string }) => {
        if (report?.power && report.power !== desktop.power) desktop.power = report.power
        socket.broadcast.emit("desktop:state", report)
      })

      socket.on("desktop:clipboard", (data: { text: string; at?: number }) => {
        io2.emit("rc:log", { id: uid(), text: "تم دفع الحافظة من الكمبيوتر إلى الهاتف", kind: "ok", at: Date.now() })
        socket.broadcast.emit("desktop:clipboard", data)
      })

      socket.on("rc:ping", (data: { t: number }) => {
        socket.emit("rc:pong", { t: data?.t ?? Date.now() })
      })

      for (const ev of RC_INPUT) {
        socket.on(ev, (data: Record<string, unknown>) => {
          if (!gateInput(socket, ev)) return
          if (ev === "rc:click") {
            const b = data?.button === "right" ? "أيمن" : "أيسر"
            io2.emit("rc:log", { id: uid(), text: `نقرة ${b} من لوحة لمس الهاتف`, kind: "in", at: Date.now() })
          } else if (ev === "rc:key" && data?.special) {
            io2.emit("rc:log", { id: uid(), text: `مفتاح خاص من الهاتف: ${String(data.special)}`, kind: "in", at: Date.now() })
          } else if (ev === "rc:presenter") {
            const a = data?.action as string
            const text = a === "next" ? "عرض تقديمي: الشريحة التالية ←"
              : a === "prev" ? "عرض تقديمي: → الشريحة السابقة"
              : a === "black" ? (data?.value ? "عرض تقديمي: شاشة سوداء" : "عرض تقديمي: إلغاء الشاشة السوداء")
              : a === "laser-on" ? "تفعيل المؤشر الليزري"
              : a === "laser-off" ? "إيقاف المؤشر الليزري" : null
            if (text) io2.emit("rc:log", { id: uid(), text, kind: "in", at: Date.now() })
          } else if (ev === "rc:media") {
            const a = data?.action as string
            const label: Record<string, string> = {
              toggle: "تشغيل/إيقاف مؤقت", play: "تشغيل", pause: "إيقاف مؤقت",
              next: "المقطع التالي", prev: "المقطع السابق", mute: "كتم الصوت", unmute: "إلغاء الكتم",
            }
            const text = a === "volume" ? `مستوى الصوت: ${Math.round(Number(data?.value ?? 0))}%` : label[a] ? `وسائط: ${label[a]}` : null
            if (text) io2.emit("rc:log", { id: uid(), text, kind: "in", at: Date.now() })
          } else if (ev === "rc:gamepad" && data?.kind === "button") {
            io2.emit("rc:log", { id: uid(), text: `يد الألعاب: زر ${String(data?.button ?? "")} → ${String(data?.action ?? "")}`, kind: "in", at: Date.now() })
          } else if (ev === "rc:clipboard" && data?.direction === "toPc") {
            io2.emit("rc:log", { id: uid(), text: `حافظة: نص وارد من الهاتف (${String(data?.text ?? "").length} حرف)`, kind: "in", at: Date.now() })
          } else if (ev === "rc:clipboard" && data?.direction === "pull") {
            io2.emit("rc:log", { id: uid(), text: "حافظة: الهاتف طلب نسخ حافظة الكمبيوتر", kind: "info", at: Date.now() })
          }
          // بث للجميع بما فيهم المرسل: في وحدة التحكم داخل التطبيق
          // يتشارك الكمبيوتر والهاتف نفس socket — يجب أن يسمع الطرفان
          io2.emit(ev, data)
        })
      }

      socket.on("rc:power", (data: { action: string }) => {
        const action = data?.action
        const label = POWER_AR_ACTION[action] ?? action
        if (desktop.power === "off" && action !== "unlock") {
          socket.emit("rc:rejected", { reason: "off", ev: "rc:power" })
          return
        }
        io2.emit("rc:log", { id: uid(), text: `أمر نظام من الهاتف: ${label}`, kind: "in", at: Date.now() })
        io2.emit("rc:power", data)
        if (action === "shutdown" || action === "restart") desktop.power = "shutting-down"
        else if (action === "sleep") desktop.power = "sleeping"
        else if (action === "hibernate") desktop.power = "shutting-down"
        else if (action === "lock") desktop.power = "locked"
        else if (action === "unlock") desktop.power = "on"
        else if (action === "logout") desktop.power = "locked" // شاشة الدخول = جلسة مقفلة
      })

      socket.on("rc:wol", (data: { mac: string }) => {
        const raw = String(data?.mac ?? "").trim()
        const norm = raw.replace(/-/g, ":").toUpperCase()
        const valid = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(norm)
        if (!valid) {
          socket.emit("rc:rejected", { reason: "mac", ev: "rc:wol" })
          io2.emit("rc:log", { id: uid(), text: `Wake-on-LAN: عنوان MAC غير صالح (${raw})`, kind: "info", at: Date.now() })
          return
        }
        if (norm !== desktop.mac.toUpperCase()) {
          socket.emit("rc:rejected", { reason: "mac", ev: "rc:wol" })
          io2.emit("rc:log", { id: uid(), text: `Wake-on-LAN: MAC لا يطابق الكمبيوتر المسجل (${norm} ≠ ${desktop.mac})`, kind: "info", at: Date.now() })
          return
        }
        if (desktop.power === "on" || desktop.power === "locked") {
          socket.emit("rc:rejected", { reason: "already-on", ev: "rc:wol" })
          io2.emit("rc:log", { id: uid(), text: "Wake-on-LAN: تم تجاهل الحزمة — الكمبيوتر يعمل بالفعل", kind: "info", at: Date.now() })
          return
        }
        const hex = "FFFFFFFFFFFF" + norm.replace(/:/g, "").repeat(16)
        io2.emit("rc:log", { id: uid(), text: `Wake-on-LAN: صياغة الحزمة السحرية إلى ${norm} — 6×FF + MAC×16 = ${hex.length / 2} بايت — جارٍ الإرسال الفعلي…`, kind: "in", at: Date.now() })
        // FA-power: الإرسال الفعلي عبر UDP broadcast (لا مجرد صياغة)
        sendWolPacket(norm, (ok, detail) => {
          io2.emit("rc:log", {
            id: uid(),
            text: ok
              ? `حزمة Wake-on-LAN السحرية أُرسلت فعليًا إلى ${norm} — ${detail}`
              : `فشل إرسال حزمة Wake-on-LAN (${detail})`,
            kind: ok ? "in" : "err",
            at: Date.now(),
          })
        })
        io2.emit("desktop:wake", { source: "wol", mac: norm, packet: hex })
      })

      // ==== FA-9: "أكمل من حيث توقفت" — رابط من الهاتف يُفتح على الكمبيوتر ====
      socket.on("rc:handoff", (data: { url?: string; title?: string }) => {
        const raw = String(data?.url ?? "").trim()
        let parsed: URL
        try {
          parsed = new URL(raw)
        } catch {
          socket.emit("rc:rejected", { reason: "url", ev: "rc:handoff" })
          return
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          socket.emit("rc:rejected", { reason: "scheme", ev: "rc:handoff" })
          io2.emit("rc:log", { id: uid(), text: `تسليم رابط مرفوض: البروتوكول ${parsed.protocol} غير مسموح (http/https فقط)`, kind: "info", at: Date.now() })
          return
        }
        if (raw.length > 2048) {
          socket.emit("rc:rejected", { reason: "toolong", ev: "rc:handoff" })
          return
        }
        const out = { url: raw, title: String(data?.title ?? "").slice(0, 120) || undefined, at: Date.now() }
        io2.emit("rc:handoff", out)
        io2.emit("rc:log", { id: uid(), text: `تسليم من الهاتف: «${out.title ?? raw.slice(0, 60)}» بانتظار الفتح على الكمبيوتر`, kind: "in", at: Date.now() })
      })
    })

    // FA-9 إصلاح انحدار: المنفذ مشغول بخدمة قديمة (mini-service ببروتوكول ميت) لا يعني الاستسلام —
    // المدمج في next هو المصدر المعتمد، فيعيد المحاولة حتى تتحرر المنفذ (المشرف قد يعيد إطلاق الخدمة القديمة)
    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "EADDRINUSE" && bindAttempts < 15) {
        bindAttempts++
        setTimeout(() => {
          try {
            httpServer.close()
          } catch {}
          httpServer.listen(PORT)
        }, 1000)
        return
      }
      io2.emit("rc:log", {
        id: uid(),
        text: `تعذّر ربط جسر التحكم بالمنفذ ${PORT} (${err?.code ?? "خطأ"}) — قد تكون خدمة قديمة تحتكره ببروتوكول ناقص`,
        kind: "err",
        at: Date.now(),
      })
      console.error(`[nexus] Remote bridge bind failed on ${PORT}:`, err?.code)
    })

    httpServer.listen(PORT, () => {
      io2.emit("rc:log", { id: uid(), text: `جسر التحكم عن بُعد يعمل — الكمبيوتر ${desktop.name}`, kind: "ok", at: Date.now() })
      console.log(`[nexus] Remote Control Bridge on port ${PORT}`)
    })
  } catch {
    // تجاهل — قد يكون المنفذ مشغولاً بخدمة قائمة
  }
  return remoteBridgeStatus()
}

let io: SocketServer | null = null
