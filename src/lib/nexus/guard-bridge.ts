// NexusLink — جسر الحماية وإدارة الأجهزة (يعمل داخل عملية Next.js)
// ============================================================
// المرحلة 8: منارة القرب (Bluetooth-proximity style) + ترحيل أوامر
// الرن/الفقدان/المسح/المنبهات/الإعدادات السريعة بين الكمبيوتر والهاتف.
// منفذ 3006 · نفس نمط remote-bridge (مدمج، idempotent).
import { createServer } from "http"
import { Server as SocketServer } from "socket.io"
import { applyAgentTx } from "./transfer-engine"
import { store } from "./devices"
import { socketCors } from "./socket-security" // SEC (M0.3 F4)
import { isDeviceKilled, noteRefired } from "./emergency" // §48 — قائمة القتل عند إعادة الاتصال

const PORT = 3006

// ---------------------------------------------------------------------------
// FA-7 — التحكم باللمس والحقن (بديل AirMirror)
// أحداث التحكم تُوجّه مباشرة للوكيل (لا بث) — اللمس عالي التكرار ويجب ألا يُرَدّ
// إلى مرسل الويب. الجلسة نفسها تُدار على الهاتف (تأكيد/قطع)، والسيرفر يفرض
// حاجز الثقة: لا تحكم إلا من جهاز مسجل وموثوق في سجل الأجهزة.
// ---------------------------------------------------------------------------

/** أبعاد شاشة الهاتف كما أبلغها الوكيل (dev:screen) — للويب لحساب مقياس الدقة. */
interface AgentScreenInfo { w: number; h: number; density: number; deviceId: string | null; at: number }
function screenReg(): AgentScreenInfo | null {
  const gg = globalThis as unknown as { __nexusGuardScreen?: AgentScreenInfo }
  return gg.__nexusGuardScreen ?? null
}

/** محدد معدل لأوامر اللمس — 120 حدثًا/ثانية لكل عميل (حماية من الفيضان). */
const touchBudget = new Map<string, { n: number; win: number }>()
function touchAllowed(key: string): boolean {
  const now = Date.now()
  const b = touchBudget.get(key)
  if (!b || now - b.win >= 1000) {
    touchBudget.set(key, { n: 1, win: now })
    if (touchBudget.size > 64) {
      for (const [k, v] of touchBudget) if (now - v.win >= 5000) touchBudget.delete(k)
    }
    return true
  }
  b.n++
  return b.n <= 120
}

const TOUCH_OPS = new Set(["tap", "long", "swipe", "scroll", "down", "move", "up"])
const KEY_ACTIONS = new Set(["back", "home", "recents", "notifications", "keyboard"])

function clampCoord(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(20000, Math.max(0, Math.round(n * 10) / 10))
}

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
  __nexusGuardAgent?: { socketId: string | null; deviceId: string | null; media: AgentMediaInfo | null }
  // الجولة 5 (عقد §24) — سجل كل وكلاء الهواتف الحقيقيين (مفتاح = socketId).
  // agentReg الأصلي يبقى كما هو (الوكيل الأساسي للويب — توافق كامل)، وهنا
  // نحتفظ بكل هاتف متصل لتوجيه هاتف→هاتف المستهدف.
  __nexusGuardAgents?: Map<string, { deviceId: string; name: string; at: number }>
  // جلسات التحكم هاتف→هاتف النشطة (مفتاح = معرف الهاتف المتحكم):
  // {targetDeviceId, controllerSocketId, targetSocketId} — يُنشئها تأكيد
  // الهاتف المُتحكَّم به (dev:ctl-state active) ويحذفها أي إنهاء/انقطاع.
  __nexusP2pSessions?: Map<string, { targetDeviceId: string; controllerSocketId: string; targetSocketId: string; at: number }>
}
const BOOT_KEY = "__nexusGuardBooted"

/** FA-files (عقد §14) — نقطة خدمة وسائط الهاتف الحقيقي (بث فيديو مباشر). */
export interface AgentMediaInfo {
  deviceId: string | null
  lanIp: string
  port: number
  token: string
  at: number
}

// سجل الوكيل الحقيقي (يُخزَّن في globalThis ليبقى بعد hot-reload)
function agentReg(): { socketId: string | null; deviceId: string | null; media: AgentMediaInfo | null } {
  if (!g.__nexusGuardAgent) g.__nexusGuardAgent = { socketId: null, deviceId: null, media: null }
  return g.__nexusGuardAgent
}

/** نقطة وسائط الهاتف الحالية — تقرأها الطبقة الأصلية/الواجهة من status.desktop.agentMedia. */
export function agentMedia(): AgentMediaInfo | null {
  return agentReg().media
}

// ---------------------------------------------------------------------------
// الجولة 5 (عقد §24) — التحكم بهاتف من هاتف آخر عبر المركز (هاتف→هاتف)
// نفس بروتوكول FA-7 حرفيًا (dev:ctl-start/state/stop + dev:touch/text/key) —
// الجديد فقط: سجل تعدد الوكلاء + جلسات موثقة + توجيه مستهدف بمعرف الجهاز.
// ---------------------------------------------------------------------------

/** سجل كل الوكلاء الحقيقيين المتصلين (مفتاح socketId). */
function agentsReg(): Map<string, { deviceId: string; name: string; at: number }> {
  if (!g.__nexusGuardAgents) g.__nexusGuardAgents = new Map()
  return g.__nexusGuardAgents
}

/** جلسات هاتف→هاتف النشطة (مفتاح معرف المتحكم). */
function p2pSessions(): Map<string, { targetDeviceId: string; controllerSocketId: string; targetSocketId: string; at: number }> {
  if (!g.__nexusP2pSessions) g.__nexusP2pSessions = new Map()
  return g.__nexusP2pSessions
}

/** سوكِت وكيل بمعرف جهاز معيّن (للتوجيه المستهدف) — أو null. */
function agentSocketByDeviceId(ioX: SocketServer, deviceId: string) {
  for (const [sid, a] of agentsReg()) {
    if (a.deviceId === deviceId) {
      const s = ioX.sockets?.sockets?.get(sid)
      if (s) return s
    }
  }
  return null
}

/** معرف جهاز سوكِت متصل إن كان وكيلًا مسجلًا. */
function agentDeviceIdOf(socketId: string): string | null {
  return agentsReg().get(socketId)?.deviceId ?? null
}

/** بث قائمة الوكلاء الحية (بعد كل تسجيل/مغادرة) — للهاتف أ ليختار هدفه. */
function broadcastAgents(ioX: SocketServer) {
  const byId = new Map<string, { deviceId: string; name: string; at: number }>()
  for (const a of agentsReg().values()) {
    const prev = byId.get(a.deviceId)
    if (!prev || a.at > prev.at) byId.set(a.deviceId, a)
  }
  ioX.emit("guard:agents", {
    agents: [...byId.values()].map((a) => ({ deviceId: a.deviceId, name: a.name })),
    sessions: [...p2pSessions().keys()],
    at: Date.now(),
  })
}

/** إخلاء جلسات هاتف→هاتف عند انقطاع أحد الطرفين — قطع فوري من الطرفين (عقد §24.أمن). */
function teardownP2pForDisconnect(ioX: SocketServer, socketId: string) {
  const sess = p2pSessions()
  // الطرف المُتحكَّم به انقطع → أخبر المتحكم فورًا
  for (const [controllerId, s] of [...sess.entries()]) {
    if (s.targetSocketId !== socketId) continue
    sess.delete(controllerId)
    const c = ioX.sockets?.sockets?.get(s.controllerSocketId)
    try {
      c?.emit("dev:ctl-state", { active: false, reason: "target-disconnected", controller: controllerId, at: Date.now() })
    } catch { /* السوكِت مات معه — لا شيء */ }
    log(ioX, `انقطع الهاتف المُتحكَّم به (جلسة ${controllerId}) — قُطعت جلسة التحكم فورًا`, "warn")
  }
  // المتحكم انقطع → أمر قطع فوري للهدف (لا جلسة يتيمة)
  for (const [controllerId, s] of [...sess.entries()]) {
    if (s.controllerSocketId !== socketId) continue
    sess.delete(controllerId)
    const t = ioX.sockets?.sockets?.get(s.targetSocketId)
    try {
      t?.emit("dev:ctl-stop", { reason: "controller-disconnected", at: Date.now() })
    } catch { /* الهدف انقطع أيضًا */ }
    log(ioX, `انقطع الهاتف المتحكم (${controllerId}) — أُرسل قطع فوري للهدف`, "warn")
  }
}

/** تنظيف عنوان TCP (::-ffff:) إلى IPv4/IPv6 نظيف. */
function cleanIp(raw: string | null | undefined): string {
  const a = String(raw || "").replace(/^::ffff:/i, "").replace(/^::1$/, "127.0.0.1")
  return a && a !== "::" ? a : "127.0.0.1"
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

/**
 * §48 — إطلاق القتل على وكيل متصل بمعرّفه (من الخادم حصرًا بعد PIN): يبحث
 * في سجل الوكيل الأساسي ثم سجل تعدد الوكلاء (§24). لا يوجد أي مسار آخر
 * يولّد dev:kill عبر المقبس (خارج CMDS حرفيًا — لا حقن).
 */
export function emitKillToDevice(deviceId: string): boolean {
  const ioX = currentIo()
  if (!ioX || !deviceId) return false
  const reg = agentReg()
  const target =
    reg.deviceId === deviceId && reg.socketId
      ? reg.socketId
      : [...agentsReg().entries()].find(([, a]) => a.deviceId === deviceId)?.[0]
  if (!target) return false
  const s = ioX.sockets?.sockets?.get(target)
  if (!s) return false
  try {
    s.emit("dev:kill", { deviceId, at: Date.now(), via: "server" })
    return true
  } catch {
    return false
  }
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
      cors: socketCors(), // SEC (M0.3 F4): بديل السماح المفتوح — Origin خارجي يُرفض عند المصافحة
      pingTimeout: 60000,
      pingInterval: 25000,
    })
    io = io2
    g.__nexusGuardIo = io2

    io2.on("connection", (socket) => {
      socket.emit("guard:hello", {
        prox: { ...prox, state: proxState, rssi: presence?.rssi ?? null, source: presence?.source ?? null },
        phoneGuardOnline,
        screen: screenReg(),
        at: Date.now(),
      })

      // ==== تسجيل الأطراف ====
      socket.on(
        "guard:hello-phone",
        (d: { name?: string; deviceId?: string; media?: { port?: unknown; token?: unknown } }) => {
          // §48.ج — فحص قائمة القتل قبل أي شيء: المقتول العائد يُقابَل بالقتل
          // فورًا — لا تسجيل وكيل، لا منارة، لا نقطة وسائط، ولا مصافحة. البوابة
          // (البوابة الصغيرة للطوارئ) نفسها تفرض هذا الترتيب على مستوى البروتوكول.
          if (d?.deviceId && isDeviceKilled(String(d.deviceId))) {
            try {
              socket.emit("dev:kill", { deviceId: String(d.deviceId), at: Date.now(), via: "reconnect", refired: true })
            } catch { /* السوكِت يموت معه */ }
            void noteRefired(String(d.deviceId))
            log(io2, `هاتف مقتول عاد للاتصال — القتل أُعيد فورًا بلا مصافحة (${String(d.deviceId).slice(0, 24)})`, "warn")
            return
          }
          phoneGuardOnline = true
          // تسجيل الوكيل الحقيقي (لإرسال عروض النقل tx:offer إليه لاحقًا)
          const reg = agentReg()
          reg.socketId = socket.id
          if (d?.deviceId) reg.deviceId = String(d.deviceId)
          // الجولة 5 (§24) — سجل تعدد الوكلاء: كل هاتف يُسجّل بسوكِته ليصل
          // التوجيه المستهدف هاتف→هاتف، وقائمة الوكلاء تبث للاختيار في الواجهات.
          if (d?.deviceId) {
            agentsReg().set(socket.id, { deviceId: String(d.deviceId), name: String(d?.name ?? "هاتف"), at: Date.now() })
            broadcastAgents(io2)
          }
          // FA-files (عقد §14) — تسجيل نقطة وسائط الهاتف: IP من عنوان الـ TCP الفعلي
          // للسوكِت (الهاتف على نفس الشبكة المحلية حسب مقصد المنصة) + منفذ/رمز من الوكيل.
          if (d?.media && typeof d.media === "object") {
            const port = Number(d.media.port)
            const token = String(d.media.token ?? "")
            if (Number.isFinite(port) && port >= 1024 && port <= 65535 && token.length >= 8) {
              reg.media = {
                deviceId: reg.deviceId,
                lanIp: cleanIp(socket.handshake?.address),
                port: Math.floor(port),
                token,
                at: Date.now(),
              }
            }
          }
          io2.emit("dev:log", { id: uid(), text: `هاتف الحماية متصل: ${d?.name ?? "هاتف Nexus"} — منارة القرب تعمل`, kind: "ok", at: Date.now() })
          io2.emit("guard:phone-online", { online: true })
        },
      )
      // FA-files — تحديث نقطة الوسائط بعد التسجيل (إعادة تشغيل خدمة الوسائط على الهاتف)
      socket.on("guard:media", (d: { port?: unknown; token?: unknown }) => {
        const reg = agentReg()
        const port = Number(d?.port)
        const token = String(d?.token ?? "")
        if (Number.isFinite(port) && port >= 1024 && port <= 65535 && token.length >= 8) {
          reg.media = {
            deviceId: reg.deviceId,
            lanIp: cleanIp(socket.handshake?.address),
            port: Math.floor(port),
            token,
            at: Date.now(),
          }
        }
      })
      socket.on("disconnect", () => {
        // الجولة 5 (§24) — قطع فوري من الطرفين: انقطاع أي طرف هاتف→هاتف
        // يُنهي الجلسة للأطراف الأخرى فورًا (لا جلسة يتيمة أبدًا).
        if (agentsReg().delete(socket.id)) teardownP2pForDisconnect(io2, socket.id)
        // FA-files — نقطة وسائط الوكيل تموت مع سوكِت مالكها فورًا مهما بقي من
        // عملاء آخرين (مشاهدون/هواتف): بقاءها كان يترك نقطة بث ميتة معلنة في
        // status.desktop.agentMedia لهاتف انقطع فعليًا (كشفتها حزمة E2E).
        const regOwner = agentReg()
        if (regOwner.socketId === socket.id) {
          regOwner.socketId = null
          regOwner.media = null
          io2?.emit("guard:phone-online", { online: false })
        }
        // إن انقطع آخر عميل هاتف نعلم الكمبيوتر (يُلتقط غياب المنارة لاحقاً)
        setTimeout(() => {
          const socks = io2?.sockets?.sockets
          if (socks && socks.size > 0) {
            if (agentsReg().size > 0) broadcastAgents(io2)
            return
          }
          phoneGuardOnline = false
          io2?.emit("guard:phone-online", { online: false })
          if (agentsReg().size > 0) broadcastAgents(io2)
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

      // ==== FA-7: أبعاد شاشة الهاتف (من الوكيل فقط — تُخزن وتُبث للويب) ====
      // الجولة 5 (§24): الحقل يوسم بمعرف المرسل نفسه (تعدد وكلاء) — الهاتف أ
      // يفلتر بمعرف هدفه، والويب يقرأ الوكيل الأساسي كما كان.
      socket.on("dev:screen", (d: { w?: number; h?: number; density?: number }) => {
        if (agentReg().socketId !== socket.id && !agentsReg().has(socket.id)) return
        const w = Math.round(Number(d?.w ?? 0))
        const h = Math.round(Number(d?.h ?? 0))
        if (w <= 0 || h <= 0) return
        const info: AgentScreenInfo = {
          w, h,
          density: Math.round(Number(d?.density ?? 0)),
          deviceId: agentDeviceIdOf(socket.id) ?? agentReg().deviceId,
          at: Date.now(),
        }
        ;(globalThis as unknown as { __nexusGuardScreen?: AgentScreenInfo }).__nexusGuardScreen = info
        io2.emit("guard:screen", info)
        log(io2, `أبعاد شاشة الهاتف: ${w}×${h} (كثافة ${info.density})`, "info")
      })

      // ==== FA-7: جلسة التحكم — توجيه مباشر للوكيل مع حاجز الثقة ====
      socket.on("dev:ctl-start", (d: { from?: string; name?: string }) => {
        const from = String(d?.from ?? "").trim()
        const dev = store().devices.find((x) => x.id === from)
        if (!dev || !dev.trusted) {
          log(io2, `رفض محاولة تحكم من جهاز غير موثوق: ${from || "مجهول"}`, "warn")
          socket.emit("dev:ctl-rejected", { reason: "untrusted", from, at: Date.now() })
          return
        }
        const reg = agentReg()
        const target = reg.deviceId ? store().devices.find((x) => x.id === reg.deviceId) : null
        if (!target || !target.trusted) {
          socket.emit("dev:ctl-rejected", { reason: "target-untrusted", from, at: Date.now() })
          return
        }
        const okSend = guardEmitToAgent("dev:ctl-start", {
          from,
          name: dev.name,
          at: Date.now(),
        })
        if (!okSend) {
          socket.emit("dev:ctl-rejected", { reason: "offline", from, at: Date.now() })
          return
        }
        log(io2, `طلب تحكم باللمس من ${dev.name} إلى ${target.name}`, "in")
      })

      socket.on("dev:ctl-stop", () => {
        guardEmitToAgent("dev:ctl-stop", { at: Date.now() })
      })

      // ==== الجولة 5 (§24): جلسة تحكم هاتف→هاتف — بوابة الثقة الكاملة ====
      // الهاتف أ يطلب {from, target} — يجب: المرسل هو الوكيل صاحب from نفسه
      // (ربط هوية السوكِت) + الطرفان موثوقان + بلا تحكم ذاتي + الهدف حي وغير
      // محكوم به. التوجيه إلى سوكِت الهدف بنفس حدث dev:ctl-start المعروف —
      // فحوار التأكيد والإشعار على الهاتف ب يبقيان كما هما حرفيًا.
      socket.on("p2p:ctl-start", (d: { from?: string; target?: string; name?: string }) => {
        const senderDevice = agentDeviceIdOf(socket.id)
        const from = String(d?.from ?? "").trim()
        const target = String(d?.target ?? "").trim()
        const reject = (reason: string) => {
          socket.emit("p2p:ctl-rejected", { reason, from, target, at: Date.now() })
          log(io2, `رفض جلسة هاتف→هاتف (${reason}): ${from || "مجهول"} ← ${target || "مجهول"}`, "warn")
        }
        // ربط الهوية: من يطلب التحكم يجب أن يكون الوكيل صاحب المعرف نفسه
        if (!senderDevice || senderDevice !== from) return reject("identity")
        const dev = store().devices.find((x) => x.id === from)
        if (!dev || !dev.trusted) return reject("untrusted")
        const tgt = store().devices.find((x) => x.id === target)
        if (!tgt || !tgt.trusted) return reject("target-untrusted")
        // الأمان الحاسم: لا هاتف يتحكم بنفسه إطلاقًا
        if (from === target) return reject("self")
        // الهدف حي؟
        const tSock = agentSocketByDeviceId(io2, target)
        if (!tSock) return reject("target-offline")
        // متحكم واحد = جلسة واحدة (الواجهة ترسل p2p:ctl-stop قبل أي طلب جديد)
        if (p2pSessions().has(from)) return reject("already-controlling")
        // لا تحكم مزدوج: الهدف غير محكوم به من أحد
        for (const [, s] of p2pSessions()) {
          if (s.targetDeviceId === target) return reject("target-busy")
        }
        tSock.emit("dev:ctl-start", { from, name: dev.name, p2p: true, at: Date.now() })
        log(io2, `طلب تحكم هاتف→هاتف من ${dev.name} إلى ${tgt.name} — بانتظار تأكيد الهدف`, "in")
      })

      // الهاتف أ يقطع الجلسة: قطع فوري للهدف + إشعار حالة للمتحكم (مصدر واحد)
      socket.on("p2p:ctl-stop", (d: { target?: string }) => {
        const senderDevice = agentDeviceIdOf(socket.id)
        if (!senderDevice) return
        const target = String(d?.target ?? "").trim()
        const sess = p2pSessions()
        for (const [cid, s] of [...sess.entries()]) {
          if (cid !== senderDevice) continue
          if (target && s.targetDeviceId !== target) continue
          sess.delete(cid)
          const t = io2.sockets?.sockets?.get(s.targetSocketId)
          try {
            t?.emit("dev:ctl-stop", { reason: "controller-stop", at: Date.now() })
          } catch { /* الهدف انقطع */ }
          const c = io2.sockets?.sockets?.get(s.controllerSocketId)
          try {
            c?.emit("dev:ctl-state", { active: false, reason: "controller-stop", controller: cid, at: Date.now() })
          } catch { /* المتحكم هو المرسل نفسه */ }
          log(io2, `أنهى الهاتف المتحكم (${cid}) جلسة هاتف→هاتف`, "info")
        }
      })

      // ==== FA-7: أوامر اللمس/النص/الأزرار — توجيه مباشر (بلا صدى للمرسل) ====
      // الجولة 5 (§24): سوكِت هاتف (وكيل مسجل) → مسار هاتف→هاتف حصرًا — جلسة
      // موثقة مطلوبة وإلا رفض no-session (يمنع تحكم الهاتف بنفسه عبر الوكيل
      // الأساسي). سوكِت الويب → المسار القائم إلى الوكيل الأساسي كما كان.
      socket.on("dev:touch", (d: Record<string, unknown>) => {
        if (!touchAllowed(socket.id)) return
        const op = String(d?.op ?? "")
        if (!TOUCH_OPS.has(op)) return
        const payload: Record<string, unknown> = { op }
        if (d?.seq != null) payload.seq = Number(d.seq) || 0
        payload.x = clampCoord(d?.x)
        payload.y = clampCoord(d?.y)
        if (op === "swipe" || op === "scroll") {
          payload.x2 = clampCoord(d?.x2)
          payload.y2 = clampCoord(d?.y2)
          const dur = Math.min(5000, Math.max(40, Math.round(Number(d?.durationMs ?? 300))))
          payload.durationMs = dur
        }
        const senderDevice = agentDeviceIdOf(socket.id)
        if (senderDevice) {
          const sess = p2pSessions().get(senderDevice)
          if (!sess) {
            socket.emit("dev:ctl-rejected", { reason: "no-session", at: Date.now() })
            return
          }
          const t = io2.sockets?.sockets?.get(sess.targetSocketId)
          try {
            t?.emit("dev:touch", payload)
          } catch { /* الهدف انقطع — الإخلاء يحدث في disconnect */ }
          return
        }
        guardEmitToAgent("dev:touch", payload)
      })

      socket.on("dev:text", (d: { text?: string }) => {
        const text = String(d?.text ?? "")
        if (text.length > 2000) return
        const senderDevice = agentDeviceIdOf(socket.id)
        if (senderDevice) {
          const sess = p2pSessions().get(senderDevice)
          if (!sess) {
            socket.emit("dev:ctl-rejected", { reason: "no-session", at: Date.now() })
            return
          }
          const t = io2.sockets?.sockets?.get(sess.targetSocketId)
          try {
            t?.emit("dev:text", { text, at: Date.now() })
          } catch { /* الهدف انقطع */ }
          return
        }
        guardEmitToAgent("dev:text", { text, at: Date.now() })
      })

      socket.on("dev:key", (d: { action?: string }) => {
        const action = String(d?.action ?? "")
        if (!KEY_ACTIONS.has(action)) return
        const senderDevice = agentDeviceIdOf(socket.id)
        if (senderDevice) {
          const sess = p2pSessions().get(senderDevice)
          if (!sess) {
            socket.emit("dev:ctl-rejected", { reason: "no-session", at: Date.now() })
            return
          }
          const t = io2.sockets?.sockets?.get(sess.targetSocketId)
          try {
            t?.emit("dev:key", { action, at: Date.now() })
          } catch { /* الهدف انقطع */ }
          return
        }
        guardEmitToAgent("dev:key", { action, at: Date.now() })
      })

      // ==== FA-7: تقارير الوكيل — حالة الجلسة وإقرارات التنفيذ (بث للويب) ====
      // الجولة 5 (§24): حالة هاتف→هاتف تُبث للويب كما هي (الشاشة تعرضها)،
      // ويضاف توجيه مستهدف للمتحكم الهاتفي + تسجيل/إخلاء الجلسة الموثقة.
      socket.on("dev:ctl-state", (data: Record<string, unknown>) => {
        if (agentReg().socketId !== socket.id && !agentsReg().has(socket.id)) return
        io2.emit("dev:ctl-state", data)
        const senderDevice = agentDeviceIdOf(socket.id)
        if (!senderDevice) return
        const controller = String(data?.controller ?? "").trim()
        if (!controller) return
        const active = data?.active === true
        if (active) {
          // تأكيد الهدف (ضغط «سماح») → الجلسة تصبح موثقة وموجهة
          if (p2pSessions().has(controller)) return // جلسة قائمة — لا ازدواج
          p2pSessions().set(controller, {
            targetDeviceId: senderDevice,
            controllerSocketId: agentSocketByDeviceId(io2, controller)?.id ?? "",
            targetSocketId: socket.id,
            at: Date.now(),
          })
          const c = agentSocketByDeviceId(io2, controller)
          try {
            c?.emit("dev:ctl-state", { ...data, target: senderDevice, at: Date.now() })
          } catch { /* المتحكم انقطع — الإخلاء في disconnect */ }
          log(io2, `جلسة هاتف→هاتف نشطة: ${controller} يتحكم بـ${senderDevice}`, "ok")
        } else {
          // إنهاء من الهدف أو رفض أو انقطاع: أبلغ المتحكم إن كانت جلسته هي
          const s = p2pSessions().get(controller)
          if (s && s.targetDeviceId === senderDevice) {
            p2pSessions().delete(controller)
            const c = agentSocketByDeviceId(io2, controller)
            try {
              c?.emit("dev:ctl-state", { ...data, target: senderDevice, at: Date.now() })
            } catch { /* المتحكم انقطع */ }
          }
        }
      })
      socket.on("dev:touch-ack", (data: Record<string, unknown>) => {
        if (agentReg().socketId !== socket.id && !agentsReg().has(socket.id)) return
        io2.emit("dev:touch-ack", data)
        // توجيه الإقرار للمتحكم الهاتفي (إقرارات اللمس تخصه حصرًا)
        const senderDevice = agentDeviceIdOf(socket.id)
        if (!senderDevice) return
        for (const [cid, s] of p2pSessions()) {
          if (s.targetDeviceId !== senderDevice) continue
          const c = agentSocketByDeviceId(io2, cid)
          try {
            c?.emit("dev:touch-ack", data)
          } catch { /* المتحكم انقطع */ }
        }
      })

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
