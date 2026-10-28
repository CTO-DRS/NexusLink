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
//
// §38 — السياسات المؤسسية المركزية (M4.1 النواة المحلية — docs/protocol-contract.md):
//  - ملف سياسة واحد (NEXUSLINK_POLICY_FILE أو مسار النشر القياسي) يُقرأ بمتغير
//    تعديل-الوقت — التعديل حي بلا إعادة تشغيل (نمط الرمز نفسه).
//  - force-off: الخارج مرفوض حصرًا (حتى برمز صحيح) · force-on: الرمز شرط دائم.
//  - blockedBridges: جسور محجوبة عن الخارج حصرًا — loopback معفى (الجهاز هي الحدود).
//  - /__gw/health يعلن policyManaged/policyRemoteAccess للتشخيص الحي.
const http = require("http")
const https = require("https")
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

// §38 — السياسات المؤسسية المركزية (M4.1 النواة المحلية) — نفس نمط §37:
// ملف JSON واحد (NEXUSLINK_POLICY_FILE أو مسار النشر القياسي للنظام) بفرض
// حي بمتغير تعديل-الوقت بلا إعادة تشغيل. المخطط v1:
// { schemaVersion: 1, organization?, managed?: { remoteAccess?, blockedBridges? } }
//  - remoteAccess "force-off": كل واصل من خارج الجهاز مرفوض ولو برمز صحيح
//    (الرمز بلا معنى — التعطيل مؤسسي) · "force-on": الرمز شرط دائم.
//  - blockedBridges: جسور (3003..3009) محجوبة عن الخارج حصرًا — loopback
//    معفى دائمًا (الجهاز هي الحدود — عقد 2.0).
//  - ملف غير صالح = لا فرض (فشل-آمن نحو سلوك المستخدم) — الحالة تُعلن في
//    /api/enterprise/compliance (حد §38.هـ.3).
//
// §47 — المخطط v2 (التوأم المطابق لـ src/lib/enterprise-policy.ts): يقبل
// v1|v2؛ مفاتيح v2 الجديدة (lockedSettings/accessCodeRotationDays/
// disabledCapabilities/minimumVersion) تُحكّم بالمخالفات نفسها (null = لا
// فرض) — حكم «صالح/غير صالح» واحد في النسختين وإلا انشق الحسم. البوابة
// تستخدم remoteAccess/blockedBridges حصرًا (مفاتيح v2 تُفرض في نقاط الويب) —
// لكن رفض المخالفات هنا إلزامي كي يبقى «ملف تالف = غير مُدار» متطابقًا.
//
// §40 — وضع OEM «خصوصية افتراضية» (M4.3 النواة المحلية — docs/protocol-contract.md):
//  - العلم البيئي NEXUSLINK_OEM_PRIVACY=1 تضعه صورة النظام (وحدة systemd/launchd/
//    خدمة ويندوز) فيُورثه كل عمليات NexusLink — الجهاز «مولود خاص»: بلا ملف
//    سياسة صالح يكون الوصول الخارجي مرفوضًا (حتى برمز صحيح) وكل الجسور
//    (3003..3009) محجوبة عن الخارج — loopback معفى دائمًا كما هو.
//  - عكس اتجاه §38 المتعمد في وضع المستخدم: §38 فشل-آمن نحو المستخدم (ملف
//    غائب/غير صالح = لا فرض)، و§40 فشل-مغلق للمولود خاصًا (ملف غير صالح يبقى
//    مغلقاً + الحالة معلنة) — سياسة صالحة تفوز كاملة فتخفف الوضع (مسار MDM).
//  - حجب كل الجسور تحت المولود خاصًا دفاع ثانٍ خلف الباب الأمامي: الخطأ
//    المُلاحَظ للخارج هو رفض الباب الأمامي (remote-access-closed-oem-default)
//    حصرًا — قائمة الجسور تُلاحَظ تحت سياسة صالحة بقائمة حجب خاصة (خطأ
//    bridge-blocked-by-policy) كما في §38.
//  - التشخيص الحي في /__gw/health (oemPrivacy + postureSource).
// هذا المنطق مطابق لمنطق src/lib/enterprise-policy.ts (resolveEffectivePosture)
// — التعديل هنا يستوجب مراجعة هناك (نمط النسختين المتطابقتين نفسه).
//
// §41 — الطبقة المحلية للنقل المشفر (TLS في البوابة — النواة المحلية لـ E4 — docs/protocol-contract.md):
//  - OFF بالتصميم: بلا NEXUSLINK_TLS_CERT + NEXUSLINK_TLS_KEY فالسلوك حرفيًا
//    كما كان (HTTP صافٍ — صفر تغيير).
//  - عند توفير الملفين معًا: المُستمع نفسه يصير HTTPS/WSS (شهادة تُقرأ مرة
//    عند الإقلاع — التدوير بإعادة تشغيل الخدمة عبر مدير العمليات).
//  - فشل-مغلق: متغير واحد بلا الآخر، أو ملف غائب/تالف = خروج فوري برسالة
//    صاخبة — بوابة ضُبطت TLS لا تسقط صامتة إلى نص صريح (كذبة أمنية).
//  - x-forwarded-proto: https تُفرض للأعلى تحت TLS حصرًا (تُستبدل أي قيمة
//    واردة من العميل — نمط x-gw-client-ip الأمني نفسه). بلا TLS: لا حقن إطلاقًا.
//  - /__gw/health يعلن tls + tlsFingerprint (sha256 من DER مقطوعة 16) —
//    والنفق/النطاق/العقد المؤسسي يبقى خارجيًا (حد E4 الموثق بقرار مالك).
const POLICY_FILE_CANDIDATES = [
  process.env.NEXUSLINK_POLICY_FILE,
  process.platform === "win32"
    ? pathMod.join(process.env.ProgramData || "C:\\ProgramData", "NexusLink", "policy.json")
    : process.platform === "darwin"
      ? "/Library/Application Support/NexusLink/policy.json"
      : "/etc/nexuslink/policy.json",
].filter(Boolean)
const BRIDGE_PORTS = new Set([3003, 3004, 3005, 3006, 3007, 3008, 3009])
let policyCache = { mtimeMs: -1, size: -1, data: null }

function resolvePolicyFile() {
  for (const p of POLICY_FILE_CANDIDATES) {
    try { if (fs.statSync(p).isFile()) return p } catch { /* غائب — التالي */ }
  }
  return null
}

function loadPolicy() {
  const p = resolvePolicyFile()
  if (!p) { policyCache = { mtimeMs: -1, size: -1, data: null }; return null }
  try {
    const st = fs.statSync(p)
    if (st.mtimeMs !== policyCache.mtimeMs || st.size !== policyCache.size) {
      policyCache = { mtimeMs: st.mtimeMs, size: st.size, data: parsePolicy(fs.readFileSync(p, "utf8")) }
    }
    return policyCache.data
  } catch {
    policyCache = { mtimeMs: -1, size: -1, data: null }
    return null
  }
}

// §40 — العلم البيئي لوضع OEM «خصوصية افتراضية» — تضعه صورة النظام في بيئة
// العمليات (وحدة systemd/launchd/خدمة ويندوز) فيُورثه البوابة والويب معًا.
const OEM_PRIVACY_ENV = "NEXUSLINK_OEM_PRIVACY"
function oemPrivacyActive() {
  return process.env[OEM_PRIVACY_ENV] === "1"
}

/** §40 — حسم «الإغلاق الخارجي» الفعلي: "policy" تحت force-off صالح،
 * "oem-default" للمولود خاصًا (بلا سياسة صالحة + العلم)، وإلا null */
function externalClosedBy(policy) {
  if (policy && policy.remoteAccess === "force-off") return "policy"
  if (!policy && oemPrivacyActive()) return "oem-default"
  return null
}

// §41 — TLS بمصدر حقيقة واحد (متغيرات بيئة — نمط §37/§38/§40 حرفيًا):
// الشهادة والمفتاح يُقرآن مرة عند الإقلاع حصرًا (فشل-مغلق) — لا مراقبة mtime
// للمفاتيح الخاصة (سطح هجوم بلا داعٍ)؛ التدوير = إعادة تشغيل الخدمة.
const TLS_CERT_FILE = process.env.NEXUSLINK_TLS_CERT || ""
const TLS_KEY_FILE = process.env.NEXUSLINK_TLS_KEY || ""
const TLS_SET_COUNT = [TLS_CERT_FILE, TLS_KEY_FILE].filter(Boolean).length
if (TLS_SET_COUNT === 1) {
  console.error("[gateway] TLS half-configured: NEXUSLINK_TLS_CERT وNEXUSLINK_TLS_KEY يُضبطان معًا حصرًا")
  console.error("[gateway] REFUSING plaintext fallback — أصلح الإعداد أو أزل المتغيرين معًا")
  process.exit(1)
}
const TLS_MODE = TLS_SET_COUNT === 2
let TLS_OPTS = null
let tlsFingerprint = null
if (TLS_MODE) {
  try {
    const certPem = fs.readFileSync(TLS_CERT_FILE)
    const keyPem = fs.readFileSync(TLS_KEY_FILE)
    const x509 = new crypto.X509Certificate(certPem)
    tlsFingerprint = crypto.createHash("sha256").update(x509.raw).digest("hex").slice(0, 16)
    TLS_OPTS = { cert: certPem, key: keyPem }
  } catch (e) {
    console.error("[gateway] TLS config invalid:", e instanceof Error ? e.message : e)
    console.error("[gateway] REFUSING plaintext fallback — أصلح الملفين أو أزل المتغيرين معًا")
    process.exit(1)
  }
}

/** §40 — الجسور المحجوبة فعليًا عن الخارج (دفاع ثانٍ خلف الباب الأمامي):
 * قائمة السياسة تحت ملف صالح، وكل الجسور للمولود خاصًا بلا ملف صالح (لا
 * تُلاحَظ مالم تُفتح الباب — والباب الأمامي المغلق يرفض قبلها)، ولا شيء
 * في وضع المستخدم */
function effectiveBlockedBridges(policy) {
  if (policy) return policy.blockedBridges
  if (oemPrivacyActive()) return [...BRIDGE_PORTS]
  return []
}

/** تحكّم مخطط v1|v2 (§47 — توأم src/lib/enterprise-policy.ts) — null عند أي
 * مخالفة (فشل-آمن بلا فرض). مفاتيح v2 في ملف v1 = null (لا مزج إصدارات). */
const LOCKABLE_SETTINGS = new Set(["appLock", "idle", "updater"])
const POLICY_CAPABILITIES = new Set(["market", "assist", "sync"])
const ROTATION_DAYS_MIN = 1
const ROTATION_DAYS_MAX = 365
function isValidSemver(v) {
  return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v)
}
function parsePolicy(raw) {
  try {
    const j = JSON.parse(raw)
    if (!j || typeof j !== "object" || Array.isArray(j)) return null
    if (j.schemaVersion !== 1 && j.schemaVersion !== 2) return null
    const v2 = j.schemaVersion === 2
    const out = { organization: null, remoteAccess: null, blockedBridges: [] }
    if (j.organization !== undefined && j.organization !== null) {
      if (typeof j.organization !== "string" || j.organization.length > 120) return null
      out.organization = j.organization
    }
    if (j.managed !== undefined && j.managed !== null) {
      if (typeof j.managed !== "object" || Array.isArray(j.managed)) return null
      const m = j.managed
      if (m.remoteAccess !== undefined && m.remoteAccess !== null) {
        if (m.remoteAccess !== "force-on" && m.remoteAccess !== "force-off") return null
        out.remoteAccess = m.remoteAccess
      }
      if (m.blockedBridges !== undefined && m.blockedBridges !== null) {
        if (!Array.isArray(m.blockedBridges) || m.blockedBridges.length > 7) return null
        const seen = new Set()
        for (const v of m.blockedBridges) {
          if (!Number.isInteger(v) || !BRIDGE_PORTS.has(v)) return null
          seen.add(v)
        }
        out.blockedBridges = [...seen].sort((a, b) => a - b)
      }
      // §47 — مفاتيح v2: تحكّم مطابق (تُهمل قيمها هنا — فرضها في نقاط الويب —
      // لكن مخالفتها تُبطل الملف كله كي لا يختلف حكم الصلاحية بين النسختين)
      if (m.lockedSettings !== undefined && m.lockedSettings !== null) {
        if (!v2) return null
        if (!Array.isArray(m.lockedSettings) || m.lockedSettings.length > 3) return null
        const seen = new Set()
        for (const v of m.lockedSettings) {
          if (typeof v !== "string" || !LOCKABLE_SETTINGS.has(v)) return null
          seen.add(v)
        }
        if (seen.size !== m.lockedSettings.length) return null
      }
      if (m.accessCodeRotationDays !== undefined && m.accessCodeRotationDays !== null) {
        if (!v2) return null
        if (!Number.isInteger(m.accessCodeRotationDays) || m.accessCodeRotationDays < ROTATION_DAYS_MIN || m.accessCodeRotationDays > ROTATION_DAYS_MAX) return null
      }
      if (m.disabledCapabilities !== undefined && m.disabledCapabilities !== null) {
        if (!v2) return null
        if (!Array.isArray(m.disabledCapabilities) || m.disabledCapabilities.length > 3) return null
        const seen = new Set()
        for (const v of m.disabledCapabilities) {
          if (typeof v !== "string" || !POLICY_CAPABILITIES.has(v)) return null
          seen.add(v)
        }
        if (seen.size !== m.disabledCapabilities.length) return null
      }
      if (m.minimumVersion !== undefined && m.minimumVersion !== null) {
        if (!v2) return null
        if (!isValidSemver(m.minimumVersion)) return null
      }
    }
    return out
  } catch {
    return null
  }
}

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
  const ip = clientIp(req)
  // §38/§40 — الفرض المؤسسي قبل حسم الرمز: force-off بالسياسة أو المولود خاصًا
  // يلغي معنى الرمز أصلًا (خطأ تشخيصي مميز لكل مصدر)
  const policy = loadPolicy()
  const closedBy = externalClosedBy(policy)
  if (!isLoopbackIp(ip) && closedBy) {
    res.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    res.end(JSON.stringify({ ok: false, gateway: true, error: closedBy === "policy" ? "remote-access-disabled-by-policy" : "remote-access-closed-oem-default" }))
    return false
  }
  const pair = loadPair()
  if (!pair) return true // OFF — السلوك التاريخي حرفيًا
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
  const ip = clientIp(req)
  const policy = loadPolicy()
  const closedBy = externalClosedBy(policy)
  if (!isLoopbackIp(ip) && closedBy) {
    try {
      socket.end("HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\n\r\n" + JSON.stringify({ ok: false, gateway: true, error: closedBy === "policy" ? "remote-access-disabled-by-policy" : "remote-access-closed-oem-default" }))
    } catch { /* مقبس ميت */ }
    return false
  }
  const pair = loadPair()
  if (!pair) return true
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

/** §38/§40 — حظر الجسور عن الخارج حصرًا: بقائمة السياسة تحت ملف صالح،
 * وبكل الجسور للمولود خاصًا (دفاع ثانٍ خلف الباب الأمامي المغلق) —
 * false = رُفض 403 (loopback معفى دائمًا) */
function policyBridgeGate(req, res, port) {
  if (!port) return true // REST 3000 ليست جسرًا قابلًا للحجب
  const ip = clientIp(req)
  if (isLoopbackIp(ip)) return true
  const policy = loadPolicy()
  const blocked = effectiveBlockedBridges(policy)
  if (!blocked.includes(port)) return true
  res.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify({ ok: false, gateway: true, error: "bridge-blocked-by-policy", port }))
  return false
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
  if (!policyBridgeGate(req, res, t)) return
  // SEC: تمرير IP العميل الحقيقي للجسور (يستبدل دائمًا — لا يُثق بترويسة عميل)
  const headers = hopByHop(req.headers)
  headers["x-gw-client-ip"] = clientIp(req)
  // §41 — تحت TLS حصرًا: الحقيقة من البوابة لا من العميل (تُستبدل أي قيمة واردة)
  if (TLS_MODE) headers["x-forwarded-proto"] = "https"
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
  // §38/§40 — حظر جسور عن الخارج حصرًا (WS نفس الحسم — برد خام)
  if (t && !isLoopbackIp(clientIp(req))) {
    const policy = loadPolicy()
    const blocked = effectiveBlockedBridges(policy)
    if (blocked.includes(t)) {
      try { socket.end("HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\n\r\n" + JSON.stringify({ ok: false, gateway: true, error: "bridge-blocked-by-policy", port: t })) } catch {}
      return
    }
  }
  const up = net.connect(port, "127.0.0.1", () => {
    let raw = `${req.method} ${stripPair(req.url)} HTTP/1.1\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i]
      // SEC: استبدال أي x-gw-client-ip وارد من العميل — البوابة مصدر الحقيقة
      if (k.toLowerCase() === "x-gw-client-ip") continue
      // §41: تحت TLS حصرًا — استبدال أي x-forwarded-proto وارد من العميل
      if (TLS_MODE && k.toLowerCase() === "x-forwarded-proto") continue
      raw += `${k}: ${req.rawHeaders[i + 1]}\r\n`
    }
    raw += `x-gw-client-ip: ${clientIp(req)}\r\n`
    if (TLS_MODE) raw += "x-forwarded-proto: https\r\n"
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

// §41 — معالج الطلبات واحد لHTTP وHTTPS حرفيًا — المُستمع وحده يتبدل
function handleRequest(req, res) {
  try {
    const path = (req.url || "/").split("?")[0]
    if (path === "/__gw/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" })
      const pol = loadPolicy()
      res.end(JSON.stringify({ ok: true, proto: "Nexus/1.2", role: "gateway", port: GATEWAY_PORT, rest: REST_PORT, uptimeMs: Date.now() - STARTED_AT, pair: !!loadPair(), policyManaged: !!pol, policyRemoteAccess: pol ? pol.remoteAccess : null, oemPrivacy: oemPrivacyActive(), postureSource: pol ? "policy" : oemPrivacyActive() ? "oem-default" : "user-default", tls: TLS_MODE, tlsFingerprint }))
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
}

const server = TLS_MODE ? https.createServer(TLS_OPTS, handleRequest) : http.createServer(handleRequest)

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
  console.log(`[gateway] NexusLink gateway on :${BOUND_PORT} → rest:${REST_PORT} (+ ?XTransformPort=<port>)${TLS_MODE ? " [TLS]" : ""}`)
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
