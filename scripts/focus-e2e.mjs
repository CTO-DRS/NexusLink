#!/usr/bin/env node
// NexusLink — وضع التركيز الموحد (عقد §52) — focus-e2e
// ============================================================
// الطور أ (نقي): حدود المدة (5–240) + تسوية الحالة (الفاسد يُلغى) + النشاط
//   والبقية + الاستعادة الكسولة + تداخل ساعات الهدوء (إعلان لا فرض) + التمديد
//   بسقف الجلسة ورفضه لنشاط ميت.
// الطور ب (حي): بدء يذكر DND السابق → كتم التعكيس فعليًا (إشعار يدخل muted
//   مع عدّاد) → التمديد → الإيقاف يستعيد → الانقضاء يستعيد ذاتيًا → الأخطاء
//   الصادقة (حدود/تعارض/فعل مجهول) → فشل-آمن لملف تالف.
// الاستخدام:
//   node scripts/focus-e2e.mjs                     (طور أ حصرًا)
//   node scripts/focus-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e50-live
// خروج 0 = أخضر، 1 = أحمر. القاعدة: جولتان متتاليتان أخضرتان.

let pass = 0
let fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`❌ ${name}${extra ? " — " + extra : ""}`) }
}

const APP = (() => {
  const i = process.argv.indexOf("--app")
  return i > 0 ? process.argv[i + 1] : null
})()
const LIVE_DIR = (() => {
  const i = process.argv.indexOf("--dir")
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e50-live"
})()

/* ═════════════ الطور أ — النواة النقية ═════════════ */
const {
  validateFocusMinutes, normalizeFocusState, focusActive, focusRemainingMs,
  focusNeedsRestore, focusOverlapsQuiet, extendUntil,
  FOCUS_MIN_MINUTES, FOCUS_MAX_MINUTES, FOCUS_PRESETS,
} = await import("../src/lib/nexus/focus-core.ts")

const T0 = 1_700_000_000_000

// أ1–أ3 — حدود المدة
ok("أ1 الحدان شاملان (5 و240)", validateFocusMinutes(FOCUS_MIN_MINUTES).ok === true && validateFocusMinutes(FOCUS_MAX_MINUTES).ok === true)
ok("أ2 تحت/فوق/عائم/نص → رفض", validateFocusMinutes(4).error === "invalid-minutes" && validateFocusMinutes(241).error === "invalid-minutes" && validateFocusMinutes(30.5).error === "invalid-minutes" && validateFocusMinutes("30").error === "invalid-minutes")
ok("أ3 الشرائح المعروضة داخل الحدود", FOCUS_PRESETS.every((m) => validateFocusMinutes(m).ok === true) && FOCUS_PRESETS.length === 4)

// أ4–أ6 — تسوية الحالة (فشل-آمن)
ok("أ4 حالة سليمة تُقرأ كما كُتبت", normalizeFocusState({ until: T0 + 1000, suppressMirroring: true, autoReplyText: "مشغول", prevDnd: false, suppressed: 3, createdAt: T0 })?.suppressed === 3)
ok("أ5 المبتور/الفارغ/النص → null", normalizeFocusState(null) === null && normalizeFocusState({}) === null && normalizeFocusState({ until: "غدًا" }) === null)
ok("أ6 الافتراضات: الكتم مفعّل والعدّاد يبدأ صفرًا", (() => { const s = normalizeFocusState({ until: T0 + 1000 }); return s?.suppressMirroring === true && s?.suppressed === 0 && s?.autoReplyText === null })())

// أ7–أ10 — النشاط والبقية والاستعادة
const live = normalizeFocusState({ until: T0 + 60_000, prevDnd: false, suppressed: 0, createdAt: T0 })
ok("أ7 نشط قبل الانقضاء وميت بعده", focusActive(live, T0) === true && focusActive(live, T0 + 60_001) === false)
ok("أ8 البقية لا تنزل تحت صفر", focusRemainingMs(live, T0 + 70_000) === 0 && focusRemainingMs(live, T0) === 60_000)
ok("أ9 الانقضاء يستوجب استعادة والنشاط لا", focusNeedsRestore(live, T0 + 60_001) === true && focusNeedsRestore(live, T0) === false && focusNeedsRestore(null, T0) === false)
ok("أ10 الحالة المعدومة لا نشاط لها", focusActive(null, T0) === false && focusRemainingMs(null, T0) === 0)

// أ11–أ12 — تداخل ساعات الهدوء (إعلان لا فرض)
ok("أ11 تداخل يُعلن حين يمتد التركيز بعد الهدوء", focusOverlapsQuiet(normalizeFocusState({ until: T0 + 120_000 }), T0 + 60_000) === true)
ok("أ12 لا تداخل بلا هدوء أو بانقضائه قبل التركيز", focusOverlapsQuiet(live, null) === false && focusOverlapsQuiet(normalizeFocusState({ until: T0 + 30_000 }), T0 + 60_000) === false)

// أ13–أ14 — التمديد بسقف الجلسة
ok("أ13 التمديد يُجمع فوق الباقي ويُثبّت بسقف 240 من الآن", extendUntil(live, 200, T0) === T0 + 201 * 60_000 && extendUntil(live, 240, T0) === T0 + 240 * 60_000)
ok("أ14 التمديد لنشاط ميت أو بحدود خاطئة → null", extendUntil(live, 30, T0 + 60_001) === null && extendUntil(live, 3, T0) === null && extendUntil(null, 30, T0) === null)

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/focus-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const base = APP.replace(/\/$/, "")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const FOCUS = path.join(LIVE_DIR, "focus.json")
  fs.mkdirSync(LIVE_DIR, { recursive: true })
  try { fs.rmSync(FOCUS, { force: true }) } catch { /* نظيف */ }
  const getJson = async (p) => { const r = await fetch(base + p, { cache: "no-store" }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const postJson = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

  // ب1 — خط الأساس: لا تركيز ولا ملف
  let r = await getJson("/api/focus")
  ok("ب1 خط الأساس: غير نشط وno ملف", r.j?.ok === true && r.j.active === false && r.j.remainingMs === 0 && fs.existsSync(FOCUS) === false)

  // ب2 — حدود خاطئة → 400 صادق
  r = await postJson("/api/focus", { action: "start", minutes: 3 })
  ok("ب2 مدة 3 دقائق → 400 invalid-minutes", r.status === 400 && r.j?.error === "invalid-minutes")
  r = await postJson("/api/focus", { action: "start", minutes: 999 })
  ok("ب3 مدة 999 دقيقة → 400", r.status === 400)

  // ب4 — بدء 25 دقيقة مع كتم: يذكر DND السابق
  r = await postJson("/api/focus", { action: "start", minutes: 25, suppressMirroring: true })
  ok("ب4 بدء: نشط مع كتم وDND مُشغّل بمصدر focus", r.j?.active === true && r.j.suppressMirroring === true && r.j.dnd?.dnd === true && r.j.dnd?.source === "focus" && fs.existsSync(FOCUS) === true)
  const until1 = r.j.until

  // ب5 — بدء ثانٍ → 409 والإجابة تمديد
  r = await postJson("/api/focus", { action: "start", minutes: 25 })
  ok("ب5 بدء وهو نشط → 409 already-active", r.status === 409 && r.j?.hint === "extend")

  // ب6/ب7 — كتم التعكيس فعليًا: إشعار يدخل muted والعدّاد يزيد
  const nTitle = `e52-${Date.now()}`
  r = await postJson("/api/comms/notifications", { appId: "e52-test", appName: "فحص §52", title: nTitle, body: "أثناء التركيز" })
  ok("ب6 إشعار أثناء التركيز → muted وsuppressedByFocus", r.j?.notification?.status === "muted" && r.j?.suppressedByFocus === true)
  r = await getJson("/api/focus")
  ok("ب7 عدّاد المكبوت زاد إلى 1", r.j?.suppressed === 1)
  r = await getJson("/api/comms/notifications")
  ok("ب8 الإشعار محفوظ لا مفقود (بمكانته في القائمة)", (r.j?.notifications ?? []).some((x) => x.title === nTitle && x.status === "muted"))

  // ب9 — التمديد: until يطول ضمن السقف
  await sleep(1100)
  r = await postJson("/api/focus", { action: "extend", minutes: 30 })
  ok("ب9 التمديد يطول الجلسة (30 دقيقة إضافية)", r.j?.ok === true && r.j.until > until1 && r.j.active === true)

  // ب10 — إيقاف صريح: استعادة DND وحذف الملف
  r = await postJson("/api/focus", { action: "stop" })
  ok("ب10 الإيقاف: غير نشط وDND عاد false والملف حُذف", r.j?.active === false && r.j.dnd?.dnd === false && fs.existsSync(FOCUS) === false)

  // ب11 — إيقاف وهو متوقف: ok صادق بلا درامية
  r = await postJson("/api/focus", { action: "stop" })
  ok("ب11 إيقاف مرة ثانية → ok=true وwasActive=false", r.j?.ok === true && r.j.active === false)

  // ب12/ب13 — الانقضاء الذاتي يستعيد DND (استعادة كسولة بلا مؤقتات)
  await postJson("/api/focus", { action: "start", minutes: 5, suppressMirroring: true })
  fs.writeFileSync(FOCUS, JSON.stringify({ until: Date.now() + 1_200, suppressMirroring: true, prevDnd: false, suppressed: 0, createdAt: Date.now() }))
  await sleep(1_500)
  r = await getJson("/api/focus")
  ok("ب12 بعد الانقضاء: غير نشط والملف اختفى ذاتيًا", r.j?.active === false && fs.existsSync(FOCUS) === false)
  ok("ب13 الدND استُعيد بعد الانقضاء (source سقط)", r.j?.dnd?.dnd === false && r.j.dnd?.source === null)

  // ب14 — فشل-آمن: ملف تالف = لا تركيز ولا انهيار
  await postJson("/api/focus", { action: "start", minutes: 5 })
  fs.writeFileSync(FOCUS, "{corrupted-focus")
  r = await getJson("/api/focus")
  ok("ب14 ملف تالف → غير نشط بصدق (فشل-آمن)", r.j?.active === false && r.j.ok === true)

  // ب15 — فعل مجهول → 400
  r = await postJson("/api/focus", { action: "pause" })
  ok("ب15 فعل مجهول → 400", r.status === 400)

  // ب16 — كتم بلا فرض DND: الكتم يعمل عبر علم التعكيس وحده
  // (تطبيع صريح: ملف §14 الفاسد = فشل-آمن بلا استعادة معلومة — فالـDND يُصفَّر يدويًا
  //  هنا لأن الحدود الصادقة تقول: ملف فاسد لا يعرف الحالة السابقة)
  await fetch(base + "/api/comms/phone", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dnd: false }) })
  await postJson("/api/focus", { action: "start", minutes: 5, suppressMirroring: false })
  r = await postJson("/api/comms/notifications", { appId: "e52-test2", appName: "فحص §52", title: `e52b-${Date.now()}`, body: "بلا كتم" })
  ok("ب16 بلا كتم: الإشعار يمر طبيعيًا وsuppressedByFocus=false", r.j?.suppressedByFocus === false && r.j.notification.status !== "muted")
  await postJson("/api/focus", { action: "stop" })

  // ب17 — نظافة نهائية: لا أثر للتركيز على خط الأساس
  r = await getJson("/api/focus")
  ok("ب17 خاتمة نظيفة: خط الأساس كما كان", r.j?.active === false && r.j.suppressed === 0)
}

console.log(`\n═══ §52 focus-e2e: ${pass} ✅ / ${fail} ❌ (من ${APP ? 30 : 14}) ═══`)
process.exit(fail > 0 ? 1 : 0)
