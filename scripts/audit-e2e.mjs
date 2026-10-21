#!/usr/bin/env node
/**
 * audit-e2e.mjs — جولة E2E حية للسجل التدقيقي المؤسسي (عقد §39 — M4.2 نواة أدلة SOC 2).
 * ============================================================
 * تتطلب تطبيقًا حيًا (APP_URL، افتراضي :3000) شُغّل بنفس متغيرات البيئة:
 *   NEXUSLINK_AUDIT_FILE (ملف السجل الذي تكتبه الكنود الواحدة) ·
 *   NEXUSLINK_POLICY_FILE · NEXUSLINK_PAIR_FILE
 * تتحقق: الولادة الجديدة (بلا ملف = count:0 صالح) · سلسلة بصمات حتمية
 * (إعادة بناء h في السكربت نفسه — رياضيات مستقلة عن المكتبة) · توثيق كل
 * نواتج الإدارة (نجاح/تعارض/قفل سياسة/حرس loopback بوسم خارجي) · رصد
 * انتقالات السياسة (رصد أولي/تغير بحفظ from→to) · حرس F6 (لا رمز خام) ·
 * كشف العبث (تعديل رجعي يكسر السلسلة ويُعلن) · تجميد الإلحاق فوق دليل
 * مكسور · الدورة الجديدة بحذف الملف · حرس loopback على نقطة العرض · limit.
 * التنظيف الذاتي في النهاية يجعل الجولة الثانية المتتالية مطابقة للأولى.
 * الاستخدام: node scripts/audit-e2e.mjs [--app http://127.0.0.1:3000]
 */
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import net from "node:net"
import { spawn } from "node:child_process"

const APP = (() => {
  const i = process.argv.indexOf("--app")
  return i > 0 ? process.argv[i + 1] : "http://127.0.0.1:3000"
})()
const AUDIT_FILE = process.env.NEXUSLINK_AUDIT_FILE
const POLICY_FILE = process.env.NEXUSLINK_POLICY_FILE
const PAIR_FILE = process.env.NEXUSLINK_PAIR_FILE

let pass = 0
let fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`❌ ${name}${extra ? " — " + extra : ""}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- عنوان LAN حقيقي غير حلقي (تقنية §37.هـ الموثقة) ----------
function lanIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) return a.address
    }
  }
  return null
}
const LAN = lanIp()

// ---------- أدوات HTTP ----------
function request(url, { method = "GET", headers = {}, body = null, localAddress = null } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, ...(localAddress ? { localAddress } : {}) },
      (res) => {
        let txt = ""
        res.on("data", (d) => { txt += d })
        res.on("end", () => resolve({ status: res.statusCode, body: txt }))
      },
    )
    req.on("error", (e) => resolve({ status: 0, body: String(e) }))
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }) })
    if (body) req.write(body)
    req.end()
  })
}
const post = (url, obj, headers = {}) =>
  request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(obj) })

// ---------- رياضيات السلسلة المستقلة (إعادة بناء بصمات بترتيب الحقول العقدي) ----------
function recHash(r) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({ i: r.i, t: r.t, k: r.k, ok: r.ok, actor: r.actor, d: r.d, prev: r.prev }))
    .digest("hex").slice(0, 16)
}
const KINDS = new Set(["pair.enable", "pair.rotate", "pair.disable", "pair.admin.denied", "policy.observed", "policy.changed"])
function auditLines() {
  try {
    return fs.readFileSync(AUDIT_FILE, "utf8").split("\n").filter((l) => l.trim().length > 0)
  } catch {
    return []
  }
}
function verifyMath(lines) {
  let prev = ""
  let exp = 1
  for (const line of lines) {
    let r
    try { r = JSON.parse(line) } catch { return { valid: false, why: `unparseable at #${exp}` } }
    if (r.i !== exp) return { valid: false, why: `i=${r.i} متوقع ${exp}` }
    if (r.prev !== prev) return { valid: false, why: `prev مكسور عند i=${r.i}` }
    if (recHash(r) !== r.h) return { valid: false, why: `h لا يُعاد بناؤه عند i=${r.i}` }
    if (!KINDS.has(r.k)) return { valid: false, why: `k=${r.k} خارج المجموعة المغلقة` }
    if (r.actor !== "local" && r.actor !== "remote") return { valid: false, why: `actor=${r.actor}` }
    prev = r.h
    exp++
  }
  return { valid: true, count: exp - 1 }
}
const kinds = () => auditLines().map((l) => { try { return JSON.parse(l).k } catch { return "?" } })
const recAt = (n) => JSON.parse(auditLines()[n - 1])

// ---------- ملفات السياسة ----------
function writePolicy(j) {
  if (j === null) { try { fs.unlinkSync(POLICY_FILE) } catch {} ; return }
  fs.writeFileSync(POLICY_FILE, JSON.stringify(j, null, 2))
}

if (!AUDIT_FILE || !POLICY_FILE || !PAIR_FILE) {
  console.error("الجولة تتطلب NEXUSLINK_AUDIT_FILE وNEXUSLINK_POLICY_FILE وNEXUSLINK_PAIR_FILE في بيئة التطبيق نفسها")
  process.exit(1)
}

// بوابة ثانية للخارج (8197 → REST 3000) — قياس الحرس الحلقي ومحاولة الإدارة الخارجية
let gwApp = null
if (LAN) {
  gwApp = spawn(process.execPath, [path.join(process.cwd(), "mini-services", "gateway", "index.cjs")], {
    env: { ...process.env, GATEWAY_PORT: "8197", GATEWAY_FALLBACK_PORT: "8198", REST_PORT: "3000" },
    stdio: ["ignore", "ignore", "ignore"],
  })
  for (let i = 0; i < 50; i++) {
    const r = await request(`http://127.0.0.1:8197/__gw/health`)
    if (r.status === 200) break
    await sleep(100)
  }
}

try {
  // ---------- S1 — الولادة الجديدة: بلا ملف = سلسلة فارغة صالحة ----------
  let r = await request(`${APP}/api/enterprise/audit`)
  let j = JSON.parse(r.body)
  ok("S1 بلا ملف: exists:false · count:0 · valid:true (دورة جديدة)",
    r.status === 200 && j.ok === true && j.exists === false && j.count === 0 && j.valid === true && Array.isArray(j.events) && j.events.length === 0,
    `status=${r.status}`)

  // ---------- S2 — أول تفعيل: رصد أولي + enable بالبصمة، والسلسلة تبدأ بـ prev="" ----------
  r = await post(`${APP}/api/remote-access`, { action: "enable" })
  j = JSON.parse(r.body)
  const fp1 = j.fingerprint
  ok("S2a enable → 200 برمز وبصمة", r.status === 200 && j.ok === true && typeof j.token === "string" && typeof fp1 === "string", `status=${r.status}`)
  ok("S2b التسلسل: [policy.observed, pair.enable] — i=1 بلا سابق", kinds().join(",") === "policy.observed,pair.enable" && recAt(1).prev === "" && recAt(1).i === 1, kinds().join(","))
  ok("S2c دليل enable: fp = بصمة الاستجابة", recAt(2).k === "pair.enable" && recAt(2).d.fp === fp1 && recAt(2).ok === true && recAt(2).actor === "local")

  // ---------- S3 — تعارض التفعيل المكرر يُوثق ----------
  r = await post(`${APP}/api/remote-access`, { action: "enable" })
  ok("S3 enable مكرر → 409 + pair.admin.denied reason=conflict", r.status === 409 && recAt(3).k === "pair.admin.denied" && recAt(3).d.reason === "conflict" && recAt(3).ok === false, `status=${r.status}`)

  // ---------- S4 — التدوير: من بصمة إلى بصمة ----------
  r = await post(`${APP}/api/remote-access`, { action: "rotate" })
  j = JSON.parse(r.body)
  const fp2 = j.fingerprint
  ok("S4 rotate → 200 + from=fp1 → to=fp2 (الهوية تغيّرت بلا رمز خام)",
    r.status === 200 && recAt(4).k === "pair.rotate" && recAt(4).d.from === fp1 && recAt(4).d.to === fp2 && fp1 !== fp2)

  // ---------- S5 — حرس F6: الرمز الخام غائب عن الدليل حصرًا (بصمات فقط) ----------
  const rawToken = JSON.parse(fs.readFileSync(PAIR_FILE, "utf8")).token
  const fileText = auditLines().join("\n")
  ok("S5 F6: الرمز الخام غائب عن ملف السجل كليًا", typeof rawToken === "string" && rawToken.length > 20 && !fileText.includes(rawToken))

  // ---------- S6 — سياسة force-off: تغير سياسة + قفل مع توثيق السبب ----------
  writePolicy({ schemaVersion: 1, organization: "Acme Corp", managed: { remoteAccess: "force-off" } })
  await sleep(150)
  r = await post(`${APP}/api/remote-access`, { action: "enable" })
  ok("S6 force-off: enable → 403 + [policy.changed, pair.admin.denied policy-force-off]",
    r.status === 403 && r.body.includes("policy-remote-access-locked")
    && recAt(5).k === "policy.changed" && recAt(5).d.from.state === "unmanaged" && recAt(5).d.to.state === "managed"
    && recAt(6).k === "pair.admin.denied" && recAt(6).d.reason === "policy-force-off" && recAt(6).actor === "local")

  // ---------- S7 — محاولة إدارة من خارج الجهاز (عبر البوابة من عنوان LAN): وسم خارجي ----------
  writePolicy({ schemaVersion: 1, organization: "Acme Corp", managed: { remoteAccess: "force-on" } })
  await sleep(150)
  r = await post(`http://${LAN}:8197/api/remote-access`, { action: "enable" }, { "x-pair-token": rawToken })
  ok("S7 الخارج عبر البوابة: enable → 403 loopback-only + pair.admin.denied actor=remote",
    r.status === 403 && r.body.includes("pair-admin-loopback-only")
    && recAt(7).k === "pair.admin.denied" && recAt(7).actor === "remote" && recAt(7).d.reason === "loopback")

  // ---------- S8 — الامتثال يعيد رصد التغير المنتظر + ملخص السجل ----------
  r = await request(`${APP}/api/enterprise/compliance`)
  j = JSON.parse(r.body)
  ok("S8 الامتثال: managed + audit.contract=§39 + count=8 + valid + file مطابق للبيئة",
    r.status === 200 && j.managed === true
    && j.audit?.contract === "§39" && j.audit?.count === 8 && j.audit?.valid === true && j.audit?.file === AUDIT_FILE
    && j.enforced?.remoteAccess === "force-on")

  // ---------- S9 — تغير ملف السياسة (المؤسسة) يُوثق from.hash ≠ to.hash ----------
  writePolicy({ schemaVersion: 1, organization: "Acme Corp EU", managed: { remoteAccess: "force-on" } })
  await sleep(150)
  r = await request(`${APP}/api/enterprise/compliance`)
  j = JSON.parse(r.body)
  ok("S9 تغيّر السياسة (org) → policy.changed بحفظ from.hash≠to.hash (16hex)",
    r.status === 200 && recAt(9).k === "policy.changed" && recAt(9).d.from.hash !== recAt(9).d.to.hash
    && recAt(9).d.from.hash?.length === 16 && recAt(9).d.to.hash?.length === 16
    && j.audit?.count === 9)

  // ---------- S10 — حذف السياسة: عودة لغير المُدار توثق أيضًا ----------
  writePolicy(null)
  await sleep(150)
  r = await request(`${APP}/api/remote-access`)
  j = JSON.parse(r.body)
  ok("S10 حذف السياسة → GET يعلن policy:null + policy.changed إلى unmanaged",
    r.status === 200 && j.policy?.remoteAccess === null && recAt(10).k === "policy.changed" && recAt(10).d.to.state === "unmanaged")

  // ---------- S11 — نقطة العرض: السلسلة كاملة صالحة والتسلسل مطابق حرفيًا ----------
  r = await request(`${APP}/api/enterprise/audit`)
  j = JSON.parse(r.body)
  const math = verifyMath(auditLines())
  ok("S11 العرض: count=10 · valid:true · 10 أحداث · تسلسل الأنواع مطابق",
    r.status === 200 && j.count === 10 && j.valid === true && j.events?.length === 10
    && kinds().join(",") === ["policy.observed", "pair.enable", "pair.admin.denied", "pair.rotate", "policy.changed", "pair.admin.denied", "pair.admin.denied", "policy.changed", "policy.changed", "policy.changed"].join(","),
    math.valid ? "رياضيات السكربت مستقلة ✓" : math.why)

  // ---------- S12 — العبث الرجعي: تعديل ok في السطر الأول يكسر السلسلة ويُعلن ----------
  const lines = auditLines()
  const tampered = lines[0].replace('"ok":true', '"ok":false')
  fs.writeFileSync(AUDIT_FILE, [tampered, ...lines.slice(1)].join("\n") + "\n")
  r = await request(`${APP}/api/enterprise/audit`)
  j = JSON.parse(r.body)
  ok("S12 عبث رجعي بالسطر 1: valid:false · brokenAt=1 · الأحداث تُحجب", r.status === 200 && j.valid === false && j.brokenAt === 1 && j.events?.length === 0, `brokenAt=${j.brokenAt}`)

  // ---------- S13 — التجميد: لا إلحاق فوق دليل مكسور (الفعل ينجح والسجل يرفض) ----------
  const before = auditLines().length
  r = await post(`${APP}/api/remote-access`, { action: "rotate" })
  j = JSON.parse(r.body)
  const fp13 = j.fingerprint
  ok("S13 فوق سلسلة مكسورة: rotate → 200 (سلوك الإدارة سليم) ولا سطر جديد (السجل متجمد)",
    r.status === 200 && j.ok === true && typeof fp13 === "string" && auditLines().length === before, `lines=${auditLines().length}`)

  // ---------- S14 — الدورة الجديدة: حذف الملف يفتح دورة برصد أولي من جديد ----------
  fs.rmSync(AUDIT_FILE, { force: true })
  r = await post(`${APP}/api/remote-access`, { action: "disable" })
  j = JSON.parse(r.body)
  ok("S14a دورة جديدة: disable → 200 + [policy.observed, pair.disable(fp)]",
    r.status === 200 && kinds().join(",") === "policy.observed,pair.disable" && recAt(2).d.fp === fp13)
  r = await post(`${APP}/api/remote-access`, { action: "enable" })
  j = JSON.parse(r.body)
  const fp3 = j.fingerprint
  ok("S14b الدورة تكمل: enable → i=3", r.status === 200 && recAt(3).k === "pair.enable" && recAt(3).d.fp === fp3)

  // ---------- S15 — حرس loopback على نقطة العرض نفسها (حتى برمز صحيح) ----------
  // الرمز الحي لحظة الفحص حصرًا — التدويرات السابقة جعلت الرموز القديمة بلا قيمة (سلوك §37 الصحيح)
  const liveToken = JSON.parse(fs.readFileSync(PAIR_FILE, "utf8")).token
  r = await request(`http://${LAN}:8197/api/enterprise/audit`, { headers: { "x-pair-token": liveToken } })
  ok("S15 العرض عبر البوابة من الخارج → 403 audit-loopback-only", r.status === 403 && r.body.includes("audit-loopback-only"), `status=${r.status}`)

  // ---------- S16 — limit: نافذة آخر الأحداث لا تغير العدّ الكلي ----------
  r = await request(`${APP}/api/enterprise/audit?limit=1`)
  j = JSON.parse(r.body)
  ok("S16 limit=1: حدث واحد معروض والعدّ الكلي 3", r.status === 200 && j.events?.length === 1 && j.count === 3)

  // ---------- S17 — رياضيات السلسلة كاملة على ملف الدورة الحية (تحقق مستقل) ----------
  const math2 = verifyMath(auditLines())
  ok("S17 رياضيات مستقلة: 3 أسطر i=1..3 متصلة وبصماتها تُعاد",
    math2.valid && math2.count === 3, math2.valid ? "prev/h/مجموعة مغلقة ✓" : math2.why)
} catch (e) {
  fail++
  console.error("❌ استثناء في الجولة:", e)
}

// ---------- التنظيف الذاتي: الجولة القادمة تبدأ مطابقة ----------
try {
  await post(`${APP}/api/remote-access`, { action: "disable" })
} catch {}
try { fs.rmSync(AUDIT_FILE, { force: true }) } catch {}
try { fs.rmSync(POLICY_FILE, { force: true }) } catch {}
if (gwApp) { try { gwApp.kill("SIGTERM") } catch {} }

console.log(`\n=== audit-e2e (§39): ${pass} ناجح · ${fail} فاشل (LAN=${LAN ?? "بلا"} · audit=${AUDIT_FILE}) ===`)
process.exit(fail === 0 ? 0 : 1)
