#!/usr/bin/env node
/**
 * oem-e2e.mjs — جولة E2E حية لوضع OEM «خصوصية افتراضية» (عقد §40 — M4.3 النواة المحلية).
 * ============================================================
 * المرحلة أ (ذاتية الحاوية — بلا تطبيق): بوابة حية بعلم NEXUSLINK_OEM_PRIVACY=1
 *   فوق upstream وهمي (35556) وجسور وهمية (3003/3005) + ملف رمز برمز صحيح —
 *   الفحص من عنوان LAN حقيقي غير حلقي (تقنية §37.هـ الموثقة). تتحقق:
 *   المولود خاصًا (الخارج مرفوض ولو برمز صحيح + كل الجسور محجوبة + loopback
 *   معفى) · سياسة صالحة تفوز كاملة (تخفيف MDM) · تعديل/حذف لحظي · ملف غير
 *   صالح = فشل-مغلق (يبقى مغلقاً — عكس §38 المتعمد) · health يعلن
 *   oemPrivacy/postureSource · WS برد خام.
 * المرحلة ب (انحدار وضع المستخدم): بوابة ثانية بلا العلم — السلوك التاريخي
 *   حرفيًا: بلا سياسة الخارج يعبر برمز، وملف غير صالح = فشل-آمن مفتوح (§38).
 * المرحلة ج (--app http://127.0.0.1:3000 — تتطلب تطبيقًا حيًا مُقلعًا بنفس
 *   متغيرات البيئة NEXUSLINK_OEM_PRIVACY/POLICY_FILE/PAIR_FILE/AUDIT_FILE):
 *   الامتثال الحلقي (oemPrivacy + effective) · قفل enable/rotate تحت
 *   المولود خاصًا · سياسة صالحة تفتح (enable/rotate يعملان) · إعلان
 *   invalid الفشل-المغلق · حرس loopback للامتثال عبر بوابة ثانية · السجل
 *   التدقيقي §39 يرصد oem/source وسلسلته سليمة (إعادة بناء مستقلة رياضيًا).
 * الاستخدام:
 *   node scripts/oem-e2e.mjs                                ← المرحلتان أ+ب
 *   node scripts/oem-e2e.mjs --app http://127.0.0.1:3000    ← المرحلة ج حصرًا
 */
import http from "node:http"
import net from "node:net"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { spawn } from "node:child_process"

const GW_PORT = 8197
const GW_FALLBACK = 8198
const UP_PORT = 35556
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
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }) })
    if (body) req.write(body)
    req.end()
  })
}

/** طلب «خارجي»: الاتصال بعنوان LAN المحلي — البوابة ترى remoteAddress غير حلقي */
function requestViaLan(target, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const u = new URL(target)
    const req = http.request(
      { host: LAN, port: u.port, path: u.pathname + u.search, method, headers, localAddress: LAN },
      (res) => {
        let b = ""
        res.on("data", (d) => { b += d })
        res.on("end", () => resolve({ status: res.statusCode, body: b }))
      },
    )
    req.on("error", (e) => resolve({ status: 0, body: String(e) }))
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }) })
    if (body) req.write(body)
    req.end()
  })
}

/** WS خام خارجي: يعيد أول سطر الاستجابة والجسم إن وجد */
function rawWsExternal(port, { headers = "" } = {}) {
  return new Promise((resolve) => {
    const s = net.connect({ host: LAN, port, localAddress: LAN }, () => {
      s.write(`GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: ${LAN}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${headers}\r\n`)
    })
    let buf = ""
    s.on("data", (d) => { buf += d.toString(); s.destroy(); resolve(buf) })
    s.on("error", () => resolve(buf))
    setTimeout(() => { try { s.destroy() } catch {} ; resolve(buf) }, 3000)
  })
}

// ---------- ملفات مؤقتة + بوابة حية ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexuslink-e40-"))
const POLICY = path.join(tmp, "policy.json")
const PAIR = path.join(tmp, "pair-token.json")
const TOKEN = "e2e-" + "x".repeat(40)
function writePolicy(j, file = POLICY) {
  if (j === null) { try { fs.unlinkSync(file) } catch {} ; return }
  fs.writeFileSync(file, JSON.stringify(j, null, 2))
}
function writePairFile() {
  fs.writeFileSync(PAIR, JSON.stringify({ token: TOKEN, fingerprint: "e2efingerprint0000", createdAt: new Date().toISOString() }, null, 2))
}
function spawnGateway(extraEnv = {}, port = GW_PORT, fallback = GW_FALLBACK) {
  const g = spawn(process.execPath, [path.join(process.cwd(), "mini-services", "gateway", "index.cjs")], {
    env: {
      ...process.env,
      GATEWAY_PORT: String(port),
      GATEWAY_FALLBACK_PORT: String(fallback),
      REST_PORT: String(UP_PORT),
      NEXUSLINK_PAIR_FILE: PAIR,
      NEXUSLINK_POLICY_FILE: POLICY,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  g.stdout.on("data", (d) => { log += d })
  g.stderr.on("data", (d) => { log += d })
  return { g, log: () => log }
}
async function waitGateway(port) {
  for (let i = 0; i < 60; i++) {
    const r = await request(`http://127.0.0.1:${port}/__gw/health`)
    if (r.status === 200) return true
    await new Promise((r2) => setTimeout(r2, 100))
  }
  return false
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- المرحلة ج: التطبيق الحي (وضع --app) — المرحلتان أ+ب تُخطيان ----------
if (APP) {
  const APP_POLICY = process.env.NEXUSLINK_POLICY_FILE
  const APP_PAIR = process.env.NEXUSLINK_PAIR_FILE
  const APP_AUDIT = process.env.NEXUSLINK_AUDIT_FILE
  if (!APP_POLICY || !APP_PAIR) {
    console.log("⚠️ المرحلة ج تتطلب NEXUSLINK_POLICY_FILE وNEXUSLINK_PAIR_FILE بالبيئة نفسها التي شُغّل بها التطبيق")
  } else {
    const writeAppPolicy = (j) => writePolicy(j, APP_POLICY)
    // تحقق مستقل للسلسلة التدقيقية (نمط audit-e2e: إعادة بناء البصمات رياضيًا بلا المكتبة)
    function readAuditRecords() {
      try {
        return fs.readFileSync(APP_AUDIT, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l))
      } catch { return [] }
    }
    function chainValid(recs) {
      let prev = ""
      let expected = 1
      for (const r of recs) {
        const h = crypto.createHash("sha256")
          .update(JSON.stringify({ i: r.i, t: r.t, k: r.k, ok: r.ok, actor: r.actor, d: r.d, prev: r.prev }))
          .digest("hex").slice(0, 16)
        if (r.i !== expected || r.prev !== prev || h !== r.h) return { valid: false, at: r.i ?? expected }
        prev = r.h
        expected++
      }
      return { valid: true, at: null }
    }

    try {
      writeAppPolicy(null)
      // ج1 — الامتثال الحلقي: المولود خاصًا كامل الوصف
      let r = await request(`${APP}/api/enterprise/compliance`)
      let j = JSON.parse(r.body)
      const eff = j.oemPrivacy?.effective ?? {}
      ok("ج1 الامتثال: oemPrivacy.active + source=oem-default + مغلق + force-off + كل الجسور (7)",
        r.status === 200 && j.oemPrivacy?.active === true && j.oemPrivacy?.source === "oem-default"
        && eff.closed === true && eff.remoteAccess === "force-off" && Array.isArray(eff.blockedBridges) && eff.blockedBridges.length === 7
        && j.policyState === "unmanaged" && j.managed === false,
        `source=${j.oemPrivacy?.source} closed=${eff.closed} bridges=${(eff.blockedBridges ?? []).length}`)

      // ج2 — GET /api/remote-access يعلن وضع OEM
      r = await request(`${APP}/api/remote-access`)
      j = JSON.parse(r.body)
      ok("ج2 remote-access GET: oemPrivacy.active=true + source=oem-default + بلا اقتران",
        r.status === 200 && j.oemPrivacy?.active === true && j.oemPrivacy?.source === "oem-default" && j.enabled === false)

      // ج3 — قفل المولود خاصًا: enable مرفوض بصدق
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enable" }) })
      j = JSON.parse(r.body)
      ok("ج3 المولود خاصًا: enable → 403 oem-privacy-default + hint=deploy-policy-file",
        r.status === 403 && j.error === "oem-privacy-default" && j.hint === "deploy-policy-file", `status=${r.status}`)
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rotate" }) })
      ok("ج4 المولود خاصًا: rotate → 403 oem-privacy-default (بلا اقتران أصلًا)", r.status === 403 && r.body.includes("oem-privacy-default"), `status=${r.status}`)

      // ج5 — السجل التدقيقي: سلسلة سليمة + الرصد الأولي يحمل oem:true + الرفض موثق
      await sleep(150)
      let recs = readAuditRecords()
      let cv = chainValid(recs)
      const observed = recs.find((x) => x.k === "policy.observed")
      const denied = recs.find((x) => x.k === "pair.admin.denied" && x.d?.reason === "oem-privacy-default")
      ok("ج5 السجل §39: سلسلة سليمة (إعادة بناء مستقلة) + policy.observed d.oem=true + رفض oem موثق",
        recs.length > 0 && cv.valid && observed?.d?.oem === true && observed?.d?.source === "oem-default" && !!denied,
        `n=${recs.length} valid=${cv.valid} at=${cv.at}`)

      // ج6 — سياسة صالحة تفوز كاملة: المصدر ينتقل لحظيًا إلى policy
      writeAppPolicy({ schemaVersion: 1, organization: "OEM IT", managed: { remoteAccess: "force-on" } })
      await sleep(150)
      r = await request(`${APP}/api/enterprise/compliance`)
      j = JSON.parse(r.body)
      ok("ج6 سياسة صالحة: managed=true + source=policy + غير مغلق + force-on + بصمة 16hex",
        r.status === 200 && j.managed === true && j.oemPrivacy?.source === "policy" && j.oemPrivacy?.effective?.closed === false
        && j.enforced?.remoteAccess === "force-on" && typeof j.policyHash === "string" && j.policyHash.length === 16,
        `hash=${j.policyHash}`)

      // ج7 — التفعيل يعمل تحت سياسة مُخففة ثم التدوير متروك
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enable" }) })
      j = JSON.parse(r.body)
      ok("ج7 سياسة force-on: enable يعمل (رمز يُصدر مرة واحدة)", r.status === 200 && j.ok === true && typeof j.token === "string", `status=${r.status}`)
      const liveToken = j.token || ""
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rotate" }) })
      j = JSON.parse(r.body)
      ok("ج8 سياسة force-on: rotate يعمل (التدوير متروك — §38 تحت §40)", r.status === 200 && j.ok === true && typeof j.token === "string", `status=${r.status}`)

      // ج9 — حرس loopback للامتثال عبر بوابة ثانية (بلا علم OEM — §37 خالصة):
      // الخارج برمز صحيح يعبر البوابة لكن الامتثال حلقي حصرًا → 403 loopback-only
      // (درس M4.2 الموثق S15: الرمز الحي يُقرأ من الملف لحظة الفحص — رمز ج7 مات بتدوير ج8)
      const gwApp = spawn(process.execPath, [path.join(process.cwd(), "mini-services", "gateway", "index.cjs")], {
        env: {
          ...process.env,
          NEXUSLINK_OEM_PRIVACY: "",
          NEXUSLINK_POLICY_FILE: path.join(tmp, "none-policy.json"),
          GATEWAY_PORT: "8199", GATEWAY_FALLBACK_PORT: "8200", REST_PORT: "3000",
        },
        stdio: ["ignore", "ignore", "ignore"],
      })
      await waitGateway(8199)
      const liveTokenNow = (() => { try { return JSON.parse(fs.readFileSync(APP_PAIR, "utf8")).token || "" } catch { return "" } })()
      r = await requestViaLan(`http://127.0.0.1:8199/api/enterprise/compliance`, { headers: { "x-pair-token": liveTokenNow } })
      ok("ج9 الامتثال عبر البوابة من الخارج برمز صحيح → 403 loopback-only (الحرس الحلقي قائم تحت §40)",
        r.status === 403 && r.body.includes("loopback-only"), `status=${r.status}`)
      try { gwApp.kill("SIGTERM") } catch {}

      // ج10 — حذف السياسة: عودة فورية للمولود خاصًا (مصدر oem-default) والتدوير يُقفل
      writeAppPolicy(null)
      await sleep(150)
      r = await request(`${APP}/api/enterprise/compliance`)
      j = JSON.parse(r.body)
      ok("ج10 حذف السياسة: عودة لحظية للمولود خاصًا (source=oem-default + مغلق)",
        r.status === 200 && j.policyState === "unmanaged" && j.oemPrivacy?.source === "oem-default" && j.oemPrivacy?.effective?.closed === true)
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rotate" }) })
      ok("ج11 المولود خاصًا من جديد: rotate → 403 oem-privacy-default", r.status === 403 && r.body.includes("oem-privacy-default"), `status=${r.status}`)

      // ج12 — التعطيل متروك تحت المولود خاصًا (حذف رمز لا يزيد تعريضًا)
      r = await request(`${APP}/api/remote-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disable" }) })
      ok("ج12 المولود خاصًا: disable يعمل (200) — التعطيل لا يُقفل أبدًا", r.status === 200, `status=${r.status}`)

      // ج13 — ملف غير صالح: الفشل-المغلق معلن صاخبًا (عكس §38 المتعمد في وضع المستخدم)
      fs.writeFileSync(APP_POLICY, "{ broken json")
      await sleep(150)
      r = await request(`${APP}/api/enterprise/compliance`)
      j = JSON.parse(r.body)
      ok("ج13 ملف غير صالح: policyState=invalid + يبقى مغلقاً (فشل-مغلق §40)",
        r.status === 200 && j.policyState === "invalid" && j.managed === false
        && j.oemPrivacy?.source === "oem-default" && j.oemPrivacy?.effective?.closed === true,
        `state=${j.policyState} closed=${j.oemPrivacy?.effective?.closed}`)

      // ج14 — السجل بعد كل الانتقالات: سلسلة سليمة + policy.changed تحمل oem
      await sleep(150)
      recs = readAuditRecords()
      cv = chainValid(recs)
      const changes = recs.filter((x) => x.k === "policy.changed")
      ok("ج14 السجل بعد الانتقالات: سلسلة سليمة + policy.changed بدلالة oem:true + لا فجوات",
        recs.length >= 8 && cv.valid && changes.length >= 3 && changes.every((x) => x.d?.oem === true),
        `n=${recs.length} changed=${changes.length} valid=${cv.valid}`)

      // تنظيف: إزالة الملفات المؤقتة الجانبية (الملف غير الصالح يبقى حتى إعادة التشغيل التالية)
      writeAppPolicy(null)
    } catch (e) {
      fail++
      console.error("❌ استثناء في المرحلة ج:", e)
    }
  }
  console.log(`\n=== oem-e2e (المرحلة ج): ${pass} ناجح · ${fail} فاشل (APP=${APP}) ===`)
  process.exit(fail === 0 ? 0 : 1)
}

// ---------- المرحلتان أ+ب: بوابتان حيتان فوق upstream وجسور وهمية ----------
function makeUpstream() {
  return http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("up-ok")
  })
}
const upstream = makeUpstream()
const bridgeMocks = [makeUpstream(), makeUpstream()] // 3003 و3005 — لقياس الحجب والعبور

try {
  await new Promise((r) => upstream.listen(UP_PORT, r))
  await new Promise((r) => bridgeMocks[0].listen(3003, r))
  await new Promise((r) => bridgeMocks[1].listen(3005, r))
  writePairFile()
  writePolicy(null)

  // ----- المرحلة أ: المولود خاصًا (NEXUSLINK_OEM_PRIVACY=1) -----
  const gwA = spawnGateway({ NEXUSLINK_OEM_PRIVACY: "1" })
  const readyA = await waitGateway(GW_PORT)
  ok("أ0 البوابة (بعلم OEM) وupstream وجسور وهمية جاهزة", readyA, gwA.log().slice(-160))
  const GWA = `http://127.0.0.1:${GW_PORT}`

  let h = JSON.parse((await request(`${GWA}/__gw/health`)).body)
  ok("أ1 health يعلن oemPrivacy:true + postureSource=oem-default + policyManaged:false + pair:true",
    h.oemPrivacy === true && h.postureSource === "oem-default" && h.policyManaged === false && h.pair === true,
    `oem=${h.oemPrivacy} src=${h.postureSource}`)

  let r = await requestViaLan(`${GWA}/`, { headers: { "x-pair-token": TOKEN } })
  ok("أ2 المولود خاصًا: الخارج برمز صحيح → 403 remote-access-closed-oem-default (الرمز بلا معنى)",
    r.status === 403 && r.body.includes("remote-access-closed-oem-default"), `status=${r.status}`)
  r = await requestViaLan(`${GWA}/`)
  ok("أ3 المولود خاصًا: الخارج بلا رمز → 403 نفسه (الإغلاق لا يتوقف على الرمز)", r.status === 403 && r.body.includes("remote-access-closed-oem-default"), `status=${r.status}`)
  r = await request(`${GWA}/`)
  ok("أ4 loopback معفى دائمًا حتى في المولود خاصًا (الجهاز هي الحدود)", r.status === 200 && r.body === "up-ok")

  r = await requestViaLan(`${GWA}/?XTransformPort=3003`, { headers: { "x-pair-token": TOKEN } })
  ok("أ5 جسر وهمي 3003 للخارج+رمز: 403 رفض الباب الأمامي (المولود خاصًا يغلق كل الطرق قبل الجسور)",
    r.status === 403 && r.body.includes("remote-access-closed-oem-default"), `status=${r.status}`)
  r = await requestViaLan(`${GWA}/?XTransformPort=3004`, { headers: { "x-pair-token": TOKEN } })
  ok("أ6 جسر بلا upstream (3004): 403 الباب الأمامي لا 502 — الإغلاق يسبق التحويل",
    r.status === 403 && r.body.includes("remote-access-closed-oem-default"), `status=${r.status}`)
  r = await request(`${GWA}/?XTransformPort=3003`)
  ok("أ7 الجسر الوهمي يبقى مفتوحًا لـ loopback (الحجب عن الخارج حصرًا)", r.status === 200 && r.body === "up-ok")

  const wsA = await rawWsExternal(GW_PORT, { headers: `x-pair-token: ${TOKEN}\r\n` })
  ok("أ8 WS خارجي تحت المولود خاصًا: رفض خام 403 remote-access-closed-oem-default حتى برمز",
    wsA.includes("403") && wsA.includes("remote-access-closed-oem-default"), (wsA.split("\r\n")[0] || "no-response").slice(0, 60))

  // ----- سياسة صالحة تفوز كاملة (مسار MDM للتخفيف) -----
  writePolicy({ schemaVersion: 1, organization: "OEM IT", managed: { remoteAccess: "force-on" } })
  await sleep(80)
  h = JSON.parse((await request(`${GWA}/__gw/health`)).body)
  ok("أ9 سياسة صالحة: health يعلن postureSource=policy + policyManaged:true", h.postureSource === "policy" && h.policyManaged === true)
  r = await requestViaLan(`${GWA}/`, { headers: { "x-pair-token": TOKEN } })
  ok("أ10 سياسة force-on تخفف: الخارج برمز صحيح يعبر من جديد", r.status === 200 && r.body === "up-ok", `status=${r.status}`)
  r = await requestViaLan(`${GWA}/`)
  ok("أ11 force-on: الخارج بلا رمز → 401 pair-token-required (الرمز شرط دائم)", r.status === 401 && r.body.includes("pair-token-required"), `status=${r.status}`)

  writePolicy({ schemaVersion: 1, organization: "OEM IT", managed: { remoteAccess: "force-on", blockedBridges: [3005] } })
  await sleep(80)
  r = await requestViaLan(`${GWA}/?XTransformPort=3005`, { headers: { "x-pair-token": TOKEN } })
  ok("أ12 تحت سياسة: حجب بقائمة السياسة → 403 bridge-blocked-by-policy (خطأ مميز عن OEM)",
    r.status === 403 && r.body.includes("bridge-blocked-by-policy"), `status=${r.status}`)
  r = await requestViaLan(`${GWA}/?XTransformPort=3003`, { headers: { "x-pair-token": TOKEN } })
  ok("أ13 تحت سياسة: جسر خارج قائمة الحجب يعبر (السياسة تفوز لا المولود خاصًا)", r.status === 200 && r.body === "up-ok", `status=${r.status}`)

  writePolicy({ schemaVersion: 1, organization: "OEM IT", managed: { remoteAccess: "force-off" } })
  await sleep(80)
  r = await requestViaLan(`${GWA}/`, { headers: { "x-pair-token": TOKEN } })
  ok("أ14 تعديل حي إلى force-off: الخارج مرفوض → remote-access-disabled-by-policy (خطأ السياسة)",
    r.status === 403 && r.body.includes("remote-access-disabled-by-policy"), `status=${r.status}`)

  // ----- حذف/فساد لحظيان: عودة المولود خاصًا والفشل-المغلق -----
  writePolicy(null)
  await sleep(80)
  r = await requestViaLan(`${GWA}/`, { headers: { "x-pair-token": TOKEN } })
  ok("أ15 حذف السياسة: عودة فورية للمولود خاصًا (403 oem)", r.status === 403 && r.body.includes("remote-access-closed-oem-default"), `status=${r.status}`)
  fs.writeFileSync(POLICY, "{ broken json")
  await sleep(80)
  h = JSON.parse((await request(`${GWA}/__gw/health`)).body)
  ok("أ16 ملف غير صالح: policyManaged:false + postureSource=oem-default (الفشل-المغلق معلن)",
    h.policyManaged === false && h.postureSource === "oem-default")
  r = await requestViaLan(`${GWA}/`, { headers: { "x-pair-token": TOKEN } })
  ok("أ17 الفشل-المغلق: ملف تالف لا يفتح جهازًا مولودًا خاصًا (403 oem — عكس §38 المتعمد)",
    r.status === 403 && r.body.includes("remote-access-closed-oem-default"), `status=${r.status}`)
  r = await requestViaLan(`${GWA}/?XTransformPort=3003`, { headers: { "x-pair-token": TOKEN } })
  ok("أ18 الفشل-المغلق شامل: الجسور وراء الباب المغلق (403 oem) — لا فجوة بملف تالف",
    r.status === 403 && r.body.includes("remote-access-closed-oem-default"), `status=${r.status}`)

  try { gwA.g.kill("SIGTERM") } catch {}
  await sleep(300)

  // ----- المرحلة ب: انحدار وضع المستخدم (بلا العلم — صفر تغيير) -----
  writePolicy(null)
  const gwB = spawnGateway({}, 8201, 8202)
  const readyB = await waitGateway(8201)
  ok("ب0 بوابة وضع المستخدم (بلا علم) جاهزة", readyB, gwB.log().slice(-160))
  const GWB = `http://127.0.0.1:8201`

  h = JSON.parse((await request(`${GWB}/__gw/health`)).body)
  ok("ب1 health: oemPrivacy:false + postureSource=user-default (السلوك التاريخي)", h.oemPrivacy === false && h.postureSource === "user-default")
  r = await requestViaLan(`${GWB}/`, { headers: { "x-pair-token": TOKEN } })
  ok("ب2 بلا علم وبلا سياسة: الخارج برمز صحيح يعبر (السلوك التاريخي حرفيًا)", r.status === 200 && r.body === "up-ok", `status=${r.status}`)
  r = await requestViaLan(`${GWB}/`)
  ok("ب3 الخارج بلا رمز → 401 (§37 كما هو)", r.status === 401, `status=${r.status}`)

  fs.writeFileSync(POLICY, "{ broken json")
  await sleep(80)
  r = await requestViaLan(`${GWB}/`, { headers: { "x-pair-token": TOKEN } })
  ok("ب4 وضع المستخدم: ملف غير صالح = فشل-آمن مفتوح (§38.هـ.3 محفوظ حرفيًا)", r.status === 200 && r.body === "up-ok", `status=${r.status}`)
  h = JSON.parse((await request(`${GWB}/__gw/health`)).body)
  ok("ب5 وضع المستخدم: الملف التالف يعلن policyManaged:false بلا posture خاص", h.policyManaged === false && h.postureSource === "user-default")

  try { gwB.g.kill("SIGTERM") } catch {}
} catch (e) {
  fail++
  console.error("❌ استثناء في المرحلتين أ+ب:", e)
}

upstream.close()
for (const b of bridgeMocks) { try { b.close() } catch {} }
console.log(`\n=== oem-e2e (المرحلتان أ+ب): ${pass} ناجح · ${fail} فاشل (LAN=${LAN} · tmp=${tmp}) ===`)
process.exit(fail === 0 ? 0 : 1)
