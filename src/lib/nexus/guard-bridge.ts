// NexusLink — جسر الحماية وإدارة الأجهزة (يعمل داخل عملية Next.js)
// ============================================================
// المرحلة 8: منارة القرب (Bluetooth-proximity style) + ترحيل أوامر
// الرن/الفقدان/المسح/المنبهات/الإعدادات السريعة بين الكمبيوتر والهاتف.
// منفذ 3006 · نفس نمط remote-bridge (مدمج، idempotent).
import { createServer } from "http"
import { Server as SocketServer } from "socket.io"
import { applyAgentTx } from "./transfer-engine"

const PORT = 3006

// ---------- إعدادات محرك القرب (المصدر الرسمي) ----------
export interface ProxSettings {
  enabled: boolean
  thresholdRssi: number // أضعف من هذا → خارج النطاق
  graceSec: number // مهلة السماح قبل القفل
  autoUnlock: boolean // فتح تلقائي عند العودة
}
const prox: ProxSettings = {
  enabled: true,
  thresholdRssi: -68,
  graceSec: 8,
  autoUnlock: true,
}

// حالة الحضور: منارة حقيقية من الهاتف تتقدم دائماً على المحاكاة
interface Presence {
  rssi: number
  last: number
  source: "real" | "sim"
}
let presence: Presence | { rssi: number; last: 0; source: "sim" } | null = null

type ProxState = "near" | "grace" | "locked" | "disabled"
let proxState: ProxState = "near"
let graceSince = 0
const REAL_FRESH_MS = 8000 // منارة حقيقية أحدث من هذا تُلغي المحاكاة

function currentPresence(): Presence | null {
  if (!presence) return null
  if (presence.source === "sim") {
    // وجود هاتف حقيقي متصل؟ المنارة الحقيقية هي المصدر الوحيد — المحاكاة تُهمل
    if (phoneGuardOnline) return null
    // منارة حقيقية حديثة؟ إذن المحاكاة تُهمل أيضاً
    const hasReal = lastRealBeacon > 0 && Date.now() - lastRealBeacon < REAL_FRESH_MS
    if (hasReal) return null
  }
  return presence
}

let lastRealBeacon = 0
let phoneGuardOnline = false

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

function log(io2: SocketServer, text: string, kind: "in" | "ok" | "info" | "warn" = "info") {
  io2.emit("dev:log", { id: uid(), text, kind, at: Date.now() })
}

// guard ضد الإقلاع المزدوج عند hot-reload
const g = globalThis as unknown as {
  __nexusGuardBooted?: boolean
  __nexusGuardIo?: SocketServer | null
  __nexusGuardAgent?: { socketId: string | null; deviceId: string | null }
}
const BOOT_KEY = "__nexusGuardBooted"

// سجل الوكيل الحقيقي (يُخزَّن في globalThis ليبقى بعد hot-reload)
function agentReg(): { socketId: string | null; deviceId: string | null } {
  if (!g.__nexusGuardAgent) g.__nexusGuardAgent = { socketId: null, deviceId: null }
  return g.__nexusGuardAgent
}

function currentIo(): SocketServer | null {
  return io ?? g.__nexusGuardIo ?? null
}

/** بث عام على جسر الحماية (لعملاء الويب). */
export function guardEmit(event: string, data: unknown): boolean {
  const ioX = currentIo()
  if (!ioX) return false
  try {
    ioX.emit(event, data)
    return true
  } catch {
    return false
  }
}

/** إرسال موجّه للوكيل الحقيقي (هاتف Flutter المتصل بـ guard:hello-phone). */
export function guardEmitToAgent(event: string, data: unknown): boolean {
  const ioX = currentIo()
  const reg = agentReg()
  if (!ioX || !reg.socketId) return false
  const s = ioX.sockets?.sockets?.get(reg.socketId)
  if (!s) return false
  try {
    s.emit(event, data)
    return true
  } catch {
    return false
  }
}

/** هل الوكيل الحقيقي متصل الآن؟ */
export function isAgentOnline(): boolean {
  const ioX = currentIo()
  const reg = agentReg()
  if (!ioX || !reg.socketId) return false
  return !!ioX.sockets?.sockets?.has(reg.socketId)
}

export function getAgentDeviceId(): string | null {
  return agentReg().deviceId
}

export function guardBridgeStatus() {
  return {
    booted: !!g[BOOT_KEY],
    port: PORT,
    prox: { ...prox, state: proxState, rssi: presence?.rssi ?? null, source: presence?.source ?? null, phoneGuardOnline },
  }
}

export function ensureGuardBridge() {
  if (g[BOOT_KEY]) return guardBridgeStatus()
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
    g.__nexusGuardIo = io2

    io2.on("connection", (socket) => {
      socket.emit("guard:hello", {
        prox: { ...prox, state: proxState, rssi: presence?.rssi ?? null, source: presence?.source ?? null },
        phoneGuardOnline,
        at: Date.now(),
      })

      // ==== تسجيل الأطراف ====
      socket.on("guard:hello-phone", (d: { name?: string; deviceId?: string }) => {
        phoneGuardOnline = true
        // تسجيل الوكيل الحقيقي (لإرسال عروض النقل tx:offer إليه لاحقًا)
        const reg = agentReg()
        reg.socketId = socket.id
        if (d?.deviceId) reg.deviceId = String(d.deviceId)
        io2.emit("dev:log", { id: uid(), text: `هاتف الحماية متصل: ${d?.name ?? "هاتف Nexus"} — منارة القرب تعمل`, kind: "ok", at: Date.now() })
        io2.emit("guard:phone-online", { online: true })
      })
      socket.on("disconnect", () => {
        // إن انقطع آخر عميل هاتف نعلم الكمبيوتر (يُلتقط غياب المنارة لاحقاً)
        setTimeout(() => {
          const socks = io2?.sockets?.sockets
          if (socks && socks.size > 0) return
          phoneGuardOnline = false
          const reg = agentReg()
          if (reg.socketId === socket.id) reg.socketId = null
          io2?.emit("guard:phone-online", { online: false })
        }, 1500)
      })

      // ==== أحداث النقل من الوكيل → تحديث سجل المهام + ترحيل للويب ====
      const TX_EVENTS = ["tx:accept", "tx:reject", "tx:progress", "tx:state"] as const
      for (const ev of TX_EVENTS) {
        socket.on(ev, (data: Record<string, unknown>) => {
          try {
            const job = applyAgentTx(ev, data || {})
            socket.broadcast.emit("tx:update", { ev, job, at: Date.now() })
          } catch {
            /* حدث نقل تالف — تجاهل */
          }
        })
      }

      // ==== منارة القرب ====
      socket.on("prox:beacon", (d: { rssi?: number; device?: string }) => {
        lastRealBeacon = Date.now()
        presence = { rssi: Number(d?.rssi ?? -55), last: lastRealBeacon, source: "real" }
      })
      socket.on("prox:sim", (d: { rssi?: number }) => {
        // محاكاة من الكمبيوتر — تُستخدم فقط عند غياب منارة حقيقية
        presence = { rssi: Number(d?.rssi ?? -50), last: Date.now(), source: "sim" }
      })

      // ==== قفل/فتح يدوي من الكمبيوتر ====
      socket.on("prox:manual-lock", () => {
        proxState = "locked"
        graceSince = 0
        log(io2, "قفل يدوي من لوحة الحماية", "info")
        io2.emit("pc:lock", { reason: "manual", at: Date.now() })
      })
      socket.on("prox:manual-unlock", () => {
        if (!prox.enabled) {
          proxState = "disabled"
        } else {
          proxState = "near"
        }
        graceSince = 0
        log(io2, "فُتح القفل بكلمة المرور", "ok")
        io2.emit("pc:unlock", { reason: "manual" })
      })

      // ==== إعدادات القرب ====
      socket.on("guard:settings", (d: Partial<ProxSettings>) => {
        if (typeof d.enabled === "boolean") prox.enabled = d.enabled
        if (typeof d.thresholdRssi === "number") prox.thresholdRssi = d.thresholdRssi
        if (typeof d.graceSec === "number" && d.graceSec >= 3 && d.graceSec <= 120) prox.graceSec = d.graceSec
        if (typeof d.autoUnlock === "boolean") prox.autoUnlock = d.autoUnlock
        if (!prox.enabled) {
          proxState = "disabled"
          graceSince = 0
        } else if (proxState === "disabled") proxState = "near"
        log(io2, `إعدادات الحماية حُدّثت: ${prox.enabled ? "مراقبة القرب مفعّلة" : "متوقفة"} · عتبة ${prox.thresholdRssi}dBm · مهلة ${prox.graceSec}ث`, "info")
        io2.emit("guard:settings", { ...prox })
      })

      // ==== أوامر الكمبيوتر → الهاتف (ترحيل للجميع) ====
      const CMDS = ["dev:ring", "dev:ring-stop", "dev:light", "dev:lost", "dev:lost-off", "dev:wipe", "dev:alarm", "dev:qs", "dev:app"] as const
      for (const ev of CMDS) {
        socket.on(ev, (data: Record<string, unknown>) => {
          if (ev === "dev:ring") log(io2, "أمر: رنين قوي على الهاتف — تجاوز الوضع الصامت", "in")
          else if (ev === "dev:ring-stop") log(io2, "أمر: إيقاف الرنين", "info")
          else if (ev === "dev:light") log(io2, `أمر: ${data?.on ? "إضاءة الشاشة/الفلاش" : "إطفاء الإضاءة"} على الهاتف`, "in")
          else if (ev === "dev:lost" && data?.on) log(io2, `أمر: تفعيل وضع الفقدان — «${String(data?.message ?? "").slice(0, 40)}»`, "warn")
          else if (ev === "dev:lost-off") log(io2, "أمر: إلغاء وضع الفقدان — الهاتف فُتح", "ok")
          else if (ev === "dev:wipe") log(io2, "أمر: مسح عن بُعد لبيانات الهاتف!", "warn")
          else if (ev === "dev:alarm" && data?.action === "add") log(io2, `أمر: منبه جديد ${String(data?.time ?? "")} — ${String(data?.label ?? "")}`, "in")
          else if (ev === "dev:alarm" && data?.action === "toggle") log(io2, `أمر: ${data?.enabled ? "تفعيل" : "تعطيل"} المنبه ${String(data?.time ?? "")}`, "in")
          else if (ev === "dev:qs") log(io2, `أمر إعدادات سريعة: ${String(data?.key ?? "")} = ${String(data?.value ?? "")}`, "in")
          io2.emit(ev, data)
        })
      }

      // ==== تقارير الهاتف → الكمبيوتر ====
      socket.on("dev:state", (data: Record<string, unknown>) => {
        socket.broadcast.emit("dev:state", data)
      })
      socket.on("dev:sync-request", () => {
        socket.broadcast.emit("dev:sync-request")
      })
      socket.on("dev:acked", (d: { text?: string }) => {
        if (d?.text) log(io2, d.text, "ok")
      })
    })

    httpServer.on("error", () => {
      // المنفذ مشغول (الخدمة المستقلة تعمل) — لا شيء يحدث
    })

    // ==== محرك القرب: نبضة كل ثانية ====
    setInterval(() => {
      if (!io2) return
      const p = currentPresence()
      const now = Date.now()

      if (!prox.enabled) {
        if (proxState !== "disabled") proxState = "disabled"
        io2.emit("prox:state", { state: proxState, rssi: p?.rssi ?? null, source: p?.source ?? null, leftMs: null, settings: prox })
        return
      }

      // بلا منارة إطلاقاً (لا هاتف حقيقي ولا محاكاة) → اعتبرها ابتعاداً
      const stale = !p || now - p.last > Math.max(6000, prox.graceSec * 1000)
      const weak = !!p && p.rssi < prox.thresholdRssi
      const away = stale || weak

      if (proxState === "locked") {
        if (!away && prox.autoUnlock) {
          proxState = "near"
          graceSince = 0
          log(io2, "عاد الهاتف إلى نطاق القرب — فُتح الكمبيوتر تلقائياً", "ok")
          io2.emit("pc:unlock", { reason: "proximity", at: now })
        }
      } else if (away) {
        if (proxState === "near") {
          proxState = "grace"
          graceSince = now
          log(io2, weak ? `إشارة الهاتف ضعيفة (${Math.round(p!.rssi)}dBm) — عد تنازلي للقفل` : "فُقدت منارة الهاتف — عد تنازلي للقفل", "warn")
        }
        const elapsed = now - graceSince
        const leftMs = Math.max(0, prox.graceSec * 1000 - elapsed)
        if (leftMs <= 0) {
          proxState = "locked"
          log(io2, "ابتعد الهاتف عن النطاق — قُفل الكمبيوتر تلقائياً", "warn")
          io2.emit("pc:lock", { reason: weak ? "weak-signal" : "no-beacon", rssi: p?.rssi ?? null, at: now })
        }
      } else {
        proxState = "near"
        graceSince = 0
      }

      io2.emit("prox:state", {
        state: proxState,
        rssi: p?.rssi ?? null,
        source: p?.source ?? null,
        leftMs: proxState === "grace" ? Math.max(0, prox.graceSec * 1000 - (now - graceSince)) : null,
        settings: prox,
      })
    }, 1000)

    httpServer.listen(PORT, () => {
      log(io2, "جسر الحماية وإدارة الأجهزة يعمل — مراقبة القرب جاهزة", "ok")
      console.log(`[nexus] Guard Bridge on port ${PORT}`)
    })
  } catch {
    // تجاهل — قد يكون المنفذ مشغولاً
  }
  return guardBridgeStatus()
}

let io: SocketServer | null = null
