// NexusLink — جسر التحكم عن بُعد (المرحلة 6: الهاتف يتحكم بالكمبيوتر)
// ============================================================
// خدمة مستقلة (socket.io, port 3004) تنقل أحداث الإدخال من الهاتف
// إلى الكمبيوتر عبر Nexus Protocol: لوحة اللمس، لوحة المفاتيح،
// الماوس الهوائي (الجيروسكوب)، يد الألعاب، جهاز العروض، الوسائط،
// أوامر النظام + Wake-on-LAN، ومزامنة الحافظة المشتركة.
import { createServer } from 'http'
import { createSocket, Socket as UdpSocket, RemoteInfo } from 'dgram'
import { randomBytes } from 'crypto'
import { Server } from 'socket.io'

const PORT = 3004

// ---------------------------------------------------------------------------
// SEC (M0.3 — docs/security-audit.md) — حارس المآخذ: CORS + IP العميل الحقيقي
// (مرآة src/lib/nexus/socket-security.ts — الخدمة المستقلة بلا استيراد من src)
// ---------------------------------------------------------------------------
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"])
function originAllowed(origin: string | undefined): boolean {
  const o = String(origin ?? "").trim()
  if (!o) return true // عميل أصلي (Flutter/Node/E2E) — بلا ترويسة Origin
  let u: URL
  try { u = new URL(o) } catch { return false }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false
  const host = u.hostname.toLowerCase()
  if (LOOPBACK.has(host) || host.endsWith(".local")) return true
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 192) return true
    if (a === 172 && b >= 16 && b <= 31) return true
  }
  if (host.startsWith("::ffff:")) return true
  return false
}
const CORS_ALLOWED = {
  origin: (o: string | undefined, cb: (e: Error | null, ok: boolean) => void) => cb(null, originAllowed(o)),
  methods: ["GET", "POST"],
}
interface GwHandshake { address?: string; headers?: Record<string, string | string[] | undefined> }
function realClientIp(hs: GwHandshake): string {
  const remote = String(hs?.address ?? "").replace(/^::ffff:/, "")
  if (LOOPBACK.has(remote)) {
    const fwd = String(hs?.headers?.["x-gw-client-ip"] ?? "").trim().replace(/^::ffff:/, "")
    return fwd || "127.0.0.1"
  }
  return remote
}
function isLocalSocket(hs: GwHandshake): boolean {
  return LOOPBACK.has(realClientIp(hs))
}

// ---------- حالة الكمبيوتر المسجلة ----------
const desktop = {
  name: 'NEXUS-PC',
  mac: 'A4:5E:60:C1:2D:9F',
  power: 'on' as string, // يُحدَّث من تقارير desktop:state
}

// ------------------------------------------------------------------
// FA-input (عقد §13) — جلسة التحكم الموثوقة
// الخدمة المستقلة بلا سجل أجهزة (Prisma) — قائمة الثقة من البيئة:
// NEXUS_TRUSTED_DEVICES="galaxy-s24,abc123" (CSV). فارغة = لا جلسات.
// (الجسر المدمج في Next هو المصدر المعتمد في الحزمة الحقيقية)
// ------------------------------------------------------------------
const TRUSTED = new Set(
  (process.env.NEXUS_TRUSTED_DEVICES || '').split(',').map((s) => s.trim()).filter(Boolean),
)
const HB_TIMEOUT_MS = 6000
interface RcSession {
  active: boolean
  deviceId: string | null
  name: string | null
  socketId: string | null
  at: number
  lastHb: number
}
const session: RcSession = { active: false, deviceId: null, name: null, socketId: null, at: 0, lastHb: 0 }
const controllerTrust = new Map<string, { deviceId: string; name: string }>()
const desktopSocks = new Set<string>()

function endSession(reason: string) {
  if (!session.active) return
  const name = session.name
  // الجولة 4 (عقد §18) — القناة الحية ترث عمر الجلسة
  dropLiveFlows(session.socketId ?? '', reason)
  session.active = false
  session.deviceId = null
  session.name = null
  session.socketId = null
  session.lastHb = 0
  io?.emit('rc:session', { active: false, reason, at: Date.now() })
  rcLog(`انتهت جلسة التحكم (${name ?? 'مجهول'}) — السبب: ${reason}`, 'info')
}

// watchdog الجلسة — نبض مفقود 6ث → إنهاء تلقائي
setInterval(() => {
  if (session.active && Date.now() - session.lastHb > HB_TIMEOUT_MS) endSession('timeout')
}, 2000).unref?.()

let io: Server
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const POWER_AR: Record<string, string> = {
  on: 'يعمل',
  'shutting-down': 'جارٍ الإيقاف',
  off: 'مطفأ',
  booting: 'إقلاع',
  sleeping: 'سكون',
  hibernating: 'إسبات',
  locked: 'مقفل',
}

// أحداث الإدخال المنقولة (هاتف → كمبيوتر)
const RC_INPUT = new Set([
  'rc:move', 'rc:click', 'rc:scroll', 'rc:pinch', 'rc:key',
  'rc:gamepad', 'rc:presenter', 'rc:media', 'rc:clipboard',
  'rc:pointer', // FA-media (عقد §15) — مؤشر مطلق على الشاشة المعروضة في الهاتف
])

/**
 * FA-media (عقد §15) — تنقية rc:pointer (مطابقة للجسر المدمج):
 * إحداثيات مطبّعة 0..1 + إجراء من قائمة بيضاء — null = رفض صامت.
 */
const POINTER_ACTIONS = new Set(['move', 'down', 'up', 'click', 'dblclick', 'rclick'])
function sanitizePointer(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const nx = Number(data?.nx)
  const ny = Number(data?.ny)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  const action = String(data?.action ?? 'move')
  if (!POINTER_ACTIONS.has(action)) return null
  return {
    nx: Math.round(nx * 10000) / 10000,
    ny: Math.round(ny * 10000) / 10000,
    action,
  }
}

// أسماء أوامر النظام للسجل
const POWER_AR_ACTION: Record<string, string> = {
  shutdown: 'إيقاف التشغيل',
  restart: 'إعادة التشغيل',
  sleep: 'السكون',
  hibernate: 'الإسبات',
  lock: 'قفل الشاشة',
  unlock: 'فتح القفل',
  logout: 'تسجيل الخروج', // FA-power (عقد §12)
}

/**
 * FA-power — إرسال حزمة Wake-on-LAN السحرية فعليًا عبر UDP broadcast
 * (نفس منطق src/lib/nexus/remote-bridge.ts — النسختان متطابقتان تعاقديًا).
 * NEXUS_WOL_BROADCAST = الوجهات (افتراضي 255.255.255.255) ·
 * NEXUS_WOL_PORT = المنفذ (افتراضي 9 التعاقدي — يُبدّل في الاختبار).
 */
function sendWolPacket(macNorm: string, cb: (ok: boolean, detail: string) => void) {
  const pkt = Buffer.from('FFFFFFFFFFFF' + macNorm.replace(/:/g, '').repeat(16), 'hex')
  const targets = (process.env.NEXUS_WOL_BROADCAST || '255.255.255.255')
    .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4)
  const port = Number(process.env.NEXUS_WOL_PORT || 9) || 9
  if (!targets.length) {
    cb(false, 'لا وجهات broadcast')
    return
  }
  const sock = createSocket({ type: 'udp4', reuseAddr: true })
  let done = false
  const finish = (ok: boolean, detail: string) => {
    if (done) return
    done = true
    try { sock.close() } catch { /* مغلق بالفعل */ }
    cb(ok, detail)
  }
  sock.on('error', (e) => finish(false, `socket: ${e.message}`))
  sock.bind(() => {
    try { sock.setBroadcast(true) } catch { /* محجوب — نكمل */ }
    let pending = targets.length
    let sent = 0
    for (const t of targets) {
      sock.send(pkt, port, t, (err) => {
        if (!err) sent++
        if (--pending === 0) {
          finish(sent > 0, `${sent}/${targets.length} وجهة → ${targets.join(',')}:${port} (${pkt.length} بايت)`)
        }
      })
    }
  })
}

function rcLog(text: string, kind: 'in' | 'ok' | 'info' = 'in') {
  io?.emit('rc:log', { id: uid(), text, kind, at: Date.now() })
  console.log('[rc]', text)
}

// ---------------------------------------------------------------------------
// الجولة 4 (عقد §18) — NexusLive: قناة UDP عالية التردد للإدخال الحي
// (مرآة حرفية لمنطق src/lib/nexus/remote-bridge.ts — النسختان متطابقتان تعاقديًا)
// ---------------------------------------------------------------------------
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

function dropLiveFlows(socketId: string, reason: string) {
  for (const [k, f] of liveFlows) {
    if (f.socketId === socketId) {
      liveFlows.delete(k)
      rcLog(`انتهى التدفق الحي (NexusLive) لـ ${f.name} — ${reason}`, 'info')
    }
  }
}

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

function ensureLiveUdp() {
  if (liveUdp) return
  const sock = createSocket({ type: 'udp4', reuseAddr: false })
  sock.on('error', (e) => {
    console.error('[rc] NexusLive UDP error:', e.message)
    liveGlobal.forwardErrors++
  })
  sock.on('message', (buf: Buffer, rinfo: RemoteInfo) => {
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
    const keyHex = buf.subarray(14, 22).toString('hex')
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
      rcLog(`التدفق الحي (NexusLive) ارتبط بعنوان ${addr} — ${flow.name}`, 'ok')
    }
    if (ptype === LIVE_PING) {
      flow.stats.pings++
      const pong = Buffer.from(buf)
      pong[3] = LIVE_PONG
      pong.writeUInt32BE(Date.now() & 0xffffffff, 10)
      sock.send(pong, rinfo.port, rinfo.address, (err) => {
        if (err) liveGlobal.pongErrors++
      })
      return
    }
    liveSeqUpdate(flow, buf.readUInt32BE(6))
    flow.stats.received++
    sock.send(buf, LIVE_SINK_PORT, '127.0.0.1', (err) => {
      if (err) {
        liveGlobal.forwardErrors++
      } else {
        flow.stats.forwarded++
      }
    })
  })
  sock.bind(LIVE_UDP_PORT, () => {
    console.log(`[rc] NexusLive UDP relay on :${LIVE_UDP_PORT} → 127.0.0.1:${LIVE_SINK_PORT}`)
  })
  liveUdp = sock
  setInterval(() => {
    if (liveFlows.size) io?.emit('rc:live-stats', liveStatsSnapshot())
  }, 5000).unref?.()
}

// هل الإدخال مسموح حسب حالة الطاقة؟
function gateInput(socket: { emit: (ev: string, d?: unknown) => void }, data: { __kind?: string } | undefined, ev: string): boolean {
  if (desktop.power === 'off' || desktop.power === 'hibernating') {
    socket.emit('rc:rejected', { reason: desktop.power === 'off' ? 'off' : 'hibernating', ev })
    return false
  }
  // الاستيقاظ من السكون بأي إدخال من الهاتف
  if (desktop.power === 'sleeping') {
    desktop.power = 'on'
    io?.emit('desktop:wake', { source: 'input', ev })
    rcLog('استيقظ الكمبيوتر من السكون بسبب إدخال من الهاتف', 'ok')
  }
  return true
}

// ---------- خادم socket.io ----------
const httpServer = createServer()
io = new Server(httpServer, {
  path: '/',
  cors: CORS_ALLOWED, // SEC (M0.3 F4): بديل السماح المفتوح — Origin خارجي يُرفض عند المصافحة
  pingTimeout: 60000,
  pingInterval: 25000,
})
// الجولة 4 (عقد §18) — سوكِت UDP للقناة الحية بجانب WebSocket
ensureLiveUdp()

io.on('connection', (socket) => {
  console.log('client connected:', socket.id)
  socket.emit('rc:hello', {
    desktop: { name: desktop.name, mac: desktop.mac, power: desktop.power },
    at: Date.now(),
  })

  // ==== تسجيل الطرفين ====
  socket.on('rc:hello-controller', (data: { name?: string; deviceId?: string }) => {
    const name = data?.name || 'هاتف التحكم'
    // FA-input — توثيق وحدة التحكم فقط بهوية موجودة في قائمة الثقة
    const deviceId = String(data?.deviceId ?? '').trim()
    if (deviceId && TRUSTED.has(deviceId)) {
      controllerTrust.set(socket.id, { deviceId, name })
      rcLog(`هاتف تحكم موثوق متصل: ${name} — مسموح له بجلسة التحكم`, 'ok')
    } else {
      rcLog(`هاتف تحكم متصل: ${name}${deviceId ? ' — الهوية غير موثوقة (لا جلسة تحكم)' : ''}`, deviceId ? 'info' : 'ok')
    }
    socket.broadcast.emit('rc:controller-online', { name, at: Date.now() })
  })

  socket.on('desktop:register', (data: { name?: string; mac?: string }) => {
    // SEC (M0.3 F8): دور الكمبيوتر (أحداثه تُنفّذ دائمًا) — لعميل محلي حصرًا
    if (!isLocalSocket(socket.handshake as unknown as GwHandshake)) {
      socket.emit('rc:rejected', { reason: 'local-only', ev: 'desktop:register' })
      rcLog(`رفض تسجيل دور الكمبيوتر: العميل من ${realClientIp(socket.handshake as unknown as GwHandshake)} وليس من الجهاز نفسه`, 'info')
      return
    }
    if (data?.name) desktop.name = data.name
    if (data?.mac) desktop.mac = data.mac
    desktopSocks.add(socket.id) // FA-input — واجهة الكمبيوتر نفسها
    console.log('desktop registered:', desktop.name, desktop.mac)
  })

  // ==== FA-input — دورة حياة جلسة التحكم (مطابق للجسر المدمج) ====
  socket.on('rc:session', (data: { action?: string; deviceId?: string; name?: string }) => {
    const action = String(data?.action ?? '')
    const isDesktop = desktopSocks.has(socket.id)
    if (action === 'start') {
      const deviceId = String(data?.deviceId ?? '').trim()
      const sockDev = controllerTrust.get(socket.id)
      const trusted =
        (sockDev && (!deviceId || sockDev.deviceId === deviceId)) || (!!deviceId && TRUSTED.has(deviceId))
      if (!trusted) {
        socket.emit('rc:rejected', { reason: 'untrusted', ev: 'rc:session' })
        rcLog(`رفض بدء جلسة تحكم: الجهاز غير موثوق (${deviceId || 'بلا هوية'})`, 'info')
        return
      }
      if (session.active && session.deviceId !== deviceId) {
        socket.emit('rc:rejected', { reason: 'busy', ev: 'rc:session' })
        return
      }
      session.active = true
      session.deviceId = deviceId || sockDev?.deviceId || null
      session.name = String(data?.name ?? '') || sockDev?.name || 'جهاز تحكم'
      session.socketId = socket.id
      session.at = Date.now()
      session.lastHb = Date.now()
      io?.emit('rc:session', { active: true, controller: { deviceId: session.deviceId, name: session.name }, at: session.at })
      rcLog(`بدأت جلسة تحكم بالكمبيوتر من: ${session.name}`, 'ok')
    } else if (action === 'hb') {
      if (session.active && session.socketId === socket.id) session.lastHb = Date.now()
    } else if (action === 'stop') {
      if (session.active && (session.socketId === socket.id || isDesktop)) {
        endSession(isDesktop && session.socketId !== socket.id ? 'desktop-stop' : 'phone-stop')
      }
    }
  })

  // ==== تقارير حالة الكمبيوتر → بث للهواتف ====
  socket.on('desktop:state', (report: { power?: string }) => {
    // SEC (M0.3 F8): من دور الكمبيوتر حصرًا — انتحالها يعطّل الإدخال كله
    if (!desktopSocks.has(socket.id)) return
    if (report?.power && report.power !== desktop.power) {
      desktop.power = report.power
      console.log('desktop power:', desktop.power)
    }
    socket.broadcast.emit('desktop:state', report)
  })

  // ==== دفع الحافظة من الكمبيوتر إلى الهاتف ====
  socket.on('desktop:clipboard', (data: { text: string; at?: number }) => {
    // SEC (M0.3 F8): من دور الكمبيوتر حصرًا — منع حقن الحافظة من الشبكة
    if (!desktopSocks.has(socket.id)) return
    rcLog('تم دفع الحافظة من الكمبيوتر إلى الهاتف', 'ok')
    socket.broadcast.emit('desktop:clipboard', data)
  })

  // ==== قناة أخبار قياس زمن الاستجابة ====
  socket.on('rc:ping', (data: { t: number }) => {
    socket.emit('rc:pong', { t: data?.t ?? Date.now() })
  })

  // ---------------------------------------------------------------------------
  // الجولة 4 (عقد §18) — فتح التدفق الحي (مرآة الجسر المدمج حرفيًا):
  // هاتف موثوق + جلسة نشطة حصرًا — مفتاح 8B عشوائي يرد في rc:live-ready
  // ---------------------------------------------------------------------------
  socket.on('rc:live-hello', () => {
    const trust = controllerTrust.get(socket.id)
    if (!trust || !session.active || session.socketId !== socket.id) {
      socket.emit('rc:rejected', { reason: 'untrusted', ev: 'rc:live-hello' })
      rcLog('رفض فتح القناة الحية (NexusLive): يتطلب جلسة تحكم نشطة من هاتف موثوق', 'info')
      return
    }
    dropLiveFlows(socket.id, 'إعادة فتح')
    const key = randomBytes(8)
    liveFlows.set(key.toString('hex'), {
      key,
      socketId: socket.id,
      deviceId: trust.deviceId,
      name: trust.name,
      bound: null,
      lastSeq: null,
      stats: { received: 0, forwarded: 0, lost: 0, reorder: 0, dup: 0, pings: 0 },
    })
    socket.emit('rc:live-ready', {
      port: LIVE_UDP_PORT,
      key: key.toString('hex'),
      mtu: LIVE_MAX_DATAGRAM,
      proto: LIVE_VERSION,
      at: Date.now(),
    })
    rcLog(`فتح التدفق الحي (NexusLive) لـ ${trust.name} — UDP :${LIVE_UDP_PORT} مفتاح 16-hex`, 'ok')
  })

  socket.on('rc:live-stats?', () => {
    socket.emit('rc:live-stats', liveStatsSnapshot())
  })

  // ---------------------------------------------------------------------------
  // الجولة 4 مرحلة ② (عقد §20) — تحكم لوحة الرسم (مرآة الجسر المدمج حرفيًا):
  // rc:tablet:cmd من هاتف موثوق خلال جلسة نشطة حصرًا — نفس تنقية §20.ج
  // (الفاسد يُرفض كله) — وrc:tablet:state من دور الكمبيوتر حصرًا.
  // ---------------------------------------------------------------------------
  socket.on('rc:tablet:cmd', (data: Record<string, unknown>) => {
    const trust = controllerTrust.get(socket.id)
    if (!trust || !session.active || session.socketId !== socket.id) {
      socket.emit('rc:rejected', { reason: 'untrusted', ev: 'rc:tablet:cmd' })
      rcLog('رفض أوامر لوحة الرسم: يتطلب جلسة تحكم نشطة من هاتف موثوق', 'info')
      return
    }
    const cmd = String(data?.cmd ?? '')
    if (cmd !== 'get' && cmd !== 'set') return
    const payload: Record<string, unknown> = { cmd }
    if (cmd === 'set') {
      const mode = data.mode
      if (mode !== undefined && mode !== 'mouse' && mode !== 'tablet') return
      if (mode !== undefined) payload.mode = mode
      const pressure = data.pressure
      if (pressure !== undefined && !['off', 'keys', 'scroll'].includes(String(pressure))) return
      if (pressure !== undefined) payload.pressure = pressure
      for (const k of ['decKey', 'incKey'] as const) {
        const v = data[k]
        if (v === undefined) continue
        const sv = String(v)
        if (sv.length !== 1 || sv.charCodeAt(0) < 33 || sv.charCodeAt(0) > 126) return
        payload[k] = sv
      }
      if (data.levels !== undefined) {
        const n = Number(data.levels)
        if (!Number.isInteger(n) || n < 2 || n > 64) return
        payload.levels = n
      }
      const modifier = data.modifier
      if (modifier !== undefined && !['none', 'ctrl', 'alt', 'shift'].includes(String(modifier))) return
      if (modifier !== undefined) payload.modifier = modifier
    }
    io.emit('rc:tablet:cmd', { ...payload, __src: 'controller' })
  })

  socket.on('rc:tablet:state', (data: Record<string, unknown>) => {
    // من دور الكمبيوتر حصرًا — الهاتف لا يصدر حالة (نمط §19)
    if (!desktopSocks.has(socket.id)) return
    io.emit('rc:tablet:state', data)
  })

  // ---------------------------------------------------------------------------
  // الجولة 4 مرحلة ③ (عقد §21) — التحكم المتقدم (مرآة الجسر المدمج حرفيًا):
  // rc:gyro:cmd من هاتف موثوق خلال جلسة نشطة حصرًا — نفس تنقية §21.ج
  // (الفاسد يُرفض كله) — وrc:gyro:state من دور الكمبيوتر حصرًا.
  // ---------------------------------------------------------------------------
  socket.on('rc:gyro:cmd', (data: Record<string, unknown>) => {
    const trust = controllerTrust.get(socket.id)
    if (!trust || !session.active || session.socketId !== socket.id) {
      socket.emit('rc:rejected', { reason: 'untrusted', ev: 'rc:gyro:cmd' })
      rcLog('رفض أوامر التحكم المتقدم: يتطلب جلسة تحكم نشطة من هاتف موثوق', 'info')
      return
    }
    const cmd = String(data?.cmd ?? '')
    if (cmd !== 'get' && cmd !== 'set') return
    const payload: Record<string, unknown> = { cmd }
    if (cmd === 'set') {
      const mode = data.mode
      if (mode !== undefined && !['off', 'gamepad', 'airmouse', 'presenter'].includes(String(mode))) return
      if (mode !== undefined) payload.mode = mode
      const template = data.template
      if (template !== undefined && !['platformer', 'racing', 'fighting', 'custom'].includes(String(template))) return
      if (template !== undefined) payload.template = template
      for (const [k, lo, hi] of [
        ['deadzoneDeg', 5, 45], ['sens', 0.5, 5], ['shakeDegS', 3, 30], ['tiltDeg', 10, 60],
      ] as const) {
        const v = data[k]
        if (v === undefined) continue
        const n = Number(v)
        if (!Number.isFinite(n) || n < lo || n > hi) return
        payload[k] = n
      }
      const laser = data.laser
      if (laser !== undefined && typeof laser !== 'boolean') return
      if (laser !== undefined) payload.laser = laser
      const calibrate = data.calibrate
      if (calibrate !== undefined && typeof calibrate !== 'boolean') return
      if (calibrate !== undefined) payload.calibrate = calibrate
      const NAMED_GYRO_KEYS = ['up', 'down', 'left', 'right', 'space', 'enter', 'esc', 'tab', 'shift', 'ctrl', 'pageup', 'pagedown', 'home', 'end', 'f5', 'f11']
      for (const k of ['keyA', 'keyB', 'keyX', 'keyY', 'keyL', 'keyR'] as const) {
        const v = data[k]
        if (v === undefined) continue
        const sv = String(v)
        // المسافة مفتاح ألعاب صالح (قفز/فرامل) — المحرف المرئي 33..126 أو مسافة واحدة
        const okSingle = sv.length === 1 && (sv === ' ' || (sv.charCodeAt(0) >= 33 && sv.charCodeAt(0) <= 126))
        if (!okSingle && !NAMED_GYRO_KEYS.includes(sv.trim().toLowerCase())) return
        payload[k] = sv
      }
    }
    io.emit('rc:gyro:cmd', { ...payload, __src: 'controller' })
  })

  socket.on('rc:gyro:state', (data: Record<string, unknown>) => {
    // من دور الكمبيوتر حصرًا — الهاتف لا يصدر حالة (نمط §20)
    if (!desktopSocks.has(socket.id)) return
    io.emit('rc:gyro:state', data)
  })

  // ==== نقل أحداث الإدخال مع بوابة الطاقة ====
  for (const ev of RC_INPUT) {
    socket.on(ev, (data: Record<string, unknown>) => {
      if (!gateInput(socket, data, ev)) return
      // FA-media (عقد §15) — rc:pointer يُنقّى حرفيًا قبل البث (كالجسر المدمج)
      if (ev === 'rc:pointer') {
        const ptr = sanitizePointer(data)
        if (!ptr) return
        data = ptr
      }
      // FA-input — حقن مصدر الحدث (نفس الجسر المدمج — عقد §13)
      const src = desktopSocks.has(socket.id)
        ? 'desktop'
        : controllerTrust.has(socket.id)
          ? 'controller'
          : 'unknown'
      const payload = { ...(data ?? {}), __src: src }
      // سجل انتقائي (الأحداث المتكررة مثل الحركة لا تُسجل)
      if (ev === 'rc:click') {
        const b = data?.button === 'right' ? 'أيمن' : 'أيسر'
        rcLog(`نقرة ${b} من لوحة لمس الهاتف`)
      } else if (ev === 'rc:key') {
        const special = data?.special as string | undefined
        if (special) rcLog(`مفتاح خاص من الهاتف: ${special}`)
      } else if (ev === 'rc:presenter') {
        const a = data?.action as string
        if (a === 'next') rcLog('عرض تقديمي: الشريحة التالية ←', 'in')
        else if (a === 'prev') rcLog('عرض تقديمي: → الشريحة السابقة', 'in')
        else if (a === 'start') rcLog('عرض تقديمي: بدء العرض (F5)', 'in') // FA-input
        else if (a === 'stop') rcLog('عرض تقديمي: إنهاء العرض (Esc)', 'in') // FA-input
        else if (a === 'black') rcLog(`عرض تقديمي: ${data?.value ? 'شاشة سوداء' : 'إلغاء الشاشة السوداء'}`)
        else if (a === 'laser-on') rcLog('تفعيل المؤشر الليزري', 'in')
        else if (a === 'laser-off') rcLog('إيقاف المؤشر الليزري', 'info')
      } else if (ev === 'rc:media') {
        const a = data?.action as string
        const label: Record<string, string> = {
          toggle: 'تشغيل/إيقاف مؤقت', play: 'تشغيل', pause: 'إيقاف مؤقت',
          next: 'المقطع التالي', prev: 'المقطع السابق', mute: 'كتم الصوت', unmute: 'إلغاء الكتم',
        }
        rcLog(a === 'volume' ? `مستوى الصوت: ${Math.round(Number(data?.value ?? 0))}%` : `وسائط: ${label[a] ?? a}`)
      } else if (ev === 'rc:gamepad' && data?.kind === 'button') {
        rcLog(`يد الألعاب: زر ${String(data?.button ?? '')} → ${String(data?.action ?? '')}`)
      } else if (ev === 'rc:clipboard' && data?.direction === 'toPc') {
        rcLog(`حافظة: نص وارد من الهاتف (${String(data?.text ?? '').length} حرف)`, 'in')
      } else if (ev === 'rc:clipboard' && data?.direction === 'pull') {
        rcLog('حافظة: الهاتف طلب نسخ حافظة الكمبيوتر', 'info')
      }
      io?.emit(ev, payload)
    })
  }

  // ==== أوامر النظام ====
  socket.on('rc:power', (data: { action: string }) => {
    // SEC (M0.3 F1): desktop أو controller (هاتف موثوق) حصرًا — المجهول يُرفض
    const src = desktopSocks.has(socket.id)
      ? 'desktop'
      : controllerTrust.has(socket.id)
        ? 'controller'
        : 'unknown'
    if (src === 'unknown') {
      socket.emit('rc:rejected', { reason: 'untrusted', ev: 'rc:power' })
      rcLog('رفض أمر نظام: المصدر غير موثوق (يتطلب هاتف مقترن أو واجهة الكمبيوتر)', 'info')
      return
    }
    const action = data?.action
    const label = POWER_AR_ACTION[action] ?? action
    if (desktop.power === 'off' && action !== 'unlock') {
      socket.emit('rc:rejected', { reason: 'off', ev: 'rc:power' })
      return
    }
    rcLog(`أمر نظام من الهاتف: ${label}`, 'in')
    io?.emit('rc:power', { ...(data ?? {}), __src: src })
    if (action === 'shutdown') desktop.power = 'shutting-down'
    else if (action === 'restart') desktop.power = 'shutting-down'
    else if (action === 'sleep') desktop.power = 'sleeping'
    else if (action === 'hibernate') desktop.power = 'shutting-down'
    else if (action === 'lock') desktop.power = 'locked'
    else if (action === 'unlock') desktop.power = 'on'
    else if (action === 'logout') desktop.power = 'locked' // شاشة الدخول = جلسة مقفلة
  })

  // ==== Wake-on-LAN ====
  socket.on('rc:wol', (data: { mac: string }) => {
    // SEC (M0.3 F1): إيقاظ من هاتف موثوق/واجهة الكمبيوتر حصرًا
    const src = desktopSocks.has(socket.id)
      ? 'desktop'
      : controllerTrust.has(socket.id)
        ? 'controller'
        : 'unknown'
    if (src === 'unknown') {
      socket.emit('rc:rejected', { reason: 'untrusted', ev: 'rc:wol' })
      rcLog('رفض Wake-on-LAN: المصدر غير موثوق (يتطلب هاتف مقترن أو واجهة الكمبيوتر)', 'info')
      return
    }
    const raw = String(data?.mac ?? '').trim()
    const norm = raw.replace(/-/g, ':').toUpperCase()
    const valid = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(norm)
    if (!valid) {
      socket.emit('rc:rejected', { reason: 'mac', ev: 'rc:wol' })
      rcLog(`Wake-on-LAN: عنوان MAC غير صالح (${raw})`, 'info')
      return
    }
    if (norm !== desktop.mac.toUpperCase()) {
      socket.emit('rc:rejected', { reason: 'mac', ev: 'rc:wol' })
      rcLog(`Wake-on-LAN: MAC لا يطابق الكمبيوتر المسجل (${norm} ≠ ${desktop.mac})`, 'info')
      return
    }
    if (desktop.power === 'on' || desktop.power === 'locked') {
      socket.emit('rc:rejected', { reason: 'already-on', ev: 'rc:wol' })
      rcLog('Wake-on-LAN: تم تجاهل الحزمة — الكمبيوتر يعمل بالفعل', 'info')
      return
    }
    const hex = 'FFFFFFFFFFFF' + norm.replace(/:/g, '').repeat(16)
    rcLog(`Wake-on-LAN: صياغة الحزمة السحرية إلى ${norm} — 6×FF + MAC×16 = ${hex.length / 2} بايت — جارٍ الإرسال الفعلي…`, 'in')
    // FA-power: الإرسال الفعلي عبر UDP broadcast (لا مجرد صياغة)
    sendWolPacket(norm, (ok, detail) => {
      rcLog(ok
        ? `حزمة Wake-on-LAN السحرية أُرسلت فعليًا إلى ${norm} — ${detail}`
        : `فشل إرسال حزمة Wake-on-LAN (${detail})`, ok ? 'in' : 'info')
    })
    io?.emit('desktop:wake', { source: 'wol', mac: norm, packet: hex, __src: src })
  })

  socket.on('disconnect', () => {
    // FA-input — انقطاع صاحب الجلسة ينهيها دائمًا (قاعدة §4.8)
    if (session.active && session.socketId === socket.id) endSession('disconnected')
    // الجولة 4 (عقد §18) — تدفقات القناة الحية تموت مع سوكِتها
    dropLiveFlows(socket.id, 'انقطاع السوكِت')
    controllerTrust.delete(socket.id)
    desktopSocks.delete(socket.id)
    console.log('client disconnected:', socket.id)
  })
})

httpServer.listen(PORT, () => {
  console.log(`NexusLink Remote Control Bridge on port ${PORT}`)
  rcLog(`جسر التحكم عن بُعد يعمل — الكمبيوتر ${desktop.name} (${POWER_AR[desktop.power]})`, 'ok')
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
