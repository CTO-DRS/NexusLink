#!/usr/bin/env node
// NexusLink — خادم المرحّل الذاتي (عقد §49 — النواة المحلية لـ E4)
// ============================================================
// خدمة مستقلة صفر-تبعيات يشغّلها المالك على خادمه الخاص (VPS/خادم منزلي):
// أنبوب تمرير أعمى بين هاتف/متصفح بعيد ومركز NexusLink — بلا أي سحابة.
//
// العقد الصادق (§49 — خلاصة):
//   · صفر تخزين: لا ملفات ولا قاعدة بيانات ولا سجلات محتوى — حالة التوجيه
//     في الذاكرة حصرًا؛ إعادة التشغيل تمحو الغرف والنفق يعيد الاتصال آليًا.
//   · السر لا يسافر أبدًا: الدخول بإثبات HMAC-SHA256 (nonce يوقّعه العميل)
//     والتحقق زمن-ثابت — معرّف الغرفة مشتق من السر لكنه لا يمنح وصولًا.
//   · غرفة واحدة = مركز واحد (السر نفسه = المشغّل نفسه): المركز الجديد
//     يزيح القديم بصراحة (close 4000 "replaced").
//   · المرحّل يرى البيانات الوصفية (العناوين والتوقيت والأحجام) لا محتوى
//     القنوات المعمّاة — وحدود TLS موضوع مالك التشغيل (نمط §41.ب: وكيل
//     Caddy أمام المرحّل موصى به للإنترنت العام).
//   · فشل-مغلق: بلا NEXUSLINK_RELAY_SECRET يرفض الإقلاع أصلًا (لا مرحّل
//     مفتوحًا أبدًا) · متغير TLS واحد بلا الآخر يرفض الإقلاع (نمط §41).
//   · الربط الافتراضي 127.0.0.1: تعريضه للإنترنت قرار --host 0.0.0.0
//     الصريح من المالك.
//   · v1: HTTP/REST حصرًا عبر النفق (ترقيات WS ترفض) · أجساد ≤ 8MiB ·
//     إطار واحد = رسالة واحدة بسقف معلن.
//
// الاستعمال:
//   NEXUSLINK_RELAY_SECRET=<سر قوي ≥16> node mini-services/relay/server.mjs
//   [--port 8310] [--host 127.0.0.1]
//   NEXUSLINK_TLS_CERT=/path/cert.pem NEXUSLINK_TLS_KEY=/path/key.pem  (اختياري — نمط §41)
//
// الفحص الحي: node scripts/relay-e2e.mjs  (طور ب يقلع هذا الخادم فعليًا)

import http from "node:http"
import https from "node:https"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// النواة النقية المشتركة (نفس مصدر الحقيقة للخادم والنفق والفحص — node ≥22.18
// يقشّر الأنواع تلقائيًا عند الاستيراد الديناميكي، نمط بوابات E2E في البيت)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const core = await import("../../src/lib/nexus/relay-core.ts")
const {
  RELAY_PROTOCOL_VERSION, MAX_FRAME_CHARS, MAX_VISITORS_PER_ROOM, MAX_INFLIGHT_PER_VISITOR,
  MAX_AUTH_FAILS, AUTH_FAIL_LOCK_MS, NONCE_WINDOW_MS, HEARTBEAT_MS, AUTH_DEADLINE_MS,
  roomIdFromSecret, verifyAuth, validRoomId, validRequestId,
  encodeFrame, parseFrame,
} = core

// ── CLI والبيئة ──────────────────────────────────────────────────────
const argv = process.argv.slice(2)
function argOf(flag) {
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const PORT = Number(argOf("--port") || process.env.NEXUSLINK_RELAY_PORT || 8310)
const HOST = argOf("--host") || process.env.NEXUSLINK_RELAY_HOST || "127.0.0.1"
const SECRET = process.env.NEXUSLINK_RELAY_SECRET || ""
const TLS_CERT = process.env.NEXUSLINK_TLS_CERT || ""
const TLS_KEY = process.env.NEXUSLINK_TLS_KEY || ""

// ── فشل-مغلق إقلاعي (نمط §41: رسالة صاخبة وخروج — لا سقوط صامت) ─────
if (!SECRET || SECRET.length < 16) {
  console.error("✗ REFUSING open relay: NEXUSLINK_RELAY_SECRET مفقود أو أقصر من 16 محرفًا (عقد §49).")
  console.error("  الاستعمال: NEXUSLINK_RELAY_SECRET=<سر قوي> node mini-services/relay/server.mjs")
  process.exit(2)
}
if ((TLS_CERT ? 1 : 0) !== (TLS_KEY ? 1 : 0)) {
  console.error("✗ REFUSING plaintext fallback: متغير TLS واحد بلا الآخر (نمط §41 — عقد §49).")
  console.error("  اضبط NEXUSLINK_TLS_CERT و NEXUSLINK_TLS_KEY معًا أو أزل كليهما (وضع Caddy أمام المرحّل).")
  process.exit(2)
}

// ── حالة التوجيه في الذاكرة حصرًا (صفر تخزين — عقد §49) ─────────────
const rooms = new Map() // room → { hub: Conn|null, visitors: Map<Conn, {joinedAt}> }
const connRoom = new Map() // Conn → room (للتنظيف عند القطع)
const authFails = new Map() // ip → { n, until }
const seenNonces = new Map() // nonce → وقت الرؤية
const startedAt = Date.now()
let requestsServed = 0

function sweepNonces() {
  const cut = Date.now() - NONCE_WINDOW_MS
  for (const [n, ts] of seenNonces) if (ts < cut) seenNonces.delete(n)
}

// ── بروتوكول WS يدوي (قاع RFC 6455 — نص فقط، عميل مقنّع، سيرفر غير مقنّع) ──
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function wsAccept(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64")
}

/** قراءة إطار WS واحد من المخزن — يرجع {opcode, payload, next} أو {need}/{reject} */
function readWsFrame(buf, offset = 0) {
  if (buf.length - offset < 2) return { need: true }
  const b0 = buf[offset]
  const b1 = buf[offset + 1]
  const fin = (b0 & 0x80) !== 0
  const opcode = b0 & 0x0f
  const masked = (b1 & 0x80) !== 0
  let len = b1 & 0x7f
  let p = offset + 2
  if (len === 126) {
    if (buf.length - p < 2) return { need: true }
    len = buf.readUInt16BE(p); p += 2
  } else if (len === 127) {
    if (buf.length - p < 8) return { need: true }
    const hi = buf.readUInt32BE(p), lo = buf.readUInt32BE(p + 4)
    if (hi !== 0 || lo > MAX_FRAME_CHARS) return { reject: "oversize" }
    len = lo; p += 8
  }
  if (len > MAX_FRAME_CHARS) return { reject: "oversize" }
  if (!masked) return { reject: "unmasked" }
  if (buf.length - p < 4 + len) return { need: true }
  const mask = buf.subarray(p, p + 4); p += 4
  const payload = Buffer.allocUnsafe(len)
  for (let i = 0; i < len; i++) payload[i] = buf[p + i] ^ mask[i & 3]
  if (!fin || opcode === 0x00) return { reject: "fragmented" }
  return { opcode, payload, next: p + len }
}

/** كتابة إطار نص WS (سيرفر → عميل بلا قناع — RFC: السيرفر لا يقنّع) */
function wsTextFrame(socket, text) {
  const payload = Buffer.from(text, "utf8")
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.from([0x81, len])
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4)
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = 0x81; header[1] = 127
    header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6)
  }
  socket.write(Buffer.concat([header, payload]))
}

/** إغلاق مؤدب بإطار close ثم قطع */
function wsClose(socket, code, reason) {
  try {
    const r = Buffer.from(String(reason || ""), "utf8")
    const h = Buffer.allocUnsafe(2)
    h.writeUInt16BE(code, 0)
    const plen = Math.min(r.length + 2, 125)
    socket.write(Buffer.concat([Buffer.from([0x88, plen]), h, r.subarray(0, plen - 2)]))
  } catch { /* مقبس ميت */ }
  setTimeout(() => { try { socket.destroy() } catch { /* بالفعل */ } }, 150)
}

// ── كائن الاتصال (hub أو visitor بعد المصادقة) ────────────────────────
class Conn {
  constructor(socket) {
    this.socket = socket
    this.role = null // "hub" | "visitor"
    this.room = null // 16-hex
    this.authed = false
    this.alive = true
    this.lastPong = Date.now()
    this.inflight = new Set() // معرفات الطلبات قيد الخدمة (زائر حصرًا)
    this.buffer = Buffer.alloc(0)
  }
  send(frame) { if (this.alive) wsTextFrame(this.socket, encodeFrame(frame)) }
  close(code, reason) { if (!this.alive && this.role === null) return; this.alive = false; wsClose(this.socket, code, reason) }
}

function clientIpOf(socket) {
  return String(socket.remoteAddress || "unknown").replace(/^::ffff:/, "")
}

// ── حسم المصادقة ─────────────────────────────────────────────────────
function authFail(ip) {
  const f = authFails.get(ip) || { n: 0, until: 0 }
  f.n += 1
  if (f.n >= MAX_AUTH_FAILS) f.until = Date.now() + AUTH_FAIL_LOCK_MS
  authFails.set(ip, f)
}

function handleAuth(conn, frame) {
  const ip = clientIpOf(conn.socket)
  const f = authFails.get(ip)
  if (f && f.until > Date.now()) {
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "auth-err", reason: "locked" })
    conn.close(4001, "locked")
    return
  }
  // منع إعادة تشغيل الإثبات: nonce مُشاهد داخل النافذة يرفض (تخفيض معلن)
  sweepNonces()
  if (seenNonces.has(frame.nonce)) {
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "auth-err", reason: "nonce-replayed" })
    conn.close(4001, "nonce-replayed")
    return
  }
  if (!verifyAuth(SECRET, frame.nonce, frame.proof)) {
    authFail(ip)
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "auth-err", reason: "bad-proof" })
    conn.close(4003, "bad-proof")
    return
  }
  seenNonces.set(frame.nonce, Date.now())
  authFails.delete(ip)

  if (frame.role === "hub") {
    const room = roomIdFromSecret(SECRET)
    let r = rooms.get(room)
    if (!r) { r = { hub: null, visitors: new Map() }; rooms.set(room, r) }
    if (r.hub && r.hub.alive) {
      // غرفة واحدة = مركز واحد (السر نفسه = المشغّل نفسه): الجديد يزيح القديم
      const old = r.hub
      old.send({ v: RELAY_PROTOCOL_VERSION, t: "err", reason: "replaced" })
      old.close(4000, "replaced")
      cleanupConn(old)
    }
    r.hub = conn
    conn.role = "hub"; conn.room = room; conn.authed = true
    connRoom.set(conn, room)
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "auth-ok", room, service: "nexuslink-relay", version: RELAY_PROTOCOL_VERSION })
    return
  }

  // زائر: غرفة صالحة + مركز حي + سقف الزائرين
  if (!validRoomId(frame.room)) {
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "auth-err", reason: "room-invalid" })
    conn.close(4003, "room-invalid")
    return
  }
  const r = rooms.get(frame.room)
  if (!r || !r.hub || !r.hub.alive) {
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "auth-err", reason: "no-hub" })
    conn.close(4004, "no-hub")
    return
  }
  if (r.visitors.size >= MAX_VISITORS_PER_ROOM) {
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "auth-err", reason: "room-full" })
    conn.close(4005, "room-full")
    return
  }
  r.visitors.set(conn, { joinedAt: Date.now() })
  conn.role = "visitor"; conn.room = frame.room; conn.authed = true
  connRoom.set(conn, frame.room)
  conn.send({ v: RELAY_PROTOCOL_VERSION, t: "auth-ok", room: frame.room, service: "nexuslink-relay", version: RELAY_PROTOCOL_VERSION })
  r.hub.send({ v: RELAY_PROTOCOL_VERSION, t: "visitor-join", room: frame.room, visitors: r.visitors.size })
}

// ── تمرير الطلبات (المرحّل أعمى: إطار↔إطار بلا تفسير محتوى) ──────────
function handleVisitorReq(conn, frame) {
  const r = rooms.get(conn.room)
  if (!r || !r.hub || !r.hub.alive) {
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "err", reason: "no-hub", id: frame.id })
    return
  }
  if (!validRequestId(frame.id)) {
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "err", reason: "id-invalid" })
    return
  }
  if (conn.inflight.size >= MAX_INFLIGHT_PER_VISITOR) {
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "err", reason: "busy", id: frame.id })
    return
  }
  conn.inflight.add(frame.id)
  r.hub.send({
    v: RELAY_PROTOCOL_VERSION, t: "req", id: frame.id, method: frame.method, path: frame.path,
    headers: frame.headers, ...(frame.bodyB64 !== undefined ? { bodyB64: frame.bodyB64 } : {}),
  })
  requestsServed++
}

function handleHubRes(conn, frame) {
  const r = rooms.get(conn.room)
  if (!r) return
  for (const [visitor] of r.visitors) {
    if (visitor.inflight.has(frame.id)) {
      visitor.inflight.delete(frame.id)
      visitor.send({
        v: RELAY_PROTOCOL_VERSION, t: "res", id: frame.id, status: frame.status,
        headers: frame.headers, ...(frame.bodyB64 !== undefined ? { bodyB64: frame.bodyB64 } : {}),
      })
      return
    }
  }
  // معرف مجهول (توجيه ضاع بعد إعادة تشغيل المرحّل مثلًا) — يُعلن للمركز بصدق
  conn.send({ v: RELAY_PROTOCOL_VERSION, t: "err", reason: "unknown-id", id: frame.id })
}

// ── تنظيف الاتصال ────────────────────────────────────────────────────
function cleanupConn(conn) {
  const room = connRoom.get(conn)
  if (!room) return
  connRoom.delete(conn)
  const r = rooms.get(room)
  if (!r) return
  if (r.hub === conn) {
    r.hub = null
    // المركز سقط: الزائرون يُخبرون بصدق (النفق يعيد الاتصال بتراجع حتمي)
    for (const [v] of r.visitors) v.send({ v: RELAY_PROTOCOL_VERSION, t: "err", reason: "no-hub" })
    if (r.visitors.size === 0) rooms.delete(room)
  } else if (r.visitors.has(conn)) {
    r.visitors.delete(conn)
    if (r.hub && r.hub.alive) r.hub.send({ v: RELAY_PROTOCOL_VERSION, t: "visitor-part", room, visitors: r.visitors.size })
    if (!r.hub && r.visitors.size === 0) rooms.delete(room)
  }
}

// ── حسم الإطار فوق WS ────────────────────────────────────────────────
function handleFrame(conn, frame) {
  if (!conn.authed) {
    if (frame.t !== "auth") { conn.close(4002, "auth-first"); return }
    handleAuth(conn, frame)
    return
  }
  switch (frame.t) {
    case "ping": conn.send({ v: RELAY_PROTOCOL_VERSION, t: "pong" }); conn.lastPong = Date.now(); return
    case "pong": conn.lastPong = Date.now(); return
    case "req": if (conn.role === "visitor") handleVisitorReq(conn, frame); return
    case "res": if (conn.role === "hub") handleHubRes(conn, frame); return
    default: return // إطارات أخرى تُتجاهل بصدق (auth مكرر مثلًا لا أثر له)
  }
}

function pump(conn) {
  for (;;) {
    const out = readWsFrame(conn.buffer)
    if (out.need) return
    if (out.reject) { conn.close(1002, out.reject); return }
    conn.buffer = conn.buffer.subarray(out.next)
    if (out.opcode === 0x08) { conn.alive = false; try { conn.socket.end() } catch { /* بالفعل */ } return }
    if (out.opcode === 0x09) { // WS-level ping → pong فوري (RFC)
      try {
        const pl = Math.min(out.payload.length, 125)
        const h = pl < 126 ? Buffer.from([0x8a, pl]) : Buffer.from([0x8a, 126, 0, pl])
        conn.socket.write(Buffer.concat([h, out.payload.subarray(0, pl)]))
      } catch { /* مقبس ميت */ }
      conn.lastPong = Date.now()
      continue
    }
    if (out.opcode === 0x0a) { conn.lastPong = Date.now(); continue }
    if (out.opcode !== 0x01) { conn.close(1002, "text-only"); return }
    const text = out.payload.toString("utf8")
    if (text.length > MAX_FRAME_CHARS) { conn.close(1009, "oversize"); return }
    const parsed = parseFrame(text)
    if (!parsed.ok) { conn.send({ v: RELAY_PROTOCOL_VERSION, t: "err", reason: parsed.reason }); conn.close(1002, parsed.reason); return }
    handleFrame(conn, parsed.frame)
  }
}

// ── HTTP: الصحة والحالة والترقية ────────────────────────────────────
function handler(req, res) {
  const url = String(req.url || "/").split("?")[0]
  if (url === "/__relay/health") {
    let visitors = 0
    for (const r of rooms.values()) visitors += r.visitors.size
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    res.end(JSON.stringify({
      ok: true, service: "nexuslink-relay", version: RELAY_PROTOCOL_VERSION,
      uptimeMs: Date.now() - startedAt, rooms: rooms.size, visitors, requests: requestsServed,
      tls: !!(TLS_CERT && TLS_KEY),
    }))
    return
  }
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
    res.end("NexusLink self-hosted relay (§49) — blind authenticated pipe.\nZero storage. One hub per room. https://github.com/CTO-DRS/NexusLink\n")
    return
  }
  res.writeHead(404, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify({ ok: false, error: "not-found" }))
}

function onUpgrade(req, socket) {
  const key = req.headers["sec-websocket-key"]
  const url = String(req.url || "").split("?")[0]
  if (url !== "/__relay/ws" || !key || String(req.headers.upgrade || "").toLowerCase() !== "websocket") {
    try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n") } catch { /* مقبس ميت */ }
    return
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${wsAccept(String(key))}\r\n\r\n`,
  )
  const conn = new Conn(socket)
  socket.on("data", (d) => {
    if (!conn.alive) return
    conn.buffer = Buffer.concat([conn.buffer, d])
    if (conn.buffer.length > MAX_FRAME_CHARS + 4096) { conn.close(1009, "oversize"); return }
    pump(conn)
  })
  socket.on("close", () => { conn.alive = false; cleanupConn(conn) })
  socket.on("error", () => { conn.alive = false; try { socket.destroy() } catch { /* بالفعل */ } })
  // مهلة المصادقة: أول إطار خلال 5 ثوانٍ وإلا قطع (لا اتصال معلق بلا نية)
  setTimeout(() => { if (!conn.authed && conn.alive) conn.close(4002, "auth-deadline") }, AUTH_DEADLINE_MS)
}

// ── الإقلاع (http صاف أو https/WSS بمعطيات §41 — بلا سقوط صامت) ──────
const server = TLS_CERT && TLS_KEY
  ? https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, handler)
  : http.createServer(handler)
server.on("upgrade", onUpgrade)
server.listen(PORT, HOST, () => {
  const proto = TLS_CERT && TLS_KEY ? "https/wss" : "http/ws"
  console.log(`▸ NexusLink relay (§49) على ${proto}://${HOST}:${PORT}`)
  console.log(`  الغرفة: ${roomIdFromSecret(SECRET)} (معلنة للمالك — لا تمنح وصولًا)`)
  console.log(`  صفر تخزين · زائرون/غرفة ≤ ${MAX_VISITORS_PER_ROOM} · إطار ≤ ${MAX_FRAME_CHARS} محرفًا`)
})

// نبض دوري: ping نصي كل HEARTBEAT_MS والصمت ضِعفها يقطع (كشف الموتي بصدق)
setInterval(() => {
  const cut = Date.now() - HEARTBEAT_MS * 2
  for (const conn of connRoom.keys()) {
    if (!conn.alive) continue
    if (conn.lastPong < cut) { conn.close(1001, "heartbeat"); cleanupConn(conn); continue }
    conn.send({ v: RELAY_PROTOCOL_VERSION, t: "ping" })
  }
}, HEARTBEAT_MS).unref()

// إطفاء مؤدب: كل الاتصالات تُقطع والحالة تُمحى (النفق يعيد الاتصال)
function shutdown() {
  console.log("▸ إطفاء المرحّل — كل الغرف تُمحى (صفر تخزين)")
  for (const conn of connRoom.keys()) conn.close(1001, "shutdown")
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
