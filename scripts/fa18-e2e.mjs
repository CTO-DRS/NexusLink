// FA-18 — تحقق E2E حي: الطبقة الثالثة للمتصفح — CSP بالـnonce + صفر طلب خارجي + وكيل وسائط الهاتف (تكليف 45)
// =====================================================================================================
// · كل مستند HTML يحمل CSP حية: script-src 'self' 'nonce-…' 'strict-dynamic' + connect-src 'self' صافية
// · nonce حي يطابق ترويسة CSP ويختلف كل طلب (لا إعادة تشغيل)
// · صفر fonts.googleapis|fonts.gstatic في أي بايت مخدوم — الخط مستضاف /fonts/
// · وكيل /api/phone-media/list: loopback يمر (503 بلا هاتف) · عبر البوابة من LAN → 403 pc-only
// · حرس الأصل (تكليف 38) حي: Origin عام على POST → 403 cross-origin-blocked
// الاستخدام: node scripts/fa18-e2e.mjs   (المكدس عامر: next standalone :3000 + بوابة 8207)
import { request } from 'node:http'
import os from 'node:os'
import { readFileSync, readdirSync } from 'node:fs'

const GW = { host: '127.0.0.1', port: Number(process.env.FA13_GW_PORT) || 8207 }
const REST = { host: '127.0.0.1', port: 3000 }
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
function lanIp() {
  return Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4')?.address || ''
}
function reqRaw(host, port, path, method = 'GET', body = null, headers = {}) {
  return new Promise((res, rej) => {
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    const h = { ...headers }
    if (data) { h['content-type'] = 'application/json'; h['content-length'] = data.length }
    const r = request({ host, port, path, method, headers: h }, (resp) => {
      let raw = ''
      resp.on('data', (c) => { raw += c })
      resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, raw }))
    })
    r.on('error', rej)
    if (data) r.write(data)
    r.end()
  })
}

const LAN = lanIp()
if (!LAN) { console.log('FAIL بلا عنوان LAN — لا يمكن محاكاة عميل شبكي'); process.exit(1) }

// ==== 1) CSP على مستند HTML الرئيسي — حية ومطابقة ومتغيرة ====
const doc1 = await reqRaw(REST.host, REST.port, '/', 'GET', null, { accept: 'text/html' })
const csp1 = doc1.headers['content-security-policy'] || ''
check('FA18/CSP: الصفحة الرئيسية تحمل Content-Security-Policy', !!csp1, csp1.slice(0, 60) + '…')
check('FA18/CSP: script-src فيه nonce حي + strict-dynamic', /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp1), csp1.match(/script-src[^;]*/)?.[0] || '—')
check('FA18/CSP: default-src و connect-src و font-src نفس الأصل صافية',
  /default-src 'self'/.test(csp1) && /connect-src 'self'(;|$)/.test(csp1) && /font-src 'self'/.test(csp1), '')
check('FA18/CSP: frame-ancestors self و object-src none و base-uri/form-action self',
  /frame-ancestors 'self'/.test(csp1) && /object-src 'none'/.test(csp1) && /base-uri 'self'/.test(csp1) && /form-action 'self'/.test(csp1), '')
const cspNonce = (csp1.match(/'nonce-([^']+)'/) || [])[1]
const html1 = doc1.raw
const htmlNonce = (html1.match(/<script\s+nonce="([^"]+)"/) || [])[1]
check('FA18/CSP: سكربت الثيم المضمّن يحمل نفس nonce الترويسة', !!cspNonce && htmlNonce === cspNonce, `csp=${cspNonce?.slice(0, 8)} html=${htmlNonce?.slice(0, 8)}`)
const doc2 = await reqRaw(REST.host, REST.port, '/', 'GET', null, { accept: 'text/html' })
const cspNonce2 = ((doc2.headers['content-security-policy'] || '').match(/'nonce-([^']+)'/) || [])[1]
check('FA18/CSP: nonce جديد كل طلب (لا إعادة تشغيل ولا تخزين)', !!cspNonce2 && cspNonce2 !== cspNonce, `${cspNonce?.slice(0, 8)} ≠ ${cspNonce2?.slice(0, 8)}`)

// ==== 2) بقية مستندات الواجهة والمستقل ====
for (const p of ['/tv', '/phone', '/download', '/controller']) {
  const d = await reqRaw(REST.host, REST.port, p, 'GET', null, { accept: 'text/html' })
  check(`FA18/CSP${p}: مستند حي بسياسة nonce`, /script-src 'self' 'nonce-/.test(d.headers['content-security-policy'] || ''), `status=${d.status}`)
}
const wc = await reqRaw(REST.host, REST.port, '/web-client/index.html', 'GET', null, { accept: 'text/html' })
check('FA18/CSP/web-client: العميل المستقل بسياسة كذلك', /script-src 'self' 'nonce-/.test(wc.headers['content-security-policy'] || ''), `status=${wc.status}`)

// ==== 3) الأصول والـAPI بلا تدخل ====
const health = await reqRaw(REST.host, REST.port, '/api/health')
check('FA18/API: /api/health بلا CSP (JSON ليس مستندًا) ويعمل', !health.headers['content-security-policy'] && health.raw.includes('"ok":true'), '')
const cssPath = (html1.match(/href="(\/_next\/static\/[^"]+\.css)"/) || [])[1]
check('FA18/CSS: الصفحة تشير لملف CSS مبني', !!cssPath, cssPath || '—')
if (cssPath) {
  const css = await reqRaw(REST.host, REST.port, cssPath)
  check('FA18/CSS: ملف البناء بلا googleapis ولا gstatic (الخط محلي)',
    css.status === 200 && !css.raw.includes('fonts.googleapis') && !css.raw.includes('fonts.gstatic'), `bytes=${css.raw.length}`)
  check('FA18/CSS: @font-face يشير إلى /fonts/plex-ar- (الاستضافة المحلية صارت في البناء)', css.raw.includes('/fonts/plex-ar-'), '')
  const htmlNoFont = !html1.includes('fonts.googleapis') && !html1.includes('fonts.gstatic')
  check('FA18/HTML: صفر طلب خط خارجي في HTML المخدوم', htmlNoFont, '')
}
const fontFile = readdirSync('public/fonts')[0]
const fontResp = await reqRaw(REST.host, REST.port, `/fonts/${fontFile}`)
check('FA18/FONT: ملف الخط يُخدوم محليًا بصيغة woff2 سليمة',
  fontResp.status === 200 && fontResp.raw.slice(0, 4) === 'wOF2', `status=${fontResp.status}`)

// ==== 4) ترويسات الأمن القديمة سليمة ====
check('FA18/HEADERS: X-Frame-Options و nosniff و Referrer-Policy و Permissions-Policy كما هي',
  doc1.headers['x-frame-options'] === 'SAMEORIGIN' && doc1.headers['x-content-type-options'] === 'nosniff'
  && doc1.headers['referrer-policy'] === 'no-referrer' && (doc1.headers['permissions-policy'] || '').includes('camera=(self)'), '')

// ==== 5) حرس الأصل (تكليف 38) حي بعد إعادة الهيكلة ====
const evil = await reqRaw(REST.host, REST.port, '/api/fs', 'POST', { action: 'list', path: '/' }, { origin: 'https://evil.example' })
check('FA18/ORIGIN: POST من أصل عام → 403 cross-origin-blocked', evil.status === 403 && evil.raw.includes('cross-origin-blocked'), `status=${evil.status}`)
const own = await reqRaw(REST.host, REST.port, '/api/fs', 'POST', { action: 'list', path: '/' }, { origin: `http://127.0.0.1:${REST.port}` })
check('FA18/ORIGIN: POST من أصل محلي يمر الحرس (ليس cross-origin-blocked)', own.status !== 403 || !own.raw.includes('cross-origin-blocked'), `status=${own.status}`)

// ==== 6) وكيل وسائط الهاتف — نفس الأصل + حرس FA-16 ====
const pmLocal = await reqRaw(REST.host, REST.port, '/api/phone-media/list?dir=%2F')
check('FA18/PROXY/loopback: الوكيل يمر الحرس ويجيب بصدق (503 بلا هاتف)', pmLocal.status === 503 && pmLocal.raw.includes('phone-media-offline'), `status=${pmLocal.status}`)
const pmLan = await reqRaw(LAN, GW.port, '/api/phone-media/list?dir=%2F')
check('FA18/PROXY/lan: قراءة وسائط الهاتف عبر البوابة من عميل شبكي → 403 pc-only', pmLan.status === 403 && pmLan.raw.includes('pc-only'), `status=${pmLan.status}`)
const pmGwLoop = await reqRaw('127.0.0.1', GW.port, '/api/phone-media/list?dir=%2F')
check('FA18/PROXY/gw-loopback: عبر البوابة من loopback يمر (503 بلا هاتف)', pmGwLoop.status === 503, `status=${pmGwLoop.status}`)

// ==== 7) عميل الويب المستقل سليم بعد إعادة الهيكلة ====
const wcjs = await reqRaw(REST.host, REST.port, '/web-client/app.js')
check('FA18/WEBCLIENT: app.js للعميل المستقل يُخدوم كما هو', wcjs.status === 200 && wcjs.raw.includes('makeGuardedFetch'), `status=${wcjs.status}`)

console.log(`\n=== fa18-e2e: ${results.filter(r => r.ok).length}/${results.length} ===`)
process.exit(failed ? 1 : 0)
