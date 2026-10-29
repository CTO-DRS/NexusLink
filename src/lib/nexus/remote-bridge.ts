// NexusLink — جسر التحكم عن بُعد (يعمل داخل عملية Next.js)
// ============================================================
// نفس منطق mini-services/remote-service لكن مدمجاً في خادم Next
// كي يعمل تحت إشراف المنصة مباشرة دون عملية منفصلة.
// منفذ 3004 · نقل أحداث الهاتف → الكمبيوتر عبر Nexus Protocol.
// FA-power (عقد §12): أوامر النظام الحقيقية (logout إضافي) + إرسال حزمة
// Wake-on-LAN السحرية فعليًا عبر UDP broadcast (كانت تُصاغ فقط سابقًا).
// FA-input (عقد §13): جلسة تحكم موثوقة (rc:session بدء/نبض/إيقاف + watchdog)،
// حاجز الثقة من سجل الأجهزة، وحقن __src في أحداث الإدخال لتمييز المصدر
// (desktop = واجهة الكمبيوتر نفسها · controller = هاتف موثوق · unknown).
import { createServer } from "http"
import { createSocket, Socket as UdpSocket, RemoteInfo } from "dgram"
import { randomBytes } from "crypto"
import { Server as SocketServer } from "socket.io"
import { store as deviceStore } from "./devices"
import { markFirstValue } from "./pair-metrics" // M1.1 §30: أول جلسة تحكم مقبولة تُكمل التسييل
import { socketCors, realClientIp, isLocalSocket } from "./socket-security"

const PORT = 3004

// SEC (M1 F9): غرفة جمهور الحافظة الموجّه — ينضم إليها العملاء المحليون
// (حد §13 الصادق: الجهاز نفسه) والهواتف الموثوقة بهوية مقترنة حصرًا؛
// سوكِت استطلاع شبكي بلا هوية لا ينضم أبدًا فلا يسمع نص الحافظة.
const CLIP_AUD = "rc:clip-aud"

// ---------------------------------------------------------------------------
// الجولة 4 (عقد §18) — NexusLive: قناة UDP عالية التردد للإدخال الحي
// ---------------------------------------------------------------------------
// المسار: هاتف (داتاجرام ثنائي ≤32B) → UDP :3010 (هذا الجسر — بوابة الثقة
// + إحصاء فقد/ترتيب/تكرار) → إعادة توجيه إلى 127.0.0.1:3011 (حوض Rust
// الحصري — live.rs يفك ويحقن عبر input_exec). الثقة تُدار هنا حصرًا:
// rc:live-hello فوق socket.io يتطلب هاتفًا موثوقًا + جلسة تحكم نشطة،
// والمفتاح (8B عشوائي لكل جلسة) يُثبّت عنوان المرسل عند أول حزمة.
const LIVE_UDP_PORT = Number(process.env.NEXUS_LIVE_PORT || 3010)
const LIVE_SINK_PORT = Number(process.env.NEXUS_LIVE_SINK_PORT || 3011)
const LIVE_MAGIC = 0x4e58
const LIVE_VERSION = 1
const LIVE_MAX_DATAGRAM = 128
const LIVE_TYPES = new Set([1, 2, 3, 4, 0x7f]) // pen mouse gyro touch ping
const LIVE_PING = 0x7f
const LIVE_PONG = 0x7e

interface LiveStats {
  received: number
  forwarded: number
  lost: number
  reorder: number
  dup: number
  pings: number
}
interface LiveFlow {
  key: Buffer
  socketId: string
  deviceId: string | null
  name: string
  bound: string | null
  lastSeq: number | null
  stats: LiveStats
}
const liveFlows = new Map<string, LiveFlow>()
const liveGlobal = { droppedMalformed: 0, droppedNoKey: 0, droppedAddr: 0, forwardErrors: 0, pongErrors: 0 }
let liveUdp: UdpSocket | null = null

function liveStatsSnapshot() {
  const flows = [...liveFlows.values()].map((f) => ({
    deviceId: f.deviceId,
    name: f.name,
    bound: f.bound,
    stats: { ...f.stats },
  }))
  return { port: LIVE_UDP_PORT, sinkPort: LIVE_SINK_PORT, flows, global: { ...liveGlobal }, at: Date.now() }
}

/** إسقاط تدفقات سوكِت منتهي (نهاية جلسة/انقطاع) — القناة الحية ترث عمر الجلسة */
function dropLiveFlows(socketId: string, reason: string) {
  for (const [k, f] of liveFlows) {
    if (f.socketId === socketId) {
      liveFlows.delete(k)
      io2Safe?.emit("rc:log", { id: uid(), text: `انتهى التدفق الحي (NexusLive) لـ ${f.name} — ${reason}`, kind: "info", at: Date.now() })
    }
  }
}

/** تحديث إحصاء التسلسل (wrap-aware — نفس دلالة live_core في Rust) */
function liveSeqUpdate(f: LiveFlow, seq: number) {
  if (f.lastSeq === null) {
    f.lastSeq = seq
    return
  }
  const d = (seq - f.lastSeq) >>> 0
  if (d === 0) {
    f.stats.dup++
    return
  }
  if (d < 0x80000000) {
    if (d > 1) f.stats.lost += d - 1
  } else {
    f.stats.reorder++
  }
  f.lastSeq = seq
}

/** ضمان سوكِت UDP واحد للجسر (idempotent — إقلاع الجسر فقط) */
function ensureLiveUdp() {
  if (liveUdp) return
  const sock = createSocket({ type: "udp4", reuseAddr: false })
  sock.on("error", (e) => {
    console.error("[nexus] NexusLive UDP error:", e.message)
    liveGlobal.forwardErrors++
  })
  sock.on("message", (buf: Buffer, rinfo: RemoteInfo) => {
    // ------------------------------------------------------------------
    // الحد الأعلى للتنقية هنا: توقيع/إصدار/نوع/طول/مفتاح/عنوان — والفك
    // النهائي في Rust (live_core) — حاجزان متتاليان كما في الجسور القائمة.
    // ------------------------------------------------------------------
    if (buf.length < 22 || buf.length > LIVE_MAX_DATAGRAM) {
      liveGlobal.droppedMalformed++
      return
    }
    if (buf.readUInt16BE(0) !== LIVE_MAGIC || buf[2] !== LIVE_VERSION) {
      liveGlobal.droppedMalformed++
      return
    }
    const ptype = buf[3]
    if (!LIVE_TYPES.has(ptype)) {
      liveGlobal.droppedMalformed++
      return
    }
    const keyHex = buf.subarray(14, 22).toString("hex")
    const flow = liveFlows.get(keyHex)
    if (!flow) {
      liveGlobal.droppedNoKey++
      return
    }
    const addr = `${rinfo.address}:${rinfo.port}`
    if (flow.bound && flow.bound !== addr) {
      liveGlobal.droppedAddr++
      return
    }
    if (!flow.bound) {
      flow.bound = addr
      io2Safe?.emit("rc:log", { id: uid(), text: `التدفق الحي (NexusLive) ارتبط بعنوان ${addr} — ${flow.name}`, kind: "ok", at: Date.now() })
    }
    if (ptype === LIVE_PING) {
      // pong: نفس seq + ts=زمن الجسر (مزامنة إزاحة NTP-نمط عند الهاتف) + نفس المفتاح
      flow.stats.pings++
      const pong = Buffer.from(buf)
      pong[3] = LIVE_PONG
      // قناع 32-بت: >>> 0 حصرًا — عامل & في JS يُعيد Int32 بإشارة سالبة فيكسر
      // writeUInt32BE في نصف نوافذ الزمن (درس §48 نفسه — قنبلة موقّتة أزلناها)
      pong.writeUInt32BE(Date.now() >>> 0, 10)
      sock.send(pong, rinfo.port, rinfo.address, (err) => {
        if (err) liveGlobal.pongErrors++
      })
      return
    }
    liveSeqUpdate(flow, buf.readUInt32BE(6))
    flow.stats.received++
    // إعادة توجيه الحزمة كما هي (بلا تعديل) إلى حوض Rust على loopback حصرًا
    sock.send(buf, LIVE_SINK_PORT, "127.0.0.1", (err) => {
      if (err) {
        liveGlobal.forwardErrors++
      } else {
        flow.stats.forwarded++
      }
    })
  })
  sock.bind(LIVE_UDP_PORT, () => {
    console.log(`[nexus] NexusLive UDP relay on :${LIVE_UDP_PORT} → 127.0.0.1:${LIVE_SINK_PORT}`)
  })
  liveUdp = sock
  // بث إحصاء القناة كل 5ث أثناء نشاطها (unref — لا يحجب الخروج)
  setInterval(() => {
    if (liveFlows.size) io2Safe?.emit("rc:live-stats", liveStatsSnapshot())
  }, 5000).unref?.()
}
// مرجع io الحالي للسوكِتات المساعدة (يضبط عند الإقلاع)
let io2Safe: SocketServer | null = null

const desktop = {
  name: "NEXUS-PC",
  mac: "A4:5E:60:C1:2D:9F",
  power: "on" as string,
}

// ------------------------------------------------------------------
// FA-input (عقد §13) — جلسة التحكم الموثوقة
// ------------------------------------------------------------------
const HB_TIMEOUT_MS = 6000 // انقطاع النبض 6ث → إنهاء تلقائي (watchdog)
interface RcSession {
  active: boolean
  deviceId: string | null
  name: string | null
  socketId: string | null
  at: number
  lastHb: number
}
const session: RcSession = {
  active: false,
  deviceId: null,
  name: null,
  socketId: null,
  at: 0,
  lastHb: 0,
}
// سوكِتات موثوقة: وحدات تحكم مسجلة بهوية موثوقة + واجهات الكمبيوتر نفسها
const controllerTrust = new Map<string, { deviceId: string; name: string }>()
const desktopSocks = new Set<string>()

function sessionInfo() {
  return {
    active: session.active,
    deviceId: session.deviceId,
    name: session.name,
    at: session.at,
  }
}

function endSession(io2: SocketServer | null, reason: string) {
  if (!session.active) return
  const name = session.name
  // الجولة 4 (عقد §18) — القناة الحية ترث عمر الجلسة: حذف تدفقات صاحبها
  dropLiveFlows(session.socketId ?? "", reason)
  session.active = false
  session.deviceId = null
  session.name = null
  session.socketId = null
  session.lastHb = 0
  io2?.emit("rc:session", { active: false, reason, at: Date.now() })
  io2?.emit("rc:log", { id: uid(), text: `انتهت جلسة التحكم (${name ?? "مجهول"}) — السبب: ${reason}`, kind: "info", at: Date.now() })
}

/** بحث جهاز موثوق في السجل — حاجز الثقة (نفس منطق dev:ctl-start في §4.8) */
function isTrustedDevice(deviceId: string | null | undefined): boolean {
  const id = String(deviceId ?? "").trim()
  if (!id) return false
  try {
    const dev = deviceStore().devices.find((d) => d.id === id)
    return !!(dev && dev.trusted)
  } catch {
    return false
  }
}

const RC_INPUT = new Set([
  "rc:move", "rc:click", "rc:scroll", "rc:pinch", "rc:key",
  "rc:gamepad", "rc:presenter", "rc:media", "rc:clipboard",
  "rc:pointer", // FA-media (عقد §15) — مؤشر مطلق على الشاشة المعروضة في الهاتف
])

/**
 * FA-media (عقد §15) — تنقية rc:pointer: إحداثيات مُطبّعة 0..1 (موضع على
 * الشاشة المعروضة في الهاتف) + إجراء من قائمة بيضاء. يعيد حمولة آمنة أو null.
 */
const POINTER_ACTIONS = new Set(["move", "down", "up", "click", "dblclick", "rclick"])
function sanitizePointer(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const nx = Number(data?.nx)
  const ny = Number(data?.ny)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  const action = String(data?.action ?? "move")
  if (!POINTER_ACTIONS.has(action)) return null
  return {
    nx: Math.round(nx * 10000) / 10000,
    ny: Math.round(ny * 10000) / 10000,
    action,
  }
}

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

// watchdog جلسة التحكم — نبض مفقود 6ث → إنهاء تلقائي (حارس السلامة)
setInterval(() => {
  if (session.active && Date.now() - session.lastHb > HB_TIMEOUT_MS) {
    endSession(io, "timeout")
  }
}, 2000).unref?.()

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
  return {
    booted: !!g[BOOT_KEY],
    port: PORT,
    desktop: { ...desktop },
    session: sessionInfo(),
    // الجولة 4 (عقد §18) — حالة القناة الحية (تدفقات + إحصاء إجمالي)
    live: liveStatsSnapshot(),
  }
}

export function ensureRemoteBridge() {
  if (g[BOOT_KEY]) return remoteBridgeStatus()
  g[BOOT_KEY] = true

  try {
    const httpServer = createServer()
    let bindAttempts = 0
    const io2 = new SocketServer(httpServer, {
      path: "/",
      cors: socketCors(), // SEC (M0.3 F4): بديل السماح المفتوح — Origin خارجي يُرفض عند المصافحة
      pingTimeout: 60000,
      pingInterval: 25000,
    })
    io = io2
    io2Safe = io2
    // الجولة 4 (عقد §18) — سوكِت UDP للقناة الحية بجانب WebSocket (dgram نفسه
    // المستورد للـ WoL) — يُقلاع مرة واحدة مع الجسر
    ensureLiveUdp()

    io2.on("connection", (socket) => {
      socket.emit("rc:hello", {
        desktop: { name: desktop.name, mac: desktop.mac, power: desktop.power },
        at: Date.now(),
      })
      // SEC (M1 F9): المحليون في جمهور الحافظة الموجّه — الانضمام بمحلية
      // الجهاز أو هوية موثوقة فقط (عقد §13.ج أدناه للموثوق بهويته).
      if (isLocalSocket(socket.handshake)) socket.join(CLIP_AUD)

      socket.on("rc:hello-controller", (data: { name?: string; deviceId?: string }) => {
        const name = data?.name || "هاتف التحكم"
        // FA-input — تسجيل بهوية (deviceId): يُوثق فقط إن كان في سجل الأجهزة موثوقًا.
        // بلا هوية = متحكم ويبي محاكي (نفس السلوك القائم — بلا تنفيذ أصلي).
        const deviceId = String(data?.deviceId ?? "").trim()
        if (deviceId && isTrustedDevice(deviceId)) {
          controllerTrust.set(socket.id, { deviceId, name })
          socket.join(CLIP_AUD) // SEC (M1 F9): هوية مقترنة → جمهور الحافظة الموجّه
          io2.emit("rc:log", { id: uid(), text: `هاتف تحكم موثوق متصل: ${name} — مسموح له بجلسة التحكم`, kind: "ok", at: Date.now() })
        } else {
          io2.emit("rc:log", { id: uid(), text: `هاتف تحكم متصل: ${name}${deviceId ? " — الهوية غير موثوقة (لا جلسة تحكم)" : ""}`, kind: deviceId ? "err" : "ok", at: Date.now() })
        }
        socket.broadcast.emit("rc:controller-online", { name, at: Date.now() })
      })

      socket.on("desktop:register", (data: { name?: string; mac?: string }) => {
        // SEC (M0.3 F8): دور الكمبيوتر صاحب الجهاز — أحداثه تُنفّذ دائمًا في
        // الطبقة الأصلية — فلا يُمنح إلا لعميل من الجهاز نفسه (loopback عبر
        // البوابة المحلية أو مباشر). سوكِت شبكة ينتحل الدور → رفض مسجّل.
        if (!isLocalSocket(socket.handshake)) {
          socket.emit("rc:rejected", { reason: "local-only", ev: "desktop:register" })
          io2.emit("rc:log", { id: uid(), text: `رفض تسجيل دور الكمبيوتر: العميل من ${realClientIp(socket.handshake)} وليس من الجهاز نفسه`, kind: "err", at: Date.now() })
          return
        }
        if (data?.name) desktop.name = data.name
        if (data?.mac) desktop.mac = data.mac
        // FA-input — سوكِت واجهة الكمبيوتر نفسها (صاحب الجهاز — أحداثه أصلية دائمًا)
        desktopSocks.add(socket.id)
      })

      // FA-input (عقد §13) — دورة حياة جلسة التحكم: start | hb | stop
      socket.on("rc:session", (data: { action?: string; deviceId?: string; name?: string }) => {
        const action = String(data?.action ?? "")
        const isDesktop = desktopSocks.has(socket.id)
        if (action === "start") {
          const deviceId = String(data?.deviceId ?? "").trim()
          const sockDev = controllerTrust.get(socket.id)
          // بوابة الثقة المزدوجة: سوكِت مسجل موثوق، أو هوية موثوقة في السجل
          const trusted =
            (sockDev && (!deviceId || sockDev.deviceId === deviceId)) || isTrustedDevice(deviceId)
          if (!trusted) {
            socket.emit("rc:rejected", { reason: "untrusted", ev: "rc:session" })
            io2.emit("rc:log", { id: uid(), text: `رفض بدء جلسة تحكم: الجهاز غير موثوق (${deviceId || "بلا هوية"})`, kind: "err", at: Date.now() })
            return
          }
          if (session.active && session.deviceId !== deviceId) {
            socket.emit("rc:rejected", { reason: "busy", ev: "rc:session" })
            return
          }
          const dev = deviceId ? deviceStore().devices.find((d) => d.id === deviceId) : null
          session.active = true
          session.deviceId = deviceId || sockDev?.deviceId || null
          session.name = String(data?.name ?? "") || sockDev?.name || dev?.name || "جهاز تحكم"
          session.socketId = socket.id
          session.at = Date.now()
          session.lastHb = Date.now()
          if (session.deviceId) void markFirstValue(session.deviceId, "control") // M1.1 §30: أول قيمة تحكم تُكمل التسييل
          io2.emit("rc:session", { active: true, controller: { deviceId: session.deviceId, name: session.name }, at: session.at })
          io2.emit("rc:log", { id: uid(), text: `بدأت جلسة تحكم بالكمبيوتر من: ${session.name} — إشعار دائم في الشريط والقطع فوري من الطرفين`, kind: "ok", at: Date.now() })
        } else if (action === "hb") {
          if (session.active && session.socketId === socket.id) session.lastHb = Date.now()
        } else if (action === "stop") {
          if (session.active && (session.socketId === socket.id || isDesktop)) {
            endSession(io2, isDesktop && session.socketId !== socket.id ? "desktop-stop" : "phone-stop")
          }
        }
      })

      socket.on("desktop:state", (report: { power?: string }) => {
        // SEC (M0.3 F8): حالة الطاقة تُصدر من دور الكمبيوتر حصرًا — انتحالها
        // من سوكِت شبكة يعطّل الإدخال كله (بوابة gateInput) = حرمان بلا سبب.
        if (!desktopSocks.has(socket.id)) return
        if (report?.power && report.power !== desktop.power) desktop.power = report.power
        socket.broadcast.emit("desktop:state", report)
      })

      socket.on("desktop:clipboard", (data: { text: string; at?: number }) => {
        // SEC (M0.3 F8): دفع الحافظة من دور الكمبيوتر حصرًا — وإلا صار
        // حقن حافظة (نص يظهر على الهاتف كأنه من الكمبيوتر) متاحًا لأي سوكِت.
        if (!desktopSocks.has(socket.id)) return
        // SEC (M1 F9): التسليم موجّه لا عام — نص الحافظة حساس. أثناء جلسة
        // نشطة يصل لوحدة التحكم المقترنة حصرًا (زوج §13)، وإلا لجمهور
        // المحليين/الموثوقين فقط — سوكِت شبكي بلا هوية لا يسمعه إطلاقًا.
        if (session.active && session.socketId) {
          io2.to(session.socketId).emit("desktop:clipboard", data)
        } else {
          io2.to(CLIP_AUD).emit("desktop:clipboard", data)
        }
        io2.emit("rc:log", { id: uid(), text: "تم دفع الحافظة من الكمبيوتر إلى الهاتف", kind: "ok", at: Date.now() })
      })

      socket.on("rc:ping", (data: { t: number }) => {
        socket.emit("rc:pong", { t: data?.t ?? Date.now() })
      })

      // -----------------------------------------------------------------
      // PERF (عقد §29) — تمرير إقرارات قياس استجابة التحكم (مرآة الخدمة
      // المصغّرة حرفيًا — النسختان متطابقتان تعاقديًا): من دور الكمبيوتر
      // حصرًا (حرس F8 — انتحال الدور لإقرارات كاذبة يفسد القياس)، والإقرار
      // بلا محتوى (معرف + طابع + اسم حدث + أزمنة حصرًا) فيُبث كقناة أخبار
      // كrc:log (F6 متوافق: لا بيانات حساسة تُبث).
      // -----------------------------------------------------------------
      socket.on("rc:ack", (data: { mid?: unknown; mt?: unknown; ev?: unknown }) => {
        if (!desktopSocks.has(socket.id)) return
        const mid = String(data?.mid ?? "").slice(0, 64)
        if (!mid) return
        const ev = String(data?.ev ?? "").slice(0, 32)
        const mt = Number(data?.mt) || 0
        io2?.emit("rc:ack", { mid, mt, ev, at: Date.now() })
      })

      // -----------------------------------------------------------------
      // الجولة 4 (عقد §18) — فتح التدفق الحي: هاتف موثوق + جلسة نشطة حصرًا.
      // المفتاح 8B عشوائي لكل تدفق — يرد في rc:live-ready ويلزم حزم UDP،
      // وأول حزمة تحمله تُثبّت عنوان المرسل (رفض ما بعده من عنوان آخر).
      // -----------------------------------------------------------------
      socket.on("rc:live-hello", () => {
        const trust = controllerTrust.get(socket.id)
        if (!trust || !session.active || session.socketId !== socket.id) {
          socket.emit("rc:rejected", { reason: "untrusted", ev: "rc:live-hello" })
          io2.emit("rc:log", { id: uid(), text: "رفض فتح القناة الحية (NexusLive): يتطلب جلسة تحكم نشطة من هاتف موثوق", kind: "err", at: Date.now() })
          return
        }
        // إعادة hello من نفس السوكِت = استبدال تدفقه القديم (إعادة اتصال)
        dropLiveFlows(socket.id, "إعادة فتح")
        const key = randomBytes(8)
        liveFlows.set(key.toString("hex"), {
          key,
          socketId: socket.id,
          deviceId: trust.deviceId,
          name: trust.name,
          bound: null,
          lastSeq: null,
          stats: { received: 0, forwarded: 0, lost: 0, reorder: 0, dup: 0, pings: 0 },
        })
        socket.emit("rc:live-ready", {
          port: LIVE_UDP_PORT,
          key: key.toString("hex"),
          mtu: LIVE_MAX_DATAGRAM,
          proto: LIVE_VERSION,
          at: Date.now(),
        })
        io2.emit("rc:log", { id: uid(), text: `فتح التدفق الحي (NexusLive) لـ ${trust.name} — UDP :${LIVE_UDP_PORT} مفتاح 16-hex`, kind: "ok", at: Date.now() })
      })

      // حالة القناة الحية عند الطلب (استهلاك الواجهات — بلا انتظار البث الدوري)
      socket.on("rc:live-stats?", () => {
        socket.emit("rc:live-stats", liveStatsSnapshot())
      })

      // -----------------------------------------------------------------
      // الجولة 4 مرحلة ② (عقد §20) — تحكم لوحة الرسم: rc:tablet:cmd من هاتف
      // موثوق خلال جلسة نشطة حصرًا (نفس بوابة live-hello) → الكمبيوتر ينفّذ
      // ويبث rc:tablet:state من دوره حصرًا. التنقية هنا (§20.ج): الحقول
      // المرسلة حصرًا والفاسد يُرفض كله — لا جزئيات.
      // -----------------------------------------------------------------
      socket.on("rc:tablet:cmd", (data: Record<string, unknown>) => {
        const trust = controllerTrust.get(socket.id)
        if (!trust || !session.active || session.socketId !== socket.id) {
          socket.emit("rc:rejected", { reason: "untrusted", ev: "rc:tablet:cmd" })
          return
        }
        const cmd = String(data?.cmd ?? "")
        if (cmd !== "get" && cmd !== "set") return
        const payload: Record<string, unknown> = { cmd }
        if (cmd === "set") {
          const mode = data.mode
          if (mode !== undefined && mode !== "mouse" && mode !== "tablet") return
          if (mode !== undefined) payload.mode = mode
          const pressure = data.pressure
          if (pressure !== undefined && !["off", "keys", "scroll"].includes(String(pressure))) return
          if (pressure !== undefined) payload.pressure = pressure
          for (const k of ["decKey", "incKey"] as const) {
            const v = data[k]
            if (v === undefined) continue
            const s = String(v)
            if (s.length !== 1 || s.charCodeAt(0) < 33 || s.charCodeAt(0) > 126) return
            payload[k] = s
          }
          if (data.levels !== undefined) {
            const n = Number(data.levels)
            if (!Number.isInteger(n) || n < 2 || n > 64) return
            payload.levels = n
          }
          const modifier = data.modifier
          if (modifier !== undefined && !["none", "ctrl", "alt", "shift"].includes(String(modifier))) return
          if (modifier !== undefined) payload.modifier = modifier
        }
        io2.emit("rc:tablet:cmd", { ...payload, __src: "controller" })
      })

      socket.on("rc:tablet:state", (data: Record<string, unknown>) => {
        // من دور الكمبيوتر حصرًا — الهاتف لا يصدر حالة (نمط secondscreen:state §19)
        if (!desktopSocks.has(socket.id)) return
        io2.emit("rc:tablet:state", data)
      })

      // -----------------------------------------------------------------
      // الجولة 4 مرحلة ③ (عقد §21) — التحكم المتقدم (جيمباد الحساسات /
      // الماوس الهوائي المعاير / عارض العروض): rc:gyro:cmd من هاتف موثوق
      // خلال جلسة نشطة حصرًا (بوابة live-hello نفسها — نمط tablet §20.ج).
      // التنقية هنا: الحقول المرسلة حصرًا والفاسد يُرفض كله — لا جزئيات.
      // -----------------------------------------------------------------
      socket.on("rc:gyro:cmd", (data: Record<string, unknown>) => {
        const trust = controllerTrust.get(socket.id)
        if (!trust || !session.active || session.socketId !== socket.id) {
          socket.emit("rc:rejected", { reason: "untrusted", ev: "rc:gyro:cmd" })
          return
        }
        const cmd = String(data?.cmd ?? "")
        if (cmd !== "get" && cmd !== "set") return
        const payload: Record<string, unknown> = { cmd }
        if (cmd === "set") {
          const mode = data.mode
          if (mode !== undefined && !["off", "gamepad", "airmouse", "presenter"].includes(String(mode))) return
          if (mode !== undefined) payload.mode = mode
          const template = data.template
          if (template !== undefined && !["platformer", "racing", "fighting", "custom"].includes(String(template))) return
          if (template !== undefined) payload.template = template
          for (const [k, lo, hi] of [
            ["deadzoneDeg", 5, 45], ["sens", 0.5, 5], ["shakeDegS", 3, 30], ["tiltDeg", 10, 60],
          ] as const) {
            const v = data[k]
            if (v === undefined) continue
            const n = Number(v)
            if (!Number.isFinite(n) || n < lo || n > hi) return
            payload[k] = n
          }
          const laser = data.laser
          if (laser !== undefined && typeof laser !== "boolean") return
          if (laser !== undefined) payload.laser = laser
          const calibrate = data.calibrate
          if (calibrate !== undefined && typeof calibrate !== "boolean") return
          if (calibrate !== undefined) payload.calibrate = calibrate
          const NAMED_GYRO_KEYS = ["up", "down", "left", "right", "space", "enter", "esc", "tab", "shift", "ctrl", "pageup", "pagedown", "home", "end", "f5", "f11"]
          for (const k of ["keyA", "keyB", "keyX", "keyY", "keyL", "keyR"] as const) {
            const v = data[k]
            if (v === undefined) continue
            const s = String(v)
            // المسافة مفتاح ألعاب صالح (قفز/فرامل) — المحرف المرئي 33..126 أو مسافة واحدة
            const okSingle = s.length === 1 && (s === " " || (s.charCodeAt(0) >= 33 && s.charCodeAt(0) <= 126))
            if (!okSingle && !NAMED_GYRO_KEYS.includes(s.trim().toLowerCase())) return
            payload[k] = s
          }
        }
        io2.emit("rc:gyro:cmd", { ...payload, __src: "controller" })
      })

      socket.on("rc:gyro:state", (data: Record<string, unknown>) => {
        // من دور الكمبيوتر حصرًا — الهاتف لا يصدر حالة (نمط tablet:state §20)
        if (!desktopSocks.has(socket.id)) return
        io2.emit("rc:gyro:state", data)
      })

      for (const ev of RC_INPUT) {
        socket.on(ev, (data: Record<string, unknown>) => {
          if (!gateInput(socket, ev)) return
          // FA-media (عقد §15) — rc:pointer يُنقّى حرفيًا قبل البث (إحداثيات
          // مُطبّعة + إجراء معروف) — الرفض الصامت للفاسد دون قطع القناة
          if (ev === "rc:pointer") {
            const ptr = sanitizePointer(data)
            if (!ptr) return
            data = ptr
          }
          // FA-input — حقن مصدر الحدث: desktop (واجهة الكمبيوتر) / controller
          // (هاتف موثوق) / unknown — الطبقة الأصلية ترفض unknown ولا تنفذ
          // إلا أحداث وحدة تحكم موثوقة خلال جلسة نشطة (أو واجهة الكمبيوتر نفسها).
          const src = desktopSocks.has(socket.id)
            ? "desktop"
            : controllerTrust.has(socket.id)
              ? "controller"
              : "unknown"
          const payload = { ...(data ?? {}), __src: src }
          if (ev === "rc:click") {
            const b = data?.button === "right" ? "أيمن" : "أيسر"
            io2.emit("rc:log", { id: uid(), text: `نقرة ${b} من لوحة لمس الهاتف`, kind: "in", at: Date.now() })
          } else if (ev === "rc:key" && data?.special) {
            io2.emit("rc:log", { id: uid(), text: `مفتاح خاص من الهاتف: ${String(data.special)}`, kind: "in", at: Date.now() })
          } else if (ev === "rc:presenter") {
            const a = data?.action as string
            const text = a === "next" ? "عرض تقديمي: الشريحة التالية ←"
              : a === "prev" ? "عرض تقديمي: → الشريحة السابقة"
              : a === "start" ? "عرض تقديمي: بدء العرض (F5)" // FA-input (عقد §13)
              : a === "stop" ? "عرض تقديمي: إنهاء العرض (Esc)" // FA-input
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
          io2.emit(ev, payload)
        })
      }

      socket.on("disconnect", () => {
        // FA-input — انقطاع سوكِت صاحب الجلسة ينهيها دائمًا (قاعدة §4.8)
        if (session.active && session.socketId === socket.id) endSession(io2, "disconnected")
        // الجولة 4 (عقد §18) — تدفقات القناة الحية تموت مع سوكِتها
        dropLiveFlows(socket.id, "انقطاع السوكِت")
        controllerTrust.delete(socket.id)
        desktopSocks.delete(socket.id)
      })

      socket.on("rc:power", (data: { action: string }) => {
        // SEC (M0.3 F1): أوامر النظام/الطاقة تُنفّذ فعليًا في الطبقة الأصلية —
        // كانت تُرحّل بلا بوابة (بلا __src) فيكفي سوكِت شبكة واحد لإغلاق
        // الكمبيوتر. العقد الجديد: desktop (صاحب الجهاز) أو controller
        // (هاتف موثوق — نفس بوابة RC_INPUT §13) — المجهول يُرفض هنا ولا يُرحّل.
        const src = desktopSocks.has(socket.id)
          ? "desktop"
          : controllerTrust.has(socket.id)
            ? "controller"
            : "unknown"
        if (src === "unknown") {
          socket.emit("rc:rejected", { reason: "untrusted", ev: "rc:power" })
          io2.emit("rc:log", { id: uid(), text: "رفض أمر نظام: المصدر غير موثوق (يتطلب هاتف مقترن أو واجهة الكمبيوتر)", kind: "err", at: Date.now() })
          return
        }
        const action = data?.action
        const label = POWER_AR_ACTION[action] ?? action
        if (desktop.power === "off" && action !== "unlock") {
          socket.emit("rc:rejected", { reason: "off", ev: "rc:power" })
          return
        }
        io2.emit("rc:log", { id: uid(), text: `أمر نظام من الهاتف: ${label}`, kind: "in", at: Date.now() })
        io2.emit("rc:power", { ...(data ?? {}), __src: src })
        if (action === "shutdown" || action === "restart") desktop.power = "shutting-down"
        else if (action === "sleep") desktop.power = "sleeping"
        else if (action === "hibernate") desktop.power = "shutting-down"
        else if (action === "lock") desktop.power = "locked"
        else if (action === "unlock") desktop.power = "on"
        else if (action === "logout") desktop.power = "locked" // شاشة الدخول = جلسة مقفلة
      })

      socket.on("rc:wol", (data: { mac: string }) => {
        // SEC (M0.3 F1): إيقاظ الكمبيوتر من هاتف موثوق/واجهة الكمبيوتر حصرًا
        // (نفس بوابة rc:power) — وإلا صار إرسال حزم broadcast من أداة شبكية.
        const src = desktopSocks.has(socket.id)
          ? "desktop"
          : controllerTrust.has(socket.id)
            ? "controller"
            : "unknown"
        if (src === "unknown") {
          socket.emit("rc:rejected", { reason: "untrusted", ev: "rc:wol" })
          io2.emit("rc:log", { id: uid(), text: "رفض Wake-on-LAN: المصدر غير موثوق (يتطلب هاتف مقترن أو واجهة الكمبيوتر)", kind: "err", at: Date.now() })
          return
        }
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
        io2.emit("desktop:wake", { source: "wol", mac: norm, packet: hex, __src: src })
      })

      // ==== FA-9: "أكمل من حيث توقفت" — رابط من الهاتف يُفتح على الكمبيوتر ====
      socket.on("rc:handoff", (data: { url?: string; title?: string }) => {
        // SEC (M0.3 F1): فتح روابط على كمبيوتر المستخدم من هاتف مقترن أو
        // واجهة الكمبيوتر حصرًا — وإلا صار متاحًا كأداة تصيّد من أي سوكِت شبكة.
        const trusted = desktopSocks.has(socket.id) || controllerTrust.has(socket.id)
        if (!trusted) {
          socket.emit("rc:rejected", { reason: "untrusted", ev: "rc:handoff" })
          io2.emit("rc:log", { id: uid(), text: "رفض تسليم رابط: المصدر غير موثوق (يتطلب هاتف مقترن أو واجهة الكمبيوتر)", kind: "err", at: Date.now() })
          return
        }
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
