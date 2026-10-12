// NexusLink — جسر التحكم عن بُعد (المرحلة 6: الهاتف يتحكم بالكمبيوتر)
// ============================================================
// خدمة مستقلة (socket.io, port 3004) تنقل أحداث الإدخال من الهاتف
// إلى الكمبيوتر عبر Nexus Protocol: لوحة اللمس، لوحة المفاتيح،
// الماوس الهوائي (الجيروسكوب)، يد الألعاب، جهاز العروض، الوسائط،
// أوامر النظام + Wake-on-LAN، ومزامنة الحافظة المشتركة.
import { createServer } from 'http'
import { createSocket } from 'dgram'
import { Server } from 'socket.io'

const PORT = 3004

// ---------- حالة الكمبيوتر المسجلة ----------
const desktop = {
  name: 'NEXUS-PC',
  mac: 'A4:5E:60:C1:2D:9F',
  power: 'on' as string, // يُحدَّث من تقارير desktop:state
}

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
])

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
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket) => {
  console.log('client connected:', socket.id)
  socket.emit('rc:hello', {
    desktop: { name: desktop.name, mac: desktop.mac, power: desktop.power },
    at: Date.now(),
  })

  // ==== تسجيل الطرفين ====
  socket.on('rc:hello-controller', (data: { name?: string }) => {
    const name = data?.name || 'هاتف التحكم'
    rcLog(`هاتف تحكم متصل: ${name} — جاهز لإرسال الأوامر`, 'ok')
    socket.broadcast.emit('rc:controller-online', { name, at: Date.now() })
  })

  socket.on('desktop:register', (data: { name?: string; mac?: string }) => {
    if (data?.name) desktop.name = data.name
    if (data?.mac) desktop.mac = data.mac
    console.log('desktop registered:', desktop.name, desktop.mac)
  })

  // ==== تقارير حالة الكمبيوتر → بث للهواتف ====
  socket.on('desktop:state', (report: { power?: string }) => {
    if (report?.power && report.power !== desktop.power) {
      desktop.power = report.power
      console.log('desktop power:', desktop.power)
    }
    socket.broadcast.emit('desktop:state', report)
  })

  // ==== دفع الحافظة من الكمبيوتر إلى الهاتف ====
  socket.on('desktop:clipboard', (data: { text: string; at?: number }) => {
    rcLog('تم دفع الحافظة من الكمبيوتر إلى الهاتف', 'ok')
    socket.broadcast.emit('desktop:clipboard', data)
  })

  // ==== قناة أخبار قياس زمن الاستجابة ====
  socket.on('rc:ping', (data: { t: number }) => {
    socket.emit('rc:pong', { t: data?.t ?? Date.now() })
  })

  // ==== نقل أحداث الإدخال مع بوابة الطاقة ====
  for (const ev of RC_INPUT) {
    socket.on(ev, (data: Record<string, unknown>) => {
      if (!gateInput(socket, data, ev)) return
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
      io?.emit(ev, data)
    })
  }

  // ==== أوامر النظام ====
  socket.on('rc:power', (data: { action: string }) => {
    const action = data?.action
    const label = POWER_AR_ACTION[action] ?? action
    if (desktop.power === 'off' && action !== 'unlock') {
      socket.emit('rc:rejected', { reason: 'off', ev: 'rc:power' })
      return
    }
    rcLog(`أمر نظام من الهاتف: ${label}`, 'in')
    io?.emit('rc:power', data)
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
    io?.emit('desktop:wake', { source: 'wol', mac: norm, packet: hex })
  })

  socket.on('disconnect', () => {
    console.log('client disconnected:', socket.id)
  })
})

httpServer.listen(PORT, () => {
  console.log(`NexusLink Remote Control Bridge on port ${PORT}`)
  rcLog(`جسر التحكم عن بُعد يعمل — الكمبيوتر ${desktop.name} (${POWER_AR[desktop.power]})`, 'ok')
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
