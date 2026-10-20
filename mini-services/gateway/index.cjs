#!/usr/bin/env node
"use strict";
// NexusLink — بوابة الإدخال الموحدة (بديل Caddy داخل حزمة سطح المكتب)
// ============================================================
// نفس العقد الحرفي للبوابة (docs/protocol-contract.md §1 + Caddyfile):
//  - أي طلب يحمل ?XTransformPort=<port> يُحوَّل إلى 127.0.0.1:<port> (HTTP + WS upgrade)
//  - غير ذلك → REST_TARGET (الواجهة + /api/* على 3000)
//  - GET /__gw/health → فحص جاهزية البوابة نفسها (بلا تبعية للأعلى)
// صفر تبعيات — وحدات node مدمجة حصرًا (http/net/fs/crypto/path). نفس سلوك
// header_up Host {host}: نمرّر الترويسات كما هي (Host الأصلي مع المنفذ 81 يصل للأعلى).
//
// §37 — رمز الوصول البعيد (إغلاق حد §36.هـ.1 — docs/protocol-contract.md):
//  - OFF بالتصميم: بلا ملف رمز صالح فالسلوك حرفيًا كما كان (صفر تغيير أمني).
//  - عند التمكين (POST /api/remote-access يكتب ملف JSON): كل واصل من خارج
//    loopback يجب أن يحمل الرمز بترويسة x-pair-token أو بارامتر ?pair= —
//    والإعفاء حصرًا: /__gw/health وواصل loopback (الجهاز هي الحدود).
//  - مقارنة زمن-ثابت عبر sha256 (لا تسرّب طول) + حجب مؤقت لكل IP بعد 5 فشل.
//  - نظافة: بارامتر pair يُجرَد من المسار قبل التحويل للأعلى (الرمز لا يصل
//    لسجلات الخدمات الداخلية أبدًا) ولا يُطبع في أي سجل.
const http = require("http")
const net = require("net")
const fs = require("fs")
const crypto = require("crypto")
const pathMod = require("path")

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 81)
const FALLBACK_PORT = Number(process.env.GATEWAY_FALLBACK_PORT || 8180)
const REST_HOST = process.env.REST_HOST || "127.0.0.1"
const REST_PORT = Number(process.env.REST_PORT || 3000)
const STARTED_AT = Date.now()
let BOUND_PORT = GATEWAY_PORT

// §37 — مصدر الحقيقة الواحد للرمز: ملف JSON خارج المخطط (صفر-مخطط، صفر-db)
// { token, fingerprint, createdAt } — تكتبه /api/remote-access وحذفه = تعطيل.
const PAIR_FILE = process.env.NEXUSLINK_PAIR_FILE || pathMod.join(process.cwd(), ".zstate", "pair-token.json")
let pairCache = { mtimeMs: -1, size: -1, data: null }

function loadPair() {
  try {
    const st = fs.statSync(PAIR_FILE)
    if (st.mtimeMs !== pairCache.mtimeMs || st.size !== pairCache.size) {
      const j = JSON.parse(fs.readFileSync(PAIR_FILE, "utf8"))
      pairCache = { mtimeMs: st.mtimeMs, size: st.size, data: j && typeof j.token === "string" && j.token.length >= 16 ? { token: j.token } : null }
    }
    return pairCache.data
  } catch {
    pairCache = { mtimeMs: -1, size: -1, data: null }
    return null
  }
}

function isLoopbackIp(ip) {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

/** مقارنة زمن-ثابت عبر هضم ثابت الطول — لا تسرّب طول ولا بادئة */
function tokenMatches(candidate, expected) {
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest()
  return crypto.timingSafeEqual(h(candidate), h(expected))
}

// حجب تجريبي في الذاكرة حصرًا: 5 فشل متتالٍ من IP واحد → قفل 30 ثانية.
// الرمز الصحيح ينجح ويصفّر العداد حتى أثناء القفل (المالك يعرف رمزه).
const PAIR_MAX_FAILS = 5
const PAIR_LOCK_MS = 30000
const pairFails = new Map()

function pairLockedMs(ip) {
  const f = pairFails.get(ip)
  if (!f || !f.until) return 0
  return Date.now() < f.until ? f.until - Date.now() : 0
}

function pairFail(ip) {
  const f = pairFails.get(ip) || { n: 0, until: 0 }
  if (f.until && Date.now() >= f.until) f.n = 0
  f.until = 0
  f.n += 1
  if (f.n >= PAIR_MAX_FAILS) { f.until = Date.now() + PAIR_LOCK_MS; f.n = 0 }
  pairFails.set(ip, f)
}

function pairCandidate(req, u) {
  const h = req.headers["x-pair-token"]
  if (typeof h === "string" && h.length > 0) return h
  const q = u.searchParams.get("pair")
  return typeof q === "string" && q ? q : ""
}

/** حسم البوابة لطلب HTTP — false = رُفض وردّ 401/429 (المتصل loopback معفى دائمًا) */
function pairGateHttp(req, res, reqUrl) {
  const pair = loadPair()
  if (!pair) return true // OFF — السلوك التاريخي حرفيًا
  const ip = clientIp(req)
  if (isLoopbackIp(ip)) return true
  let u
  try { u = new URL(reqUrl, "http://gw") } catch { u = new URL("/", "http://gw") }
  const cand = pairCandidate(req, u)
  if (cand && tokenMatches(cand, pair.token)) { pairFails.delete(ip); return true }
  const lockMs = pairLockedMs(ip)
  if (lockMs > 0) {
    res.writeHead(429, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    res.end(JSON.stringify({ ok: false, gateway: true, error: "pair-locked", retryAfterMs: lockMs }))
  } else {
    pairFail(ip)
    res.writeHead(401, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    res.end(JSON.stringify({ ok: false, gateway: true, error: "pair-token-required" }))
  }
  return false
}

/** حسم البوابة لترقية WS — نفس الحسم برد خام على المقبس */
function pairGateRaw(req, socket, reqUrl) {
  const pair = loadPair()
  if (!pair) return true
  const ip = clientIp(req)
  if (isLoopbackIp(ip)) return true
  let u
  try { u = new URL(reqUrl, "http://gw") } catch { u = new URL("/", "http://gw") }
  const cand = pairCandidate(req, u)
  if (cand && tokenMatches(cand, pair.token)) { pairFails.delete(ip); return true }
  try {
    if (pairLockedMs(ip) > 0) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\ncontent-type: application/json\r\n\r\n" + JSON.stringify({ ok: false, gateway: true, error: "pair-locked" }))
    } else {
      pairFail(ip)
      socket.end("HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\n\r\n" + JSON.stringify({ ok: false, gateway: true, error: "pair-token-required" }))
    }
  } catch { /* مقبس ميت */ }
  return false
}

/** نظافة §37: إسقاط بارامتر pair قبل التحويل للأعلى — الرمز لا يغادر البوابة */
function stripPair(u) {
  if (!u || u.indexOf("pair=") === -1) return u
  try {
    const o = new URL(u, "http://gw")
    o.searchParams.delete("pair")
    return `${o.pathname}${o.search || ""}`
  } catch { return u }
}

// SEC (M0.3 — docs/security-audit.md F2): قائمة سماح منافذ التحويل.
// البوابة هي مدخل الشبكة المحلية — كان XTransformPort يقفز إلى أي منفذ
// 1024..65535 فيتحول إلى نفق مسح/SSRF نحو خدمات الجهاز المحلية الأخرى.
// العقد: جسور Nexus حصرًا (3003..3009) + REST الافتراضي 3000.
// GATEWAY_ALLOW يسمح بالتوسيع (مثال: "3003-3009,3011") — للتجارب حصرًا.
const ALLOW = new Set()
for (const part of (process.env.GATEWAY_ALLOW || "3003-3009").split(",")) {
  const m = part.trim().match(/^(\d{2,5})-(\d{2,5})$/)
  if (m) {
    for (let p = Number(m[1]); p <= Number(m[2]); p++) ALLOW.add(p)
  } else if (/^\d{2,5}$/.test(part.trim())) {
    ALLOW.add(Number(part.trim()))
  }
}

/** null = لا بارامتر (يذهب لـ REST) · -1 = بارامتر خارج القائمة (يرفض 403) */
function targetPort(reqUrl) {
  try {
    const q = new URL(reqUrl, "http://gw").searchParams.get("XTransformPort")
    if (!q) return null
    if (!/^\d{2,5}$/.test(q)) return -1
    const p = Number(q)
    if (p < 1024 || p > 65535) return -1
    if (!ALLOW.has(p)) return -1
    return p
  } catch {
    return -1
  }
}

/** IP العميل الحقيقي: البوابة محلية — الواصل من loopback عبر البوابة يحمل
 * x-gw-client-ip (نستبدله حرفيًا فلا يُثق بترويسة من عميل مباشر)، والواصل
 * مباشرة من الشبكة يبقى بعنوانه الحقيقي. تقرؤه الجسور لبوابة desktop:register. */
function clientIp(req) {
  return req.socket?.remoteAddress || ""
}

function hopByHop(headers) {
  const h = { ...headers }
  delete h["connection"]
  delete h["keep-alive"]
  delete h["proxy-connection"]
  delete h["transfer-encoding"]
  delete h["upgrade"]
  delete h["proxy-authenticate"]
  delete h["proxy-authorization"]
  delete h["te"]
  delete h["trailer"]
  return h
}

function rejectDisallowed(req, res, port) {
  res.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify({ ok: false, gateway: true, error: "port-not-allowed", port, allow: [...ALLOW].sort((a, b) => a - b) }))
}

function proxyHttp(req, res) {
  const t = targetPort(req.url)
  if (t === -1) return rejectDisallowed(req, res, t)
  const port = t ?? REST_PORT
  // SEC: تمرير IP العميل الحقيقي للجسور (يستبدل دائمًا — لا يُثق بترويسة عميل)
  const headers = hopByHop(req.headers)
  headers["x-gw-client-ip"] = clientIp(req)
  const up = http.request(
    { host: "127.0.0.1", port, method: req.method, path: stripPair(req.url), headers },
    (ures) => {
      res.writeHead(ures.statusCode || 502, ures.headers)
      ures.pipe(res)
    },
  )
  up.setTimeout(0)
  up.on("error", (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ ok: false, gateway: true, error: "upstream-unreachable", port, detail: e.code || e.message }))
    } else {
      res.destroy()
    }
  })
  req.pipe(up)
}

// WS upgrade: نفق TCP خام — نعيد كتابة رأس الطلب حرفيًا ثم أنبوب ثنائي بالاتجاهين
function proxyUpgrade(req, socket, head) {
  const t = targetPort(req.url)
  if (t === -1) {
    try { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n") } catch {}
    return
  }
  const port = t ?? REST_PORT
  const up = net.connect(port, "127.0.0.1", () => {
    let raw = `${req.method} ${stripPair(req.url)} HTTP/1.1\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i]
      // SEC: استبدال أي x-gw-client-ip وارد من العميل — البوابة مصدر الحقيقة
      if (k.toLowerCase() === "x-gw-client-ip") continue
      raw += `${k}: ${req.rawHeaders[i + 1]}\r\n`
    }
    raw += `x-gw-client-ip: ${clientIp(req)}\r\n`
    raw += "\r\n"
    up.write(raw)
    if (head && head.length) up.write(head)
    socket.pipe(up)
    up.pipe(socket)
  })
  const cleanup = () => { try { socket.destroy() } catch {} try { up.destroy() } catch {} }
  up.on("error", cleanup)
  socket.on("error", cleanup)
  socket.on("close", cleanup)
  up.on("close", () => { try { socket.destroy() } catch {} })
}

const server = http.createServer((req, res) => {
  try {
    const path = (req.url || "/").split("?")[0]
    if (path === "/__gw/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" })
      res.end(JSON.stringify({ ok: true, proto: "Nexus/1.2", role: "gateway", port: GATEWAY_PORT, rest: REST_PORT, uptimeMs: Date.now() - STARTED_AT, pair: !!loadPair() }))
      return
    }
    if (!pairGateHttp(req, res, req.url)) return
    proxyHttp(req, res)
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: false, gateway: true, error: e instanceof Error ? e.message : "gw" }))
    }
  }
})

// مأخذ socket.io طويل الاستطلاع عبر البوابة: بلا مهلات قاتلة
server.requestTimeout = 0
server.headersTimeout = 60000
server.keepAliveTimeout = 120000
server.on("upgrade", (req, socket, head) => {
  if (!pairGateRaw(req, socket, req.url)) return
  proxyUpgrade(req, socket, head)
})
server.on("clientError", (_err, socket) => { try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n") } catch {} })

server.listen(GATEWAY_PORT, () => {
  console.log(`[gateway] NexusLink gateway on :${BOUND_PORT} → rest:${REST_PORT} (+ ?XTransformPort=<port>)`)
  // سطر آلي يقرؤه مدير العمليات (Rust) ليحدد NEXUSLINK_GATEWAY_PORT لجسر comms/mDNS
  console.log(`[gateway] PORT=${BOUND_PORT}`)
})
server.on("error", (e) => {
  // تراجع محدد: المنافذ <1024 تحتاج صلاحيات (Linux/macOS) — نجرب المنفذ البديل مرة واحدة
  if ((e.code === "EACCES" || e.code === "EADDRINUSE") && BOUND_PORT === GATEWAY_PORT && FALLBACK_PORT !== GATEWAY_PORT) {
    console.error(`[gateway] :${GATEWAY_PORT} blocked (${e.code}) → falling back to :${FALLBACK_PORT}`)
    BOUND_PORT = FALLBACK_PORT
    server.listen(BOUND_PORT)
    return
  }
  console.error("[gateway] listen failed:", e.message)
  process.exit(1)
})
process.on("SIGTERM", () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000) })
process.on("SIGINT", () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000) })
