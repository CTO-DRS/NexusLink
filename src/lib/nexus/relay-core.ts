// NexusLink — نواة المرحّل الذاتي النقية (عقد §49 — النواة المحلية لـ E4)
// ============================================================
// دالٌّ خالص مشترك المنطق (خادم المرحّل · نفق المركز · الفحص) — بلا I/O ولا
// React ولا حالة:
//  · معرّف الغرفة مشتق حتميًا من سرّ المرحّل (HMAC-SHA256) — علنيّ العرض لا
//    يمنح وصولًا: الدخول يتطلب إثبات HMAC بالسر نفسه (مقارنة زمن-ثابتة —
//    درس §6/§37) والسر لا يسافر أبدًا في أي إطار.
//  · ترميز الأطر JSON-نص فوق WS: إطار واحد = رسالة واحدة، سقف حجم معلن،
//    ونسخة بروتوكول تُفحص حرفيًا — الغريب والمشوه والمتضخم يرفض بسبب معلن.
//  · تراجع إعادة الاتصال حتمي صرف (أُسّي بسقف) — قابل للتحقق في الفحص
//    بلا عشوائية تخفي سلوكًا.
// صفر تخزين في المرحّل (عقد §49): كل حالة توجيه في الذاكرة حصرًا.
// حدود بروتوكول v1 المعلنة: HTTP/REST حصرًا عبر النفق (لا ترقية WS) ·
// أجساد بسقف 8MiB · ترويسات أحادية القيمة · قنوات المقبس الحي محلية.

import crypto from "crypto"

/** نسخة بروتوكول المرحّل — تُفحص في كل إطار حرفيًا */
export const RELAY_PROTOCOL_VERSION = 1

/** مجالات الاشتقاق — تفصل السر عن أي استعمال مباشر كمفتاح */
const ROOM_DOMAIN = "nexuslink/relay-room/v1"
const AUTH_DOMAIN = "nexuslink/relay-auth/v1"
const FP_DOMAIN = "nexuslink/relay-fp/v1"

// ── السقوف والثوابت التعاقدية (معلنة كلها في §49) ─────────────────────
/** أقصى حجم لإطار نصي واحد (محارف) ≈ 9MiB ثنائية بعد base64 */
export const MAX_FRAME_CHARS = 12_000_000
/** أقصى جسم طلب/استجابة يعبر النفق (بايت) */
export const MAX_BODY_BYTES = 8 * 1024 * 1024
/** أقصى طول للمسار */
export const MAX_PATH_CHARS = 2048
/** أقصى عدد ترويسات في الطلب الوارد من الزائر */
export const MAX_HEADERS = 32
/** طرق HTTP المسموحة عبر النفق حصرًا */
export const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
/** زائران كحد أقصى في الغرفة الواحدة */
export const MAX_VISITORS_PER_ROOM = 5
/** طلبات قيد الخدمة المتزامنة للزائر الواحد */
export const MAX_INFLIGHT_PER_VISITOR = 4
/** قفل عنوان بعد فشلات مصادقة متتالية */
export const MAX_AUTH_FAILS = 5
export const AUTH_FAIL_LOCK_MS = 10 * 60_000
/** نافذة منع إعادة تشغيل الإثبات (nonce) */
export const NONCE_WINDOW_MS = 10 * 60_000
/** نبض المرحّل — إطار ping كل هذه المدة والصمت ضِعفها يقطع */
export const HEARTBEAT_MS = 15_000
/** مهلة أول إطار مصادقة بعد الترقية */
export const AUTH_DEADLINE_MS = 5_000

/** أسباب رفض الإطار — مغلقة كأنواع البيت (لا سبب مجهول) */
export type FrameRejectReason =
  | "malformed"    // ليس JSON سليمًا
  | "not-object"   // JSON لكن ليس كائنًا
  | "version"      // نسخة بروتوكول غريبة
  | "unknown-type" // نوع إطار خارج المغلق
  | "oversize"     // فوق سقف المحارف المعلن
  | "shape"        // حقول مفقودة أو من نوع خاطئ

export type RelayFrame =
  | { v: number; t: "auth"; role: "hub" | "visitor"; nonce: string; proof: string; room?: string }
  | { v: number; t: "auth-ok"; room: string; service: string; version: number }
  | { v: number; t: "auth-err"; reason: string }
  | { v: number; t: "req"; id: string; method: string; path: string; headers: Record<string, string>; bodyB64?: string }
  | { v: number; t: "res"; id: string; status: number; headers: Record<string, string>; bodyB64?: string }
  | { v: number; t: "ping" }
  | { v: number; t: "pong" }
  | { v: number; t: "visitor-join"; room: string; visitors: number }
  | { v: number; t: "visitor-part"; room: string; visitors: number }
  | { v: number; t: "err"; reason: string; id?: string }

const FRAME_TYPES = new Set(["auth", "auth-ok", "auth-err", "req", "res", "ping", "pong", "visitor-join", "visitor-part", "err"])

// ── الاشتقاق والإثبات ────────────────────────────────────────────────

/** معرّف الغرفة: 16-hex حتمي من السر — علنيّ العرض بلا أي قدرة وصول */
export function roomIdFromSecret(secret: string): string {
  return crypto.createHmac("sha256", secret).update(ROOM_DOMAIN).digest("hex").slice(0, 16)
}

/** بصمة السر للعرض (≠ معرّف الغرفة — مجال مختلف): 16-hex */
export function fingerprintOfSecret(secret: string): string {
  return crypto.createHmac("sha256", secret).update(FP_DOMAIN).digest("hex").slice(0, 16)
}

/** nonce جديد: 16 بايت عشوائية hex (32 محرفًا) */
export function newNonce(): string {
  return crypto.randomBytes(16).toString("hex")
}

/** إثبات المصادقة: HMAC-SHA256(السر، المجال:nonce) — hex 64 */
export function authProof(secret: string, nonce: string): string {
  return crypto.createHmac("sha256", secret).update(`${AUTH_DOMAIN}:${nonce}`).digest("hex")
}

/** تحقق زمن-ثابت (درس §6/§37) — طول مختلف يرفض قبل المقارنة بلا تسريب */
export function verifyAuth(secret: string, nonce: string, proof: string): boolean {
  if (typeof proof !== "string" || proof.length !== 64 || !/^[0-9a-f]{64}$/.test(proof)) return false
  const expected = Buffer.from(authProof(secret, nonce), "hex")
  const given = Buffer.from(proof, "hex")
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

/** صلاحية معرّف غرفة وارد من زائر: 16-hex حرفًا */
export function validRoomId(room: unknown): boolean {
  return typeof room === "string" && /^[0-9a-f]{16}$/.test(room)
}

/** صلاحية سرّ مرحّل عند التفعيل: 16..256 محرفًا بلا فراغات ولا تحكم */
export function validateSecret(secret: unknown): boolean {
  if (typeof secret !== "string") return false
  if (secret.length < 16 || secret.length > 256) return false
  return !/[\s\u0000-\u001f\u007f]/.test(secret)
}

// ── التراجع الحتمي ───────────────────────────────────────────────────

/** تراجع إعادة الاتصال: 250ms × 2^محاولة بسقف 16s — حتمي صرف بلا عشوائية */
export function backoffMs(attempt: number): number {
  const a = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0
  return Math.min(250 * 2 ** Math.min(a, 6), 16_000)
}

// ── ترميز الأطر ──────────────────────────────────────────────────────

/** ترميز إطار كنص JSON جاهز للإرسال فوق WS (إطار نص واحد) */
export function encodeFrame(frame: RelayFrame): string {
  return JSON.stringify({ ...frame, v: RELAY_PROTOCOL_VERSION })
}

/** فك إطار نص والتحقق الصارم: النسخة والنوع والشكل العام والسقف */
export function parseFrame(raw: string):
  { ok: true; frame: RelayFrame } | { ok: false; reason: FrameRejectReason } {
  if (typeof raw !== "string") return { ok: false, reason: "malformed" }
  if (raw.length > MAX_FRAME_CHARS) return { ok: false, reason: "oversize" }
  let j: unknown
  try { j = JSON.parse(raw) } catch { return { ok: false, reason: "malformed" } }
  if (j === null || typeof j !== "object" || Array.isArray(j)) return { ok: false, reason: "not-object" }
  const o = j as Record<string, unknown>
  if (o.v !== RELAY_PROTOCOL_VERSION) return { ok: false, reason: "version" }
  if (typeof o.t !== "string" || !FRAME_TYPES.has(o.t)) return { ok: false, reason: "unknown-type" }
  const t = o.t
  if (t === "auth") {
    if (o.role !== "hub" && o.role !== "visitor") return { ok: false, reason: "shape" }
    if (typeof o.nonce !== "string" || typeof o.proof !== "string") return { ok: false, reason: "shape" }
    return { ok: true, frame: { v: RELAY_PROTOCOL_VERSION, t, role: o.role, nonce: o.nonce, proof: o.proof, ...(typeof o.room === "string" ? { room: o.room } : {}) } }
  }
  if (t === "auth-ok") {
    if (!validRoomId(o.room)) return { ok: false, reason: "shape" }
    return { ok: true, frame: { v: RELAY_PROTOCOL_VERSION, t, room: o.room as string, service: String(o.service ?? ""), version: Number(o.version ?? 0) } }
  }
  if (t === "auth-err" || t === "err") {
    if (typeof o.reason !== "string") return { ok: false, reason: "shape" }
    return { ok: true, frame: { v: RELAY_PROTOCOL_VERSION, t, reason: o.reason, ...(typeof o.id === "string" ? { id: o.id } : {}) } }
  }
  if (t === "req") {
    if (typeof o.id !== "string" || typeof o.method !== "string" || typeof o.path !== "string") return { ok: false, reason: "shape" }
    if (o.headers === null || typeof o.headers !== "object" || Array.isArray(o.headers)) return { ok: false, reason: "shape" }
    return { ok: true, frame: { v: RELAY_PROTOCOL_VERSION, t, id: o.id, method: o.method, path: o.path, headers: o.headers as Record<string, string>, ...(typeof o.bodyB64 === "string" ? { bodyB64: o.bodyB64 } : {}) } }
  }
  if (t === "res") {
    if (typeof o.id !== "string" || typeof o.status !== "number") return { ok: false, reason: "shape" }
    if (o.headers === null || typeof o.headers !== "object" || Array.isArray(o.headers)) return { ok: false, reason: "shape" }
    return { ok: true, frame: { v: RELAY_PROTOCOL_VERSION, t, id: o.id, status: o.status as number, headers: o.headers as Record<string, string>, ...(typeof o.bodyB64 === "string" ? { bodyB64: o.bodyB64 } : {}) } }
  }
  if (t === "visitor-join" || t === "visitor-part") {
    if (!validRoomId(o.room) || typeof o.visitors !== "number") return { ok: false, reason: "shape" }
    return { ok: true, frame: { v: RELAY_PROTOCOL_VERSION, t, room: o.room as string, visitors: o.visitors as number } }
  }
  return { ok: true, frame: { v: RELAY_PROTOCOL_VERSION, t: "ping" } }
}

// ── روابط وأدوات العرض (F6 متوافقة — بلا أسرار) ─────────────────────

/** تطبيع رابط المرحّل: http(s)/ws(s) فقط → origin موحد للعرض وwsUrl للاتصال */
export function normalizeRelayUrl(input: unknown):
  { ok: true; origin: string; wsUrl: string } | { ok: false; reason: string } {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) return { ok: false, reason: "empty" }
  let u: URL
  try { u = new URL(input.trim()) } catch { return { ok: false, reason: "malformed" } }
  const scheme = u.protocol.toLowerCase()
  if (scheme !== "http:" && scheme !== "https:" && scheme !== "ws:" && scheme !== "wss:") {
    return { ok: false, reason: "scheme" }
  }
  const secure = scheme === "https:" || scheme === "wss:"
  const origin = `${secure ? "https" : "http"}://${u.host}`
  return { ok: true, origin, wsUrl: `${secure ? "wss" : "ws"}://${u.host}/__relay/ws` }
}

/** تعتيم رابط للعرض: يقتطع أي اعتمادات ويبقي الأصل والمسار حصرًا */
export function redactUrl(input: string): string {
  try {
    const u = new URL(input.trim())
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return ""
  }
}

// ── تطبيع طلب الزائر (يستعمله النفق حصرًا — النقطة الواحدة للحسم) ─────

/** ترويسات قفزة-إلى-قفزة وأخرى محظور تمريرها من الزائر */
const STRIP_REQUEST_HEADERS = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade",
  "host", "content-length", "accept-encoding",
])

/** ترويسات تُسقط من الاستجابة قبل إعادتها للزائر (fetch يفك الضغط بنفسه) */
export const STRIP_RESPONSE_HEADERS = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade",
  "content-length", "content-encoding",
])

/** تطبيع طلب الزائر: تحقق الطريقة والمسار والترويسات وسقف الجسم —
 *  ناتج جاهز للاستعمال في fetch المركزي، أو سبب رفض معلن */
export function normalizeVisitorRequest(frame: { method: string; path: string; headers: Record<string, string>; bodyB64?: string }):
  { ok: true; method: string; path: string; headers: Record<string, string>; body: Buffer | null }
  | { ok: false; reason: string } {
  const method = String(frame.method || "").toUpperCase()
  if (!ALLOWED_METHODS.has(method)) return { ok: false, reason: "method-not-allowed" }
  const path = String(frame.path || "")
  if (!path.startsWith("/") || path.length > MAX_PATH_CHARS || /[\u0000-\u001f]/.test(path)) {
    return { ok: false, reason: "path-invalid" }
  }
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, v] of Object.entries(frame.headers || {})) {
    const name = String(k).toLowerCase()
    if (STRIP_REQUEST_HEADERS.has(name)) continue
    if (name === "x-nexuslink-relay") continue // النفق يضبطها بنفسه حصرًا
    if (name.length > 64 || String(v).length > 512) return { ok: false, reason: "header-oversize" }
    out[name] = String(v)
    n++
    if (n > MAX_HEADERS) return { ok: false, reason: "too-many-headers" }
  }
  let body: Buffer | null = null
  if (typeof frame.bodyB64 === "string" && frame.bodyB64.length > 0) {
    if (!/^[A-Za-z0-9+/=]+$/.test(frame.bodyB64)) return { ok: false, reason: "body-encoding" }
    try { body = Buffer.from(frame.bodyB64, "base64") } catch { return { ok: false, reason: "body-encoding" } }
    if (body.length > MAX_BODY_BYTES) return { ok: false, reason: "body-oversize" }
  }
  return { ok: true, method, path, headers: out, body }
}

/** صلاحية معرّف طلب الزائر (id): 1..64 محرفًا من [a-z0-9-] */
export function validRequestId(id: unknown): boolean {
  return typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id)
}
