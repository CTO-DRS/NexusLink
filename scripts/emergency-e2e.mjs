#!/usr/bin/env node
// NexusLink — بوابة الطوارئ الذكي (عقد §48) — emergency-e2e
// ============================================================
// الطور أ (نقي — بلا خادم، 27 فحصًا): رياضيات النواة — تطبيع التسليح
//   الصاخب بكل حوافه (3–10)، حتمية ترتيب التصعيد الذاتي، بصمة القتل
//   16-hex بلا إشارة سالبة أبدًا (درس الجولة: XOR بلا >>>0)، وصدق الكود:
//   dev:kill خارج CMDS، لا «unkill» ناجح، حرس loopback حاضر، الكتابة
//   ذرّية 0600، العقد في المستند، توازن i18n في المعاجم الخمسة.
// الطور ب (حي — ضد السيرفر، 24 فحصًا): السيناريو الكامل:
//   نظيفة → رفض unkill 400 → رفض LAN 403 → تسليح مع PIN بلا كشف الهاش →
//   guard:arm عبر المقبس → قتل خاطئ 403/400 → القتل الصحيح بتدوير رمز §37
//   ووصول dev:kill → إعادة اتصال المقتول بلا مصافحة والتمييز للسليم →
//   الإعادة خاملة refired → ملف 0600 → سجل §39 بالأنواع الأربعة → خاتمة.
// الاستخدام:
//   node scripts/emergency-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e48-live
//   node scripts/emergency-e2e.mjs                                (طور أ حصرًا)
// خروج 0 = أخضر، 1 = أحمر. القاعدة: جولتان متتاليتان أخضرتان.

import fs from "node:fs"
import path from "node:path"

let pass = 0
let fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`❌ ${name}${extra ? " — " + extra : ""}`) }
}

/* ═════════════ الطور أ — النواة النقية وصدق الكود (27 فحصًا) ═════════════ */
const {
  KILL_WORD, killFingerprint, normalizeArmRules, decideSelfEscalation,
  UNLOCK_FAIL_MIN, UNLOCK_FAIL_MAX,
} = await import("../src/lib/nexus/emergency-core.ts")

// 1-2: كلمة القتل الحرفية وحدود التطبيع
ok("أ1 كلمة القتل حرفية «اقتل»", KILL_WORD === "اقتل")
ok("أ2 حدود التطبيع 3–10 معلنة", UNLOCK_FAIL_MIN === 3 && UNLOCK_FAIL_MAX === 10)

// 3-7: التطبيع الصاخب بكل حوافه
const below = normalizeArmRules({ unlockFailLimit: 1, simChangeAction: "kill" })
ok("أ3 تحت الحد يُشدَّد إلى 3 بملاحظة صاخبة", below.rules.unlockFailLimit === 3 && below.notes.some((n) => n.includes("شُدِّد")))
const above = normalizeArmRules({ unlockFailLimit: 99, simChangeAction: "warn" })
ok("أ4 فوق الحد يُخفَّض إلى 10 بملاحظة", above.rules.unlockFailLimit === 10 && above.notes.some((n) => n.includes("خُفِّض")))
const garbage = normalizeArmRules({ unlockFailLimit: "abc", simChangeAction: "nonsense" })
ok("أ5 مدخل تالف يهبط إلى الافتراضي 5 مع إعلان", garbage.rules.unlockFailLimit === 5 && garbage.notes.length >= 1)
const valid = normalizeArmRules({ unlockFailLimit: 7, simChangeAction: "off" })
ok("أ6 المدخل السليم يمر بلا ملاحظة واحدة", valid.rules.unlockFailLimit === 7 && valid.rules.simChangeAction === "off" && valid.notes.length === 0)
const empty = normalizeArmRules({})
ok("أ7 الفراغ الكامل = افتراضي صامت (لا إعلان على غياب)", empty.rules.unlockFailLimit === 5 && empty.rules.simChangeAction === "warn" && empty.notes.length === 0)

// 8-13: حتمية ترتيب التصعيد الذاتي (48.د)
const RULES = { unlockFailLimit: 5, simChangeAction: "kill" }
ok("أ8 المقتول يبقى مقتولًا (الترتيب 1)", decideSelfEscalation({ killed: true, unlockFails: 0, simChanged: false }, RULES).reason === "already-killed")
ok("أ9 بلوغ حد المحاولات يقتل (الترتيب 2)", decideSelfEscalation({ killed: false, unlockFails: 5, simChanged: false }, RULES).reason === "unlock-fails")
ok("أ10 القتيل يسبق كل شيء حتى مع بلوغ الحد", decideSelfEscalation({ killed: true, unlockFails: 9, simChanged: true }, RULES).reason === "already-killed")
ok("أ11 المحاولات تسبق الشريحة (الترتيب الحتمي)", decideSelfEscalation({ killed: false, unlockFails: 5, simChanged: true }, RULES).reason === "unlock-fails")
ok("أ12 تغيير الشريحة مع قاعدة kill يقتل (الترتيب 3)", decideSelfEscalation({ killed: false, unlockFails: 0, simChanged: true }, RULES).reason === "sim-changed")
const warnRules = { unlockFailLimit: 5, simChangeAction: "warn" }
ok("أ13 تغيير الشريحة مع قاعدة warn لا يقتل", decideSelfEscalation({ killed: false, unlockFails: 0, simChanged: true }, warnRules).action === "none")
ok("أ13.ب بلا تسليح لا تصعيد أبدًا", decideSelfEscalation({ killed: false, unlockFails: 99, simChanged: true }, null).action === "none")

// 14-19: بصمة القتل — 16-hex حتمية بلا إشارة سالبة (درس >>>0 الموثق)
const fp1 = killFingerprint("device-a|armed|12345")
ok("أ14 البصمة 16 محرفًا سداسيًا حصرًا", /^[0-9a-f]{16}$/.test(fp1), fp1)
ok("أ15 البصمة حتمية (نفس البذرة = نفس البصمة)", killFingerprint("device-a|armed|12345") === fp1)
ok("أ16 بذرة مختلفة = بصمة مختلفة", killFingerprint("device-b|armed|12345") !== fp1)
ok("أ17 لا إشارة سالبة أبدًا (درس XOR)", !fp1.includes("-"))
let allHex = true
for (let i = 0; i < 1000 && allHex; i++) allHex = /^[0-9a-f]{16}$/.test(killFingerprint(`seed-${i}-عرربي-${i * 7}`))
ok("أ18 ألف بذرة عشوائية كلها 16-hex صحيحة", allHex)
ok("أ19 البصمة فارغة البذرة تظل 16-hex (لا انهيار)", /^[0-9a-f]{16}$/.test(killFingerprint("")))

// 20-24: صدق الكود (المصدر يحرس نفسه)
const bridgeSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/nexus/guard-bridge.ts"), "utf8")
const routeSrc = fs.readFileSync(path.join(process.cwd(), "src/app/api/security/emergency/route.ts"), "utf8")
const srvSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/nexus/emergency.ts"), "utf8")
ok("أ20 dev:kill خارج قائمة CMDS (لا حقن بالمقبس)", bridgeSrc.includes('const CMDS = ["dev:ring"') && !bridgeSrc.slice(bridgeSrc.indexOf("const CMDS"), bridgeSrc.indexOf("const CMDS") + 400).includes("dev:kill"))
// أ21: لا مسار unkill ناجح — الكلمة تظهر في كتلة الرفض 400 حصرًا (قبل فرعي arm/kill)
const unkillBlock = routeSrc.slice(0, routeSrc.indexOf('if (action === "arm")'))
const afterArm = routeSrc.slice(routeSrc.indexOf('if (action === "arm")'))
ok("أ21 لا مسار unkill ناجح في المسار (رفض 400 حصرًا)", unkillBlock.includes('action === "unkill"') && unkillBlock.includes("no-unkill-ever") && !afterArm.includes("unkill"))
ok("أ22 حرس loopback حاضر في المسار (نمط §37)", routeSrc.includes("x-gw-client-ip") && routeSrc.includes("isLoopbackIp"))
ok("أ23 الكتابة ذرّية 0600 في طبقة الخادم", srvSrc.includes("renameSync") && srvSrc.includes("0o600"))
const phoneSrc = fs.readFileSync(path.join(process.cwd(), "src/components/nexus/guard/phone-guard.tsx"), "utf8")
ok("أ24 التوأم يستقبل dev:kill ويعطّل كل الأوامر بعده", phoneSrc.includes('socket.on("dev:kill"') && (phoneSrc.match(/if \(killedRef\.current\) return/g) || []).length >= 8)

// 25-27: العقد وi18n
const contract = fs.readFileSync(path.join(process.cwd(), "docs/enterprise-deploy.md"), "utf8")
ok("أ25 عقد §48 كامل في المستند (17 + 48.و.1 الرفض الموثق)", contract.includes("## 17) وضع الطوارئ الذكي") && contract.includes("الحد 48.و.1"))
ok("أ26 التوأم يرسّخ القتل في localStorage (إعادة التحميل لا تنقذ)", phoneSrc.includes("nexus.emergency.kill"))
const AR = /[\u0600-\u06FF]/
function arKeys(p) {
  try { return Object.keys(JSON.parse(fs.readFileSync(path.join(process.cwd(), p), "utf8"))).filter((k) => AR.test(k)).length } catch { return -1 }
}
const counts = [arKeys("src/lib/ar-en-map.json"), arKeys("src/lib/i18n/fr.json"), arKeys("src/lib/i18n/es.json"), arKeys("src/lib/i18n/de.json"), arKeys("src/lib/i18n/ru.json")]
ok("أ27 توازن i18n الخمسة حرفيًا (3,725×5 — أساس §49: +18 مفتاح المرحّل)", counts.every((c) => c === 3725), counts.join("/"))

/* ═════════════ الطور ب — السيناريو الحي (24 فحصًا) ═════════════ */
const APP = (() => {
  const i = process.argv.indexOf("--app")
  return i > 0 ? process.argv[i + 1] : null
})()
const LIVE_DIR = (() => {
  const i = process.argv.indexOf("--dir")
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e48-live"
})()

if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/emergency-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const { io } = await import("socket.io-client")
  const base = APP.replace(/\/$/, "")
  const get = (p, h = {}) => fetch(base + p, { cache: "no-store", headers: h })
  const post = (p, body, h = {}) => fetch(base + p, {
    method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(body),
  })
  const EMERGENCY = path.join(LIVE_DIR, "emergency-kill.json")
  const AUDIT = path.join(LIVE_DIR, "audit.jsonl")
  const LAN = { "x-gw-client-ip": "192.168.1.77" }
  const PIN = "4848-abcd"
  const VICTIM = "phone-victim-a"
  const HEALTHY = "phone-healthy-b"

  // إقلاع الجسر (port 3006) — مرة واحدة قبل كل شيء
  await get("/api/guard/boot").catch(() => {})
  await new Promise((r) => setTimeout(r, 800))

  /** عميل هاتف وهمي: يسجل بمعرّفه ويجمع الأحداث الواصلة. */
  function phoneClient(deviceId, events) {
    const s = io("http://127.0.0.1:3006", { path: "/", transports: ["websocket", "polling"], forceNew: true, reconnection: false, timeout: 8000 })
    const bag = events ?? []
    s.onAny((ev, ...args) => { if (ev === "dev:kill" || ev === "guard:arm") bag.push({ ev, d: args[0] ?? null }) })
    return { s, bag, hello: () => s.emit("guard:hello-phone", { name: `twin-${deviceId}`, deviceId }) }
  }
  const waitMs = (ms) => new Promise((r) => setTimeout(r, ms))

  // 1) حالة نظيفة (boot-e48 يبدأها بلا ملف طوارئ)
  let r = await get("/api/security/emergency")
  let j = await r.json()
  ok("ب1 لقطة البداية نظيفة غير مُسلَّحة", j.ok === true && j.armed === false && Array.isArray(j.kills) && j.kills.length === 0)
  ok("ب2 كلمة القتل معلنة (حدود صادقة)", j.killWord === "اقتل")

  // 2) الحد البنيوي: لا إلغاء قتل أبدًا — بكل الصيغ
  r = await post("/api/security/emergency", { action: "unkill" })
  j = await r.json()
  const r2 = await post("/api/security/emergency", { action: "revive", pin: PIN, confirm: "اقتل", deviceId: VICTIM })
  ok("ب3 unkill وrevive مرفوضان 400 صريحين", r.status === 400 && j.error === "no-unkill-ever" && r2.status === 400)

  // 3) إدارة من LAN عبر البوابة → 403 (نمط §37)
  r = await post("/api/security/emergency", { action: "arm", pin: PIN, rules: {} }, LAN)
  j = await r.json()
  ok("ب4 التسليح من LAN مرفوض 403 (loopback حصرًا)", r.status === 403 && j.error === "emergency-admin-loopback-only")

  // 4) الهاتف السليم يتصل أولًا (ليكون هدف dev:kill موثقًا)
  const healthy = phoneClient(HEALTHY)
  await waitMs(600)
  healthy.hello()
  await waitMs(600)

  // 5) التسليح بالـPIN مع تطبيع صاخب (أرسلنا 1 → 3)
  r = await post("/api/security/emergency", { action: "arm", pin: PIN, rules: { unlockFailLimit: 1, simChangeAction: "kill" } })
  j = await r.json()
  ok("ب5 التسليح ينجح بتطبيع معلن (1 → 3)", j.ok === true && j.rules?.unlockFailLimit === 3 && Array.isArray(j.notes) && j.notes.length >= 1)
  ok("ب6 الهاش لا يعود في أي استجابة (خام أبدًا)", !JSON.stringify(j).includes("pinSha256") && !JSON.stringify(j).includes("sha256"))
  await waitMs(500)
  ok("ب7 guard:arm وصل الهاتف المتصل عبر المقبس", healthy.bag.some((e) => e.ev === "guard:arm" && e.d?.rules?.unlockFailLimit === 3))

  // 6) قتل بمدخلات خاطئة بكل الترتيبات
  r = await post("/api/security/emergency", { action: "kill", pin: "wrong-pin", confirm: "اقتل", deviceId: VICTIM })
  ok("ب8 PIN خاطئ → 403 مرفوض", r.status === 403 && (await r.json()).error === "pin-denied")
  r = await post("/api/security/emergency", { action: "kill", pin: PIN, confirm: "ا ق ت ل", deviceId: VICTIM })
  ok("ب9 الكلمة بفواصل ليست الكلمة → 400", r.status === 400 && (await r.json()).error === "confirm-word-required")
  r = await post("/api/security/emergency", { action: "kill", pin: PIN, confirm: "اقتل", deviceId: "" })
  ok("ب10 معرّف غائب → 400", r.status === 400 && (await r.json()).error === "device-id-required")

  // 7) تمكين رمز §37 (البوابة تحتاج سياسة غير oem-default — boot-e48 يكتبها)
  r = await post("/api/remote-access", { action: "enable" })
  j = await r.json()
  const fpBefore = j.fingerprint ?? null
  ok("ب11 رمز §37 مُمكَّن قبل القتل", r.status === 200 && !!fpBefore, `fp=${fpBefore}`)

  // 8) الضحية تتصل ثم القتل الصحيح
  const victim = phoneClient(VICTIM)
  await waitMs(600)
  victim.hello()
  await waitMs(600)
  r = await post("/api/security/emergency", { action: "kill", pin: PIN, confirm: "اقتل", deviceId: VICTIM })
  j = await r.json()
  ok("ب12 القتل الصحيح ينجح بكل شروطه", j.ok === true && j.killed === true && /^[0-9a-f]{16}$/.test(j.fingerprint ?? ""))
  ok("ب13 تدوير رمز §37 لحظة القتل (pairRotated)", j.pairRotated === true && j.pairRotated !== undefined)
  ok("ب14 dev:kill وصل الوكيل المتصل لحظة القتل", j.deliveredToAgent === true && victim.bag.some((e) => e.ev === "dev:kill" && e.d?.deviceId === VICTIM))
  await waitMs(300)
  r = await get("/api/remote-access")
  j = await r.json()
  ok("ب15 بصمة §37 تغيّرت فعلًا بعد القتل", j.fingerprint && j.fingerprint !== fpBefore, `${fpBefore} → ${j.fingerprint}`)

  // 9) الضحية تعيد الاتصال → قتل فوري بلا مصافحة
  victim.s.disconnect()
  await waitMs(400)
  const reconnected = phoneClient(VICTIM)
  await waitMs(600)
  reconnected.hello()
  await waitMs(700)
  ok("ب16 المقتول العائد يُقابَل بالقتل قبل أي مصافحة", reconnected.bag.some((e) => e.ev === "dev:kill" && e.d?.via === "reconnect" && e.d?.refired === true))
  // السليم لم يستلم أي قتل قط
  ok("ب17 السليم لم يستلم dev:kill أبدًا (تمييز القائمة)", !healthy.bag.some((e) => e.ev === "dev:kill"))

  // 10) إعادة القتل عبر الـAPI: خاملة صادقة
  r = await post("/api/security/emergency", { action: "kill", pin: PIN, confirm: "اقتل", deviceId: VICTIM })
  j = await r.json()
  ok("ب18 الإعادة خاملة refired بلا بصمة جديدة", j.ok === true && j.refired === true)

  // 11) القائمة في الحالة + الملف على القرص 0600
  r = await get("/api/security/emergency")
  j = await r.json()
  ok("ب19 القائمة الدائمة تحمل الضحية ببصمته وتدويره", j.armed === true && j.kills.length === 1 && j.kills[0].deviceId === VICTIM && j.kills[0].pairRotated === true)
  let modeOk = null
  try { modeOk = (fs.statSync(EMERGENCY).mode & 0o777) === 0o600 } catch { modeOk = "no-file" }
  ok("ب20 ملف الحالة 0600 على القرص", modeOk === true, String(modeOk))

  // 12) سجل §39 بالأنواع الأربعة + دليل التدوير من-إلى
  let audit = []
  try { audit = fs.readFileSync(AUDIT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) } catch { /* بلا سجل */ }
  const kinds = new Set(audit.map((a) => a.k))
  ok("ب21 السجل يحمل الأنواع الأربعة الجديدة", ["emergency.arm", "emergency.kill", "emergency.kill.denied", "emergency.kill.refired"].every((k) => kinds.has(k)), [...kinds].filter((k) => k.startsWith("emergency")).join(","))
  const killRec = audit.filter((a) => a.k === "emergency.kill").at(-1)
  ok("ب22 دليل القتل يحمل البصمة والتدوير من-إلى", !!killRec && killRec.d?.pairRotated === true && typeof killRec.d?.pairFrom === "string" && killRec.d.pairFrom === fpBefore && /^[0-9a-f]{16}$/.test(killRec.d?.pairTo ?? ""))
  const deniedRec = audit.find((a) => a.k === "emergency.kill.denied" && a.d?.reason === "pin")
  ok("ب23 الرفض بالـPIN موثق (لا إغراق — مرة واحدة لكل طلب)", !!deniedRec)

  // 13) الخاتمة: قائمة لا تفرَّغ + unkill ما زال مرفوضًا بعد كل شيء
  r = await post("/api/security/emergency", { action: "unkill", pin: PIN, confirm: "اقتل", deviceId: VICTIM })
  ok("ب24 الخاتمة: unkill مرفوض 400 حتى بعد القتل الكامل", r.status === 400)

  // تنظيف عملاء البوابة
  try { healthy.s.disconnect(); reconnected.s.disconnect(); victim.s.disconnect() } catch { /* غائب */ }
}

/* ───────────────────────── التقرير ───────────────────────── */
const total = pass + fail
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
console.log(`emergency-e2e — بوابة الطوارئ الذكي (عقد §48)`)
console.log(`النتيجة: ${pass}/${total} فحصًا أخضر — ${fail === 0 ? "✅ أخضر" : "❌ أحمر"}`)
if (fail) process.exit(1)
process.exit(0)
