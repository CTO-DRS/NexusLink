// FA-13 — تحقق E2E حي: بوابة أوامر الكمبيوتر على الجسور (تكليف 40)
// عميل محلي (loopback) يمر · عميل "شبكي" (عنوان LAN للجهاز نفسه) يُرفض local-only
// ملاحظة: المنفذ 8207 افتراضيًا — بيئات الاستضافة تعترض منافذ الويب (80/81/443)
// شفافيًا فلا يصل العميل للبوابة أصلًا؛ سطح المكتب الحقيقي يستخدم 81 (FA13_GW_PORT للتجاوز).
// الاستخدام: node scripts/fa13-e2e.mjs   (المكدس عامر: next standalone + بوابة)
import { request } from 'node:http'
import os from 'node:os'
import { io } from 'socket.io-client'

const GW = { host: '127.0.0.1', port: Number(process.env.FA13_GW_PORT) || 8207 }
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
function lanIp() {
  return Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4')?.address || ''
}
function waitEvent(sock, ev, ms = 4000) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms)
    sock.once(ev, (d) => { clearTimeout(t); res(d) })
  })
}
function connect(target, extra = {}) {
  return new Promise((res, rej) => {
    const s = io(target, { transports: ['polling'], reconnection: false, timeout: 8000, ...extra })
    s.once('connect', () => res(s))
    s.once('connect_error', (e) => rej(new Error(String(e?.message || e))))
  })
}

const LAN = lanIp()
if (!LAN) { console.log('FAIL بلا عنوان LAN — لا يمكن محاكاة عميل شبكي'); process.exit(1) }

// ==== 1) security-bridge 3009 — التوثيق الذاتي والقراءة من الشبكة تُرفض، المحلي يمر ====
{
  const lan = await connect(`http://${LAN}:3009`)
  let p = waitEvent(lan, 'sec:rejected')
  lan.emit('sec:trust-decision', { decision: 'trust', deviceId: 'evil-self', name: 'Evil' })
  const rej2 = await p
  check('SEC3009/lan: sec:trust-decision من عميل شبكي → sec:rejected local-only', !!rej2 && rej2.reason === 'local-only' && rej2.ev === 'sec:trust-decision', JSON.stringify(rej2))
  p = waitEvent(lan, 'sec:rejected')
  lan.emit('wipe:list')
  const rej3 = await p
  check('SEC3009/lan: wipe:list من عميل شبكي → رفض (قائمة الملفات لا تُسرَّب)', !!rej3 && rej3.ev === 'wipe:list', JSON.stringify(rej3))
  lan.disconnect()
  const loc = await connect('http://127.0.0.1:3009')
  loc.emit('sec:trust-decision', { decision: 'once', alertId: 'fa13-selftest', name: 'x', deviceId: 'fa13-x' })
  const done = await waitEvent(loc, 'sec:alert-resolved', 3000)
  check('SEC3009/loopback: sec:trust-decision المحلي يصل المعالج (sec:alert-resolved)', !!done, JSON.stringify(done)?.slice(0, 80))
  loc.disconnect()
}

// ==== 2) guard-bridge 3006 — dev:wipe من الشبكة يُرفض، المحلي يمرّر ====
{
  const lan = await connect(`http://${LAN}:3006`)
  let p = waitEvent(lan, 'dev:ctl-rejected')
  lan.emit('dev:wipe', { on: true })
  const rej = await p
  check('GUARD3006/lan: dev:wipe من عميل شبكي → dev:ctl-rejected local-only', !!rej && rej.reason === 'local-only' && rej.ev === 'dev:wipe', JSON.stringify(rej))
  p = waitEvent(lan, 'dev:ctl-rejected', 2500)
  lan.emit('prox:manual-lock')
  const rej2 = await p
  check('GUARD3006/lan: prox:manual-lock من عميل شبكي → رفض', !!rej2 && rej2.ev === 'prox:manual-lock', JSON.stringify(rej2))
  p = waitEvent(lan, 'dev:ctl-rejected', 2500)
  lan.emit('dev:ctl-start', { from: 'pc-office' })
  const rej3 = await p
  check('GUARD3006/lan: dev:ctl-start انتحال هوية موثوق → رفض local-only', !!rej3 && rej3.reason === 'local-only', JSON.stringify(rej3))
  lan.disconnect()
}

// ==== 3) automation-bridge 3008 — rule:upsert من الشبكة يُرفض ====
{
  // الجسر يقلع عبر /api/automation/boot (عقد §26 — بعيد عن إقلاع الجسور الخمسة)
  await new Promise((res) => {
    request({ host: '127.0.0.1', port: 3000, path: '/api/automation/boot', method: 'GET' }, (r) => {
      r.resume(); r.on('end', res)
    }).on('error', () => res()).end()
  })
  const lan = await connect(`http://${LAN}:3008`)
  const p = waitEvent(lan, 'auto:rejected')
  lan.emit('rule:upsert', { rule: { kind: 'test' } })
  const rej = await p
  check('AUTO3008/lan: rule:upsert من عميل شبكي → auto:rejected local-only', !!rej && rej.reason === 'local-only' && rej.ev === 'rule:upsert', JSON.stringify(rej))
  lan.disconnect()
  const loc = await connect('http://127.0.0.1:3008')
  const p2 = waitEvent(loc, 'auto:rejected')
  loc.emit('rule:upsert', { rule: { kind: 'nonsense-kind' } })
  const r = await p2
  check('AUTO3008/loopback: rule:upsert المحلي يصل المعالج (رفض تعقيم المحتوى لا البوابة)', !!r && r.reason === undefined, JSON.stringify(r))
  loc.disconnect()
}

// ==== 4) media-bridge 3005 — cam:shutter (الكاميرا) من الشبكة يُرفض ====
{
  const lan = await connect(`http://${LAN}:3005`)
  const p = waitEvent(lan, 'media:rejected')
  lan.emit('cam:shutter', { timer: 0 })
  const rej = await p
  check('MEDIA3005/lan: cam:shutter من عميل شبكي → media:rejected local-only', !!rej && rej.reason === 'local-only' && rej.ev === 'cam:shutter', JSON.stringify(rej))
  lan.disconnect()
}

// ==== 5) عبر البوابة (نمط العملاء الحقيقيين) — محلي يمر، ترويسة مزورة تُستبدل ====
{
  const loc = await connect(`http://${GW.host}:${GW.port}/?XTransformPort=3009`)
  check('GW/loopback: عميل عبر البوابة من loopback → متصل', true, '')
  const pd = waitEvent(loc, 'sec:alert-resolved', 3000)
  loc.emit('sec:trust-decision', { decision: 'once', alertId: 'fa13-gw', name: 'y', deviceId: 'fa13-y' })
  const done = await pd
  check('GW/loopback: sec:trust-decision عبر البوابة يصل المعالج', !!done, '')
  loc.disconnect()
  const spoof = await connect(`http://${LAN}:${GW.port}/?XTransformPort=3009`, { extraHeaders: { 'x-gw-client-ip': '127.0.0.1' } })
  const ps = waitEvent(spoof, 'sec:rejected')
  spoof.emit('sec:trust-decision', { decision: 'trust', deviceId: 'evil-spoof', name: 'Evil' })
  const rej = await ps
  check('GW/spoof: عميل شبكي عبر البوابة يزوّر x-gw-client-ip → البوابة تستبدلها → رفض local-only', !!rej && rej.reason === 'local-only', JSON.stringify(rej))
  spoof.disconnect()
}

const fails = results.filter((r) => !r.ok).length
console.log(`\n=== FA-13 E2E: ${results.length - fails}/${results.length} PASS ===`)
process.exit(fails ? 1 : 0)
