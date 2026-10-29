// NexusLink — نفق المرحّل الذاتي على المركز (عقد §49 — النواة المحلية لـ E4)
// ============================================================
// عميل يعمل داخل عملية Next (نمط الجسور): يتصل خارجيًا بخادم المرحّل الذي
// يملكه المالك، يوثّق نفسه كمركز بإثبات HMAC (السر لا يسافر)، ثم يخدم طلبات
// الزوار البعيدين عبر البوابة المحلية للجهاز:
//
//   هاتف/متصفح ──(WS)── المرحّل (خادم المالك) ──(WS خارجي من المركز)──
//   هذا النفق ──(HTTP loopback + ترويسة x-nexuslink-relay)── البوابة §37
//
// لماذا عبر البوابة لا إلى REST مباشرة؟ ليظل حسم رمز §37 وفرض السياسة
// §38/§40 وحجب الجسور في نقطة واحدة: الترويسة x-nexuslink-relay يجعل
// الطلب عبر النفق «خارجيًا» في كل حواجز البوابة (ترويسة شدّ: وجودها يشدّ
// أبدًا ولا يرخي — والبوابة وحدها لا تعرف إلا أنها من loopback فتصدّقها
// كتصنيف لا كهوية).
//
// صفر تغيير مخطط: مصدر الحقيقة ملف JSON خارج المخطط (.zstate/relay.json أو
// NEXUSLINK_RELAY_FILE) بتعديل-وقت — حذف الملف أو enabled=false = تعطيل
// فوري بلا إعادة تشغيل (نمط §37/§48).
//
// حدود v1 المعلنة: HTTP/REST حصرًا (ترقية WS عبر النفق مرفوضة في النواة) ·
// مهلة طلب 30s · جسم ≤ 8MiB · تراجع إعادة الاتصال حتمي (250ms×2^n سقف 16s).

import http from "node:http"
import https from "node:https"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  RELAY_PROTOCOL_VERSION, MAX_BODY_BYTES, HEARTBEAT_MS,
  roomIdFromSecret, fingerprintOfSecret, newNonce, authProof,
  normalizeRelayUrl, normalizeVisitorRequest, redactUrl, validateSecret,
  encodeFrame, parseFrame, validRequestId,
  type RelayFrame,
} from "./relay-core"

const RELAY_FILE =
  process.env.NEXUSLINK_RELAY_FILE || path.join(process.cwd(), ".zstate", "relay.json")

/** البوابة هي نقطة الدخول الموحدة — النفق يخاطبها حصرًا لا REST مباشرة */
const GW_PORT = Number(process.env.NEXUSLINK_GW_PORT || process.env.GATEWAY_PORT || 81)
/** مهلة خدمة الطلب الواحد عبر النفق */
const REQUEST_TIMEOUT_MS = 30_000

export type RelayTunnelState = "disabled" | "connecting" | "connected" | "waiting" | "error"

interface RelayConfig {
  enabled: boolean
  url: string
  secret: string
  createdAt: string
  fingerprint: string
}

export interface RelayTunnelStatus {
  state: RelayTunnelState
  reason: string
  url: string // معتّم — الأصل حصرًا بلا اعتمادات
  roomId: string
  fingerprint: string
  createdAt: string
  attempt: number
  connectedAt: number | null
  lastConnectedAt: number | null
  stats: { requests: number; ok: number; errors: number; bytesIn: number; bytesOut: number }
  gwPort: number
  protocolVersion: number
}

// ── قراءة الملف بمتغير تعديل-وقت (نمط pairCache في البوابة) ──────────
let fileCache: { mtimeMs: number; size: number; data: RelayConfig | null } = { mtimeMs: -1, size: -1, data: null }
function readRelayFile(): RelayConfig | null {
  try {
    const st = fs.statSync(RELAY_FILE)
    if (st.mtimeMs !== fileCache.mtimeMs || st.size !== fileCache.size) {
      let parsed: RelayConfig | null = null
      try {
        const j = JSON.parse(fs.readFileSync(RELAY_FILE, "utf8"))
        if (j && typeof j === "object" && typeof j.url === "string" && typeof j.secret === "string") {
          parsed = {
            enabled: j.enabled === true,
            url: j.url,
            secret: j.secret,
            createdAt: String(j.createdAt ?? ""),
            fingerprint: String(j.fingerprint ?? fingerprintOfSecret(String(j.secret))),
          }
        }
      } catch { /* تالف — يعامل كمعطل بصدق */ }
      fileCache = { mtimeMs: st.mtimeMs, size: st.size, data: parsed }
    }
    return fileCache.data
  } catch {
    fileCache = { mtimeMs: -1, size: -1, data: null }
    return null
  }
}

// ── الحالة الحية للنفق (عملية واحدة — مفرد دلالي) ────────────────────
let ws: import("node:stream").Duplex | null = null
let state: RelayTunnelState = "disabled"
let stateReason = ""
let attempt = 0
let connectedAt: number | null = null
let lastConnectedAt: number | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let lastPongAt = Date.now()
let currentConfig: RelayConfig | null = null
const stats = { requests: 0, ok: 0, errors: 0, bytesIn: 0, bytesOut: 0 }
let loopArmed = false

export function relayTunnelStatus(): RelayTunnelStatus {
  const cfg = readRelayFile()
  return {
    state: cfg && cfg.enabled ? state : "disabled",
    reason: cfg && cfg.enabled ? stateReason : cfg ? "disabled-by-file" : "no-config",
    url: cfg ? redactUrl(cfg.url) : "",
    roomId: cfg && validateSecret(cfg.secret) ? roomIdFromSecret(cfg.secret) : "",
    fingerprint: cfg?.fingerprint ?? "",
    createdAt: cfg?.createdAt ?? "",
    attempt,
    connectedAt,
    lastConnectedAt,
    stats: { ...stats },
    gwPort: GW_PORT,
    protocolVersion: RELAY_PROTOCOL_VERSION,
  }
}

// ── عميل WS يدوي (قاع RFC 6455 — العميل يقنّع والسيرفر لا) ───────────
function wsClientMaskedText(socket: import("node:stream").Duplex, text: string) {
  const payload = Buffer.from(text, "utf8")
  const mask = crypto.randomBytes(4)
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.allocUnsafe(2)
    header[0] = 0x81; header[1] = 0x80 | len
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4)
    header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = 0x81; header[1] = 0x80 | 127
    header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6)
  }
  const masked = Buffer.allocUnsafe(len)
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
  socket.write(Buffer.concat([header, mask, masked]))
}

function wsParseServerFrames(buffer: Buffer, socket: import("node:stream").Duplex, onText: (s: string) => void, onClose: (code: number) => void): Buffer {
  let offset = 0
  for (;;) {
    if (buffer.length - offset < 2) break
    const b0 = buffer[offset]
    const b1 = buffer[offset + 1]
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0 // السيرفر لا يقنّع — إن قنّع فهو خطأ بروتوكول
    let len = b1 & 0x7f
    let p = offset + 2
    if (len === 126) {
      if (buffer.length - p < 2) break
      len = buffer.readUInt16BE(p); p += 2
    } else if (len === 127) {
      if (buffer.length - p < 8) break
      const hi = buffer.readUInt32BE(p)
      len = buffer.readUInt32BE(p + 4)
      if (hi !== 0) { onClose(1009); return buffer.subarray(buffer.length) }
      p += 8
    }
    if (buffer.length - p < len) break
    if (masked) { onClose(1002); return buffer.subarray(buffer.length) }
    const payload = buffer.subarray(p, p + len)
    if (opcode === 0x08) { onClose(payload.length >= 2 ? payload.readUInt16BE(0) : 1005); return buffer.subarray(buffer.length) }
    if (opcode === 0x0a) { lastPongAt = Date.now(); offset = p + len; continue }
    if (opcode === 0x09) {
      // WS-level ping من المرحّل → pong فوري
      const pl = Math.min(payload.length, 125)
      const h = pl < 126 ? Buffer.from([0x8a, pl]) : Buffer.from([0x8a, 126, 0, pl])
      try { socket.write(Buffer.concat([h, payload.subarray(0, pl)])) } catch { /* مقبس ميت */ }
      lastPongAt = Date.now()
      offset = p + len
      continue
    }
    if (opcode === 0x01) onText(payload.toString("utf8"))
    offset = p + len
  }
  return buffer.subarray(offset)
}

// ── خدمة طلب زائر: التطبيع ثم fetch عبر البوابة (نقطة الحسم الواحدة) ──
const REASON_STATUS: Record<string, number> = {
  "method-not-allowed": 405,
  "path-invalid": 400,
  "header-oversize": 431,
  "too-many-headers": 431,
  "body-encoding": 400,
  "body-oversize": 413,
}

async function serveVisitorRequest(frame: Extract<RelayFrame, { t: "req" }>, roomId: string): Promise<string> {
  const mkerr = (status: number, reason: string) =>
    encodeFrame({
      v: RELAY_PROTOCOL_VERSION, t: "res", id: frame.id, status,
      headers: { "content-type": "application/json" },
      bodyB64: Buffer.from(JSON.stringify({ ok: false, relay: true, error: reason })).toString("base64"),
    })
  if (!validRequestId(frame.id)) return mkerr(400, "id-invalid")
  const norm = normalizeVisitorRequest(frame)
  if (!norm.ok) return mkerr(REASON_STATUS[norm.reason] ?? 400, norm.reason)
  stats.requests++
  stats.bytesIn += norm.body ? norm.body.length : 0
  try {
    const headers: Record<string, string> = { ...norm.headers, "x-nexuslink-relay": roomId }
    const res = await fetch(`http://127.0.0.1:${GW_PORT}${norm.path}`, {
      method: norm.method,
      headers,
      body: norm.body && norm.method !== "GET" && norm.method !== "HEAD" ? new Uint8Array(norm.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "manual",
    })
    const outHeaders: Record<string, string> = {}
    for (const [k, v] of res.headers) {
      const lower = k.toLowerCase()
      if (["connection", "keep-alive", "transfer-encoding", "upgrade", "content-length", "content-encoding"].includes(lower)) continue
      if (lower === "set-cookie") continue // متعدد القيم لا يمرر في v1 — حد معلن
      outHeaders[lower] = v
    }
    let bodyB64: string | undefined
    if (norm.method !== "HEAD" && res.status !== 204 && res.status !== 304) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_BODY_BYTES) return mkerr(502, "response-oversize")
      stats.bytesOut += buf.length
      bodyB64 = buf.length > 0 ? buf.toString("base64") : undefined
    }
    stats.ok++
    return encodeFrame({ v: RELAY_PROTOCOL_VERSION, t: "res", id: frame.id, status: res.status, headers: outHeaders, ...(bodyB64 !== undefined ? { bodyB64 } : {}) })
  } catch (e) {
    stats.errors++
    const msg = e instanceof Error ? e.message : String(e)
    const reason = /timeout|abort/i.test(msg) ? "gateway-timeout" : "gateway-unreachable"
    return mkerr(502, reason)
  }
}

// ── حلقة الاتصال: connect → auth → serve → تراجع حتمي عند السقوط ─────
function teardownSocket() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  if (ws) {
    try { ws.destroy() } catch { /* بالفعل */ }
    ws = null
  }
}

function scheduleReconnect(cfg: RelayConfig, why: string) {
  if (state !== "disabled") { state = "waiting"; stateReason = why }
  const wait = Math.min(250 * 2 ** Math.min(attempt, 6), 16_000)
  attempt++
  if (reconnectTimer) clearTimeout(reconnectTimer)
  const cfgAtSchedule = cfg
  reconnectTimer = setTimeout(() => { void connectOnce(cfgAtSchedule) }, wait)
  reconnectTimer.unref?.()
}

function connectOnce(cfg: RelayConfig) {
  const nu = normalizeRelayUrl(cfg.url)
  if (!nu.ok) { state = "error"; stateReason = `url-${nu.reason}`; return }
  if (!validateSecret(cfg.secret)) { state = "error"; stateReason = "secret-invalid"; return }
  // ملف تغيّر أثناء الانتظار (تعطيل مثلًا) — الحلقة تُلغي نفسها بصدق
  const now = readRelayFile()
  if (!now || !now.enabled || now.url !== cfg.url || now.secret !== cfg.secret) { relayTunnelTouch(); return }

  const roomId = roomIdFromSecret(cfg.secret)
  currentConfig = cfg
  state = "connecting"; stateReason = ""
  const secure = nu.wsUrl.startsWith("wss://")
  const target = new URL(nu.wsUrl)
  const key = crypto.randomBytes(16).toString("base64")
  const opts: http.RequestOptions = {
    host: target.hostname,
    port: Number(target.port || (secure ? 443 : 80)),
    path: target.pathname,
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-key": key,
      "sec-websocket-version": "13",
    },
    timeout: 8_000,
  }
  const req = secure ? https.request(opts) : http.request(opts)
  req.on("upgrade", (res, socket) => {
    if (!res.headers["sec-websocket-accept"]) { socket.destroy(); scheduleReconnect(cfg, "handshake-missing-accept"); return }
    ws = socket
    state = "connecting"; stateReason = "auth"
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    // المصادقة فورًا: إثبات HMAC — السر لا يسافر أبدًا
    const nonce = newNonce()
    wsClientMaskedText(socket, encodeFrame({ v: RELAY_PROTOCOL_VERSION, t: "auth", role: "hub", nonce, proof: authProof(cfg.secret, nonce) }))
    socket.on("data", (d: Buffer) => {
      buffer = wsParseServerFrames(
        Buffer.concat([buffer, d]),
        socket,
        (text: string) => {
          const parsed = parseFrame(text)
          if (!parsed.ok) return // إطار غريب من المرحّل — يُتجاهل (النبض يكشف الموت)
          const f = parsed.frame
          if (f.t === "auth-ok") {
            if (f.room !== roomId) { state = "error"; stateReason = "room-mismatch"; socket.destroy(); return }
            state = "connected"; stateReason = ""
            attempt = 0
            connectedAt = Date.now()
            lastConnectedAt = Date.now()
            lastPongAt = Date.now()
            return
          }
          if (f.t === "ping") { lastPongAt = Date.now(); if (ws) wsClientMaskedText(ws, encodeFrame({ v: RELAY_PROTOCOL_VERSION, t: "pong" })); return }
          if (f.t === "visitor-join" || f.t === "visitor-part" || f.t === "pong") return
          if (f.t === "auth-err" || f.t === "err") { state = "error"; stateReason = f.reason; return }
          if (f.t === "req") {
            void serveVisitorRequest(f, roomId).then((resText) => {
              if (ws) { try { wsClientMaskedText(ws, resText) } catch { /* مقبس ميت */ } }
            })
          }
        },
        (code) => {
          teardownSocket()
          scheduleReconnect(cfg, `closed-${code}`)
        },
      )
    })
    socket.on("error", () => { teardownSocket(); scheduleReconnect(cfg, "socket-error") })
    socket.on("close", () => { teardownSocket(); scheduleReconnect(cfg, "socket-closed") })
    // نبضنا نحن: نصي كل HEARTBEAT_MS — المرحّل يقطع الصامت (صمتنا نقطعه نحن)
    heartbeatTimer = setInterval(() => {
      if (state === "connected") {
        if (Date.now() - lastPongAt > HEARTBEAT_MS * 2) { teardownSocket(); scheduleReconnect(cfg, "heartbeat-missed"); return }
        if (ws) { try { wsClientMaskedText(ws, encodeFrame({ v: RELAY_PROTOCOL_VERSION, t: "ping" })) } catch { /* مقبس ميت */ } }
      }
    }, HEARTBEAT_MS)
    heartbeatTimer.unref?.()
  })
  req.on("error", (e: Error) => { state = "error"; stateReason = e.message.slice(0, 80); scheduleReconnect(cfg, "connect-error") })
  req.on("timeout", () => { req.destroy(); scheduleReconnect(cfg, "connect-timeout") })
  req.end()
}

/** تسليح النفق (idempotent) — أول استدعاء يبدأ الحلقة، والتالية تعيد الحسم فقط */
export function ensureRelayTunnel(): RelayTunnelStatus {
  if (!loopArmed) {
    loopArmed = true
    setInterval(() => relayTunnelTouch(), 2_000).unref?.()
  }
  relayTunnelTouch()
  return relayTunnelStatus()
}

/** إعادة الحسم من الملف: تعطيل يقطع فورًا، وتغيّر الإعداد يعيد الاتصال */
export function relayTunnelTouch(): void {
  const cfg = readRelayFile()
  if (!cfg || !cfg.enabled) {
    teardownSocket()
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    state = "disabled"
    stateReason = cfg ? "disabled-by-file" : "no-config"
    attempt = 0
    connectedAt = null
    return
  }
  const changed = !currentConfig || currentConfig.url !== cfg.url || currentConfig.secret !== cfg.secret
  if (state === "disabled" || state === "error" || changed) {
    if (changed) { teardownSocket(); currentConfig = cfg; attempt = 0 }
    if (state === "disabled" || changed || state === "error") {
      if (!reconnectTimer) void connectOnce(cfg)
    }
  }
}

/** كتابة الملف ذرّيًا 0600 (نمط §37/§48) — للمسار الإداري حصرًا */
export function writeRelayConfig(url: string, secret: string): { fingerprint: string; createdAt: string } {
  const fingerprint = fingerprintOfSecret(secret)
  const createdAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(RELAY_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${RELAY_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ enabled: true, url, secret, createdAt, fingerprint }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, RELAY_FILE)
  try { fs.chmodSync(RELAY_FILE, 0o600) } catch { /* أنظمة بلا أذونات بوزيكس */ }
  fileCache = { mtimeMs: -1, size: -1, data: null } // أعد القراءة الآن
  return { fingerprint, createdAt }
}

/** تعطيل: حذف الملف = قطع فوري بلا إعادة تشغيل (نمط §37) */
export function disableRelayConfig(): void {
  try { fs.rmSync(RELAY_FILE, { force: true }) } catch { /* غائب أصلًا */ }
  fileCache = { mtimeMs: -1, size: -1, data: null }
  teardownSocket()
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  state = "disabled"
  stateReason = "disabled-by-file"
  attempt = 0
  connectedAt = null
}
