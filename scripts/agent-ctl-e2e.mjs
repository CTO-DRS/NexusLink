// FA-7 — تحقق E2E حي: التحكم باللمس والحقن (عقد §4.8)
// محاكاة الوكيل (الهاتف) + عميلَي ويب على جسر الحماية 3006 عبر البوابة.
// الاستخدام: node scripts/agent-ctl-e2e.mjs
import { request } from 'node:http'
import { io } from 'socket.io-client'

const GATEWAY_HOST = '127.0.0.1'
const GATEWAY_PORT = 81
const LAN_HOST_HEADER = '192.168.1.5:81'
const DEVICE = { id: 'ctl-e2e-agent', name: 'Ctl-E2E-Phone' }
const PC = { id: 'pc-office', name: 'PC-OFFICE' }
const SCREEN = { w: 1080, h: 2340, density: 420 }

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
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
function waitFor(fn, ms = 5000, step = 60) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); resolve(true) }
      else if (Date.now() - t0 > ms) { clearInterval(iv); resolve(false) }
    }, step)
  })
}

function bridgeSocket(query) {
  return io(`http://${GATEWAY_HOST}:${GATEWAY_PORT}`, {
    transports: ['websocket', 'polling'],
    query: { XTransformPort: '3006' },
    reconnection: false,
    timeout: 8000,
    ...query,
  })
}

const connect = (s) =>
  new Promise((resolve) => {
    const to = setTimeout(() => resolve(false), 9000)
    s.on('connect', () => { clearTimeout(to); resolve(true) })
    s.connect()
  })

// ==== 1) اقتران وكيل التحكم (موثوق في السجل) ====
console.log('\n── 1) تسجيل وكيل التحكم (pair → trusted) ──')
const pair = await httpJson('POST', '/api/devices', {
  hostHeader: LAN_HOST_HEADER,
  body: { action: 'pair', id: DEVICE.id, name: DEVICE.name, kind: 'phone', model: 'E2E', battery: 80, ip: '192.168.1.90' },
})
check('pair نجح (idempotent)', pair.status === 200 && pair.json?.ok === true, `id=${pair.json?.device?.id}`)

// ==== 2) سوكِت الوكيل + عميلَا ويب ====
console.log('\n── 2) سوكِتات جسر 3006 (وكيل + ويبان) ──')
const agent = bridgeSocket()
const web1 = bridgeSocket()
const aOk = await connect(agent)
const w1Ok = await connect(web1)
check('الوكيل وعميل الويب الأول متصلان بالجسر', aOk && w1Ok)

// مستقبلات الوكيل (كل الأحداث الموجهة مباشرة)
const agentRecv = { ctlStart: [], ctlStop: [], touch: [], text: [], key: [] }
agent.on('dev:ctl-start', (d) => agentRecv.ctlStart.push(d))
agent.on('dev:ctl-stop', (d) => agentRecv.ctlStop.push(d))
agent.on('dev:touch', (d) => agentRecv.touch.push(d))
agent.on('dev:text', (d) => agentRecv.text.push(d))
agent.on('dev:key', (d) => agentRecv.key.push(d))

// عميل الويب الأول: يراقب البث والرفض (ولم يسمع أي صدى لأوامره)
const web1Recv = { screen: [], helloScreen: null, ctlState: [], rejected: [], touchEcho: [], ack: [] }
web1.on('guard:screen', (d) => web1Recv.screen.push(d))
web1.on('dev:ctl-state', (d) => web1Recv.ctlState.push(d))
web1.on('dev:ctl-rejected', (d) => web1Recv.rejected.push(d))
web1.on('dev:touch', () => web1Recv.touchEcho.push(Date.now()))
web1.on('dev:touch-ack', (d) => web1Recv.ack.push(d))
let hello1 = null
web1.on('guard:hello', (d) => { hello1 = d })

// التسجيل: الوكيل يُعلن نفسه ثم يرسل أبعاد شاشته (كما تفعل الخدمة الأصلية)
agent.emit('guard:hello-phone', { name: DEVICE.name, deviceId: DEVICE.id })
await sleep(300)
agent.emit('dev:screen', SCREEN)
await sleep(500)

// ==== 3) أبعاد الشاشة تصل الويب (بث guard:screen) ====
console.log('\n── 3) تقرير dev:screen → guard:screen + hello.screen ──')
const gotScreen = web1Recv.screen.find((s) => s.w === SCREEN.w && s.h === SCREEN.h)
check('guard:screen وصل الويب بالأبعاد الصحيحة', !!gotScreen, JSON.stringify(gotScreen ?? null))
check('الحقل يحمل معرف الجهاز', gotScreen?.deviceId === DEVICE.id)

// عميل ويب ثانٍ يتأخر — يجب أن يجد الأبعاد في guard:hello (حقل إضافي)
const web2 = bridgeSocket()
const w2Ok = await connect(web2)
const hello2 = await new Promise((resolve) => {
  const to = setTimeout(() => resolve(null), 4000)
  web2.on('guard:hello', (d) => { clearTimeout(to); resolve(d) })
})
check('عميل متأخر يجد الشاشة في guard:hello.screen', hello2?.screen?.w === SCREEN.w && hello2?.screen?.h === SCREEN.h, JSON.stringify(hello2?.screen ?? null))

const web2State = []
web2.on('dev:ctl-state', (d) => web2State.push(d))

// ==== 4) بدء الجلسة من ويب موثوق ====
console.log('\n── 4) جلسة التحكم: بدء من موثوق + رفض من مجهول ──')
web1.emit('dev:ctl-start', { from: PC.id, name: PC.name })
await sleep(500)
const startGot = agentRecv.ctlStart[0]
check('dev:ctl-start وصل الوكيل مباشرة', !!startGot && startGot.from === PC.id && startGot.name === PC.name, JSON.stringify(startGot ?? null))

// الهاتف يقبل (كما يفعل بعد ضغطة «سماح»)
agent.emit('dev:ctl-state', { active: true, controller: PC.id, name: PC.name, reason: 'confirmed', at: Date.now() })
await sleep(500)
const st1 = web1Recv.ctlState.find((s) => s.active === true)
const st2 = web2State.find((s) => s.active === true)
check('dev:ctl-state (نشطة) وصل عميل الويب الأول', !!st1 && st1.controller === PC.id, JSON.stringify(st1 ?? null))
check('dev:ctl-state وصل عميل الويب الثاني أيضًا (بث)', !!st2 && st2.name === PC.name)

// طلب من جهاز غير موثوق/مجهول
const beforeUnknown = agentRecv.ctlStart.length
web1.emit('dev:ctl-start', { from: 'stranger-pc', name: 'Stranger' })
await sleep(500)
const rej = web1Recv.rejected.find((r) => r.reason === 'untrusted' && r.from === 'stranger-pc')
check('الطلب المجهول رُفض بسبب untrusted', !!rej, JSON.stringify(rej ?? null))
check('الطلب المرفوض لم يوجَّه للوكيل إطلاقًا', agentRecv.ctlStart.length === beforeUnknown)

// ==== 5) أوامر اللمس/النص/الأزرار — توجيه مباشر بلا صدى ====
console.log('\n── 5) توجيه dev:touch/dev:text/dev:key ──')
web1.emit('dev:touch', { op: 'tap', x: 500, y: 1200, seq: 7 })
web1.emit('dev:touch', { op: 'swipe', x: 100, y: 1500, x2: 100, y2: 600, durationMs: 320, seq: 8 })
web1.emit('dev:touch', { op: 'explode', x: 1, y: 2 }) // op غير صالح → يُسقط
await sleep(500)
const tapGot = agentRecv.touch.find((t) => t.op === 'tap' && t.x === 500 && t.y === 1200 && t.seq === 7)
check('نقرة وصلت الوكيل بإحداثياتها الدقيقة', !!tapGot, JSON.stringify(tapGot ?? null))
const swipeGot = agentRecv.touch.find((t) => t.op === 'swipe' && t.y2 === 600 && t.durationMs === 320)
check('سحبة وصلت بحقولها كاملة', !!swipeGot, JSON.stringify(swipeGot ?? null))
check('op غير صالح سُقط قبل الوكيل', !agentRecv.touch.some((t) => t.op === 'explode'))
check('لا صدى لأوامر اللمس إلى مرسل الويب', web1Recv.touchEcho.length === 0)

web1.emit('dev:text', { text: 'مرحبا بالعالم' })
web1.emit('dev:key', { action: 'back' })
await sleep(500)
const textGot = agentRecv.text.find((t) => t.text === 'مرحبا بالعالم')
check('النص العربي وصل سليمًا (UTF-8)', !!textGot, JSON.stringify(textGot ?? null))
const keyGot = agentRecv.key.find((k) => k.action === 'back')
check('أمر الزر (رجوع) وصل الوكيل', !!keyGot)

// إقرار التنفيذ من الوكيل → بث للويب
agent.emit('dev:touch-ack', { seq: 7, op: 'tap', ok: true })
await sleep(400)
const ackGot = web1Recv.ack.find((a) => a.seq === 7 && a.op === 'tap' && a.ok === true)
check('dev:touch-ack relayed إلى الويب', !!ackGot, JSON.stringify(ackGot ?? null))

// ==== 6) إنهاء الجلسة + رفض عندما لا وكيل ====
console.log('\n── 6) الإنهاء والانقطاع ──')
web1.emit('dev:ctl-stop', {})
await sleep(500)
check('dev:ctl-stop وصل الوكيل', agentRecv.ctlStop.length >= 1)
agent.emit('dev:ctl-state', { active: false, reason: 'stopped', at: Date.now() })
const stEndOk = await waitFor(() => web1Recv.ctlState.find((s) => s.active === false) != null, 4000)
const stEnd = web1Recv.ctlState.find((s) => s.active === false)
check('حالة الانتهاء بُثّت للويب', stEndOk, JSON.stringify(stEnd ?? null))

agent.disconnect()
await sleep(1200)
web1.emit('dev:ctl-start', { from: PC.id, name: PC.name })
const rejOfflineOk = await waitFor(() => web1Recv.rejected.find((r) => r.reason === 'offline') != null, 5000)
const rejOffline = web1Recv.rejected.find((r) => r.reason === 'offline')
check('بلا وكيل حي → رفض offline', rejOfflineOk, JSON.stringify(rejOffline ?? null))

// ==== الختام ====
console.log('\n═══════ ملخص FA-7 ═══════')
const passed = results.filter((r) => r.ok).length
console.log(`${passed}/${results.length} فحصًا ناجحًا`)
web1.disconnect()
web2.disconnect()
process.exit(passed === results.length ? 0 : 1)
