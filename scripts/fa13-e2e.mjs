// FA-13/14/15/16/22/23/24 — تحقق E2E حي: بوابة أوامر الكمبيوتر على الجسور وعلى HTTP وعلى جسر comms والطبقات الثلاث وتوحيد الحراس ونهاية الرفض الصامت لقراءة الأدلة (تكليف 40/41/42/43/51/54/55)
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

// ==== 9) FA-22 عبر HTTP (تكليف 51) — الموجة الثالثة: مسارات أُضيفت بعد FA-16 هربت من الحرس الثاني ====
{
  const LAN403 = (r) => r.status === 403 && r.json?.error === 'pc-only'
  // تهيئة طبقة الإنتاجية (بذور prodState/الملفات/الأزواج — idempotent) لفحوص loopback الحية
  await reqJson(REST.host, REST.port, '/api/prod/boot', 'GET')
  // 9.أ خزنة الحافظة — محتوى مفكوك يُعرض (كلمات سر/رموز OTP — أعلى حساسية في prod)
  const vlLan = await reqJson(LAN, GW.port, '/api/prod/clipboard/vault', 'GET')
  check('FA22/VAULT/lan: قائمة الخزنة بمحتواها المفكوك من عميل شبكي → 403', LAN403(vlLan), `status=${vlLan.status}`)
  const vrLan = await reqJson(LAN, GW.port, '/api/prod/clipboard/vault', 'POST', { action: 'reveal', id: 'fa22-x' })
  check('FA22/VAULT/lan: كشف عنصر حساس من عميل شبكي → 403', LAN403(vrLan), `status=${vrLan.status}`)
  const vkLan = await reqJson(LAN, GW.port, '/api/prod/clipboard/vault', 'POST', { action: 'rotate-key' })
  check('FA22/VAULT/lan: تدوير مفتاح الخزنة من عميل شبكي → 403 (اليد المحلية الموحدة حرسًا واحدًا)', LAN403(vkLan), `status=${vkLan.status}`)
  const vlLoc = await reqJson(REST.host, REST.port, '/api/prod/clipboard/vault', 'GET')
  check('FA22/VAULT/loopback: قائمة الخزنة محليًا كما كانت (ok:true)', vlLoc.status === 200 && vlLoc.json?.ok === true, `status=${vlLoc.status} ok=${vlLoc.json?.ok}`)
  const vkLoc = await reqJson(REST.host, REST.port, '/api/prod/clipboard/vault', 'POST', { action: 'rotate-key', deviceId: 'fa22-selftest' })
  check('FA22/VAULT/loopback: تدوير قفل جهاز محليًا يعمل (منطق §59 حي — الحرس يمر)', vkLoc.status === 200 && vkLoc.json?.ok === true, `status=${vkLoc.status} ok=${vkLoc.json?.ok} keys=${vkLoc.json?.keys}`)
  // 9.ب أزواج المزامنة — إدارة مجلدات الكمبيوتر (إنشاء mkdir/تصفح/حذف) — الإطلاق كان محروسًا (FA-16) والإدارة مفتوحة!
  const ppLan = await reqJson(LAN, GW.port, '/api/prod/pairs', 'POST', { deviceA: 'a', folderA: 'fa22a', deviceB: 'b', folderB: 'fa22b' })
  check('FA22/PAIRS/lan: إنشاء زوج مزامنة (mkdir على القرص) من عميل شبكي → 403', LAN403(ppLan), `status=${ppLan.status}`)
  const puLan = await reqJson(LAN, GW.port, '/api/prod/pairs', 'PUT', { deviceId: 'fa22-x' })
  check('FA22/PAIRS/lan: استعراض مجلدات الكمبيوتر (listDir) من عميل شبكي → 403', LAN403(puLan), `status=${puLan.status}`)
  const pdLan = await reqJson(LAN, GW.port, '/api/prod/pairs', 'DELETE', { id: 'fa22-x' })
  check('FA22/PAIRS/lan: حذف زوج مزامنة من عميل شبكي → 403', LAN403(pdLan), `status=${pdLan.status}`)
  const ppLoc = await reqJson(REST.host, REST.port, '/api/prod/pairs', 'POST', { deviceA: 'x', folderA: 'fa22', deviceB: 'x', folderB: 'fa22' })
  check('FA22/PAIRS/loopback: الحرس يمر محليًا ويعبر للتحقق التعاقدي (400 مجلدان متطابقان)', ppLoc.status === 400 && ppLoc.json?.error === 'اختر مجلدين مختلفين', `status=${ppLoc.status} err=${ppLoc.json?.error}`)
  // 9.ج الملفات الشخصية — قلب بوابة الإشعارات عبر CRUD
  const pfLan = await reqJson(LAN, GW.port, '/api/prod/profiles', 'POST', { name: 'fa22', networkName: 'net' })
  check('FA22/PROFILES/lan: إنشاء ملف شخصي من عميل شبكي → 403', LAN403(pfLan), `status=${pfLan.status}`)
  const pfxLan = await reqJson(LAN, GW.port, '/api/prod/profiles', 'DELETE', { id: 'fa22-x' })
  check('FA22/PROFILES/lan: حذف ملف شخصي من عميل شبكي → 403', LAN403(pfxLan), `status=${pfxLan.status}`)
  const pfLoc = await reqJson(REST.host, REST.port, '/api/prod/profiles', 'POST', {})
  check('FA22/PROFILES/loopback: الحرس يمر محليًا (400 «الاسم واسم الشبكة مطلوبان»)', pfLoc.status === 400, `status=${pfLoc.status} err=${pfLoc.json?.error}`)
  // 9.د حالة الإنتاجية والشبكة — وضع الحافظة وقلب الإشعارات
  const psLan = await reqJson(LAN, GW.port, '/api/prod/state', 'PATCH', { clipMode: 'manual' })
  check('FA22/STATE/lan: قلب وضع الحافظة الموحدة من عميل شبكي → 403', LAN403(psLan), `status=${psLan.status}`)
  const psLoc = await reqJson(REST.host, REST.port, '/api/prod/state', 'PATCH', { clipMode: 'auto' })
  check('FA22/STATE/loopback: PATCH الحالة محليًا كما كانت (ok:true)', psLoc.status === 200 && psLoc.json?.ok === true, `status=${psLoc.status}`)
  const pnLan = await reqJson(LAN, GW.port, '/api/prod/network', 'POST', { network: 'Office-Net' })
  check('FA22/NETWORK/lan: تبديل الشبكة (قلب notifsPaused) من عميل شبكي → 403', LAN403(pnLan), `status=${pnLan.status}`)
  const pnLoc = await reqJson(REST.host, REST.port, '/api/prod/network', 'POST', {})
  check('FA22/NETWORK/loopback: الحرس يمر محليًا (400 «اسم الشبكة مطلوب»)', pnLoc.status === 400, `status=${pnLoc.status} err=${pnLoc.json?.error}`)
  // 9.هـ مساعدة الأجهزة — موافقة المالك على اقتران مساعدة = إدارة اقتران: يد الكمبيوتر حصرًا
  // (طلب/قطع/طي تبقى قنوات أجهزة موثقة — الفحص يثبت أن consent حصرًا هو المقفول)
  const acLan = await reqJson(LAN, GW.port, '/api/devices/assist', 'POST', { action: 'consent', accept: true, pendingId: 'fa22-x' })
  check('FA22/ASSIST/lan: موافقة مالك على طلب اقتران من عميل شبكي → 403 (فئة pair.admin)', LAN403(acLan), `status=${acLan.status}`)
  const aqLan = await reqJson(LAN, GW.port, '/api/devices/assist', 'POST', { action: 'request', assistCode: '000000' })
  check('FA22/ASSIST/lan: طلب المساعدة (قناة جهاز موثقة برمز) لا يُقفل — يعبر للحرس التعاقدي للرمز', aqLan.status === 403 && aqLan.json?.error !== 'pc-only', `status=${aqLan.status} err=${String(aqLan.json?.error ?? aqLan.json?.reason)?.slice(0, 40)}`)
  const acLoc = await reqJson(REST.host, REST.port, '/api/devices/assist', 'POST', { action: 'consent', accept: true, pendingId: 'no-such' })
  check('FA22/ASSIST/loopback: موافقة محلية تعبر الحرس لمنطق الموافقة (404 لا طلب مطابق)', acLoc.status === 404, `status=${acLoc.status} err=${acLoc.json?.error}`)
  // 9.و الأمن — جرد ملفات المسح الآمن وكتابة المستلامات على القرص
  const wpLan = await reqJson(LAN, GW.port, '/api/security/wipe', 'GET')
  check('FA22/WIPE/lan: جرد الملفات القابلة للمسح من عميل شبكي → 403', LAN403(wpLan), `status=${wpLan.status}`)
  const wpLoc = await reqJson(REST.host, REST.port, '/api/security/wipe', 'GET')
  check('FA22/WIPE/loopback: الجرد محليًا كما كان (ok:true)', wpLoc.status === 200 && wpLoc.json?.ok === true, `status=${wpLoc.status}`)
  const rcLan = await reqJson(LAN, GW.port, '/api/security/recv', 'POST', { name: 'fa22.bin', dataB64: 'aGk=' })
  check('FA22/RECV/lan: كتابة ملف مستلم على قرص الكمبيوتر من عميل شبكي → 403', LAN403(rcLan), `status=${rcLan.status}`)
  const rcLoc = await reqJson(REST.host, REST.port, '/api/security/recv', 'POST', {})
  check('FA22/RECV/loopback: الحرس يمر محليًا (400 بيانات ناقصة — لا كتابة)', rcLoc.status === 400, `status=${rcLoc.status}`)
  // 9.ز الماسح — معاينة الوثائق (توثيق §62 نفسه قال «العيادة على حاسوب المالك حصرًا» وكان الحرس معلنًا بلا تنفيذ)
  const spLan = await reqJson(LAN, GW.port, '/api/scan/preview?id=fa22&n=1', 'GET')
  check('FA22/SCAN-PREV/lan: معاينة وثائق الماسح من عميل شبكي → 403 قبل أي 404', LAN403(spLan), `status=${spLan.status}`)
  const spLoc = await reqJson(REST.host, REST.port, '/api/scan/preview?id=fa22&n=1', 'GET')
  check('FA22/SCAN-PREV/loopback: المعاينة محليًا تعبر الحرس لمنطق الجلسة (404 لا جلسة)', spLoc.status === 404, `status=${spLoc.status}`)
  // 9.ح فحص APK — تنفيذ subprocess (unzip) فعل المالك حصرًا
  const akLan = await reqJson(LAN, GW.port, '/api/apk', 'POST', { deviceId: 'fa22-x', path: 'x.apk' })
  check('FA22/APK/lan: فحص APK (exec unzip) من عميل شبكي → 403 قبل أي تنفيذ', LAN403(akLan), `status=${akLan.status}`)
}

// ==== 10) FA-23 عبر HTTP (تكليف 54) — توحيد الحراس الحلقوية اليدوية تحت الحرس المنظومي ====
// الحراس اليدوية القديمة (نمط §37/§38/§48/§49/§51) كانت نسخًا متكررة من الفعل نفسه
// (isLoopbackIp + فحص ترويسة يدوي) خارج بوابة FA-14/16/22. التوحيد: الفعل واحد
// في http-guard (guardPcOnly ببارامتر reason يصون meta القديمة — وبموجة FA-24
// انتقلت قراءات الأدلة الثلاث أيضًا فنهاية الرفض الصامت) — والعقود المفحوصة كلها محفوظة حرفيًا: نفس 403 بنفس سلسلة
// الخطأ لكل مسار ونفس meta.reason "loopback" (audit-e2e S7 يثبتها).
{
  // 10.أ فحوص مصدر — لا نسخة للحرس خارج http-guard والمسارات الستة تحت الحرس الواحد
  const fs2 = await import('node:fs')
  const routeSrc = (f) => fs2.readFileSync(new URL(`../src/app/api/${f}/route.ts`, import.meta.url), 'utf8')
  const adminRoutes = ['relay', 'security/emergency', 'remote-access', 'guest/share', 'handoff', 'backup-secure']
  const readRoutes = ['enterprise/audit', 'enterprise/compliance', 'enterprise/report']
  const legacyRoutes = [...adminRoutes, ...readRoutes]
  const legacyDefFiles = legacyRoutes.map((f) => [f, routeSrc(f)])
    .concat([
      ['backup-secure-server', fs2.readFileSync(new URL('../src/lib/nexus/backup-secure-server.ts', import.meta.url), 'utf8')],
      ['scan-server', fs2.readFileSync(new URL('../src/lib/nexus/scan-server.ts', import.meta.url), 'utf8')],
    ])
  const defCount = legacyDefFiles.filter(([, s]) => /function isLoopbackIp/.test(s)).length
  check('FA23/src: صفر تعريف isLoopbackIp خارج http-guard (9 مسارات + مكتبتان — النسخ كلها حذفت)', defCount === 0, `defs=${defCount}`)
  const adminGuarded = adminRoutes.filter((f) => routeSrc(f).includes('guardPcOnly(')).length
  check('FA23/src: المسارات الإدارية الستة تحت guardPcOnly المنظومي حصرًا', adminGuarded === 6, `guarded=${adminGuarded}/6`)
  // FA-24 (تكليف 55): القراءات الثلاث انتقلت أيضًا تحت guardPcOnly (نهاية الرفض الصامت) — التسعة كلها تحت الحرس الواحد
  const legacyGuarded = legacyRoutes.filter((f) => routeSrc(f).includes('guardPcOnly(')).length
  check('FA23/src: المسارات التسعة (6 إدارية + 3 قراءات أدلة بموجة FA-24) تحت guardPcOnly المنظومي حصرًا', legacyGuarded === 9, `guarded=${legacyGuarded}/9`)
  const guardSrc = fs2.readFileSync(new URL('../src/lib/nexus/http-guard.ts', import.meta.url), 'utf8')
  check('FA23/src: الحرس المنظومي يقبل reason ("pc-only"|"loopback") فيصون meta القديمة',
    guardSrc.includes('reason: "pc-only" | "loopback" = "pc-only"'), 'http-guard')
  const stringsKept = adminRoutes.every((f, i) => routeSrc(f).includes(
    ['relay-admin-loopback-only', 'emergency-admin-loopback-only', 'pair-admin-loopback-only',
      'guest-admin-loopback-only', 'handoff-admin-loopback-only', 'backup-admin-loopback-only'][i]))
  check('FA23/src: سلاسل أخطاء 403 التعاقدية الست كما هي (عقود البوابات القديمة محفوظة)', stringsKept, 'legacy 403 strings')
  // 10.ب رفض حي عبر البوابة من LAN — كل مسار بسلسلة خطئه المعلنة (10 بوابات موحدة)
  const LANerr = (r, err) => r.status === 403 && r.json?.error === err && r.json?.detail === 'via-gateway-non-loopback'
  const rlLan = await reqJson(LAN, GW.port, '/api/relay', 'POST', { action: 'enable', url: 'https://evil.example', secret: 's' })
  check('FA23/RELAY/lan: إدارة المرحّل من عميل شبكي → 403 relay-admin-loopback-only (عقد §49 كما هو)', LANerr(rlLan, 'relay-admin-loopback-only'), `status=${rlLan.status}`)
  const emLan = await reqJson(LAN, GW.port, '/api/security/emergency', 'POST', { action: 'arm', pin: '0000' })
  check('FA23/EMERGENCY/lan: تسليح الطوارئ من عميل شبكي → 403 emergency-admin-loopback-only (عقد §48 كما هو)', LANerr(emLan, 'emergency-admin-loopback-only'), `status=${emLan.status}`)
  const raLan = await reqJson(LAN, GW.port, '/api/remote-access', 'POST', { action: 'enable' })
  check('FA23/REMOTE-ACCESS/lan: إدارة الاقتران من عميل شبكي برمز مزعوم → 403 pair-admin-loopback-only (عقد §37 كما هو)', LANerr(raLan, 'pair-admin-loopback-only'), `status=${raLan.status}`)
  const gsLan = await reqJson(LAN, GW.port, '/api/guest/share', 'POST', { action: 'enable', mode: 'send' })
  check('FA23/GUEST/lan: إدارة المشاركة الضيوفية من عميل شبكي → 403 guest-admin-loopback-only (عقد §51 كما هو)', LANerr(gsLan, 'guest-admin-loopback-only'), `status=${gsLan.status}`)
  const hdLan = await reqJson(LAN, GW.port, '/api/handoff', 'POST', { action: 'clear' })
  check('FA23/HANDOFF/lan: تفريغ التسليم من عميل شبكي → 403 handoff-admin-loopback-only', LANerr(hdLan, 'handoff-admin-loopback-only'), `status=${hdLan.status}`)
  const hkLan = await reqJson(LAN, GW.port, '/api/handoff', 'POST', { action: 'rotate-key' })
  check('FA23/HANDOFF/lan: تدوير قفل التسليم من عميل شبكي → 403 handoff-admin-loopback-only', LANerr(hkLan, 'handoff-admin-loopback-only'), `status=${hkLan.status}`)
  const bsLan = await reqJson(LAN, GW.port, '/api/backup-secure', 'POST', { action: 'schedule-enable', hours: 24 })
  check('FA23/BACKUP-SEC/lan: جدولة الدرع الاحتياطي من عميل شبكي → 403 backup-admin-loopback-only (حرس FA-14 والفرع الموحد FA-23)', LANerr(bsLan, 'backup-admin-loopback-only'), `status=${bsLan.status}`)
  const auLan = await reqJson(LAN, GW.port, '/api/enterprise/audit', 'GET')
  check('FA23/ENTERPRISE-AUDIT/lan: عرض سلسلة التدقيق من عميل شبكي → 403 audit-loopback-only (عقد §39 كما هو)', LANerr(auLan, 'audit-loopback-only'), `status=${auLan.status}`)
  const coLan = await reqJson(LAN, GW.port, '/api/enterprise/compliance', 'GET')
  check('FA23/COMPLIANCE/lan: تقرير الامتثال من عميل شبكي → 403 compliance-loopback-only (عقد §38 كما هو)', LANerr(coLan, 'compliance-loopback-only'), `status=${coLan.status}`)
  const rpLan = await reqJson(LAN, GW.port, '/api/enterprise/report', 'GET')
  check('FA23/REPORT/lan: مولد تقارير التدقيق من عميل شبكي → 403 report-loopback-only (عقد §47 كما هو)', LANerr(rpLan, 'report-loopback-only'), `status=${rpLan.status}`)
  // 10.ج أثباتات loopback — الحرس يمرر المحلي للمنطق التعاقدي حرفيًا (سلوك ما قبل التوحيد بلا انحراف)
  const rlLoc = await reqJson(REST.host, REST.port, '/api/relay', 'POST', { action: 'no-such-fa23' })
  check('FA23/RELAY/loopback: الإدارة محليًا تعبر الحرس لمنطق §49 (400 unknown-action بتوثيقه)', rlLoc.status === 400 && rlLoc.json?.error === 'unknown-action', `status=${rlLoc.status}`)
  const emLoc = await reqJson(REST.host, REST.port, '/api/security/emergency', 'POST', { action: 'unkill' })
  check('FA23/EMERGENCY/loopback: المحلي يعبر الحرس للحد البنيوي (400 no-unkill-ever — لا عودة أبدًا)', emLoc.status === 400 && emLoc.json?.error === 'no-unkill-ever', `status=${emLoc.status}`)
  const raLoc = await reqJson(REST.host, REST.port, '/api/remote-access', 'POST', { action: 'rotate' })
  check('FA23/REMOTE-ACCESS/loopback: المحلي يعبر الحرس لعقد الإدارة (409 not-enabled — الاقتران معطل بيئيًا)', raLoc.status === 409 && raLoc.json?.error === 'not-enabled', `status=${raLoc.status}`)
  const gsLoc = await reqJson(REST.host, REST.port, '/api/guest/share', 'POST', { action: 'enable', mode: 'fa23-bogus' })
  check('FA23/GUEST/loopback: المحلي يعبر الحرس للتحقق التعاقدي (400 وضع غير صالح — بلا كتابة)', gsLoc.status === 400, `status=${gsLoc.status} err=${String(gsLoc.json?.error ?? '')?.slice(0, 30)}`)
  const hdLoc = await reqJson(REST.host, REST.port, '/api/handoff', 'POST', { action: 'clear' })
  check('FA23/HANDOFF/loopback: التفريغ محليًا كما كان (200 ok)', hdLoc.status === 200 && hdLoc.json?.ok === true, `status=${hdLoc.status}`)
  const bsLoc = await reqJson(REST.host, REST.port, '/api/backup-secure', 'POST', { action: 'schedule-disable' })
  check('FA23/BACKUP-SEC/loopback: إيقاف الجدولة محليًا كما كان (200 ok — بذور نظيفة)', bsLoc.status === 200 && bsLoc.json?.ok === true, `status=${bsLoc.status}`)
  const auLoc = await reqJson(REST.host, REST.port, '/api/enterprise/audit', 'GET')
  check('FA23/ENTERPRISE-AUDIT/loopback: العرض محليًا يفتح السلسلة الحية (200 valid:true — رفضات LAN أعلاه موثقة فيها)', auLoc.status === 200 && auLoc.json?.ok === true && auLoc.json?.valid === true, `status=${auLoc.status} count=${auLoc.json?.count}`)
}

// ==== 11) FA-24 عبر HTTP (تكليف 55) — نهاية الرفض الصامت لقراءة الأدلة: كل رفض LAN لقراءة §38/§39/§47 يوثق في سلسلة §39 نفسها ====
// الباب المعلن حرفيًا في حدود FA-23 («تدقيق رفض القراءة باب لاحق يبدأ بتحديث عقود العدّ
// في تلك الجولة أولًا») — عُدّ audit-e2e S16/S17 حُدّثا (3→4) وS15 يثبت السجل نفسه،
// وهنا العقد الدائم: صفر isLocalRequest في المسارات + النوع الجديد + رفض حي موثق
// + المخفف 3 ثوانٍ + شكل السجل + أثبات loopback.
{
  // 11.أ فحوص مصدر — صفر استخدام للحرس الصامت في كل مسارات API والنوع في المكتبة الواحدة
  const fs2 = await import('node:fs')
  const path2 = await import('node:path')
  const routeSrc = (f) => fs2.readFileSync(new URL(`../src/app/api/${f}/route.ts`, import.meta.url), 'utf8')
  const auditSrc = fs2.readFileSync(new URL('../src/lib/enterprise-audit.ts', import.meta.url), 'utf8')
  let apiRoutes = 0
  let silentUses = 0
  const walk = (d) => {
    for (const e of fs2.readdirSync(d, { withFileTypes: true })) {
      const p = path2.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'route.ts') { apiRoutes++; if (/[^\w.]isLocalRequest\(/.test(fs2.readFileSync(p, 'utf8'))) silentUses++ }
    }
  }
  walk(path2.join(process.cwd(), 'src', 'app', 'api'))
  check('FA24/src: صفر استخدام isLocalRequest في كل مسارات API (الرفض الصامت انتهى — الحرس الواحد guardPcOnly)', apiRoutes > 40 && silentUses === 0, `routes=${apiRoutes} silent=${silentUses}`)
  check('FA24/src: نوع evidence.denied في AuditType ومجموعة KINDS (المكتبة الواحدة — الغريب يرفض وقت الكتابة)', auditSrc.includes('| "evidence.denied"') && auditSrc.includes('"evidence.denied",'), 'enterprise-audit')
  const reads = [
    ['enterprise/audit', 'audit-view', 'audit-loopback-only'],
    ['enterprise/compliance', 'compliance-view', 'compliance-loopback-only'],
    ['enterprise/report', 'report-view', 'report-loopback-only'],
  ]
  const okReads = reads.filter(([f, act, err]) => routeSrc(f).includes(`"evidence.denied", "${act}", "loopback"`) && routeSrc(f).includes(err)).length
  check('FA24/src: القراءات الثلاث فوق guardPcOnly بنوع evidence.denied وreason=loopback وسلاسل 403 التعاقدية كما هي', okReads === 3, `reads=${okReads}/3`)
  // 11.ب رفض حي يوثق في السلسلة نفسها + المخفف 3 ثوانٍ (رفضان متتاليان بسجل واحد)
  // تصفير مخفف الحرس أولًا (3 ثوانٍ لكل kind:action في عملية الخادم الواحدة — درس الجسور FA-13)
  await new Promise((r) => setTimeout(r, 3300))
  const evidence = async () => {
    const r = await reqJson(REST.host, REST.port, '/api/enterprise/audit?limit=500', 'GET')
    const byAction = {}
    for (const e of (r.json?.events ?? [])) if (e.k === 'evidence.denied') byAction[e.d?.action] = (byAction[e.d?.action] ?? 0) + 1
    return byAction
  }
  const before = await evidence()
  for (const p of ['/api/enterprise/audit', '/api/enterprise/compliance', '/api/enterprise/report']) {
    await reqJson(LAN, GW.port, p, 'GET')
    await reqJson(LAN, GW.port, p, 'GET')
  }
  await new Promise((r) => setTimeout(r, 200))
  const after = await evidence()
  const deltas = ['audit-view', 'compliance-view', 'report-view'].map((act) => (after[act] ?? 0) - (before[act] ?? 0))
  check('FA24/lan: كل رفض LAN لقراءة الأدلة يوثق في سلسلة §39 نفسها — رفضان متتاليان بسجل واحد لكل نقطة (المخفف يوثق أول رفض حصرًا)', deltas.every((d) => d === 1), `deltas=${deltas.join(',')}`)
  const evAll = (await reqJson(REST.host, REST.port, '/api/enterprise/audit?limit=500', 'GET')).json?.events?.filter((e) => e.k === 'evidence.denied') ?? []
  const shaped = evAll.every((e) => e.ok === false && e.actor === 'remote' && e.d?.reason === 'loopback' && ['audit-view', 'compliance-view', 'report-view'].includes(e.d?.action))
  check('FA24/shape: سجلات evidence.denied بأبعادها التعاقدية حصرًا (ok=false actor=remote reason=loopback أفعال الأدلة الثلاثة)', evAll.length >= 3 && shaped, `n=${evAll.length}`)
  // 11.ج أثبات loopback — المحلي يقرأ الدليل بلا أي سجل رفض له (الحرس يمرر المحلي للمنطق التعاقدي)
  const coLoc = await reqJson(REST.host, REST.port, '/api/enterprise/compliance', 'GET')
  const rpLoc = await reqJson(REST.host, REST.port, '/api/enterprise/report', 'GET')
  check('FA24/loopback: الامتثال والتقرير محليًا كما كانا (200 — الحرس يمرر المحلي ورفضاته للسلسلة حصرًا)', coLoc.status === 200 && coLoc.json?.ok === true && rpLoc.status === 200 && rpLoc.json?.ok === true, `co=${coLoc.status} rp=${rpLoc.status}`)
  const locRead = await reqJson(REST.host, REST.port, '/api/enterprise/audit?limit=500', 'GET')
  const allRemote = (locRead.json?.events ?? []).filter((e) => e.k === 'evidence.denied').every((e) => e.actor === 'remote')
  check('FA24/loopback: العرض محليًا يفتح السلسلة الحية (valid:true) وسجلات الرفض actor=remote حصرًا (المحلي لا يرفض أصلًا)', locRead.status === 200 && locRead.json?.valid === true && allRemote, `count=${locRead.json?.count}`)
}

// ==== 12) FA-25 عبر المصدر (تكليف 56) — الاسترجاع الانتقائي: مدقق SOC 2 يسأل سلسلة §39 أسئلتها عبر النقطة المحرسة نفسها ====
// الامتداد البنيوي المعلن لحدود FA-24: بعد أن صارت الرفضات أدلةً بقائمة مولّدة
// جديدة، كانت نقطة العرض الوحيدة تعرف «آخر N حدث» حصرًا — فلا سؤال «كل رفضات
// الأدلة؟» إلا بقراءة الملف على الجهاز مباشرة — تخطٍّ لحرس القراءة المصمم
// حصرًا ليكون الأدلة عبر HTTP. الإغلاق: قائمة الأنواع المولّدة حصرا (الغريب
// 400 بلا أي قراءة) + شكل الفعل الصارم + بروفايل limit على المطابقات
// (matched/truncated) — والمسار بلا بارامترات بحرفه بلا حقل جديد.
{
  const fs2 = await import('node:fs')
  const libSrc = fs2.readFileSync(new URL('../src/lib/enterprise-audit.ts', import.meta.url), 'utf8')
  const routeSrc = fs2.readFileSync(new URL('../src/app/api/enterprise/audit/route.ts', import.meta.url), 'utf8')
  check('FA25/src: الاسترجاع الانتقائي في المكتبة الواحدة (readAuditFiltered + isAuditKind عضو القائمة)',
    libSrc.includes('export function readAuditFiltered') && libSrc.includes('export function isAuditKind'), 'enterprise-audit')
  check('FA25/src: النقطة تفرض القائمة المولّدة حصرا والغريب 400 بلا أي قراءة (bad-audit-type/bad-audit-action) والحرس ما يزال أول الدالة',
    routeSrc.includes('isAuditKind(rawType)') && routeSrc.includes('bad-audit-type') && routeSrc.includes('bad-audit-action')
    && routeSrc.includes('readAuditFiltered') && /guardPcOnly\(request, "evidence\.denied", "audit-view", "loopback"\)/.test(routeSrc), 'enterprise/audit')
  check('FA25/src: التوافق الرجعي حرفًا — المسار بلا بارامترات يعود بtail كما كان وبلا حقول جديدة',
    routeSrc.includes('readAuditTail(limit)') && routeSrc.includes('!filtering'), 'enterprise/audit')
}

const fails = results.filter((r) => !r.ok).length
console.log(`\n=== FA-13+14+15+16+22+23+24+25 E2E: ${results.length - fails}/${results.length} PASS ===`)
process.exit(fails ? 1 : 0)
