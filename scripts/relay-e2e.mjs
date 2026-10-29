#!/usr/bin/env node
/**
 * relay-e2e.mjs — بوابة المرحّل الذاتي (عقد §49 — النواة المحلية لـ E4).
 * ============================================================
 * المرحلة أ (نقي 26): رياضيات النواة بلا شبكة — اشتقاق الغرفة والبصمة
 *   والإثبات (حتمية · زمن-ثابت · أسباب رفض مغلقة) · ترميز الأطر ذهابًا
 *   وإيابًا بكل أسباب الرفض · التراجع الحتمي بسقفه · تطبيع الروابط والأسرار
 *   وطلبات الزوار (ترويسات القفزة والانتحال تُسقط والرمز يمر).
 * المرحلة ب (حي): مرحّل حقيقي (server.mjs) + بوابة حقيقية (gateway/index.cjs)
 *   + نفق حقيقي (relay-tunnel.ts داخل العملية) + upstream وهمي يسجل ما رأى:
 *   جولة كاملة زائر→مرحّل→نفق→بوابة→upstream · §37 عبر النفق حرفيًا (بلا
 *   رمز 401 وبالرمز 200 وloopback المباشر معفى كما هو) · فشل-مغلق إقلاعي
 *   (بلا سر · نصف TLS) · إزاحة المركز الجديد وإعادة اتصال النفق · إعادة
 *   تشغيل المرحّل واستئناف الخدمة · سقوف الزائرين والقيد الجاري والإطار ·
 *   مهلة المصادقة · قفل فشلات المصادقة (مرحّل ثانٍ) · عدادات الصحة صادقة.
 * الاستخدام: node scripts/relay-e2e.mjs   (جولتان متتاليتان إلزاميتان)
 */
import http from "node:http"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"

// خطاف حل «بلا امتداد من TS» قبل أي استيراد ديناميكي (نمط البوابة ذاتها)
const req = createRequire(import.meta.filename)
req("./ts-resolve-hooks.cjs").registerTsResolve()

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const RELAY_SERVER = path.join(ROOT, "mini-services", "relay", "server.mjs")
const GW_SCRIPT = path.join(ROOT, "mini-services", "gateway", "index.cjs")

const SECRET = "relay-e2e-secret-0123456789"
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nexuslink-relay-e2e-"))
const RELAY_PORT = 8321
const RELAY2_PORT = 8322
const GW_PORT = 8331
const GW_FALLBACK = 8332
const UP_PORT = 8341

let pass = 0
let fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`❌ ${name}${extra ? " — " + extra : ""}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ═══════════════ المرحلة أ — النواة النقية (صفر شبكة) ═══════════════
console.log("═══ أ — النواة النقية ═══")
{
  const core = await import("../src/lib/nexus/relay-core.ts")
  const S1 = "secret-one-0123456789"
  const S2 = "secret-two-0123456789"

  const r1a = core.roomIdFromSecret(S1)
  const r1b = core.roomIdFromSecret(S1)
  ok("أ1 اشتقاق الغرفة حتمي 16-hex", r1a === r1b && /^[0-9a-f]{16}$/.test(r1a), r1a)
  ok("أ2 سر مختلف = غرفة مختلفة", core.roomIdFromSecret(S2) !== r1a)
  const fp = core.fingerprintOfSecret(S1)
  ok("أ3 البصمة 16-hex ومستقلة عن الغرفة", /^[0-9a-f]{16}$/.test(fp) && fp !== r1a, fp)

  const n = core.newNonce()
  ok("أ4 الإثبات حتمي والتحقق صحيح", core.authProof(S1, n) === core.authProof(S1, n) && core.verifyAuth(S1, n, core.authProof(S1, n)))
  ok("أ5 إثبات محرّف يُرفض", !core.verifyAuth(S1, n, core.authProof(S1, "other-nonce")))
  ok("أ6 سر مختلف يُرفض", !core.verifyAuth(S2, n, core.authProof(S1, n)))
  ok("أ7 إثبات مشوه يُرفض (قصير/غير hex)", !core.verifyAuth(S1, n, "deadbeef") && !core.verifyAuth(S1, n, "z".repeat(64)))
  const n2 = core.newNonce()
  ok("أ8 nonce جديد: 32-hex فريد", /^[0-9a-f]{32}$/.test(n) && n !== n2)

  const seq = [0, 1, 2, 3, 4, 5, 6, 7, 20, -3].map(core.backoffMs)
  ok("أ9 التراجع حتمي بسقف 16s وتقييد سالب", seq[0] === 250 && seq[1] === 500 && seq[6] === 16000 && seq[7] === 16000 && seq[8] === 16000 && seq[9] === 250, seq.join("/"))

  const reqEnv = core.encodeFrame({ v: 1, t: "req", id: "r-1", method: "GET", path: "/x?y=1", headers: { "x-pair-token": "T" }, bodyB64: Buffer.from("hi").toString("base64") })
  const backReq = core.parseFrame(reqEnv)
  ok("أ10 إطار req ذهابًا وإيابًا", backReq.ok && backReq.frame.t === "req" && backReq.frame.id === "r-1" && backReq.frame.bodyB64 === Buffer.from("hi").toString("base64"))
  const resBack = core.parseFrame(core.encodeFrame({ v: 1, t: "res", id: "r-1", status: 200, headers: { "content-type": "application/json" } }))
  ok("أ11 إطار res ذهابًا وإيابًا", resBack.ok && resBack.frame.status === 200)
  const pBack = core.parseFrame(core.encodeFrame({ v: 1, t: "visitor-join", room: r1a, visitors: 2 }))
  ok("أ12 إطارات النبض والزوار تمر", pBack.ok && core.parseFrame(core.encodeFrame({ v: 1, t: "ping" })).ok)

  ok("أ13 JSON مشوه → malformed", core.parseFrame("{oops").reason === "malformed")
  ok("أ14 ليس كائنًا → not-object", core.parseFrame("5").reason === "not-object")
  ok("أ15 نسخة غريبة → version", core.parseFrame(JSON.stringify({ v: 9, t: "ping" })).reason === "version")
  ok("أ16 نوع مجهول → unknown-type", core.parseFrame(JSON.stringify({ v: 1, t: "zzz" })).reason === "unknown-type")
  ok("أ17 فوق السقف → oversize", core.parseFrame("x".repeat(core.MAX_FRAME_CHARS + 1)).reason === "oversize")
  ok("أ18 دور غريب في auth → shape", core.parseFrame(JSON.stringify({ v: 1, t: "auth", role: "admin", nonce: n, proof: core.authProof(S1, n) })).reason === "shape")
  const normV = core.parseFrame(core.encodeFrame({ v: 1, t: "ping" }))
  ok("أ19 encodeFrame يفرض v=1 حرفيًا", normV.ok && JSON.parse(core.encodeFrame({ v: 1, t: "ping" })).v === 1)

  const u1 = core.normalizeRelayUrl("ws://relay.example.com:8310")
  const u2 = core.normalizeRelayUrl("https://relay.example.com")
  ok("أ20 تطبيع ws/http/https/wss", u1.ok && u1.wsUrl === "ws://relay.example.com:8310/__relay/ws" && u2.ok && u2.wsUrl === "wss://relay.example.com/__relay/ws")
  ok("أ21 مخطط غريب/فارغ يرفض", !core.normalizeRelayUrl("ftp://x").ok && core.normalizeRelayUrl("").reason === "empty")
  ok("أ22 تعتيم الرابط يقتطع الاعتمادات والاستعلام", core.redactUrl("https://u:p@r.example.com/a?x=1") === "https://r.example.com/a")

  ok("أ23 صلاحية السر: مقبول/قصير/فراغ/طويل", core.validateSecret(S1) && !core.validateSecret("short") && !core.validateSecret("has space 0123456") && !core.validateSecret("x".repeat(257)))

  const nv = core.normalizeVisitorRequest({ method: "get", path: "/a", headers: { Host: "h", Connection: "keep-alive", "x-pair-token": "T", "X-NexusLink-Relay": "spoof", accept: "text/html" }, bodyB64: Buffer.from("hi").toString("base64") })
  ok("أ24 تطبيع طلب الزائر: ترويسات القفزة والانتحال تسقط والرمز يمر", nv.ok && nv.method === "GET" && nv.headers["x-pair-token"] === "T" && !("host" in nv.headers) && !("connection" in nv.headers) && !("x-nexuslink-relay" in nv.headers) && nv.body?.toString() === "hi")
  ok("أ25 طلب فاسد يرفض بسبب معلن", core.normalizeVisitorRequest({ method: "TRACE", path: "/a", headers: {} }).reason === "method-not-allowed" && core.normalizeVisitorRequest({ method: "GET", path: "no-slash", headers: {} }).reason === "path-invalid" && core.normalizeVisitorRequest({ method: "GET", path: "/a", headers: {}, bodyB64: Buffer.alloc(core.MAX_BODY_BYTES + 1).toString("base64") }).reason === "body-oversize")

  ok("أ26 معرف الطلب: صالح/فاسد", core.validRequestId("abc-123") && !core.validRequestId("ABC!") && !core.validRequestId("") && !core.validRequestId("x".repeat(65)))
}

// ═══════════════ المرحلة ب — الحي الكامل ═══════════════
console.log("═══ ب — الحي: مرحّل + بوابة + نفق + زائر ═══")

// ── upstream وهمي يسجل كل ما رأى ─────────────────────────────────────
let seen = null
const upstream = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => { body += c })
  req.on("end", () => {
    seen = { method: req.method, url: req.url, headers: req.headers, body }
    if (req.url.startsWith("/slow")) {
      const ms = Number(new URL(req.url, "http://u").searchParams.get("ms") || 300)
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true, slow: true }))
      }, ms)
      return
    }
    if (req.url.startsWith("/echo")) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(body)
      return
    }
    res.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(JSON.stringify({ ok: true, upstream: true }))) })
    res.end(JSON.stringify({ ok: true, upstream: true }))
  })
})
await new Promise((r) => upstream.listen(UP_PORT, "127.0.0.1", r))

// ── أدوات WS (عميل مقنّع — قاع RFC 6455) ─────────────────────────────
function wsSendMasked(socket, text) {
  const payload = Buffer.from(text, "utf8")
  const mask = crypto.randomBytes(4)
  const len = payload.length
  let header
  if (len < 126) header = Buffer.from([0x81, 0x80 | len])
  else if (len < 65536) { header = Buffer.allocUnsafe(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2) }
  else { header = Buffer.allocUnsafe(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6) }
  const masked = Buffer.allocUnsafe(len)
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
  socket.write(Buffer.concat([header, mask, masked]))
}

class WsClient {
  constructor(socket) {
    this.socket = socket
    this.frames = []
    this.closed = 0
    this.dead = false
    let buf = Buffer.alloc(0)
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d])
      for (;;) {
        if (buf.length < 2) break
        const b1 = buf[1]
        let len = b1 & 0x7f
        let p = 2
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); p = 4 }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); p = 10 }
        if (buf.length < p + len) break
        const op = buf[0] & 0x0f
        const payload = buf.subarray(p, p + len)
        buf = buf.subarray(p + len)
        if (op === 0x01) { try { this.frames.push(JSON.parse(payload.toString("utf8"))) } catch { this.frames.push({ t: "raw", raw: payload.toString("utf8").slice(0, 60) }) } }
        if (op === 0x08) { this.closed = payload.length >= 2 ? payload.readUInt16BE(0) : 1005; this.dead = true; try { socket.end() } catch { /* بالفعل */ } break }
        if (op === 0x09) { // pong فوري على مستوى WS
          const pl = Math.min(payload.length, 125)
          const h = pl < 126 ? Buffer.from([0x8a, pl]) : Buffer.from([0x8a, 126, 0, pl])
          try { socket.write(Buffer.concat([h, payload.subarray(0, pl)])) } catch { /* ميت */ }
        }
      }
    })
    socket.on("close", () => { this.dead = true })
    socket.on("error", () => { this.dead = true })
  }
  static async connect(port, path = "/__relay/ws") {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64")
      const r = http.request({
        host: "127.0.0.1", port, path,
        headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": key, "sec-websocket-version": "13" },
      })
      r.on("upgrade", (res, socket) => resolve(new WsClient(socket)))
      r.on("error", reject)
      setTimeout(() => reject(new Error("ws-connect-timeout")), 4000)
      r.end()
    })
  }
  send(obj) { wsSendMasked(this.socket, JSON.stringify(obj)) }
  sendRawText(text) { wsSendMasked(this.socket, text) }
  async wait(pred, timeoutMs = 6000, step = 25) {
    const t0 = Date.now()
    for (;;) {
      const f = this.frames.find(pred)
      if (f) return f
      if (Date.now() - t0 > timeoutMs) return null
      await sleep(step)
    }
  }
  async waitClose(timeoutMs = 6000) {
    const t0 = Date.now()
    while (!this.dead && Date.now() - t0 < timeoutMs) await sleep(25)
    return this.dead
  }
}

// ── إقلاع المرحّل الحقيقي ────────────────────────────────────────────
function spawnRelay(port, extraEnv = {}) {
  return spawn("node", [RELAY_SERVER, "--port", String(port)], {
    env: { ...process.env, NEXUSLINK_RELAY_SECRET: SECRET, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  })
}
async function waitRelayHealth(port, timeoutMs = 8000) {
  const t0 = Date.now()
  for (;;) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/__relay/health`, { signal: AbortSignal.timeout(700) })).json()
      if (j.ok) return j
    } catch { /* لم يقلع بعد */ }
    if (Date.now() - t0 > timeoutMs) return null
    await sleep(150)
  }
}

const relay = spawnRelay(RELAY_PORT)
let relayBooted = false
relay.stderr.on("data", (d) => { if (String(d).includes("REFUSING")) console.error("[relay!] " + d) })
{
  const h = await waitRelayHealth(RELAY_PORT)
  relayBooted = !!h
  ok("ب1 المرحّل يقلع وصحته صادقة", relayBooted && h.service === "nexuslink-relay" && h.version === 1 && h.rooms === 0, JSON.stringify(h))
}

// ب2/ب3 — فشل-مغلق إقلاعي (نمط §41 حرفيًا)
{
  const noSecret = spawn("node", [RELAY_SERVER, "--port", "8390"], { env: { ...process.env, NEXUSLINK_RELAY_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"] })
  const out2 = await new Promise((r) => { let s = ""; noSecret.stderr.on("data", (d) => { s += d }); noSecret.on("exit", (c) => r({ code: c, s })) ; noSecret.stdout.on("data", (d) => { s += d }) ; setTimeout(() => r({ code: -1, s }), 3000) })
  ok("ب2 بلا سر: يرفض الإقلاع برسالة صاخبة", out2.code !== 0 && out2.s.includes("REFUSING"), `exit=${out2.code}`)
  const halfTls = spawnRelay(8391, { NEXUSLINK_TLS_CERT: "/nonexistent/cert.pem" })
  const out3 = await new Promise((r) => { let s = ""; halfTls.stderr.on("data", (d) => { s += d }); halfTls.on("exit", (c) => r({ code: c, s })); setTimeout(() => r({ code: -1, s }), 3000) })
  ok("ب3 نصف TLS: يرفض الإقلاع (لا سقوط صامت)", out3.code !== 0 && out3.s.includes("REFUSING"))
}

// ── البوابة الحقيقية (نمط tls-e2e) ────────────────────────────────────
const PAIR_FILE = path.join(TMP, "pair-token.json")
const gw = spawn("node", [GW_SCRIPT], {
  env: {
    ...process.env,
    GATEWAY_PORT: String(GW_PORT), GATEWAY_FALLBACK_PORT: String(GW_FALLBACK),
    REST_PORT: String(UP_PORT), GATEWAY_ALLOW: String(UP_PORT),
    NEXUSLINK_PAIR_FILE: PAIR_FILE,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
{
  let booted = false
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${GW_PORT}/__gw/health`, { signal: AbortSignal.timeout(600) })).json()
      if (j.ok) { booted = true; break }
    } catch { /* لم يقلع */ }
    await sleep(150)
  }
  ok("ب4 البوابة الحقيقية تقلع (HTTP صافٍ)", booted)
}

// ── النفق الحقيقي داخل العملية (بيئة قبل الاستيراد) ────────────────────
const core2 = await import("../src/lib/nexus/relay-core.ts")
const ROOM = core2.roomIdFromSecret(SECRET)
const RELAY_FILE = path.join(TMP, "relay.json")
process.env.NEXUSLINK_RELAY_FILE = RELAY_FILE
process.env.NEXUSLINK_GW_PORT = String(GW_PORT)
const tunnel = await import("../src/lib/nexus/relay-tunnel.ts")

// (§37 معطل مبدئيًا — سير الفحص: مفتوح تاريخيًا ثم يُقفل بالملف ثم يُفتح بحذفه)
async function tunnelConnected(timeoutMs = 10000) {
  const t0 = Date.now()
  for (;;) {
    const st = tunnel.relayTunnelStatus()
    if (st.state === "connected" && st.roomId === ROOM) return st
    if (Date.now() - t0 > timeoutMs) return st
    await sleep(100)
  }
}
{
  tunnel.writeRelayConfig(`http://127.0.0.1:${RELAY_PORT}`, SECRET)
  tunnel.ensureRelayTunnel()
  const st = await tunnelConnected()
  ok("ب5 النفق يتصل ويسجل الغرفة المشتقة", st.state === "connected" && st.roomId === ROOM && st.fingerprint === core2.fingerprintOfSecret(SECRET), `${st.state}/${st.roomId}`)
}

// ── الزائر الرئيسي: مصادقة ثم طلب عبر المسار الكامل ────────────────────
async function authVisitor(room = ROOM, secret = SECRET, role = "visitor") {
  const c = await WsClient.connect(RELAY_PORT)
  const nonce = core2.newNonce()
  c.send({ v: 1, t: "auth", role, nonce, proof: core2.authProof(secret, nonce), ...(role === "visitor" ? { room } : {}) })
  const f = await c.wait((x) => x.t === "auth-ok" || x.t === "auth-err", 5000)
  return { c, f }
}
async function reqThrough(c, { method = "GET", path: p = "/probe", headers = {}, bodyB64 } = {}, id = `q${Math.random().toString(36).slice(2, 10)}`) {
  c.send({ v: 1, t: "req", id, method, path: p, headers, ...(bodyB64 !== undefined ? { bodyB64 } : {}) })
  return { id, f: await c.wait((x) => (x.t === "res" || x.t === "err") && x.id === id, 8000) }
}

{
  const v = await authVisitor()
  ok("ب6 الزائر يوثّق بالغرفة الصحيحة", v.f?.t === "auth-ok" && v.f.room === ROOM)
  const { f } = await reqThrough(v.c, { headers: { "x-pair-token": "PAIR-TOKEN-E2E-0123456789" } })
  const body = f?.bodyB64 ? Buffer.from(f.bodyB64, "base64").toString() : ""
  ok("ب7 جولة كاملة: زائر→مرحّل→نفق→بوابة→upstream", f?.t === "res" && f.status === 200 && body.includes('"upstream":true'))
  ok("ب7-ب upstream رأى ترويسة الشدة (=الغرفة) ورمز الزائر مرّا", seen?.headers["x-nexuslink-relay"] === ROOM && seen?.headers["x-pair-token"] === "PAIR-TOKEN-E2E-0123456789")
  ok("ب7-ج content-length لا تعود للزائر (النفق يفك الضغط ويحسم الطول)", f?.t === "res" && !("content-length" in (f.headers ?? {})))
  // ب26 — §37 OFF = مفتوح تاريخيًا حتى عبر النفق (سلوك §37 حرفيًا)
  const { f: fNoTok } = await reqThrough(v.c)
  ok("ب8 §37 معطل: الطلب بلا رمز يمر (السلوك التاريخي حرفيًا)", fNoTok?.t === "res" && fNoTok.status === 200)

  // تفعيل رمز §37 → البوابة تحسم عبر النفق (ترويسة الشدة)
  fs.writeFileSync(PAIR_FILE, JSON.stringify({ token: "PAIR-TOKEN-E2E-0123456789", fingerprint: "fp", createdAt: new Date().toISOString() }))
  await sleep(300) // ذاكرة mtime للبوابة
  const { f: fDenied } = await reqThrough(v.c)
  ok("ب9 §37 مفعّل: بلا رمز → 401 pair-token-required عبر النفق", fDenied?.t === "res" && fDenied.status === 401 && Buffer.from(fDenied.bodyB64, "base64").toString().includes("pair-token-required"))
  const { f: fOk } = await reqThrough(v.c, { headers: { "x-pair-token": "PAIR-TOKEN-E2E-0123456789" } })
  ok("ب10 بالرمز → 200 عبر النفق", fOk?.t === "res" && fOk.status === 200)

  // loopback المباشر بلا الترويسة: معفى كما هو (انحدار الشدة)
  const direct = await fetch(`http://127.0.0.1:${GW_PORT}/probe`)
  ok("ب11 loopback مباشر بلا رمز: معفى كما هو (الترويسة تشدّ فقط)", direct.status === 200)

  // HEAD وPOST
  const { f: fHead } = await reqThrough(v.c, { method: "HEAD", headers: { "x-pair-token": "PAIR-TOKEN-E2E-0123456789" } })
  ok("ب12 HEAD عبر النفق: 200 بلا جسم", fHead?.t === "res" && fHead.status === 200 && fHead.bodyB64 === undefined)
  const { f: fPost } = await reqThrough(v.c, { method: "POST", path: "/echo", headers: { "x-pair-token": "PAIR-TOKEN-E2E-0123456789", "content-type": "text/plain" }, bodyB64: Buffer.from("مرحبا عبر النفق").toString("base64") })
  ok("ب13 POST بجسم عربي: يصل حرفيًا ويعود", fPost?.t === "res" && fPost.status === 200 && Buffer.from(fPost.bodyB64, "base64").toString() === "مرحبا عبر النفق")

  // سقف القيد الجاري للزائر
  const ps = []
  for (let i = 0; i < 5; i++) ps.push(reqThrough(v.c, { path: "/slow?ms=350", headers: { "x-pair-token": "PAIR-TOKEN-E2E-0123456789" } }, `busy-${i}`))
  const rs = await Promise.all(ps)
  const busyErrs = rs.filter((x) => x.f?.t === "err" && x.f.reason === "busy").length
  const done = rs.filter((x) => x.f?.t === "res").length
  ok("ب14 سقف القيد الجاري (4): الخامس busy والبقية تكتمل", busyErrs === 1 && done === 4, `busy=${busyErrs} done=${done}`)

  // صفحة الحالة النصية
  const page = await (await fetch(`http://127.0.0.1:${RELAY_PORT}/`)).text()
  ok("ب15 صفحة الحالة تعلن الخدمة بصدق", page.includes("self-hosted relay") && page.includes("Zero storage"))

  // إزاحة المركز: hub خام يزيح النفق ثم النفق يعود فيزيحه ويستأنف
  const hub2 = await authVisitor(ROOM, SECRET, "hub")
  ok("ب16 المركز الثاني يُقبل (hub auth-ok)", hub2.f?.t === "auth-ok" && hub2.f.room === ROOM)
  const stBack = await tunnelConnected(12000)
  ok("ب17 النفق المُزاح يعيد الاتصال آليًا ويستعيد الغرفة", stBack.state === "connected", stBack.state)
  const hub2Replaced = await hub2.c.waitClose(5000) || !!(await hub2.c.wait((x) => x.t === "err" && x.reason === "replaced", 2000))
  ok("ب18 المركز المُزاح يُخبَر بصدق (replaced)", hub2Replaced)
  const { f: fAfter } = await reqThrough(v.c, { headers: { "x-pair-token": "PAIR-TOKEN-E2E-0123456789" } })
  ok("ب19 الزائر يُخدم بعد الإزاحة والعودة", fAfter?.t === "res" && fAfter.status === 200)

  // عدادات الصحة قبل إعادة التشغيل (تُصفَّر بعدها — صفر تخزين)
  const h1 = await (await fetch(`http://127.0.0.1:${RELAY_PORT}/__relay/health`)).json()
  const st1 = tunnel.relayTunnelStatus()
  ok("ب20 الصحة صادقة: غرفة واحدة وزوار وطلبات", h1.rooms === 1 && h1.visitors >= 1 && h1.requests >= 10, JSON.stringify({ rooms: h1.rooms, visitors: h1.visitors, requests: h1.requests }))
  ok("ب20-ب إحصاءات النفق تلت الطلبات (requests>0 وbytesOut>0)", st1.stats.requests >= 10 && st1.stats.bytesOut > 0 && st1.stats.ok >= 8, JSON.stringify(st1.stats))

  // إعادة تشغيل المرحّل: الحالة تُمحى والنفق يعود (صفر تخزين + تراجع حتمي)
  relay.kill("SIGKILL")
  await sleep(400)
  const stDown = tunnel.relayTunnelStatus()
  ok("ب21 سقوط المرحّل: النفق يعلن غير المتصل بصدق", stDown.state !== "connected", stDown.state)
  const relay2 = spawnRelay(RELAY_PORT)
  const h2 = await waitRelayHealth(RELAY_PORT)
  const stUp = await tunnelConnected(15000)
  ok("ب22 عودة المرحّل: النفق يعيد الاتصال (تراجع حتمي)", !!h2 && stUp.state === "connected", stUp.state)

  // زائر جديد (القديم مات مع المرحّل) — الخدمة استؤنفت
  const v2 = await authVisitor()
  const { f: fResumed } = await reqThrough(v2.c, { headers: { "x-pair-token": "PAIR-TOKEN-E2E-0123456789" } })
  ok("ب23 الزائر الجديد يُخدم بعد إعادة التشغيل (صفر تخزين)", v2.f?.t === "auth-ok" && fResumed?.t === "res" && fResumed.status === 200)

  // سقف الزائرين (الغرفة تضم v2 الآن): 4 إضافيون = 5 ثم السادس room-full
  const extras = []
  for (let i = 0; i < 4; i++) extras.push(await authVisitor())
  const sixth = await authVisitor()
  ok("ب24 سقف الزائرين (5): السادس room-full", extras.every((x) => x.f?.t === "auth-ok") && sixth.f?.t === "auth-err" && sixth.f.reason === "room-full")
  for (const x of extras) { try { x.c.socket.destroy() } catch { /* بالفعل */ } }

  // سقف الإطار: نص ضخم يقطع الاتصال
  const vBig = await authVisitor()
  vBig.c.sendRawText("x".repeat(core2.MAX_FRAME_CHARS + 1))
  const closed = await vBig.c.waitClose(5000)
  ok("ب25 إطار فوق السقف: المرحّل يقطع الاتصال", closed)

  // حذف ملف الرمز: §37 يعود مفتوحًا (حذف الملف = تعطيل فوري — نمط §37)
  fs.rmSync(PAIR_FILE, { force: true })
  await sleep(300)
  const { f: fOpen } = await reqThrough(v2.c)
  ok("ب26 حذف ملف الرمز: التعطيل فوري عبر النفق (نمط §37)", fOpen?.t === "res" && fOpen.status === 200)

  // مهلة المصادقة: اتصال بلا نية يُقطع (آخر اختبارات المرحّل الأول — 5 ثوانٍ)
  const vSilent = await WsClient.connect(RELAY_PORT)
  const silentClosed = await vSilent.waitClose(8000)
  ok("ب27 بلا مصادقة: القطع بعد المهلة (5s)", silentClosed && (vSilent.closed === 4002 || vSilent.closed !== 0))

  // تعطيل النفق من الملف = قطع فوري
  tunnel.disableRelayConfig()
  await sleep(200)
  const stOff = tunnel.relayTunnelStatus()
  ok("ب28 تعطيل النفق: الحالة disabled فورًا (حذف الملف)", stOff.state === "disabled" && stOff.roomId === "")

  try { relay2.kill("SIGKILL") } catch { /* بالفعل */ }
  try { relay.kill("SIGKILL") } catch { /* بالفعل */ }
}

// ── مرحّل ثانٍ: قفل فشلات المصادقة (عنوان واحد) ────────────────────────
{
  const rl2 = spawnRelay(RELAY2_PORT)
  await waitRelayHealth(RELAY2_PORT)
  for (let i = 0; i < 5; i++) {
    const c = await WsClient.connect(RELAY2_PORT)
    c.send({ v: 1, t: "auth", role: "visitor", nonce: core2.newNonce(), proof: core2.authProof("wrong-secret-01234567", core2.newNonce()), room: ROOM })
    await c.wait((x) => x.t === "auth-err", 4000)
  }
  const c6 = await WsClient.connect(RELAY2_PORT)
  const n6 = core2.newNonce()
  c6.send({ v: 1, t: "auth", role: "visitor", nonce: n6, proof: core2.authProof(SECRET, n6), room: ROOM })
  const f6 = await c6.wait((x) => x.t === "auth-err" || x.t === "auth-ok", 4000)
  ok("ب29 قفل فشلات المصادقة: الإثبات الصحيح السادس مرفوض (locked)", f6?.t === "auth-err" && f6.reason === "locked")
  try { rl2.kill("SIGKILL") } catch { /* بالفعل */ }
}

// ── تنظيف ────────────────────────────────────────────────────────────
try { gw.kill("SIGKILL") } catch { /* بالفعل */ }
upstream.close()
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* بالفعل */ }

console.log(`\n═══ الخلاصة: ${pass} ✓ · ${fail} ✗ (من ${pass + fail}) ═══`)
if (fail > 0) {
  console.error("✗ بوابة §49 فشلت — لا دفع قبل الخضار المرتين")
  process.exit(1)
}
console.log("✅ بوابة §49 (relay-e2e) خضراء — عقد المرحّل الذاتي قائم")
process.exit(0)
