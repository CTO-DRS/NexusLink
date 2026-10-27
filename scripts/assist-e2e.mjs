#!/usr/bin/env node
// NexusLink — بوابة المساعدة عن بعد (عقد §46) — assist-e2e
// ============================================================
// الطور أ (نقي — بلا خادم): رياضيات رمز المساعدة — اشتقاق حتمي، تطبيع بشري،
//   مقارنة زمن-ثابت، سقف محاولات، نوافذ صلاحية، رفض أشكال.
// الطور ب (حي — ضد السيرفر): السيناريو الكامل لسيناريو العائلة:
//   إصدار QR → رمز مساعدة ستّي → محاولة خاطئة → طلب صحيح → موافقة المالك
//   → جلسة نشطة في status → قطع بضغطة → إبطال الاقتران + مسار الرفض.
// الاستخدام:
//   node scripts/assist-e2e.mjs --app http://127.0.0.1:3000   (طور ب حي)
//   node scripts/assist-e2e.mjs                                (طور أ حصرًا)
// خروج 0 = أخضر، 1 = أحمر. القاعدة: جولتان متتاليتان أخضرتان.

import http from "node:http"

let pass = 0
let fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`❌ ${name}${extra ? " — " + extra : ""}`) }
}

/* ═════════════ الطور أ — الرياضيات النقية (13 فحصًا) ═════════════ */
const { deriveAssistCode, verifyAssistCode, normalizeAssistCode, isWellFormedCode, MAX_ASSIST_ATTEMPTS, ASSIST_CODE_TTL_MS } =
  await import("../src/lib/nexus/assist-code.ts")

// حتمية الاشتقاق: نفس السر = نفس الرمز، أسرار مختلفة = رموز مختلفة (شبه حتمي)
const c1 = deriveAssistCode("a".repeat(32))
const c2 = deriveAssistCode("a".repeat(32))
const c3 = deriveAssistCode("b".repeat(32))
ok("أ1 الاشتقاق حتمي (نفس السر → نفس الرمز)", c1 === c2)
ok("أ2 أسرار مختلفة → رموز مختلفة", c1 !== c3)
ok("أ3 الرمز ستّ خانات رقمية", isWellFormedCode(c1), c1)
ok("أ4 النافذة = نافذة الاقتران (10 دقائق)", ASSIST_CODE_TTL_MS === 10 * 60_000)
ok("أ5 سقف المحاولات = 5", MAX_ASSIST_ATTEMPTS === 5)

// التطبيع البشري: فراغات وشرطات تُقبل
ok("أ6 تطبيع «123 456»", normalizeAssistCode("123 456") === "123456")
ok("أ7 تطبيع «123-456»", normalizeAssistCode("123-456") === "123456")
ok("أ8 الشكل يرفض 5 خانات", !isWellFormedCode("12345"))

const SECRET = "f".repeat(32)
const CODE = deriveAssistCode(SECRET)
const NOW = 1_000_000_000
ok("أ9 رمز صحيح داخل النافذة يقبل", verifyAssistCode(CODE, SECRET, NOW, 0, NOW + 1000).ok)
ok("أ10 بلا نافذة → no-window", verifyAssistCode(CODE, null, NOW, 0, NOW).reason === "no-window")
ok("أ11 رمز مفقود → missing", verifyAssistCode("", SECRET, NOW, 0, NOW).reason === "missing")
ok("أ12 بعد النافذة → expired", verifyAssistCode(CODE, SECRET, NOW, 0, NOW + ASSIST_CODE_TTL_MS + 1).reason === "expired")
ok("أ13 رمز خاطئ → invalid", verifyAssistCode("000000" === CODE ? "111111" : "000000", SECRET, NOW, 0, NOW).reason === "invalid")
ok("أ13.ب سقف مستنفد → locked قبل كل شيء", verifyAssistCode(CODE, SECRET, NOW, MAX_ASSIST_ATTEMPTS, NOW).reason === "locked")
ok("أ13.ج شكل تالف → malformed", verifyAssistCode("12ab", SECRET, NOW, 0, NOW).reason === "malformed")

/* ═════════════ الطور ب — السيناريو الحي (22 فحصًا) ═════════════ */
const APP = (() => {
  const i = process.argv.indexOf("--app")
  return i > 0 ? process.argv[i + 1] : null
})()

if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/assist-e2e.mjs --app http://127.0.0.1:3000`)
} else {
  const base = APP.replace(/\/$/, "")
  const get = (p) => fetch(base + p, { cache: "no-store" })
  const post = (p, body) => fetch(base + p, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })

  // 1) لا جلسة ولا طلب قبل البداية (حالة نظيفة بعد إعادة تشغيل أو جولة سابقة نظيفة)
  let r = await get("/api/devices/assist")
  let j = await r.json()
  ok("ب1 لقطة البداية سليمة", j.ok === true)
  ok("ب2 لا جلسة نشطة قبل السيناريو", !j.session, j.session ? j.session.deviceName : "")

  // 2) إصدار QR — يفتح النافذة ويشتق رمز المساعدة (ويفسح المحاولات من جديد)
  r = await get("/api/devices/qr")
  j = await r.json()
  ok("ب3 QR يصدر رمز مساعدة", typeof j.assistCode === "string" && /^\d{6}$/.test(j.assistCode), j.assistCode)
  ok("ب4 مهلة رمز المساعدة معلنة (10 دقائق)", j.assistExpiresAt - j.payload.ts === 10 * 60_000)
  const CODE = j.assistCode

  // 3) اللقطة بعد الإصدار: نشطة والرمز مطابق
  j = await (await get("/api/devices/assist")).json()
  ok("ب5 النافذة نشطة بعد الإصدار", j.active === true)
  ok("ب6 رمز اللقطة يطابق رمز الإصدار", j.code === CODE)
  ok("ب7 المحاولات كاملة (5)", j.attemptsLeft === 5, `المتبقي ${j.attemptsLeft}`)

  // 4) محاولة خاطئة → 403 invalid وينقص السقف
  r = await post("/api/devices/assist", { action: "request", assistCode: "000000" === CODE ? "111111" : "000000", name: "intruder-phone", model: "X" })
  j = await r.json()
  ok("ب8 رمز خاطئ يُرفض 403", r.status === 403 && j.reason === "invalid")
  j = await (await get("/api/devices/assist")).json()
  ok("ب9 السقف نقص إلى 4", j.attemptsLeft === 4, `المتبقي ${j.attemptsLeft}`)
  ok("ب10 لا طلب معلّق بعد الخاطئ", !j.pending)

  // 5) طلب صحيح من «هاتف العائلة» → معلّق بلا تسجيل
  r = await post("/api/devices/assist", { action: "request", assistCode: CODE, name: "Aunt-Phone", model: "Galaxy A54", kind: "phone", ip: "192.168.1.77" })
  j = await r.json()
  ok("ب11 طلب صحيح يُقبل كمعلّق", j.ok === true && typeof j.pendingId === "string")
  ok("ب12 استطلاع الوكيل معلن (1.5ث)", j.pollAfterMs === 1500)
  const pendingId = j.pendingId
  let snap = await (await get("/api/devices/assist")).json()
  ok("ب13 الطلب مرئي للمالك باسمه", snap.pending?.name === "Aunt-Phone" && snap.pending?.model === "Galaxy A54")

  // 6) موافقة بمعرّف خاطئ → 404 (لا طلب مطابق)
  r = await post("/api/devices/assist", { action: "consent", pendingId: "deadbeef", accept: true })
  ok("ب14 معرّف طلب خاطئ → 404", r.status === 404)

  // 7) موافقة المالك → تسجيل + جلسة نشطة
  r = await post("/api/devices/assist", { action: "consent", pendingId, accept: true })
  j = await r.json()
  ok("ب15 القبول يفتح جلسة", j.state === "accepted" && j.session?.via === "short-code")
  const deviceId = j.device?.id
  ok("ب16 الجهاز مسجل متصلًا", j.device?.state === "connected" && !!deviceId)
  j = await (await get("/api/devices")).json()
  const dev = j.devices.find((x) => x.id === deviceId)
  ok("ب17 الجهاز في السجل باسمه وIP الصحيح", !!dev && dev.name === "Aunt-Phone" && dev.ip === "192.168.1.77")

  // 8) حالة سطح المكتب تعرض الجلسة (اللافتة الحمراء وRust يقرؤها)
  j = await (await get("/api/desktop/status")).json()
  ok("ب18 status.desktop.assist يعرض الجلسة", j.desktop?.assist?.session?.deviceName === "Aunt-Phone")

  // 9) قطع بضغطة → إبطال الاقتران (offline + غير موثوق) وطي الجلسة
  r = await post("/api/devices/assist", { action: "cut" })
  j = await r.json()
  ok("ب19 القطع ينجح باسم الجهاز", j.ok === true && j.cut === "Aunt-Phone")
  j = await (await get("/api/devices")).json()
  const cut = j.devices.find((x) => x.id === deviceId)
  ok("ب20 الجهاز مقطوع وغير موثوق", cut && cut.state === "offline" && cut.trusted === false)
  j = await (await get("/api/devices/assist")).json()
  ok("ب21 الجلسة طُوت بعد القطع", !j.session && !j.pending)
  j = await (await get("/api/desktop/status")).json()
  ok("ب22 status يسقط الجلسة بعد القطع", j.desktop?.assist?.session === null)

  // 10) مسار الرفض: طلب جديد → رفض صريح → لا جهاز ولا جلسة
  r = await post("/api/devices/assist", { action: "request", assistCode: CODE, name: "Stranger-Phone", kind: "phone", ip: "192.168.1.99" })
  j = await r.json()
  const pid2 = j.pendingId
  ok("ب23 طلب ثانٍ يُقبل كمعلّق", j.ok === true)
  r = await post("/api/devices/assist", { action: "consent", pendingId: pid2, accept: false })
  j = await r.json()
  ok("ب24 الرفض صريح وطيّ الطلب", j.ok === true && j.state === "denied")
  j = await (await get("/api/devices")).json()
  ok("ب25 لا جهاز «Stranger-Phone» في السجل", !j.devices.some((x) => x.name === "Stranger-Phone"))
  j = await (await get("/api/devices/assist")).json()
  ok("ب26 لا جلسة بعد الرفض", !j.session)
}

/* ───────────────────────── التقرير ───────────────────────── */
const total = pass + fail
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
console.log(`assist-e2e — بوابة المساعدة عن بعد (عقد §46)`)
console.log(`النتيجة: ${pass}/${total} فحصًا أخضر — ${fail === 0 ? "✅ أخضر" : "❌ أحمر"}`)
if (fail) process.exit(1)
process.exit(0)
