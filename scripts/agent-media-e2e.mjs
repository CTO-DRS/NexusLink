// NexusLink — E2E حي لطبقة الكاميرا والصوت (FA-8 — عقد §4.3)
// ============================================================
// يحاكي الهاتف الحقيقي (role=phone) وعميل الويب (role=pc) ضد الجسر الفعلي
// على 3005، ويتحقق من: التسجيل، ترحيل إشارات WebRTC بحقن kind/from،
// أوامر cam:cmd بقائمة بيضاء، تمرير shutter، التنبيهات، المستشعرات مع
// محدد المعدل، والصدى ping/pong. + فحص 3006: dev:ring يبث للأطراف.
import { io } from "socket.io-client"

const BASE = "http://127.0.0.1:3000" // REST
const GW = "http://127.0.0.1:81" // بوابة caddy — ?XTransformPort يوجّه للجسور
let pass = 0
let fail = 0
const results = []

function ok(name, cond, detail = "") {
  if (cond) {
    pass++
    results.push(`  ✅ ${name}`)
  } else {
    fail++
    results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitConnect(sock, name, ms = 8000) {
  if (sock.connected) return
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name} لم يتصل خلال ${ms}ms`)), ms)
    sock.once("connect", () => { clearTimeout(t); resolve() })
  })
}

async function main() {
  // إقلاع الجسرين (idempotent)
  const boot = await fetch(`${BASE}/api/media/boot`).then((r) => r.json()).catch(() => null)
  ok("boot /api/media/boot يعيد حالة الجسر", !!boot && boot.port === 3005, JSON.stringify(boot))
  await fetch(`${BASE}/api/guard/boot`).catch(() => {})
  await wait(300)

  // عميلان: هاتف (role=phone) وويب (role=pc) — عبر البوابة 81 كما يفعل الويب والوكيل
  const phone = io(`${GW}/?XTransformPort=3005`, { path: "/", transports: ["websocket", "polling"], forceNew: true, timeout: 10000 })
  const web = io(`${GW}/?XTransformPort=3005`, { path: "/", transports: ["websocket", "polling"], forceNew: true, timeout: 10000 })

  const events = { phone: {}, web: {} }
  function collect(sock, key, list) {
    for (const ev of list) sock.on(ev, (d) => { events[key][ev] ??= []; events[key][ev].push(d) })
  }
  collect(phone, "phone", ["media:hello", "media:role-ack", "rtc:answer", "rtc:ice", "rtc:offer", "cam:cmd", "cam:shutter", "sensor:stream"])
  collect(web, "web", ["media:hello", "media:phone-online", "media:log", "rtc:offer", "rtc:answer", "rtc:ice", "cam:state", "cam:shutter", "cam:cmd", "cam:captured", "sec:motion", "baby:alert", "sensor:stream", "media:pong"])

  const helloP = new Promise((r) => phone.once("media:hello", r))
  const helloW = new Promise((r) => web.once("media:hello", r))
  await waitConnect(phone, "phone")
  await waitConnect(web, "web")
  await Promise.race([Promise.all([helloP, helloW]), wait(6000)])
  ok("media:hello يصل للعميلين", !!events.phone["media:hello"]?.length && !!events.web["media:hello"]?.length)

  // 1) تسجيل الأدوار — الويب الحقيقي يسجل role=pc أولًا (use-media-bridge)
  const ackP = new Promise((r) => phone.once("media:role-ack", (d) => r(d)))
  web.emit("media:role", { role: "pc", name: "PC-E2E" })
  phone.emit("media:role", { role: "phone", name: "Pixel-Test", deviceId: "e2e-media-agent" })
  const ack = await ackP
  ok("media:role-ack للهاتف", ack?.role === "phone")
  await wait(250)
  ok("media:phone-online للويب باسم الهاتف", (events.web["media:phone-online"] ?? []).some((d) => d?.name === "Pixel-Test"))

  // 2) WebRTC: offer من الهاتف → للويب مع kind/from
  phone.emit("rtc:offer", { kind: "cam", sdp: { type: "offer", sdp: "v=0...FA8-TEST-OFFER" } })
  await wait(250)
  const offers = events.web["rtc:offer"] ?? []
  ok("rtc:offer يصل للويب مع kind=cam", offers.some((d) => d?.kind === "cam" && d?.from === "phone"), JSON.stringify(offers[0] ?? {}))
  ok("rtc:offer لا يرتد للمرسل نفسه", !(events.phone["rtc:offer"] ?? []).length)

  // 3) answer من الويب → للهاتف مع from=pc
  web.emit("rtc:answer", { kind: "cam", sdp: { type: "answer", sdp: "v=0...FA8-TEST-ANSWER" } })
  await wait(250)
  const answers = events.phone["rtc:answer"] ?? []
  ok("rtc:answer يصل للهاتف مع from=pc", answers.some((d) => d?.kind === "cam" && d?.from === "pc" && d?.sdp?.sdp?.includes("FA8-TEST-ANSWER")))

  // 4) ICE باتجاهين
  phone.emit("rtc:ice", { kind: "cam", candidate: { candidate: "candidate:1 udp 1 1.2.3.4 5000 typ host" } })
  web.emit("rtc:ice", { kind: "cam", candidate: { candidate: "candidate:2 udp 1 5.6.7.8 6000 typ host" } })
  await wait(250)
  ok("rtc:ice من الهاتف يصل الويب", (events.web["rtc:ice"] ?? []).some((d) => d?.from === "phone" && d?.candidate?.candidate?.includes("candidate:1")))
  ok("rtc:ice من الويب يصل الهاتف", (events.phone["rtc:ice"] ?? []).some((d) => d?.from === "pc" && d?.candidate?.candidate?.includes("candidate:2")))

  // 5) cam:cmd — قائمة بيضاء + تنقية الحقول
  web.emit("cam:cmd", { action: "cam-start", camera: "front", evil: "payload" })
  web.emit("cam:cmd", { action: "hack-the-phone" })
  await wait(250)
  const cmds = events.phone["cam:cmd"] ?? []
  ok("cam:cmd cam-start يصل بالكاميرا المنقاة", cmds.some((d) => d?.action === "cam-start" && d?.camera === "front" && !("evil" in d)))
  ok("cam:cmd أمر خارج القائمة البيضاء يُسقط", !cmds.some((d) => d?.action === "hack-the-phone"))

  // 6) cam:shutter — تمرير timer/flash/camera
  web.emit("cam:shutter", { timer: 5, flash: true, camera: "back" })
  await wait(250)
  const shutters = events.phone["cam:shutter"] ?? []
  ok("cam:shutter يمرر timer+flash+camera", shutters.some((d) => d?.timer === 5 && d?.flash === true && d?.camera === "back"), JSON.stringify(shutters[0] ?? {}))

  // 7) cam:state + cam:captured من الهاتف → للويب
  phone.emit("cam:state", { deviceId: "e2e-media-agent", active: true, facing: "front", torch: false, real: true, mode: "webrtc" })
  phone.emit("cam:captured", { name: "Nexus-Shot-e2e.jpg", device: "Pixel-Test" })
  await wait(250)
  ok("cam:state يصل الويب", (events.web["cam:state"] ?? []).some((d) => d?.active === true && d?.facing === "front"))
  ok("cam:captured يصل الويب", (events.web["cam:captured"] ?? []).some((d) => d?.name === "Nexus-Shot-e2e.jpg"))

  // 8) تنبيهات المراقبة
  phone.emit("sec:motion", { source: "Pixel-Test", level: 42 })
  phone.emit("baby:alert", { from: "Pixel-Test", level: 71 })
  await wait(250)
  ok("sec:motion يُرحل للويب", (events.web["sec:motion"] ?? []).some((d) => d?.level === 42))
  ok("baby:alert يُرحل للويب", (events.web["baby:alert"] ?? []).some((d) => d?.level === 71))

  // 9) sensor:stream — من الهاتف فقط + محدد معدل 40/s
  web.emit("sensor:stream", { a: [9, 9, 9], g: [0, 0, 0], ts: Date.now() }) // دور pc → يُسقط
  phone.emit("sensor:stream", { a: [0.1, 0.2, 9.81], g: [0.01, -0.02, 0.03], ts: Date.now() })
  await wait(250)
  ok("sensor:stream من الهاتف يصل الويب بحقن from", (events.web["sensor:stream"] ?? []).some((d) => d?.from === "Pixel-Test" && d?.a?.[2] === 9.81))
  ok("sensor:stream من دور غير الهاتف يُسقط", !(events.web["sensor:stream"] ?? []).some((d) => d?.a?.[0] === 9))

  const before = (events.web["sensor:stream"] ?? []).length
  for (let i = 0; i < 100; i++) {
    phone.emit("sensor:stream", { a: [i, 0, 0], g: [0, 0, 0], ts: Date.now() })
    await wait(2)
  }
  await wait(400)
  const after = (events.web["sensor:stream"] ?? []).length
  const relayed = after - before
  ok(`محدد معدل المستشعرات يعمل (وصل ${relayed} من 100 < 60)`, relayed > 0 && relayed < 60, `relayed=${relayed}`)

  // 10) ping/pong
  const pongP = new Promise((r) => phone.once("media:pong", r))
  phone.emit("media:ping", { t: 12345 })
  const pong = await pongP
  ok("media:ping → media:pong بنفس t", pong?.t === 12345)

  // 11) 3006 — أمر الرن يبث لكل العملاء (تنفيذ التنفيذ الحقيقي في Kotlin على الهاتف)
  const guard = io(`${GW}/?XTransformPort=3006`, { path: "/", transports: ["websocket", "polling"], forceNew: true, timeout: 10000 })
  const ringSeen = new Promise((r) => guard.once("dev:ring", r))
  try {
    await waitConnect(guard, "guard-3006")
    guard.emit("dev:ring", { at: Date.now() })
    const ring = await Promise.race([ringSeen, wait(2000).then(() => null)])
    ok("dev:ring على 3006 يبث (تنفيذه في خدمة Kotlin)", !!ring)
  } catch (e) {
    ok("dev:ring على 3006 يبث (تنفيذه في خدمة Kotlin)", false, e.message)
  }

  phone.close()
  web.close()
  guard.close()

  console.log("\n═══ نتائج FA-8 E2E — الكاميرا والصوت ═══")
  for (const line of results) console.log(line)
  console.log(`\nالمجموع: ${pass} ناجح / ${fail} فاشل`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("E2E crashed:", e)
  process.exit(1)
})
