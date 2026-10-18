// NexusLink — E2E حي لجعل الهاتف طرفًا متحكمًا (FA-9 — عقد §4.9 على جسر 3004)
// ===========================================================================
// يحاكي وكيل الهاتف (rc:hello-controller) وعميل الويب ضد الجسر الفعلي، ويغطي:
// تسجيل الطرفين، سيناريو اختبار النجاح (rc:move + rc:clipboard toPc بنص عربي)،
// الإدخال كاملًا (click/scroll/pinch/key/media)، بوابة الطاقة والإيقاظ WOL،
// التسليم rc:handoff الصالح والمرفوض، وامتداد drag في rc:move.
import { io } from "socket.io-client"

const BASE = "http://127.0.0.1:3000"
const GW = "http://127.0.0.1:81"
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
  const boot = await fetch(`${BASE}/api/remote/boot`).then((r) => r.json()).catch(() => null)
  ok("boot /api/remote/boot يعيد حالة الجسر", !!boot && boot.port === 3004, JSON.stringify(boot))
  await wait(300)

  const phone = io(`${GW}/?XTransformPort=3004`, { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 10000 })
  const web = io(`${GW}/?XTransformPort=3004`, { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 10000 })

  const events = { phone: {}, web: {} }
  function collect(sock, key, list) {
    for (const ev of list) sock.on(ev, (d) => { events[key][ev] ??= []; events[key][ev].push(d) })
  }
  collect(phone, "phone", ["rc:hello", "rc:move", "rc:click", "rc:scroll", "rc:pinch", "rc:key", "rc:media", "rc:power", "rc:wol", "rc:clipboard", "rc:handoff", "desktop:clipboard", "desktop:state", "rc:pong", "rc:rejected"])
  collect(web, "web", ["rc:hello", "rc:controller-online", "rc:move", "rc:click", "rc:scroll", "rc:pinch", "rc:key", "rc:media", "rc:power", "rc:wol", "rc:clipboard", "rc:handoff", "desktop:wake", "rc:log", "rc:rejected"])

  const helloP = new Promise((r) => phone.once("rc:hello", r))
  await waitConnect(phone, "phone")
  await waitConnect(web, "web")
  await helloP
  ok("rc:hello يصل للطرفين ببيانات الكمبيوتر", (events.phone["rc:hello"] ?? []).some((d) => d?.desktop?.mac?.length === 17))

  // 1) تسجيل الطرفين
  web.emit("desktop:register", { name: "NEXUS-PC-E2E", mac: "A4:5E:60:C1:2D:9F" })
  const ctlP = new Promise((r) => web.once("rc:controller-online", (d) => r(d)))
  phone.emit("rc:hello-controller", { name: "Pixel-Remote" })
  const ctl = await Promise.race([ctlP, wait(3000).then(() => null)])
  ok("rc:hello-controller يصل rc:controller-online للويب", ctl?.name === "Pixel-Remote", JSON.stringify(ctl ?? {}))

  // 2) ===== سيناريو اختبار النجاح (1/2): حركة المؤشر =====
  const moves = [[0.01, 0.0], [0.015, -0.005], [0.02, 0.01], [0.012, 0.004]]
  for (const [dx, dy] of moves) phone.emit("rc:move", { dx, dy, source: "touchpad" })
  await wait(300)
  const webMoves = (events.web["rc:move"] ?? []).filter((d) => d?.source === "touchpad")
  ok("rc:move دفعات المؤشر تصل الويب (اختبار النجاح 1/2)", webMoves.length >= moves.length, `got=${webMoves.length}`)
  const sum = webMoves.reduce((a, m) => a + (m.dx ?? 0), 0)
  ok("rc:move القيم النسبية محفوظة (مجموع dx)", Math.abs(sum - 0.057) < 0.005, `sum=${sum}`)

  // امتداد drag (FA-9): يمرر كما هو للويب
  phone.emit("rc:move", { dx: 0.03, dy: 0.0, source: "touchpad", drag: true })
  await wait(250)
  ok("rc:move drag=true يمتد للويب دون كسر", (events.web["rc:move"] ?? []).some((d) => d?.drag === true && d?.dx === 0.03))

  // 3) ===== سيناريو اختبار النجاح (2/2): حافظة الهاتف → الكمبيوتر =====
  const AR_TEXT = "مرحبًا من هاتف NexusLink — الصقني بالكومبيوتر!"
  phone.emit("rc:clipboard", { direction: "toPc", text: AR_TEXT })
  await wait(300)
  ok("rc:clipboard toPc يصل الويب بالنص العربي كاملًا", (events.web["rc:clipboard"] ?? []).some((d) => d?.direction === "toPc" && d?.text === AR_TEXT))
  // طلب السحب (pull) → الكمبيوتر يرد بـ desktop:clipboard للهاتف
  web.emit("desktop:clipboard", { text: "نص من الكمبيوتر إلى الهاتف", at: Date.now() })
  await wait(300)
  ok("desktop:clipboard من الكمبيوتر يصل الهاتف", (events.phone["desktop:clipboard"] ?? []).some((d) => d?.text?.includes("إلى الهاتف")))

  // 4) بقية الإدخال
  phone.emit("rc:click", { button: "left", type: "tap" })
  phone.emit("rc:click", { button: "right" })
  phone.emit("rc:scroll", { dy: -3.2 })
  phone.emit("rc:pinch", { scale: 1.25 })
  phone.emit("rc:key", { ch: "ة" })
  phone.emit("rc:key", { special: "enter" })
  phone.emit("rc:media", { action: "toggle" })
  phone.emit("rc:media", { action: "volume", value: 62 })
  await wait(300)
  ok("rc:click يسرى وأيمن يصلان", (events.web["rc:click"] ?? []).length >= 2)
  ok("rc:scroll يصل", (events.web["rc:scroll"] ?? []).some((d) => d?.dy === -3.2))
  ok("rc:pinch يصل", (events.web["rc:pinch"] ?? []).some((d) => d?.scale === 1.25))
  ok("rc:key حرف عربي + مفتاح خاص يصلان", (events.web["rc:key"] ?? []).some((d) => d?.ch === "ة") && (events.web["rc:key"] ?? []).some((d) => d?.special === "enter"))
  ok("rc:media toggle + volume يصلان", (events.web["rc:media"] ?? []).some((d) => d?.action === "toggle") && (events.web["rc:media"] ?? []).some((d) => d?.action === "volume" && d?.value === 62))

  // 5) الطاقة: سكون → إدخال يوقظ → إغلاق → إدخال مرفوض → WOL يوقظ
  phone.emit("rc:power", { action: "sleep" })
  await wait(250)
  ok("rc:power sleep يبث للويب", (events.web["rc:power"] ?? []).some((d) => d?.action === "sleep"))
  const wakeIn = new Promise((r) => web.once("desktop:wake", r))
  phone.emit("rc:scroll", { dy: 1 })
  const wake = await wakeIn
  ok("إدخال أثناء السكون يوقظ الكمبيوتر (desktop:wake source=input)", wake?.source === "input", JSON.stringify(wake ?? {}))

  web.emit("desktop:state", { power: "off" }) // محاكاة انطفاء فعلي
  await wait(200)
  phone.emit("rc:move", { dx: 0.01, dy: 0 })
  await wait(250)
  ok("إدخال أثناء الإطفاء مرفوض (rc:rejected off)", (events.phone["rc:rejected"] ?? []).some((d) => d?.reason === "off"))
  ok("لا rc:move يبث أثناء الإطفاء (بوابة الجسر)", !(events.web["rc:move"] ?? []).some((d) => d?.dx === 0.01 && !d?.drag && !d?.source))

  const wakeWol = new Promise((r) => web.once("desktop:wake", r))
  phone.emit("rc:wol", { mac: "A4:5E:60:C1:2D:9F" })
  const wol = await wakeWol
  ok("rc:wol بحزمة سحرية يبث desktop:wake source=wol", wol?.source === "wol" && String(wol?.packet ?? "").startsWith("FFFFFFFFFFFF"), JSON.stringify(wol ?? {}))
  phone.emit("rc:wol", { mac: "ZZ:AA:FF" })
  await wait(250)
  ok("rc:wol بـ MAC فاسد → rc:rejected mac", (events.phone["rc:rejected"] ?? []).some((d) => d?.reason === "mac" && d?.ev === "rc:wol"))
  web.emit("desktop:state", { power: "on" }) // استعادة
  await wait(150)

  // 6) التسليم rc:handoff (FA-9 — البند 6)
  const handP = new Promise((r) => web.once("rc:handoff", (d) => r(d)))
  phone.emit("rc:handoff", { url: "https://example.com/article/42", title: "مقال كنت أقرؤه" })
  const hand = await Promise.race([handP, wait(2500).then(() => null)])
  ok("rc:handoff صالح يصل الويب مع العنوان", hand?.url === "https://example.com/article/42" && hand?.title === "مقال كنت أقرؤه", JSON.stringify(hand ?? {}))
  phone.emit("rc:handoff", { url: "ftp://example.com/file" })
  phone.emit("rc:handoff", { url: "ليس رابطًا" })
  await wait(300)
  const rejects = events.phone["rc:rejected"] ?? []
  ok("rc:handoff ببروتوكول غير مسموح يرفض (scheme)", rejects.some((d) => d?.reason === "scheme" && d?.ev === "rc:handoff"))
  ok("rc:handoff بنص غير URL يرفض (url)", rejects.some((d) => d?.reason === "url" && d?.ev === "rc:handoff"))

  // 7) ping/pong
  const pongP = new Promise((r) => phone.once("rc:pong", r))
  phone.emit("rc:ping", { t: 98765 })
  const pong = await pongP
  ok("rc:ping → rc:pong بنفس t", pong?.t === 98765)

  phone.close()
  web.close()

  console.log("\n═══ نتائج FA-9 E2E — الهاتف طرف متحكم ═══")
  for (const line of results) console.log(line)
  console.log(`\nالمجموع: ${pass} ناجح / ${fail} فاشل`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("E2E crashed:", e)
  process.exit(1)
})
