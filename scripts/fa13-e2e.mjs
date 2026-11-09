// FA-13/14/15/16 — تحقق E2E حي: بوابة أوامر الكمبيوتر على الجسور وعلى HTTP وعلى جسر comms والطبقة الثانية (تكليف 40/41/42/43)
// عميل محلي (loopback) يمر · عميل "شبكي" (عنوان LAN للجهاز نفسه) يُرفض local-only/pc-only
// ملاحظة: المنفذ 8207 افتراضيًا — بيئات الاستضافة تعترض منافذ الويب (80/81/443)
// شفافيًا فلا يصل العميل للبوابة أصلًا؛ سطح المكتب الحقيقي يستخدم 81 (FA13_GW_PORT للتجاوز).
// الاستخدام: node scripts/fa13-e2e.mjs   (المكدس عامر: next standalone + بوابة)
import { request } from 'node:http'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { io } from 'socket.io-client'

const GW = { host: '127.0.0.1', port: Number(process.env.FA13_GW_PORT) || 8207 }
const REST = { host: '127.0.0.1', port: 3000 }
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
function lanIp() {
  return Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4')?.address || ''
}
function reqJson(host, port, path, method, body) {
  return new Promise((res, rej) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const r = request({ host, port, path, method, headers: data ? {
      'content-type': 'application/json', 'content-length': data.length,
    } : {} }, (resp) => {
      let raw = ''
      resp.on('data', (c) => { raw += c })
      resp.on('end', () => {
        let j = null
        try { j = JSON.parse(raw) } catch { /* بلا جسم */ }
        res({ status: resp.statusCode, json: j, raw })
      })
    })
    r.on('error', rej)
    if (data) r.write(data)
    r.end()
  })
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

// ==== 6) FA-14 عبر HTTP (تكليف 41) — العمليات المدمرة على الكمبيوتر loopback حصرًا ====
{
  const probe = `fa14-probe-${Date.now()}`
  const fsLan = await reqJson(LAN, GW.port, '/api/fs', 'POST', { op: 'mkdir', device: 'galaxy-s24', path: '/', name: probe })
  check('FA14/FS/lan: mkdir على قرص الكمبيوتر من عميل شبكي عبر البوابة → 403 pc-only',
    fsLan.status === 403 && fsLan.json?.error === 'pc-only', JSON.stringify(fsLan.json)?.slice(0, 90))
  const fsLoc = await reqJson(REST.host, REST.port, '/api/fs', 'POST', { op: 'mkdir', deviceId: 'galaxy-s24', path: '/', name: probe })
  check('FA14/FS/loopback: mkdir المحلي يصل المعالج (ok:true)',
    fsLoc.status === 200 && fsLoc.json?.ok === true, JSON.stringify(fsLoc.json)?.slice(0, 90))
  const fsDel = await reqJson(REST.host, REST.port, '/api/fs', 'POST', { op: 'delete', deviceId: 'galaxy-s24', paths: [`/${probe}`] })
  check('FA14/FS/loopback: delete المحلي يصل المعالج وينظف الأثر',
    fsDel.status === 200 && fsDel.json?.ok === true, JSON.stringify(fsDel.json)?.slice(0, 90))
  const bkLan = await reqJson(LAN, GW.port, '/api/backup-secure', 'POST', { action: 'delete', file: 'fa14-x.zip' })
  check('FA14/BACKUP/lan: حذف نسخة احتياطية من عميل شبكي → 403 loopback-only',
    bkLan.status === 403, JSON.stringify(bkLan.json)?.slice(0, 90))
  const txLan = await reqJson(LAN, GW.port, '/api/transfer', 'POST', { action: 'pause', id: 'fa14-x' })
  check('FA14/TRANSFER/lan: إيقاف مهمة نقل من عميل شبكي → 403 (قبل فحص وجود المهمة)',
    txLan.status === 403 && txLan.json?.error === 'pc-only', JSON.stringify(txLan.json)?.slice(0, 90))
  const scLan = await reqJson(LAN, GW.port, '/api/scan', 'POST', { action: 'open' })
  check('FA14/SCAN/lan: فتح جلسة ماسح من عميل شبكي → 403',
    scLan.status === 403, JSON.stringify(scLan.json)?.slice(0, 90))
}

// ==== 7) FA-15 عبر جسر comms 3003 (تكليف 42) — أوامر الهاتف من الكمبيوتر حصرًا ====
{
  // الجسر خدمة مستقلة يديرها procman في الإنتاج — إن لم تكن عاملة نقرّبها محليًا للفحص
  let commsProc = null
  const commsUp = await new Promise((res) => {
    const r = request({ host: '127.0.0.1', port: 3003, path: '/status', method: 'GET', timeout: 1500 }, (resp) => { resp.resume(); res(resp.statusCode === 200) })
    r.on('error', () => res(false))
    r.on('timeout', () => { r.destroy(); res(false) })
    r.end()
  })
  if (!commsUp) {
    commsProc = spawn(process.execPath, ['mini-services/comms-service/index.ts'], { stdio: 'ignore', cwd: process.cwd() })
    await new Promise((res) => setTimeout(res, 2500))
  }
  const lan = await connect(`http://${LAN}:3003`)
  let p = waitEvent(lan, 'phone:rejected')
  lan.emit('phone:sms-send', { messageId: 'fa15-a', address: '+966500000000', body: 'fa15' })
  const rej = await p
  check('COMMS3003/lan: phone:sms-send من عميل شبكي → phone:rejected local-only',
    !!rej && rej.reason === 'local-only' && rej.ev === 'phone:sms-send', JSON.stringify(rej))
  p = waitEvent(lan, 'phone:rejected', 2500)
  lan.emit('phone:call-dial', { callId: 'fa15-b', number: '+966500000001' })
  const rej2 = await p
  check('COMMS3003/lan: phone:call-dial (طلب مكالمة) من عميل شبكي → رفض',
    !!rej2 && rej2.ev === 'phone:call-dial', JSON.stringify(rej2))
  lan.disconnect()
  const loc = await connect('http://127.0.0.1:3003')
  const pd = waitEvent(loc, 'dnd:state')
  loc.emit('phone:dnd-set', { enabled: true })
  const dnd = await pd
  check('COMMS3003/loopback: phone:dnd-set المحلي يصل المعالج (dnd:state)',
    !!dnd && dnd.enabled === true && dnd.source === 'pc', JSON.stringify(dnd))
  const pd2 = waitEvent(loc, 'dnd:state')
  loc.emit('phone:dnd-set', { enabled: false })
  await pd2
  loc.disconnect()
  // عبر البوابة من LAN برمز مزوّر → البوابة تستبدل الترويسة → الجسر يرفض
  const spoof = await connect(`http://${LAN}:${GW.port}/?XTransformPort=3003`, { extraHeaders: { 'x-gw-client-ip': '127.0.0.1' } })
  const ps = waitEvent(spoof, 'phone:rejected')
  spoof.emit('phone:simulate', { kind: 'gmail' })
  const rej3 = await ps
  check('COMMS/GW/spoof: عميل شبكي عبر البوابة يزوّر الترويسة → رفض local-only',
    !!rej3 && rej3.reason === 'local-only', JSON.stringify(rej3))
  spoof.disconnect()
  if (commsProc) commsProc.kill()
}

// ==== 8) FA-16 عبر HTTP (تكليف 43) — الطبقة الثانية: بقية العمليات الحساسة loopback حصرًا ====
{
  const LAN403 = (r) => r.status === 403 && r.json?.error === 'pc-only'
  // 8.أ pcap — تنزيل التقاط كامل (خصوصية/أدلة جنائية)
  const pcapLan = await reqJson(LAN, GW.port, '/api/security/pcap', 'GET')
  check('FA16/PCAP/lan: تنزيل pcap من عميل شبكي عبر البوابة → 403 pc-only', LAN403(pcapLan), `status=${pcapLan.status}`)
  const pcapLoc = await reqJson(REST.host, REST.port, '/api/security/pcap', 'POST')
  check('FA16/PCAP/loopback: تصدير pcap المحلي يصل المعالج (200 بلا 403)', pcapLoc.status === 200, `status=${pcapLoc.status} ok=${pcapLoc.json?.ok}`)
  // 8.ب مسح سجلات التدقيق — العراقة: محو الأثر
  const auLan = await reqJson(LAN, GW.port, '/api/security/audit', 'DELETE')
  check('FA16/AUDIT/lan: مسح كامل سجل التدقيق من عميل شبكي → 403', LAN403(auLan), `status=${auLan.status}`)
  const naLoc = await reqJson(REST.host, REST.port, '/api/desktop/audit', 'POST', { action: 'native-fa16-selftest', detail: 'loopback-alive', severity: 'info', actor: 'fa16' })
  check('FA16/AUDIT/loopback: POST سجل الأصيلة من محلي (مسار Rust) يصل المعالج', naLoc.status === 200 && naLoc.json?.ok === true, JSON.stringify(naLoc.json)?.slice(0, 80))
  // 8.ج الإعدادات — تعطيل القفل/المحدّث من الشبكة
  const stLan = await reqJson(LAN, GW.port, '/api/desktop/settings', 'PUT', { appLock: false })
  check('FA16/SETTINGS/lan: قلب appLock من عميل شبكي → 403', LAN403(stLan), `status=${stLan.status}`)
  const scLan = await reqJson(LAN, GW.port, '/api/desktop/shortcuts', 'PUT', { shortcuts: {} })
  check('FA16/SHORTCUTS/lan: اختطاف الاختصارات من عميل شبكي → 403', LAN403(scLan), `status=${scLan.status}`)
  // 8.د comms — إرسال/حقن SMS و DND عبر HTTP (الجسر المحلي يمر loopback)
  const smsLan = await reqJson(LAN, GW.port, '/api/comms/sms', 'POST', { op: 'send', conversationId: 'x', text: 'fa16' })
  check('FA16/SMS/lan: إرسال SMS عبر HTTP من عميل شبكي → 403', LAN403(smsLan), `status=${smsLan.status}`)
  const smsLoc = await reqJson(REST.host, REST.port, '/api/comms/sms', 'POST', { op: 'incoming', address: 'fa16-selftest', text: 'fa16-bridge-alive' })
  check('FA16/SMS/loopback: حقن incoming من الجسر المحلي يصل المعالج (ok:true)', smsLoc.status === 200 && smsLoc.json?.ok === true, JSON.stringify(smsLoc.json)?.slice(0, 80))
  const dndLan = await reqJson(LAN, GW.port, '/api/comms/phone', 'PATCH', { dnd: true })
  check('FA16/DND/lan: قلب عدم الإزعاج عبر HTTP من عميل شبكي → 403 (فئة phone:dnd-set)', LAN403(dndLan), `status=${dndLan.status}`)
  const ntLan = await reqJson(LAN, GW.port, '/api/comms/notifications/action', 'POST', { id: 'fa16-x', action: 'delete' })
  check('FA16/NOTIF/lan: حذف إشعار من عميل شبكي → 403 (قبل أي فحص)', LAN403(ntLan), `status=${ntLan.status}`)
  const flLan = await reqJson(LAN, GW.port, '/api/comms/filter', 'PATCH', { mute: {} })
  check('FA16/FILTER/lan: عبث قواعد الفلترة من عميل شبكي → 403', LAN403(flLan), `status=${flLan.status}`)
  // 8.هـ prod — استعادة ببيانات مضمّنة · مسح الحافظة · إطلاق مزامنة زوج
  const bkLan = await reqJson(LAN, GW.port, '/api/prod/backup', 'POST', { action: 'restore', data: { type: 'nexuslink-backup' } })
  check('FA16/PRODBK/lan: استعادة نسخة (ببيانات مضمّنة) من عميل شبكي → 403 قبل أي استعادة', LAN403(bkLan), `status=${bkLan.status}`)
  const clLan = await reqJson(LAN, GW.port, '/api/prod/clipboard', 'DELETE')
  check('FA16/CLIP/lan: مسح سجل الحافظة الموحدة من عميل شبكي → 403', LAN403(clLan), `status=${clLan.status}`)
  const prLan = await reqJson(LAN, GW.port, '/api/prod/pairs/run', 'POST', { id: 'fa16-x' })
  check('FA16/PAIRS/lan: إطلاق مزامنة زوج من عميل شبكي → 403', LAN403(prLan), `status=${prLan.status}`)
  // 8.و كتابة قرص فعلي — التقاط الكاميرا ونسخ APK
  const capLan = await reqJson(LAN, GW.port, '/api/media/capture', 'POST', { device: 'galaxy-s24', dir: 'DCIM/Camera', dataUrl: 'data:image/jpeg;base64,x' })
  check('FA16/CAPTURE/lan: حفظ صورة كاميرا على القرص من عميل شبكي → 403', LAN403(capLan), `status=${capLan.status}`)
  const apkLan = await reqJson(LAN, GW.port, '/api/guard/backup-apk', 'POST', { pkg: 'evil.pkg', app: 'Evil', version: '1', sizeMB: 1 })
  check('FA16/APK/lan: كتابة APK + exec من عميل شبكي → 403', LAN403(apkLan), `status=${apkLan.status}`)
}

const fails = results.filter((r) => !r.ok).length
console.log(`\n=== FA-13+14+15+16 E2E: ${results.length - fails}/${results.length} PASS ===`)
process.exit(fails ? 1 : 0)
