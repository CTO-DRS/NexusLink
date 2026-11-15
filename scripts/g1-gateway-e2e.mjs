#!/usr/bin/env node
// G1 (docs/ROADMAP-2027.md — P0) — البوابة آمنة افتراضيًا: فحص E2E حي
// ============================================================
// يقلع البوابة الحقيقية (mini-services/gateway/index.cjs) بلا أي ملف رمز —
// كأول تشغيل عند مستخدم جديد — أمام upstream وهمي، ويثبت من عنوان LAN حقيقي
// غير حلقي (تقنية §37.هـ: الاتصال بعنوان الشبكة المحلي للجهاز نفسه فترى
// البوابة remoteAddress غير حلقي):
//   · أول إقلاع يولّد الرمز ويحفظه (0600) — الإعلان في /__gw/health
//   · LAN بلا رمز → 401 · برمز خاطئ → 401 · بالرمز (ترويسة/بارامتر) → 200
//   · ?pair= يُجرَّد قبل upstream · loopback معفى · WS من LAN بلا رمز → 401
//   · إعادة الإقلاع تحفظ الرمز نفسه (لا تدوير صامت يكسر الأجهزة المقترنة)
//   · حذف الملف = فشل-مغلق (401 لا 200) · علامة التعطيل = 403 بلا توليد
//   · أسلاك المصدر: QR يحمل الرمز، والهاتف (Dart + Kotlin) يرسله
// صفر تبعيات — node مدمج حصرًا. الاستخدام: node scripts/g1-gateway-e2e.mjs
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const GW_SCRIPT = path.join(ROOT, "mini-services", "gateway", "index.cjs")
const GW_PORT = Number(process.env.G1_GW_PORT || 8291)
const GW_FALLBACK = GW_PORT + 1
const UP_PORT = Number(process.env.G1_UP_PORT || 38291)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nexuslink-g1-"))
const PAIR_FILE = path.join(TMP, "state", "pair-token.json")

let pass = 0
let fail = 0
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`✅ ${name}`) } else { fail++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a && !a.internal && a.family === "IPv4") return a.address
  }
  return null
}
const LAN = lanIp()
if (!LAN) {
  console.error("❌ لا عنوان LAN غير حلقي — الفحص يحتاجه لمحاكاة واصل من الشبكة (تقنية §37.هـ)")
  process.exit(1)
}

/** طلب HTTP؛ من LAN: الاتصال بعنوان الشبكة ومنه (localAddress) فترى البوابة عنوانًا غير حلقي */
function request(host, pathQ, { headers = {}, localAddress } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host, port: GW_PORT, path: pathQ, method: "GET", headers, localAddress }, (res) => {
      let body = ""
      res.on("data", (d) => { body += d })
      res.on("end", () => resolve({ status: res.statusCode, body }))
    })
    req.on("error", (e) => resolve({ status: 0, body: String(e.message) }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }) })
    req.end()
  })
}
const viaLan = (p, o = {}) => request(LAN, p, { ...o, localAddress: LAN })
const viaLoop = (p, o = {}) => request("127.0.0.1", p, o)

/** ترقية WS خام من LAN — يعيد السطر الأول من الرد */
function wsFromLan(pathQ) {
  return new Promise((resolve) => {
    let buf = ""
    const s = net.connect({ host: LAN, port: GW_PORT, localAddress: LAN }, () => {
      s.write(`GET ${pathQ} HTTP/1.1\r\nHost: ${LAN}:${GW_PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    s.on("data", (d) => { buf += d; if (buf.includes("\r\n")) { s.destroy(); resolve(buf.split("\r\n")[0]) } })
    s.on("error", () => resolve(buf.split("\r\n")[0] || "error"))
    setTimeout(() => { try { s.destroy() } catch {} ; resolve(buf.split("\r\n")[0] || "timeout") }, 4000)
  })
}

// upstream وهمي: يسجل آخر مسار ويقبل ترقية WS (101) ليثبت العبور
let lastUpstreamUrl = ""
const upstream = http.createServer((req, res) => {
  lastUpstreamUrl = req.url
  res.writeHead(200, { "content-type": "text/plain" })
  res.end("up-ok")
})
upstream.on("upgrade", (req, socket) => {
  lastUpstreamUrl = req.url
  socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
})

let gw = null
let gwLog = ""
async function startGateway() {
  gwLog = ""
  gw = spawn(process.execPath, [GW_SCRIPT], {
    env: {
      ...process.env,
      GATEWAY_PORT: String(GW_PORT), GATEWAY_FALLBACK_PORT: String(GW_FALLBACK),
      REST_PORT: String(UP_PORT), NEXUSLINK_PAIR_FILE: PAIR_FILE,
      NEXUSLINK_POLICY_FILE: path.join(TMP, "no-policy.json"), NEXUSLINK_OEM_PRIVACY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  gw.stdout.on("data", (d) => { gwLog += d })
  gw.stderr.on("data", (d) => { gwLog += d })
  for (let i = 0; i < 60; i++) {
    const r = await viaLoop("/__gw/health")
    if (r.status === 200) return JSON.parse(r.body)
    await new Promise((r2) => setTimeout(r2, 100))
  }
  return null
}
async function stopGateway() {
  if (!gw) return
  const p = new Promise((r) => gw.once("exit", r))
  gw.kill("SIGTERM")
  await Promise.race([p, new Promise((r) => setTimeout(r, 3000))])
  gw = null
}
const readToken = () => { try { return JSON.parse(fs.readFileSync(PAIR_FILE, "utf8")).token } catch { return null } }

try {
  await new Promise((res, rej) => { upstream.once("error", rej); upstream.listen(UP_PORT, "127.0.0.1", res) })

  // ---------- 1) أول تشغيل: لا ملف رمز ----------
  ok("G1-0 البداية بلا ملف رمز (أول تشغيل عند مستخدم جديد)", !fs.existsSync(PAIR_FILE))
  const h = await startGateway()
  ok("G1-1 البوابة تقلع وتعلن pairRequired:true وpair:true", h?.ok === true && h?.pairRequired === true && h?.pair === true && h?.lanAccess === "token", JSON.stringify(h)?.slice(0, 160))
  const T = readToken()
  let mode = 0
  try { mode = fs.statSync(PAIR_FILE).mode & 0o777 } catch {}
  ok("G1-2 أول إقلاع ولّد رمزًا base64url من 43 محرفًا وحفظه بصلاحية 0600", typeof T === "string" && /^[A-Za-z0-9_-]{43}$/.test(T) && (process.platform === "win32" || mode === 0o600), `mode=${mode.toString(8)}`)
  ok("G1-3 سجل البوابة لا يطبع الرمز الخام (بصمة فقط)", !!T && !gwLog.includes(T) && /pair token ready \(fp=[0-9a-f]{16}\)/.test(gwLog), gwLog.slice(0, 200))

  // ---------- 2) الحسم من LAN ----------
  let r = await viaLan("/api/version")
  ok("G1-4 LAN بلا رمز → 401 pair-token-required", r.status === 401 && r.body.includes("pair-token-required"), `status=${r.status}`)
  r = await viaLan("/api/version", { headers: { "x-pair-token": "x".repeat(43) } })
  ok("G1-5 LAN برمز خاطئ → 401", r.status === 401, `status=${r.status}`)
  r = await viaLan("/api/version", { headers: { "x-pair-token": T } })
  ok("G1-6 LAN بترويسة الرمز الصحيح → 200 يعبر إلى upstream", r.status === 200 && r.body === "up-ok", `status=${r.status}`)
  r = await viaLan(`/api/version?a=1&pair=${encodeURIComponent(T)}`)
  ok("G1-7 LAN ببارامتر ?pair= الصحيح → 200 (مسار الهاتف)", r.status === 200 && r.body === "up-ok", `status=${r.status}`)
  ok("G1-8 ?pair= يُجرَّد قبل upstream (الرمز لا يغادر البوابة)", lastUpstreamUrl === "/api/version?a=1", `upstream saw ${lastUpstreamUrl}`)
  r = await viaLoop("/api/version")
  ok("G1-9 loopback بلا رمز → 200 (الجهاز نفسه معفى)", r.status === 200 && r.body === "up-ok", `status=${r.status}`)
  r = await viaLan("/__gw/health")
  ok("G1-10 /__gw/health معفى من LAN (تشخيص بلا بيانات)", r.status === 200, `status=${r.status}`)

  // ---------- 3) WS (socket.io) من LAN ----------
  const wsNo = await wsFromLan("/socket.io/?EIO=4&transport=websocket")
  ok("G1-11 ترقية WS من LAN بلا رمز → 401 خام", /^HTTP\/1\.1 401/.test(wsNo), wsNo)
  const wsOk = await wsFromLan(`/socket.io/?EIO=4&transport=websocket&pair=${encodeURIComponent(T)}`)
  ok("G1-12 ترقية WS من LAN بالرمز → تعبر (101 من upstream)", /^HTTP\/1\.1 101/.test(wsOk), wsOk)

  // ---------- 4) الاستمرارية عبر إعادة الإقلاع ----------
  await stopGateway()
  const h2 = await startGateway()
  ok("G1-13 إعادة الإقلاع تحفظ الرمز نفسه (الأجهزة المقترنة لا تنكسر)", h2?.pair === true && readToken() === T)
  r = await viaLan("/api/version", { headers: { "x-pair-token": T } })
  ok("G1-14 الرمز المحفوظ يعمل بعد إعادة الإقلاع → 200", r.status === 200, `status=${r.status}`)

  // ---------- 5) فشل-مغلق: حذف الملف أثناء التشغيل ----------
  fs.rmSync(PAIR_FILE, { force: true })
  await new Promise((r2) => setTimeout(r2, 200))
  r = await viaLan("/api/version")
  ok("G1-15 حذف ملف الرمز أثناء التشغيل → الخارج مرفوض 401 (لم يعد يفتح الباب)", r.status === 401, `status=${r.status}`)
  r = await viaLan("/api/version", { headers: { "x-pair-token": T } })
  ok("G1-16 والرمز القديم لم يعد يعبر → 401", r.status === 401, `status=${r.status}`)

  // ---------- 6) التعطيل الصريح: علامة .disabled ----------
  await stopGateway()
  fs.writeFileSync(`${PAIR_FILE}.disabled`, JSON.stringify({ disabledAt: new Date().toISOString() }))
  const h3 = await startGateway()
  ok("G1-17 علامة التعطيل: الإقلاع لا يولّد رمزًا (pair:false · lanAccess:closed)", h3?.pair === false && h3?.lanAccess === "closed" && !fs.existsSync(PAIR_FILE), JSON.stringify(h3)?.slice(0, 120))
  r = await viaLan("/api/version", { headers: { "x-pair-token": T } })
  ok("G1-18 معطّل صراحة: LAN → 403 remote-access-disabled", r.status === 403 && r.body.includes("remote-access-disabled"), `status=${r.status}`)
  r = await viaLoop("/api/version")
  ok("G1-19 معطّل صراحة: loopback يبقى يعمل → 200", r.status === 200, `status=${r.status}`)
  await stopGateway()

  // ---------- 7) أسلاك المصدر: QR يحمل الرمز والهاتف يرسله ----------
  const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")
  const qr = rd("src/app/api/devices/qr/route.ts")
  ok("G1-20 QR الاقتران يحمل الرمز (payload.pair من ensurePairToken) ويعلن LAN+منفذ البوابة بدل loopback",
    qr.includes("ensurePairToken()") && qr.includes("pair: pairRec.token") && qr.includes("isLoopbackHost(host)") && qr.includes("gatewayPort()"))
  const models = rd("nexuslink_mobile/lib/domain/models.dart")
  const prov = rd("nexuslink_mobile/lib/state/providers.dart")
  ok("G1-21 Flutter: QrPayload يقرأ pair وServerEndpoint يرسله في REST وsocket.io وPairTokenStore يحفظه",
    models.includes("j['pair']") && models.includes("'pair': pairToken!") && models.includes("...pairQuery")
    && prov.includes("PairTokenStore.save(endpoint.key") && prov.includes("PairTokenStore.load(endpoint.key)"))
  const svc = rd("nexuslink_mobile/android/app/src/main/kotlin/com/nexuslink/mobile/AgentForegroundService.kt")
  const sec = rd("nexuslink_mobile/android/app/src/main/kotlin/com/nexuslink/mobile/SecChannel.kt")
  const boot = rd("nexuslink_mobile/android/app/src/main/kotlin/com/nexuslink/mobile/BootReceiver.kt")
  ok("G1-22 Android: الخدمة الأصلية تمرر الرمز لكل سوكِت (3006/3007/3005/3009) وتحفظه للإقلاع التلقائي",
    (svc.match(/AgentServicePrefs\.gatewayQuery\(/g) || []).length === 3 && sec.includes("AgentServicePrefs.gatewayQuery(secPort, pairToken)")
    && svc.includes("KEY_PAIR_TOKEN, pairToken") && boot.includes("KEY_PAIR_TOKEN") && !svc.includes('opts.query = "XTransformPort='))
  const proc = rd("apps/desktop/src-tauri/src/procman.rs")
  ok("G1-23 سطح المكتب: Next على 127.0.0.1 حصرًا (لا تجاوز للبوابة) ومسار رمز واحد للطرفين في مجلد البيانات",
    proc.includes('("HOSTNAME".into(), "127.0.0.1".into())') && !proc.includes('"0.0.0.0".into()') && (proc.match(/NEXUSLINK_PAIR_FILE/g) || []).length === 2)
} catch (e) {
  ok("G1 اكتمل بلا خطأ غير متوقع", false, e instanceof Error ? e.message : String(e))
} finally {
  await stopGateway()
  upstream.close()
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
}

console.log(`\n=== g1-gateway-e2e: ${pass} ناجح · ${fail} فاشل (LAN=${LAN}) ===`)
if (fail > 0) { console.log(gwLog.slice(-600)); process.exit(1) }
