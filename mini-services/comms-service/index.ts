// NexusLink — Comms Bridge + Virtual Android Phone
// ============================================================
// خدمة مستقلة (socket.io, port 3003) تمثل جسر Nexus Protocol بين
// سطح المكتب والهاتف: انعكاس الإشعارات، الرد السريع، SMS، المكالمات،
// ومزامنة عدم الإزعاج — مع محاكي هاتف أندرويد مدمج.
// تشغيل مضمّن (تطبيق سطح المكتب Tauri): NEXUSLINK_NAME/NEXUSLINK_GATEWAY_PORT
// تعدّل الإعلان mDNS فقط — الافتراضات مطابقة للعقد (NEXUS-PC/81).
import { createServer } from 'http'
import { Server } from 'socket.io'

const PORT = 3003
const NEXT_BASE = process.env.NEXT_BASE || 'http://127.0.0.1:3000'
const SERVER_NAME = process.env.NEXUSLINK_NAME || 'NEXUS-PC'
const GATEWAY_PORT = Number(process.env.NEXUSLINK_GATEWAY_PORT || 81)
const STARTED_AT = Date.now()

// ---------- Nexus Protocol app catalog ----------
interface AppMeta { id: string; name: string; color: string; actionable: boolean }
const APPS: Record<string, AppMeta> = {
  whatsapp:  { id: 'whatsapp',  name: 'واتساب',    color: '#25D366', actionable: true },
  telegram:  { id: 'telegram',  name: 'تيليجرام',  color: '#229ED9', actionable: true },
  gmail:     { id: 'gmail',     name: 'Gmail',     color: '#EA4335', actionable: false },
  instagram: { id: 'instagram', name: 'إنستغرام',  color: '#E1306C', actionable: false },
  youtube:   { id: 'youtube',   name: 'YouTube',   color: '#FF0000', actionable: false },
  slack:     { id: 'slack',     name: 'Slack',     color: '#611f69', actionable: true },
  sms:       { id: 'sms',       name: 'الرسائل',   color: '#0d9488', actionable: true },
}

const NAMES = ['أحمد الغامدي', 'سارة العتيبي', 'محمد الحربي', 'نورة القحطاني', 'خالد المطيري', 'فاطمة الزهراني', 'عبدالله الدوسري', 'ريم الشهري']

const WA_REPLIES = [
  'تمام، وصلتني رسالتك 👍',
  'أوكي، نتكلم بعد شوي',
  'إن شاء الله، أنا جاي الآن',
  'ما شاء الله! أخبرني بالتفاصيل',
  'خلاص، اتفقنا على كذا',
]
const NOTIF_TEMPLATES: { appId: string; title: string; body: string }[] = [
  { appId: 'whatsapp',  title: 'أحمد الغامدي',  body: 'السلام عليكم، هل انتهينا من تقرير المشروع؟' },
  { appId: 'whatsapp',  title: 'مجموعة العائلة', body: 'أم عبدالله: لا تنسوا غداء الجمعة 🍽' },
  { appId: 'whatsapp',  title: 'سارة العتيبي',  body: 'أرسلت لك الملفات على الدرج، شوفها لما تفرغ' },
  { appId: 'telegram',  title: 'قناة التقنية',   body: 'مقال جديد: أفضل أدوات المطورين هذا الشهر' },
  { appId: 'telegram',  title: 'محمد الحربي',   body: 'شغّل لك عرض التجربة على السيرفر التجريبي' },
  { appId: 'gmail',     title: 'Gmail',         body: 'فاتورة اشتراكك الشهري جاهزة للتحميل' },
  { appId: 'gmail',     title: 'Gmail',         body: 'تمت استعادة كلمة المرور لحسابك بنجاح' },
  { appId: 'instagram', title: 'إنستغرام',      body: 'نورة القحطاني أشارت بإعجاب على صورتك' },
  { appId: 'youtube',   title: 'YouTube',       body: 'قناة "هندسة البرمجيات" نشرت فيديو جديد' },
  { appId: 'slack',     title: '#فريق-التطوير',  body: 'خالد: تم دفع التحديث الأخير، جاهز للمراجعة' },
]
const SMS_TEMPLATES = [
  { from: 'STC',       body: 'رصيدك الحالي 12.50 ريال. لتجديد الباقة أرسل 700 إلى 900' },
  { from: 'الهلال الأحمر', body: 'تذكير: موعدك غداً الساعة 10:00 صباحاً. للإلغاء أرسل إلغاء' },
  { from: 'أحمد الغامدي',  body: 'أخي وين وصلت؟ الكل انتظرك' },
  { from: 'بنك الراجحي',   body: 'عملية شراء POS بمبلغ 45.00 ريال — بطاقة *4321' },
]

// ---------- phone runtime ----------
interface ActiveCall { id: string; number: string; contactName?: string; direction: 'in' | 'out'; startedAt: number }
const phone = {
  name: 'Galaxy-S24',
  dnd: false,
  autoMode: true,
  activeCall: null as ActiveCall | null,
  ringingCall: null as { id: string; number: string; contactName?: string; timeout: NodeJS.Timeout } | null,
  logs: [] as { id: string; text: string; kind: string; at: number }[],
}
let io: Server

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

function phoneLog(text: string, kind: 'info' | 'in' | 'out' | 'ok' = 'info') {
  const entry = { id: uid(), text, kind, at: Date.now() }
  phone.logs.unshift(entry)
  if (phone.logs.length > 60) phone.logs.pop()
  io?.emit('phone:log', entry)
  console.log('[phone]', text)
}

async function persist(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${NEXT_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch (err) {
    console.error('[bridge] persist failed', path, err)
    return null
  }
}

// ---------- notification mirroring (ingest → filter rules on desktop server) ----------
async function mirrorNotification(input: { appId: string; title: string; body: string; actionable?: boolean }) {
  const app = APPS[input.appId] ?? { id: input.appId, name: input.appId, color: '#64748b', actionable: true }
  const out = await persist('/api/comms/notifications', {
    appId: app.id, appName: app.name, title: input.title, body: input.body,
    actionable: input.actionable ?? app.actionable,
  })
  const notification = (out?.notification ?? {
    id: uid(), appId: app.id, appName: app.name, title: input.title, body: input.body,
    actionable: input.actionable ?? app.actionable, status: 'new', replyText: null,
    createdAt: new Date().toISOString(),
  }) as Record<string, unknown>
  if (notification.status !== 'hidden') {
    io?.emit('notif:mirror', { notification })
    console.log('[mirror]', app.id, '-', input.title)
  }
}

async function incomingSms(from: string, body: string) {
  const out = await persist('/api/comms/sms', { op: 'incoming', address: from, body })
  const payload = out ?? {
    conversation: { id: uid(), address: from, contactName: null, unread: 1 },
    message: { id: uid(), body, direction: 'in', status: 'delivered', createdAt: new Date().toISOString() },
  }
  io?.emit('sms:incoming', payload)
  phoneLog(`SMS وارد من ${from}: ${body.slice(0, 40)}`, 'in')
}

// ---------- calls ----------
function startIncomingCall() {
  if (phone.ringingCall || phone.activeCall) return
  const [name, number] = Math.random() < 0.6 ? [pick(NAMES), null] : [null, '05' + Math.floor(rnd(10000000, 99999999))]
  const call = { id: uid(), number: number ?? '0501234567', contactName: name ?? undefined }
  const timeout = setTimeout(() => {
    // لم يُرد على المكالمة → missed
    if (phone.ringingCall?.id === call.id) {
      phone.ringingCall = null
      io?.emit('call:state', { callId: call.id, state: 'ended', missed: true })
      persist('/api/comms/calls', { op: 'missed', number: call.number, contactName: call.contactName })
      phoneLog(`لم يُرد على مكالمة ${call.contactName ?? call.number}`, 'info')
    }
  }, 20000)
  phone.ringingCall = { ...call, timeout }
  io?.emit('call:incoming', { callId: call.id, number: call.number, contactName: call.contactName, at: Date.now() })
  phoneLog(`مكالمة واردة من ${call.contactName ?? call.number}`, 'in')
}

function endActiveCall(durationSec: number, by: string) {
  const c = phone.activeCall
  if (!c) return
  phone.activeCall = null
  io?.emit('call:state', { callId: c.id, state: 'ended', durationSec })
  phoneLog(`انتهت المكالمة مع ${c.contactName ?? c.number} (${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}) — بواسطة ${by}`, 'ok')
}

// ---------- auto simulation ----------
let autoTimer: NodeJS.Timeout | null = null
function scheduleAuto() {
  if (autoTimer) clearTimeout(autoTimer)
  if (!phone.autoMode) return
  autoTimer = setTimeout(() => {
    const r = Math.random()
    if (r < 0.62) {
      const t = pick(NOTIF_TEMPLATES)
      mirrorNotification(t)
    } else if (r < 0.85) {
      const t = pick(SMS_TEMPLATES)
      incomingSms(t.from, t.body)
    } else if (r < 0.93) {
      startIncomingCall()
    }
    scheduleAuto()
  }, rnd(22000, 40000))
}

// ---------- socket server ----------
// SEC (M0.3 — docs/security-audit.md F4): بديل السماح المفتوح — متصفح من الإنترنت
// (Origin خارجي) يُرفض عند المصافحة؛ العملاء الأصليون (بلا Origin) والواجهة
// عبر البوابة/نفس الأصل (localhost أو نطاق خاص) مسموحون.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])
function originAllowed(origin: string | undefined): boolean {
  const o = String(origin ?? '').trim()
  if (!o) return true
  let u: URL
  try { u = new URL(o) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  if (LOOPBACK.has(host) || host.endsWith('.local')) return true
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 192) return true
    if (a === 172 && b >= 16 && b <= 31) return true
  }
  if (host.startsWith('::ffff:')) return true
  return false
}

const httpServer = createServer()
io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: (o: string | undefined, cb: (e: Error | null, ok: boolean) => void) => cb(null, originAllowed(o)),
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// فحص جاهزية + حالة (يقرؤه مدير العمليات في تطبيق سطح المكتب و tray)
// socket.io مُنشأ بـ path:'/' (العقد: يقبل أي مسار) — engine.io يطالب بكل المسارات
// ويكتب 400 قبل أي مستمع آخر. الحل: نلتقط مستمع engine حرفيًا ونغلّفه:
// /status تُجاب هنا، وكل ما عداه يُفوَّض لـ engine بلا أي تغيير سلوك.
const ENGINE_REQUEST = httpServer.listeners('request').pop() as (
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
) => void
httpServer.removeAllListeners('request')
httpServer.on('request', (req, res) => {
  try {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/status') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({
        ok: true,
        proto: 'Nexus/1.2',
        role: 'comms',
        port: PORT,
        sockets: io?.engine?.clientsCount ?? 0,
        uptimeMs: Date.now() - STARTED_AT,
      }))
      return
    }
  } catch { /* لا نُسقط السيرفر أبدًا بسبب فحص */ }
  ENGINE_REQUEST(req, res)
})

io.on('connection', (socket) => {
  console.log('desktop connected:', socket.id)
  socket.emit('bridge:hello', {
    phone: { name: phone.name, dnd: phone.dnd, autoMode: phone.autoMode, battery: 78 },
    at: Date.now(),
  })
  phoneLog('اتصال جديد من سطح المكتب عبر Nexus Protocol (TLS)', 'ok')

  // ==== محاكي الهاتف ====
  socket.on('phone:simulate', (data: { kind: string }) => {
    switch (data?.kind) {
      case 'whatsapp': case 'telegram': case 'gmail': case 'instagram': case 'youtube': case 'slack': {
        const t = pick(NOTIF_TEMPLATES.filter((x) => x.appId === data.kind)) ??
          pick(NOTIF_TEMPLATES)
        mirrorNotification(t)
        phoneLog(`إشعار ${APPS[t.appId]?.name ?? t.appId}: ${t.title}`, 'in')
        break
      }
      case 'sms': {
        const t = pick(SMS_TEMPLATES)
        incomingSms(t.from, t.body)
        break
      }
      case 'call':
        startIncomingCall()
        break
      case 'dnd': {
        phone.dnd = !phone.dnd
        io?.emit('dnd:state', { enabled: phone.dnd, source: 'phone' })
        persist('/api/comms/phone', { dnd: phone.dnd, dndSource: 'phone' })
        phoneLog(phone.dnd ? 'تم تفعيل عدم الإزعاج من الهاتف' : 'تم إيقاف عدم الإزعاج من الهاتف', phone.dnd ? 'ok' : 'info')
        break
      }
    }
  })

  socket.on('phone:auto-mode', (data: { enabled: boolean }) => {
    phone.autoMode = !!data?.enabled
    scheduleAuto()
    phoneLog(phone.autoMode ? 'وضع المحاكاة التلقائية مفعّل' : 'تم إيقاف المحاكاة التلقائية', 'info')
  })

  // ==== الرد السريع من الإشعار ====
  socket.on('phone:reply-action', (data: { notifId: string; appId: string; text: string }) => {
    const app = APPS[data?.appId]
    phoneLog(`رد سريع عبر ${app?.name ?? data?.appId}: «${data?.text}»`, 'out')
    setTimeout(() => {
      const t = {
        appId: data.appId,
        title: pick(NAMES),
        body: pick(WA_REPLIES),
      }
      mirrorNotification(t)
    }, rnd(1800, 4200))
  })

  // ==== إرسال SMS من الكمبيوتر ====
  socket.on('phone:sms-send', async (data: { messageId: string; address: string; body: string; contactName?: string }) => {
    phoneLog(`إرسال SMS إلى ${data.contactName ?? data.address}: ${data.body}`, 'out')
    setTimeout(() => {
      io?.emit('sms:status', { messageId: data.messageId, status: 'sent' })
      persist('/api/comms/sms', { op: 'status', messageId: data.messageId, status: 'sent' })
    }, 700)
    setTimeout(() => {
      io?.emit('sms:status', { messageId: data.messageId, status: 'delivered' })
      persist('/api/comms/sms', { op: 'status', messageId: data.messageId, status: 'delivered' })
    }, 1600)
    if (Math.random() < 0.55) {
      setTimeout(() => {
        incomingSms(data.address, pick([
          'وصلت رسالتك، شكراً!',
          'تمام، أراك لاحقاً',
          'أوكي، بس اعطني عنوان المكان',
          'ما قصرت، أفدتني كثير',
        ]))
      }, rnd(2500, 6000))
    }
  })

  // ==== المكالمات ====
  socket.on('phone:call-dial', (data: { callId: string; number: string; contactName?: string }) => {
    if (phone.activeCall || phone.ringingCall) {
      io?.emit('call:state', { callId: data.callId, state: 'ended', busy: true })
      return
    }
    phone.activeCall = { id: data.callId, number: data.number, contactName: data.contactName, direction: 'out', startedAt: Date.now() }
    phoneLog(`طلب اتصال صادر إلى ${data.contactName ?? data.number} — جارٍ الرن عبر الهاتف`, 'out')
    setTimeout(() => io?.emit('call:state', { callId: data.callId, state: 'ringing' }), 1300)
    setTimeout(() => {
      if (phone.activeCall?.id === data.callId) {
        phone.activeCall.startedAt = Date.now()
        io?.emit('call:state', { callId: data.callId, state: 'active' })
        phoneLog('تم ربط المكالمة — الصوت يُبث عبر سماعة الكمبيوتر', 'ok')
      }
    }, 3400)
  })

  socket.on('phone:call-answer', (data: { callId: string }) => {
    if (phone.ringingCall?.id === data.callId) {
      clearTimeout(phone.ringingCall.timeout)
      const r = phone.ringingCall
      phone.ringingCall = null
      phone.activeCall = { id: r.id, number: r.number, contactName: r.contactName, direction: 'in', startedAt: Date.now() }
      io?.emit('call:state', { callId: data.callId, state: 'active' })
      phoneLog('تم الرد على المكالمة من الكمبيوتر — سماعة الكمبيوتر كمكبر', 'ok')
    }
  })

  socket.on('phone:call-reject', (data: { callId: string }) => {
    if (phone.ringingCall?.id === data.callId) {
      clearTimeout(phone.ringingCall.timeout)
      const r = phone.ringingCall
      phone.ringingCall = null
      io?.emit('call:state', { callId: data.callId, state: 'ended', rejected: true })
      persist('/api/comms/calls', { op: 'missed', number: r.number, contactName: r.contactName })
      phoneLog(`تم رفض مكالمة ${r.contactName ?? r.number}`, 'info')
    }
  })

  socket.on('phone:call-end', (data: { callId: string; durationSec: number; direction: 'in' | 'out'; number: string; contactName?: string }) => {
    if (phone.activeCall?.id === data.callId) endActiveCall(data.durationSec, 'الكمبيوتر')
  })

  // ==== مزامنة عدم الإزعاج (من الكمبيوتر) ====
  socket.on('phone:dnd-set', (data: { enabled: boolean }) => {
    phone.dnd = !!data?.enabled
    phoneLog(phone.dnd ? 'الهاتف: تفعيل عدم الإزعاج (أمر مزامنة من الكمبيوتر)' : 'الهاتف: إيقاف عدم الإزعاج (من الكمبيوتر)', phone.dnd ? 'ok' : 'info')
    io?.emit('dnd:state', { enabled: phone.dnd, source: 'pc' })
  })

  socket.on('disconnect', () => {
    console.log('desktop disconnected:', socket.id)
  })
})

// ==== إعلان mDNS: خدمة _nexuslink._tcp (الإصلاح G-3) ====
// تطبيق الهاتف (وكيل Nexus) يكتشف السيرفر تلقائيًا عبر bonsoir/mDNS.
// كل شيء داخل try/catch — فشل الـ multicast لا يوقف الجسر أبدًا.
async function startMdns() {
  try {
    const { Bonjour } = await import("bonjour-service")
    const bonjour = new Bonjour()
    const svc = bonjour.publish({
      name: SERVER_NAME,
      type: "nexuslink", // → _nexuslink._tcp
      port: GATEWAY_PORT, // بوابة الإدخال (نفس نمط ?XTransformPort)
      txt: {
        proto: "Nexus/1.2", name: SERVER_NAME,
        gateway: String(GATEWAY_PORT), rest: "3000", comms: "3003", remote: "3004",
        media: "3005", guard: "3006", prod: "3007", sec: "3009",
      },
    })
    svc.on("up", () => console.log("[mdns] advertising _nexuslink._tcp (port " + GATEWAY_PORT + ")"))
    svc.on("error", (e: Error) => console.warn("[mdns] publish error:", e.message))
  } catch (e) {
    console.warn("[mdns] غير متاح في هذه البيئة:", e instanceof Error ? e.message : e)
  }
}

httpServer.listen(PORT, () => {
  console.log(`NexusLink Comms Bridge (virtual phone) on port ${PORT}`)
  scheduleAuto()
  void startMdns()
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
