// محاكاة وكيل الجهاز (ما يفعله تطبيق Flutter خطوة بخطوة) — تحقق E2E من عقد الاتصال
// الاستخدام: node scripts/agent-e2e-sim.mjs
import { request } from 'node:http'
import { io } from 'socket.io-client'

const GATEWAY_HOST = '127.0.0.1'
const GATEWAY_PORT = 81
// نزيّف ترويسة Host كما لو أن المتصفح فتح الويب من جهاز على الشبكة المحلية
const LAN_HOST_HEADER = '192.168.1.5:81'
const DEVICE = { id: 'pixel8-e2e-agent', name: 'Pixel-8-E2E', battery: 87 }

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

function httpJson(method, path, { hostHeader = `${GATEWAY_HOST}:${GATEWAY_PORT}`, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = request(
      {
        host: GATEWAY_HOST,
        port: GATEWAY_PORT,
        path,
        method,
        headers: {
          Host: hostHeader,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = ''
        res.on('data', (c) => (buf += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(buf) }) }
          catch (e) { reject(new Error(`bad json (${res.statusCode}): ${buf.slice(0, 120)}`)) }
        })
      },
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ==== 1) قراءة حمولة QR كما يمسحها الهاتف (عبر البوابة = نمط gateway) ====
console.log('\n── 1) QR الاقتران عبر البوابة ──')
const qrRes = await httpJson('GET', '/api/devices/qr', { hostHeader: LAN_HOST_HEADER })
const payload = qrRes.json?.payload
check(
  'QR يحمل عنوانًا حقيقيًا (G-2 مُصلح)',
  !!payload && payload.host === '192.168.1.5' && payload.port === 81,
  JSON.stringify(payload ? { host: payload.host, port: payload.port, proto: payload.proto, ports: !!payload.ports } : null),
)
check('QR يحمل خريطة منافذ الجسور', payload?.ports?.guard === 3006 && payload?.ports?.sec === 3009)
check('QR يحمل سرًا + بروتوكول Nexus/1.2', typeof payload?.secret === 'string' && payload?.secret?.length === 32 && payload?.proto === 'Nexus/1.2')

// ==== 2) فحص الصحة (ping) عبر نفس العنوان ====
console.log('\n── 2) فحص الصحة /api/tools/ping ──')
const t0 = Date.now()
const ping = await httpJson('GET', '/api/tools/ping', { hostHeader: LAN_HOST_HEADER })
check('ping يستجيب pong:true', ping.json?.pong === true, `RTT=${Date.now() - t0}ms`)

// ==== 3) تسجيل الجهاز (pair) بنفس شكل بيانات السيرفر ====
console.log('\n── 3) تسجيل الجهاز POST /api/devices {action:"pair"} ──')
// G-1 (عقد §6): الاقتران يتطلب سر آخر رمز QR مُصدَر — جلبناه من قسم (1)
const pair = await httpJson('POST', '/api/devices', {
  hostHeader: LAN_HOST_HEADER,
  body: {
    action: 'pair',
    id: DEVICE.id,
    name: DEVICE.name,
    kind: 'phone',
    model: 'Pixel 8',
    os: 'Android 15 (SDK 35)',
    battery: DEVICE.battery,
    storageTotal: 256 * 1024 ** 3,
    storageUsed: 90 * 1024 ** 3,
    ip: '192.168.1.77',
    secret: payload?.secret,
  },
})
check('pair نجح', pair.status === 200 && pair.json?.ok === true, `id=${pair.json?.device?.id}`)
check('الحقول الاختيارية للوكيل انطبقت (battery/ip حقيقيان)', pair.json?.device?.battery === 87 && pair.json?.device?.ip === '192.168.1.77')

// ==== 4) الجهاز يظهر فورًا في قائمة أجهزة الويب ====
console.log('\n── 4) ظهور الجهاز في قائمة أجهزة الويب ──')
const devs = await httpJson('GET', '/api/devices', { hostHeader: LAN_HOST_HEADER })
const mine = (devs.json?.devices ?? []).find((d) => d.id === DEVICE.id)
check('الجهاز موجود في GET /api/devices', !!mine, mine ? `state=${mine.state}, name=${mine.name}` : '')
check('حالته connected (يظهر "متصل" في الويب فورًا)', mine?.state === 'connected')

// ==== 5) القناة الدائمة: socket.io عبر البوابة ?XTransformPort=3006 (نمط الخدمة الخلفية) ====
console.log('\n── 5) قناة socket.io الدائمة (جسر الحماية 3006 عبر Caddy) ──')
const socket = io(`http://${GATEWAY_HOST}:${GATEWAY_PORT}`, {
  transports: ['websocket', 'polling'],
  query: { XTransformPort: '3006' },
  reconnection: true,
  reconnectionDelay: 1000,
  timeout: 8000,
})
let proxStates = 0
let helloAck = false
socket.on('guard:hello', () => { helloAck = true })
socket.on('prox:state', () => { proxStates++ })
const connected = await new Promise((resolve) => {
  const to = setTimeout(() => resolve(false), 9000)
  socket.on('connect', () => { clearTimeout(to); resolve(true) })
  socket.connect()
})
check('اتصل بجسر 3006 عبر البوابة (XTransformPort)', connected)
if (connected) {
  socket.emit('guard:hello-phone', { name: DEVICE.name })
  // 3 منارات كالخدمة الخلفية (كل 5 ثوانٍ → نرسل 3 بفاصل 1.2s للسرعة)
  for (let i = 0; i < 3; i++) {
    socket.emit('prox:beacon', { rssi: -52, device: DEVICE.name })
    await sleep(1200)
  }
  socket.emit('dev:state', { deviceId: DEVICE.id, name: DEVICE.name, battery: DEVICE.battery, source: 'agent', at: Date.now() })
  await sleep(1500)

  const guard = await httpJson('GET', '/api/guard/boot', { hostHeader: LAN_HOST_HEADER })
  const prox = guard.json?.prox ?? {}
  check('guard:hello-phone وصل — phoneGuardOnline=true', prox.phoneGuardOnline === true, JSON.stringify({ phoneGuardOnline: prox.phoneGuardOnline, source: prox.source }))
  check('المنارة الحقيقية مسجلة (source=real)', prox.source === 'real', `rssi=${prox.rssi}`)
  check('نبضات prox:state تتدفق للوكيل', proxStates > 0, `${proxStates} نبضة`)
}

// ==== 6) قناة الأمان 3009: الوكيل يُعلن هويته (sec:announce) ولا يُرفض ====
console.log('\n── 6) قناة الأمان E2E (3009): sec:announce بدور phone ──')
// الجسر يُقلع عند الطلب (idempotent) — التطبيق الحقيقي يضمن إقلاعه هكذا أيضًا
await httpJson('GET', '/api/security/boot', { hostHeader: LAN_HOST_HEADER })
await sleep(800)
const sec = io(`http://${GATEWAY_HOST}:${GATEWAY_PORT}`, {
  transports: ['websocket', 'polling'],
  query: { XTransformPort: '3009' },
  timeout: 8000,
})
const secOutcome = await new Promise((resolve) => {
  const out = { rejected: false, kexPeer: false, pending: false, connected: false, announced: false }
  const done = () => resolve(out)
  const to = setTimeout(done, 9000)
  sec.on('connect', () => {
    out.connected = true
    sec.emit('sec:announce', {
      role: 'phone',
      deviceId: DEVICE.id,
      name: DEVICE.name,
      pub: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
      eph: Buffer.from('fedcba9876543210fedcba9876543210').toString('base64'),
    })
    out.announced = true
    // لا يوجد نظير كمبيوتر بمفاتيح في المحاكاة → لا kex:peer متوقع
    setTimeout(done, 1500)
  })
  sec.on('sec:rejected', () => { out.rejected = true; clearTimeout(to); done() })
  sec.on('sec:pending-trust', () => { out.pending = true; clearTimeout(to); done() })
  sec.connect()
})
check('sec:announce مقبول (غير مرفوض)', secOutcome.connected && secOutcome.announced && !secOutcome.rejected, JSON.stringify(secOutcome))
check('الجهاز المقترن موثوق في جسر الأمان (لا pending-trust)', secOutcome.connected && !secOutcome.pending)
sec.disconnect()

// ==== الختام ====
console.log('\n═══════ ملخص ═══════')
const passed = results.filter((r) => r.ok).length
console.log(`${passed}/${results.length} فحصًا ناجحًا`)
socket.disconnect()
process.exit(passed === results.length ? 0 : 1)
