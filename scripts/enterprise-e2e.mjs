#!/usr/bin/env node
/**
 * enterprise-e2e.mjs — جولة E2E حية للسياسات المؤسسية المركزية (عقد §38 — M4.1 النواة المحلية).
 * ============================================================
 * المرحلة A (ذاتية الحاوية): بوابة حية (port 8193) فوق upstream وهمي (35555)
 *   + ملفا رمز/سياسة مؤقتان — الفحص من عنوان LAN حقيقي غير حلقي (تقنية §37.هـ
 *   الموثقة: الاتصال بعنوان الجهاز المحلي يجعل remoteAddress غير حلقي عند البوابة).
 *   تتحقق: غير المُدار (السلوك التاريخي حرفيًا) · force-off حتى برمز صحيح ·
 *   force-on شرط رمز · حظر جسور عن الخارج حصرًا (loopback معفى) · تعديل حي
 *   بلا إعادة تشغيل · فشل-آمن لملف غير صالح · حقل health المعلن.
 * المرحلة B (تتطلب تطبيقًا حيًا على :3000 بمتغيري البيئة نفسهما — APP_URL):
 *   قفل /api/remote-access (force-off يمنع enable/rotate وforce-on يمنع disable)
 *   + تقرير الامتثال /api/enterprise/compliance (حلقي فقط + بصمة السياسة).
 * الاستخدام: node scripts/enterprise-e2e.mjs [--app http://127.0.0.1:3000]
 */
import http from "node:http"
import net from "node:net"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const GW_PORT = 8193
const UP_PORT = 35555
const APP = (() => {
  const i = process.argv.indexOf("--app")
  return i > 0 ? process.argv[i + 1] : null
})()

let pass = 0
let fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`❌ ${name}${extra ? " — " + extra : ""}`) }
}

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
if (!LAN) {
  console.error("لا عنوان LAN غير حلقي — الجولة تحتاجه لمحاكاة الواصل الخارجي (تقنية §37.هـ)")
  process.exit(1)
}

// ---------- upstream وهمي: أي طلب → 200 up-ok (على REST والجسور المستخدمة) ----------
function makeUpstream() {
  return http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("up-ok")
  })
}
const upstream = makeUpstream()
const bridgeMocks = [makeUpstream(), makeUpstream()] // 3003 و3005 — ليصل قياس العبور عبرها

// ---------- أدوات HTTP ----------
function request(url, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let txt = ""
      res.on("data", (d) => { txt += d })
      res.on("end", () => resolve({ status: res.statusCode, body: txt }))
    })
    req.on("error", (e) => resolve({ status: 0, body: String(e) }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }) })
    if (body) req.write(body)
    req.end()
  })
}

/** طلب «خارجي»: الاتصال بعنوان LAN المحلي — البوابة ترى remoteAddress غير حلقي */
function requestViaLan(target, { method = "GET", headers = {}, localAddress = LAN } = {}) {
  return new Promise((resolve) => {
    const u = new URL(target)
    const req = http.request(
      { host: LAN, port: u.port, path: u.pathname + u.search, method, headers, localAddress },
      (res) => {
        let body = ""
        res.on("data", (d) => { body += d })
        res.on("end", () => resolve({ status: res.statusCode, body }))
      },
    )
    req.on("error", (e) => resolve({ status: 0, body: String(e) }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }) })
    req.end()
  })
}

// ---------- ملفات مؤقتة + بوابة حية ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexuslink-e38-"))
const POLICY = path.join(tmp, "policy.json")
const PAIR = path.join(tmp, "pair-token.json")
const TOKEN = "e2e-" + "x".repeat(40)
function writePolicy(j) {
  if (j === null) { try { fs.unlinkSync(POLICY) } catch {} ; return }
  fs.writeFileSync(POLICY, JSON.stringify(j, null, 2))
}
function writePairFile() {
  fs.writeFileSync(PAIR, JSON.stringify({ token: TOKEN, fingerprint: "e2efingerprint0000", createdAt: new Date().toISOString() }, null, 2))
}

const gw = spawn(process.execPath, [path.join(process.cwd(), "mini-services", "gateway", "index.cjs")], {
  env: {
    ...process.env,
    GATEWAY_PORT: String(GW_PORT),
    GATEWAY_FALLBACK_PORT: "8194",
    REST_PORT: String(UP_PORT),
    NEXUSLINK_PAIR_FILE: PAIR,
    NEXUSLINK_POLICY_FILE: POLICY,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let gwLog = ""
gw.stdout.on("data", (d) => { gwLog += d })
gw.stderr.on("data", (d) => { gwLog += d })

async function waitGateway() {
  for (let i = 0; i < 50; i++) {
    const r = await request(`http://127.0.0.1:${GW_PORT}/__gw/health`)
    if (r.status === 200) return true
    await new Promise((r2) => setTimeout(r2, 100))
  }
  return false
}

const GW = `http://127.0.0.1:${GW_PORT}`
const UP = `http://127.0.0.1:${UP_PORT}`

try {
  await new Promise((r) => upstream.listen(UP_PORT, r))
  await new Promise((r) => bridgeMocks[0].listen(3003, r))
  await new Promise((r) => bridgeMocks[1].listen(3005, r))
  const ready = await waitGateway()
  ok("A0 البوابة وupstream جاهزان", ready, gwLog.slice(-200) || `gw:${GW_PORT} up:${UP_PORT}`)

  // ---------- غير المُدار: السلوك التاريخي حرفيًا ----------
  let h = JSON.parse((await request(`${GW}/__gw/health`)).body)
  ok("A1 health يعلن policyManaged:false بلا ملف سياسة", h.policyManaged === false && h.policyRemoteAccess === null)
  let r = await requestViaLan(`${GW}/`)
  ok("A2 غير المُدار: الواصل الخارجي يعبر حرفيًا كما كان (pair OFF)", r.status === 200 && r.body === "up-ok", `status=${r.status}`)

  // ---------- pair OFF → ON: الرمز شرط للخارج ----------
  writePairFile()
  r = await requestViaLan(`${GW}/`)
  ok("A3 رمز مفعّل: الخارج بلا رمز → 401", r.status === 401 && r.body.includes("pair-token-required"), `status=${r.status}`)
  r = await requestViaLan(`${GW}/`, { headers: { "x-pair-token": TOKEN } })
  ok("A4 الخارج برمز صحيح → يعبر", r.status === 200 && r.body === "up-ok")

  // ---------- force-off: الرمز بلا معنى ----------
  writePolicy({ schemaVersion: 1, organization: "Acme Corp", managed: { remoteAccess: "force-off" } })
  await new Promise((r2) => setTimeout(r2, 50))
  h = JSON.parse((await request(`${GW}/__gw/health`)).body)
  ok("A5 health يعلن الإدارة لحظيًا (policyManaged:true + force-off)", h.policyManaged === true && h.policyRemoteAccess === "force-off")
  r = await requestViaLan(`${GW}/`, { headers: { "x-pair-token": TOKEN } })
  ok("A6 force-off: الخارج مرفوض ولو برمز صحيح → 403 remote-access-disabled-by-policy", r.status === 403 && r.body.includes("remote-access-disabled-by-policy"), `status=${r.status}`)
  r = await request(`${GW}/`)
  ok("A7 force-off: loopback معفى دائمًا (الجهاز هي الحدود)", r.status === 200 && r.body === "up-ok")

  // ---------- تعديل حي: force-off → force-on بلا إعادة تشغيل ----------
  writePolicy({ schemaVersion: 1, organization: "Acme Corp", managed: { remoteAccess: "force-on" } })
  await new Promise((r2) => setTimeout(r2, 50))
  r = await requestViaLan(`${GW}/`, { headers: { "x-pair-token": TOKEN } })
  ok("A8 تعديل حي force-on: الخارج برمز صحيح يعبر من جديد", r.status === 200 && r.body === "up-ok")
  r = await requestViaLan(`${GW}/`)
  ok("A9 force-on: الخارج بلا رمز → 401 (الرمز شرط دائم)", r.status === 401)

  // ---------- blockedBridges: حظر جسور عن الخارج حصرًا ----------
  writePolicy({ schemaVersion: 1, organization: "Acme Corp", managed: { remoteAccess: "force-on", blockedBridges: [3005, 3006] } })
  await new Promise((r2) => setTimeout(r2, 50))
  r = await requestViaLan(`${GW}/?XTransformPort=3005`, { headers: { "x-pair-token": TOKEN } })
  ok("A10 جسر محجوب: الخارج+رمز → 403 bridge-blocked-by-policy", r.status === 403 && r.body.includes("bridge-blocked-by-policy"), `status=${r.status}`)
  r = await requestViaLan(`${GW}/?XTransformPort=3003`, { headers: { "x-pair-token": TOKEN } })
  ok("A11 جسر غير محجوب: الخارج+رمز يعبر", r.status === 200 && r.body === "up-ok")
  r = await request(`${GW}/?XTransformPort=3005`)
  ok("A12 الجسر المحجوب يبقى مفتوحًا لـ loopback (فرض عن الخارج حصرًا)", r.status === 200 && r.body === "up-ok")

  // ---------- حذف السياسة = غير مُدار فورًا ----------
  writePolicy(null)
  await new Promise((r2) => setTimeout(r2, 50))
  r = await requestViaLan(`${GW}/?XTransformPort=3005`, { headers: { "x-pair-token": TOKEN } })
  ok("A13 حذف الملف: غير مُدار لحظيًا — الجسر المحجوب يعبر من جديد", r.status === 200 && r.body === "up-ok")

  // ---------- ملف غير صالح: فشل-آمن صاخب ----------
  fs.writeFileSync(POLICY, "{ this is not json")
  await new Promise((r2) => setTimeout(r2, 50))
  h = JSON.parse((await request(`${GW}/__gw/health`)).body)
  ok("A14 ملف غير صالح: لا فرض (فشل-آمن) — policyManaged:false", h.policyManaged === false)
  r = await requestViaLan(`${GW}/`, { headers: { "x-pair-token": TOKEN } })
  ok("A15 ملف غير صالح: الخارج برمز صحيح يعبر (سلوك المستخدم محفوظ)", r.status === 200 && r.body === "up-ok")

  // ---------- WS: force-off برد خام على المقبس ----------
  writePolicy({ schemaVersion: 1, organization: "Acme Corp", managed: { remoteAccess: "force-off" } })
  await new Promise((r2) => setTimeout(r2, 50))
  const wsResult = await new Promise((resolve) => {
    const s = net.connect({ host: LAN, port: GW_PORT, localAddress: LAN }, () => {
      s.write(`GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: ${LAN}:${GW_PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nx-pair-token: ${TOKEN}\r\n\r\n`)
    })
    let buf = ""
    s.on("data", (d) => { buf += d.toString(); s.destroy(); resolve(buf) })
    s.on("error", () => resolve(buf))
    setTimeout(() => { try { s.destroy() } catch {} ; resolve(buf) }, 3000)
  })
  ok("A16 WS ترقية تحت force-off: رفض خام 403 حتى برمز صحيح", wsResult.includes("403"), wsResult.split("\r\n")[0] || "no-response")
  writePolicy(null)
} catch (e) {
  fail++
  console.error("❌ استثناء في المرحلة A:", e)
}

// ---------- المرحلة B: تطبيق حي (إن توفر) ----------
if (APP) {
  // التطبيق الحي يقرأ مسارَي البيئة المحيطية (NEXUSLINK_POLICY_FILE/NEXUSLINK_PAIR_FILE)
  // — المرحلة B تكتب فيهما حصرًا (ليس مجلد tmp الخاص بالمرحلة A).
  const APP_POLICY = process.env.NEXUSLINK_POLICY_FILE
  const APP_PAIR = process.env.NEXUSLINK_PAIR_FILE
  if (!APP_POLICY || !APP_PAIR) {
    console.log("⚠️ المرحلة B تتطلب NEXUSLINK_POLICY_FILE وNEXUSLINK_PAIR_FILE بالبيئة نفسها التي شُغّل بها التطبيق")
  } else {
    // بوابة ثانية REST لها التطبيق الحي حصرًا — لقياس الحرس الحلقي عبر البوابة (B7)
    const gwApp = spawn(process.execPath, [path.join(process.cwd(), "mini-services", "gateway", "index.cjs")], {
      env: { ...process.env, GATEWAY_PORT: "8195", GATEWAY_FALLBACK_PORT: "8196", REST_PORT: "3000" },
      stdio: ["ignore", "ignore", "ignore"],
    })
    for (let i = 0; i < 50; i++) {
      const r = await request(`http://127.0.0.1:8195/__gw/health`)
      if (r.status === 200) break
      await new Promise((r2) => setTimeout(r2, 100))
    }
    const writeAppPolicy = (j) => {
      if (j === null) { try { fs.unlinkSync(APP_POLICY) } catch {} ; return }
      fs.writeFileSync(APP_POLICY, JSON.stringify(j, null, 2))
    }
    try {
      // B1 — force-off: GET يعلن القفل وPOST enable مرفوض
      writeAppPolicy({ schemaVersion: 1, organization: "Acme Corp", managed: { remoteAccess: "force-off" } })
      let r = await request(`${APP}/api/remote-access`)
      let j = JSON.parse(r.body)
      ok("B1 GET /api/remote-access يعلن policy.remoteAccess=force-off", r.status === 200 && j.policy?.remoteAccess === "force-off", `status=${r.status}`)
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enable" }) })
      ok("B2 force-off: enable → 403 policy-remote-access-locked", r.status === 403 && r.body.includes("policy-remote-access-locked"), `status=${r.status}`)

      // B3 — تعديل حي إلى force-on: enable يعمل
      writeAppPolicy({ schemaVersion: 1, organization: "Acme Corp", managed: { remoteAccess: "force-on" } })
      await new Promise((res) => setTimeout(res, 100))
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enable" }) })
      j = JSON.parse(r.body)
      ok("B3 force-on: enable يعمل (رمز يُصدر)", r.status === 200 && j.ok === true && typeof j.token === "string", `status=${r.status}`)
      const liveToken = j.token || (JSON.parse(fs.readFileSync(APP_PAIR, "utf8")).token ?? "")

      // B4 — force-on: disable مرفوض والرمز بقي
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disable" }) })
      ok("B4 force-on: disable → 403 policy-remote-access-locked", r.status === 403 && r.body.includes("policy-remote-access-locked"), `status=${r.status}`)
      r = await request(`${APP}/api/remote-access`)
      j = JSON.parse(r.body)
      ok("B5 force-on: الاقتران بقى مفعّلًا بعد محاولة التعطيل", j.enabled === true)

      // B6 — تقرير الامتثال (حلقي): الحقول كاملة
      r = await request(`${APP}/api/enterprise/compliance`)
      j = JSON.parse(r.body)
      ok("B6 الامتثال حلقيًا: managed:true + بصمة 16hex + المؤسسة + فرض force-on",
        r.status === 200 && j.managed === true && j.policyState === "managed" && typeof j.policyHash === "string" && j.policyHash.length === 16
        && j.organization === "Acme Corp" && j.enforced?.remoteAccess === "force-on" && !!j.appVersion, `hash=${j.policyHash} v=${j.appVersion}`)

      // B7 — الامتثال عبر البوابة الحية من الخارج: مرفوض ولو برمز صحيح
      r = await requestViaLan(`http://127.0.0.1:8195/api/enterprise/compliance`, { headers: { "x-pair-token": liveToken } })
      ok("B7 الامتثال عبر البوابة من الخارج → 403 loopback-only", r.status === 403 && r.body.includes("loopback-only"), `status=${r.status}`)

      // B8 — ملف غير صالح: الامتثال يعلن invalid صاخبًا (فشل-آمن)
      fs.writeFileSync(APP_POLICY, "{ broken")
      await new Promise((res) => setTimeout(res, 100))
      r = await request(`${APP}/api/enterprise/compliance`)
      j = JSON.parse(r.body)
      ok("B8 ملف غير صالح: الامتثال يعلن policyState=invalid بلا فرض", r.status === 200 && j.policyState === "invalid" && j.managed === false)

      // تنظيف: إزالة السياسة + تعطيل الاقتران (الملف غير الصالح = لا قفل)
      writeAppPolicy(null)
      await new Promise((res) => setTimeout(res, 100))
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disable" }) })
      ok("B9 تنظيف: بلا سياسة التعطيل يعود للتاريخي (200) — التعديل الحي مكتمل", r.status === 200, `status=${r.status}`)
    } catch (e) {
      fail++
      console.error("❌ استثناء في المرحلة B:", e)
    }
    try { gwApp.kill("SIGTERM") } catch {}
  }
} else {
  console.log("ℹ️ المرحلة B متخطاة — مرّر --app http://127.0.0.1:3000 مع تشغيل التطبيق بنفس متغيري البيئة")
}

upstream.close()
for (const b of bridgeMocks) { try { b.close() } catch {} }
try { gw.kill("SIGTERM") } catch {}
console.log(`\n=== enterprise-e2e: ${pass} ناجح · ${fail} فاشل (LAN=${LAN} · tmp=${tmp}) ===`)
process.exit(fail === 0 ? 0 : 1)
