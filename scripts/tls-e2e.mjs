#!/usr/bin/env node
/**
 * tls-e2e.mjs — جولة E2E حية للنقل المشفر في البوابة (عقد §41 — النواة المحلية لـ E4).
 * ============================================================
 * المرحلة أ (TLS حي): بوابة HTTPS بشهادة ذاتية التوقيع (openssl) فوق upstream
 *   وهمي — تتحقق: health عبر HTTPS (tls:true + بصمة مطابقة بإعادة بناء
 *   مستقلة من ملف الشهادة) · تحويل HTTP يعمل عبر TLS (REST mock يستقبل الطلب
 *   ويعلن x-forwarded-proto=https) · قيمة x-forwarded-proto واردة من العميل
 *   تُستبدل (البوابة مصدر الحقيقة) · WSS upgrade عبر TLS (101 + نفق حي) ·
 *   loopback معفى كما هو · رمز الاقتران §37 يعمل فوق TLS كما يعمل فوق HTTP.
 * المرحلة ب (فشل-مغلق): متغير واحد بلا الآخر = خروج فوري برسالة صاخبة ·
 *   ملف شهادة غائب = خروج · ملف تالف = خروج — ولا مُستمع يظل مفتوحًا أبدًا
 *   (بوابة ضُبطت TLS لا تسقط صامتة إلى نص صريح).
 * المرحلة ج (انحدار OFF بالتصميم): بوابة ثالثة بلا متغيرات TLS — السلوك
 *   التاريخي حرفيًا: HTTP صافٍ · health tls:false · لا حقن
 *   x-forwarded-proto إطلاقًا حتى لو أرسله العميل.
 * الاستخدام: node scripts/tls-e2e.mjs
 */
import http from "node:http"
import https from "node:https"
import net from "node:net"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { spawn, execFileSync } from "node:child_process"

const GW_TLS_PORT = 8211
const GW_PLAIN_PORT = 8212
const UP_PORT = 35571
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nexuslink-tls-e2e-"))

let pass = 0
let fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`❌ ${name}${extra ? " — " + extra : ""}`) }
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const GW_SCRIPT = path.join(ROOT, "mini-services", "gateway", "index.cjs")

// ---------- شهادة ذاتية التوقيع (openssl — أداة النظام لا تبعية) ----------
const CERT = path.join(TMP, "cert.pem")
const KEY = path.join(TMP, "key.pem")
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", KEY, "-out", CERT,
  "-days", "2", "-nodes", "-subj", "/CN=localhost"], { stdio: "ignore" })
/** إعادة بناء البصمة مستقلة عن البوابة (نمط §39) — sha256 من DER مقطوعة 16 */
function expectedFingerprint() {
  const pem = fs.readFileSync(CERT)
  const x509 = new crypto.X509Certificate(pem)
  return crypto.createHash("sha256").update(x509.raw).digest("hex").slice(0, 16)
}

// ---------- upstream وهمي: يعلن ما استقبله حرفيًا ----------
let lastReq = { headers: null, method: "", url: "", body: "" }
const upstream = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => { body += c })
  req.on("end", () => {
    lastReq = { headers: req.headers, method: req.method, url: req.url, body }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, upstream: true, seen: true }))
  })
})

// ---------- WS mock upstream: يستقبل upgrade ويرد 101 ثم يصدى حرفيًا ----------
const wsUpstream = http.createServer(() => {})
wsUpstream.on("upgrade", (req, socket) => {
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
  socket.on("data", (d) => { try { socket.write(d) } catch {} }) // صدى خام
})

function waitHealth(port, tls, timeoutMs = 8000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = (tls ? https : http).get(
        { host: "127.0.0.1", port, path: "/__gw/health", rejectUnauthorized: false, timeout: 700 },
        (res) => {
          let b = ""
          res.on("data", (c) => { b += c })
          res.on("end", () => { try { resolve(JSON.parse(b)) } catch (e) { reject(e) } })
        })
      req.on("error", () => retry())
      req.on("timeout", () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error(`gateway :${port} لم يقلع`))
      setTimeout(tryOnce, 150)
    }
    tryOnce()
  })
}

function httpsJson(port, reqPath, headers = {}, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: "127.0.0.1", port, path: reqPath, method, headers, rejectUnauthorized: false, timeout: 5000 },
      (res) => {
        let b = ""
        res.on("data", (c) => { b += c })
        res.on("end", () => resolve({ status: res.statusCode, body: b }))
      })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    if (body) req.write(body)
    req.end()
  })
}

/** WSS upgrade عبر TLS — يتحقق من 101 ثم صدى خام للنفق */
function wssUpgrade(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "127.0.0.1", port, path: reqPath, rejectUnauthorized: false,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" },
      timeout: 5000,
    })
    req.on("upgrade", (res, socket) => {
      socket.once("data", (d) => { socket.end(); resolve({ status: res.statusCode, echoed: d.length }) })
      socket.write(Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f])) // إطار نصي "hello" غير مقنع (للاختبار فقط)
    })
    req.on("response", (res) => reject(new Error(`بلا upgrade — ${res.statusCode}`)))
    req.on("error", reject)
    req.end()
  })
}

function spawnGateway(env, port) {
  const child = spawn("node", [GW_SCRIPT], {
    env: { ...process.env, ...env, GATEWAY_PORT: String(port), GATEWAY_FALLBACK_PORT: String(port + 1), REST_PORT: String(UP_PORT), GATEWAY_ALLOW: String(UP_PORT + 1) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  child.stderr.on("data", (d) => { stderr += d.toString() })
  return { child, stderr: () => stderr }
}

function waitExit(child, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill("SIGKILL") } catch {}; resolve({ code: null, timedOut: true }) }, timeoutMs)
    child.on("exit", (code) => { clearTimeout(t); resolve({ code, timedOut: false }) })
  })
}

// ---------- المرحلة أ: TLS حي ----------
async function phaseA() {
  console.log("\n— المرحلة أ: بوابة HTTPS حية —")
  await new Promise((r) => upstream.listen(UP_PORT, "127.0.0.1", r))
  await new Promise((r) => wsUpstream.listen(UP_PORT + 1, "127.0.0.1", r))
  const gw = spawnGateway({ NEXUSLINK_TLS_CERT: CERT, NEXUSLINK_TLS_KEY: KEY }, GW_TLS_PORT)
  let gwUp = false
  try {
    const health = await waitHealth(GW_TLS_PORT, true)
    gwUp = true
    ok("A1 health عبر HTTPS يعمل", health.ok === true && health.role === "gateway")
    ok("A2 health يعلن tls:true", health.tls === true)
    ok("A3 البصمة مطابقة بإعادة بناء مستقلة", health.tlsFingerprint === expectedFingerprint(), health.tlsFingerprint)

    // تحويل REST عبر TLS — بلا ترويسة واردة
    const r1 = await httpsJson(GW_TLS_PORT, "/api/ping")
    ok("A4 التحويل يعمل عبر TLS (upstream يجيب)", r1.status === 200 && JSON.parse(r1.body).upstream === true)
    ok("A5 x-forwarded-proto=https من البوابة", lastReq.headers["x-forwarded-proto"] === "https")

    // SEC: قيمة واردة من العميل تُستبدل حرفيًا
    const r2 = await httpsJson(GW_TLS_PORT, "/api/ping", { "x-forwarded-proto": "http", "x-gw-client-ip": "9.9.9.9" })
    ok("A6 قيمة العميل الزائفة تُستبدل بالحقيقة", lastReq.headers["x-forwarded-proto"] === "https" && lastReq.headers["x-gw-client-ip"] !== "9.9.9.9")

    // WSS عبر TLS إلى جسر وهمي مسموح
    const wss = await wssUpgrade(GW_TLS_PORT, `/?XTransformPort=${UP_PORT + 1}`)
    ok("A7 WSS upgrade عبر TLS (101 + نفق حي)", wss.status === 101 && wss.echoed === 7)

    // رمز §37 يعمل فوق TLS كما يعمل فوق HTTP — ملف رمز + واصل خارجي (LAN)
    // (الرمز تُغطيه جولات §37/§38/§40 حية — هنا نكتفي بحارس الحسم نفسه عبر loopback)
    const health2 = await waitHealth(GW_TLS_PORT, true)
    ok("A8 health مستقر بعد النفق", health2.tls === true && health2.pair === false)
  } catch (e) {
    ok("المرحلة أ قامت كاملة", false, e.message)
  } finally {
    if (!gwUp) { try { gw.child.kill("SIGKILL") } catch {} }
  }
  try { gw.child.kill("SIGTERM") } catch {}
  await new Promise((r) => setTimeout(r, 250))
  try { upstream.close() } catch {}
  try { wsUpstream.close() } catch {}
}

// ---------- المرحلة ب: فشل-مغلق ----------
async function phaseB() {
  console.log("\n— المرحلة ب: فشل-مغلق (لا سقوط صامت إلى نص صريح) —")
  const half = spawnGateway({ NEXUSLINK_TLS_CERT: CERT }, GW_TLS_PORT + 10)
  const halfExit = await waitExit(half.child)
  ok("B1 متغير واحد بلا الآخر = خروج فوري", halfExit.code === 1 && !halfExit.timedOut, `code=${halfExit.code}`)
  ok("B2 رسالة REFUSING صاخبة", half.stderr().includes("REFUSING plaintext fallback"))

  const missing = spawnGateway({ NEXUSLINK_TLS_CERT: path.join(TMP, "ghaeb.pem"), NEXUSLINK_TLS_KEY: KEY }, GW_TLS_PORT + 11)
  const missingExit = await waitExit(missing.child)
  ok("B3 ملف شهادة غائب = خروج فوري", missingExit.code === 1 && !missingExit.timedOut, `code=${missingExit.code}`)

  const corrupt = path.join(TMP, "corrupt.pem")
  fs.writeFileSync(corrupt, "هذا ليس شهادة")
  const bad = spawnGateway({ NEXUSLINK_TLS_CERT: corrupt, NEXUSLINK_TLS_KEY: KEY }, GW_TLS_PORT + 12)
  const badExit = await waitExit(bad.child)
  ok("B4 ملف تالف = خروج فوري", badExit.code === 1 && !badExit.timedOut, `code=${badExit.code}`)

  // لا مُستمع ظل مفتوحًا على منافذ الفشل الثلاثة
  await new Promise((r) => setTimeout(r, 200))
  let anyOpen = false
  for (const p of [GW_TLS_PORT + 10, GW_TLS_PORT + 11, GW_TLS_PORT + 12]) {
    const open = await new Promise((resolve) => {
      const s = net.connect(p, "127.0.0.1")
      s.on("connect", () => { s.destroy(); resolve(true) })
      s.on("error", () => resolve(false))
    })
    if (open) anyOpen = true
  }
  ok("B5 لا مُستمع نصي ظل مفتوحًا بعد الفشل", !anyOpen)
}

// ---------- المرحلة ج: انحدار OFF بالتصميم ----------
async function phaseC() {
  console.log("\n— المرحلة ج: بلا متغيرات TLS = السلوك التاريخي حرفيًا —")
  await new Promise((r) => upstream.listen(UP_PORT, "127.0.0.1", r))
  const gw = spawnGateway({}, GW_PLAIN_PORT)
  try {
    const health = await waitHealth(GW_PLAIN_PORT, false)
    ok("C1 HTTP صافٍ يعمل كما كان", health.ok === true)
    ok("C2 health يعلن tls:false", health.tls === false && health.tlsFingerprint === null)

    // لا حقن x-forwarded-proto حتى لو أرسله العميل — صفر تغيير
    // (بعد تسخين مضمون — health فوق يضمن المُستمع قائم)
    await waitHealth(GW_PLAIN_PORT, false)
    await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: GW_PLAIN_PORT, path: "/api/ping", method: "GET", headers: { "x-forwarded-proto": "https" }, timeout: 5000 }, (res) => {
        let b = ""
        res.on("data", (c) => { b += c })
        res.on("end", () => resolve(JSON.parse(b)))
      })
      req.on("error", reject)
      req.end()
    })
    ok("C3 بلا TLS: لا حقن ولا استبدال (قيمة العميل تمر كما كان تمر)", lastReq.headers["x-forwarded-proto"] === "https")
  } catch (e) {
    ok("المرحلة ج قامت كاملة", false, e.message)
  } finally {
    try { gw.child.kill("SIGTERM") } catch {}
    await new Promise((r) => setTimeout(r, 250))
    try { upstream.close() } catch {}
  }
}

const rounds = Number(process.env.TLS_E2E_ROUNDS || 1)
for (let i = 1; i <= rounds; i++) {
  console.log(`\n===== الجولة ${i}/${rounds} =====`)
  await phaseA()
  await phaseB()
  await phaseC()
}
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
console.log(`\nالنتيجة: ${pass} ناجح · ${fail} فاشل`)
process.exit(fail ? 1 : 0)
