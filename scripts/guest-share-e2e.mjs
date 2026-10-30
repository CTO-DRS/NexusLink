#!/usr/bin/env node
// NexusLink — المشاركة الضيوفة المباشرة (عقد §51) — guest-share-e2e
// ============================================================
// الطور أ (نقي): الرموز والبصمات والمقارنة زمن-ثابت + حدود التهيئة (5–120 دقيقة
//   وحدود الملفات) + تفعيل الحالة وانتهاؤها + تنقية الأسماء + محدد المعدل
//   المنزلق + حارس المحاولات + MIME + صفحة الاستقبال (RTL/صفر موارد خارجية).
// الطور ب (حي): دورة كاملة — إدارة loopback-only → إرسال بمتصفح (تنزيل بايتات
//   حقيقية) → استقبال من ضيف (رفع فعلي إلى الصندوق) → الأخطاء الصادقة (رمز
//   خاطئ/منتهٍ/وضع خاطئ) → القفل بعد المحاولات → تدوير وتعطيل فوري.
// الاستخدام:
//   node scripts/guest-share-e2e.mjs                     (طور أ حصرًا)
//   node scripts/guest-share-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e50-live
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
  newGuestToken, guestFingerprint, guestTokenEqual, validateGuestConfig, isGuestActive,
  sanitizeGuestName, createRateLimiter, createFailGuard, mimeFromName, guestPageHtml,
  GUEST_TTL_MIN, GUEST_TTL_MAX, GUEST_MAX_FILES, GUEST_MAX_FILE_BYTES,
} = await import("../src/lib/nexus/guest-core.ts")

const T0 = 1_700_000_000_000

// أ1–أ4 — الرمز والبصمة والمقارنة
const t1 = newGuestToken()
const t2 = newGuestToken()
ok("أ1 الرمز 32 محرفًا بلا غموض طباعي", t1.length === 32 && /^[A-Za-z0-9\-_]+$/.test(t1))
ok("أ2 رمزان متتاليان مختلفان", t1 !== t2)
ok("أ3 البصمة 16 سداسي حتمية ومتمايزة", /^[0-9a-f]{16}$/.test(guestFingerprint(t1)) && guestFingerprint(t1) === guestFingerprint(t1) && guestFingerprint(t1) !== guestFingerprint(t2))
ok("أ4 مقارنة زمن-ثابت: تطابق/اختلاف/طول", guestTokenEqual(t1, t1) === true && guestTokenEqual(t1, t2) === false && guestTokenEqual(t1, t1.slice(0, 8)) === false)

// أ5–أ8 — تهيئة الحدود
ok("أ5 send/30 دقيقة صالح", validateGuestConfig({ mode: "send", ttlMinutes: 30 }).ok === true)
ok(`أ6 الحدان شاملان (${GUEST_TTL_MIN} و${GUEST_TTL_MAX})`, validateGuestConfig({ mode: "drop", ttlMinutes: GUEST_TTL_MIN }).ok === true && validateGuestConfig({ mode: "drop", ttlMinutes: GUEST_TTL_MAX }).ok === true)
ok("أ7 TTL أقل/أعلى/عائم → رفض", validateGuestConfig({ mode: "send", ttlMinutes: 4 }).error === "invalid-ttl" && validateGuestConfig({ mode: "send", ttlMinutes: 121 }).error === "invalid-ttl" && validateGuestConfig({ mode: "send", ttlMinutes: 30.5 }).error === "invalid-ttl")
ok("أ8 وضع غريب وكثرة ملفات → رفض", validateGuestConfig({ mode: "x", ttlMinutes: 30 }).error === "invalid-mode" && validateGuestConfig({ mode: "send", ttlMinutes: 30, fileCount: GUEST_MAX_FILES + 1 }).error === "too-many-files")

// أ9–أ11 — تفعيل الحالة وانتهاؤها
const st = { token: t1, fingerprint: guestFingerprint(t1), mode: "send", expiresAt: T0 + 60_000, label: "", files: [], createdAt: T0 }
ok("أ9 حالة حية برمز سليم ولم تنتهِ", isGuestActive(st, T0) === true)
ok("أ10 المنتهي والمعدوم والقصير كلها غير حية", isGuestActive({ ...st, expiresAt: T0 - 1 }, T0) === false && isGuestActive(null, T0) === false && isGuestActive({ ...st, token: "قصير" }, T0) === false)
ok("أ11 الحد الأقصى للملف 200MB معلن", GUEST_MAX_FILE_BYTES === 200 * 1024 * 1024)

// أ12–أ14 — تنقية الأسماء
ok("أ12 اجتياز المسارات يُسقط للاسم الأخير", sanitizeGuestName("../../etc/passwd") === "passwd" && sanitizeGuestName("a/b/c.txt") === "c.txt")
ok("أ13 الخداع بالنقاط والمخفي يُستبدل", sanitizeGuestName("..evil").startsWith("ملف-") === true && sanitizeGuestName("").startsWith("ملف-") === true)
ok("أ14 محارف التحكم تُقطع والطول ≤ 120", sanitizeGuestName("ok\u0000name.txt") === "okname.txt" && sanitizeGuestName("x".repeat(500)).length === 120)

// أ15–أ16 — محدد المعدل وحارس المحاولات
const rl = createRateLimiter({ max: 3, windowMs: 60_000 })
ok("أ15 معدل: 3 تمر ثم رفض ثم تُفتح النافذة", rl.hit("k", T0) && rl.hit("k", T0 + 1) && rl.hit("k", T0 + 2) && rl.hit("k", T0 + 3) === false && rl.hit("k", T0 + 60_001) === true)
const fg = createFailGuard({ after: 3, lockMs: 60_000 })
ok("أ16 حارس المحاولات: قفل بعد العتبة وتصفيره", fg.fail("i", T0).count === 1 && fg.fail("i", T0 + 1).locked === false && fg.fail("i", T0 + 2).locked === true && fg.locked("i", T0 + 30_000) === true && fg.locked("i", T0 + 61_000) === false && (fg.clear("i"), fg.locked("i", T0 + 1) === false))

// أ17–أ18 — MIME
ok("أ17 MIME معروف", mimeFromName("تقرير.pdf") === "application/pdf" && mimeFromName("صورة.PNG") === "image/png")
ok("أ18 MIME المجهول = octet-stream", mimeFromName("ملف.غريب") === "application/octet-stream")

// أ19–أ22 — صفحة الاستقبال
const page = guestPageHtml({ mode: "send", lang: "ar", files: [{ name: "عقد.pdf", size: 3_145_728 }], actionPath: "/api/guest/xfer?g=TOKEN", label: "من الكمبيوتر" })
ok("أ19 الصفحة RTL عربية بعنوان NexusLink", page.includes('dir="rtl"') && page.includes("NexusLink") && page.includes("عقد.pdf"))
ok("أ20 صفر موارد خارجية (بلا http خارجي)", !/src=["']https?:|href=["']https?:/.test(page))
ok("أ21 صفحة الإرسال تحمل روابط تنزيل مرقمة", page.includes("&d=0"))
const drop = guestPageHtml({ mode: "drop", lang: "en", files: [], actionPath: "/api/guest/xfer?g=TOKEN", label: "" })
ok("أ22 صفحة الاستقبال نموذج رفع multipart وLTR", drop.includes("multipart/form-data") && drop.includes('dir="ltr"') && drop.includes("Send to device"))
ok("أ23 صفحة الانتهاء صادقة ثنائية", guestPageHtml({ mode: "send", lang: "ar", files: [], actionPath: "?g=x", label: "", expired: true }).includes("انتهت صلاحية المشاركة"))

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/guest-share-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const base = APP.replace(/\/$/, "")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const GUEST = path.join(LIVE_DIR, "guest-share.json")
  fs.mkdirSync(LIVE_DIR, { recursive: true })
  const get = async (p) => { const r = await fetch(base + p, { cache: "no-store" }); return { status: r.status, ct: r.headers.get("content-type") ?? "", cd: r.headers.get("content-disposition") ?? "", body: Buffer.from(await r.arrayBuffer()) } }
  const getJson = async (p) => { const r = await get(p); try { return { status: r.status, j: JSON.parse(r.body.toString("utf8")) } } catch { return { status: r.status, j: null } } }
  const postJson = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const writeState = (obj) => fs.writeFileSync(GUEST, JSON.stringify(obj, null, 2))
  const TOKEN = "e51-" + "g".repeat(28)
  const FUT = Date.now() + 30 * 60_000

  // ب1 — إدارة من عنوان خارجي (انتحال ترويسة البوابة) → 403
  let r = await postJson("/api/guest/share", { action: "enable", mode: "drop", ttlMinutes: 30 }, { "x-gw-client-ip": "10.0.0.9" })
  ok("ب1 الإدارة من خارج الجهاز → 403 (نمط §37)", r.status === 403 && r.j?.error === "guest-admin-loopback-only")

  // ب2 — تهيئة خاطئة → 400 صادق
  r = await postJson("/api/guest/share", { action: "enable", mode: "drop", ttlMinutes: 2 })
  ok("ب2 TTL أقل من الأدنى → 400 invalid-ttl", r.status === 400 && r.j?.error === "invalid-ttl")

  // ب3 — تمكين وضع الاستقبال: رمز يُسلَّم مرة واحدة
  r = await postJson("/api/guest/share", { action: "enable", mode: "drop", ttlMinutes: 30, label: "أرسل لي المستندات" })
  const tok = r.j?.token
  ok("ب3 enable drop: رمز وبصمة وصلاحية", r.status === 200 && typeof tok === "string" && tok.length >= 16 && typeof r.j.fingerprint === "string" && r.j.expiresAt > Date.now())

  // ب4 — تعارض التمكين → 409 والتدوير يعمل برمز جديد
  r = await postJson("/api/guest/share", { action: "enable", mode: "drop", ttlMinutes: 30 })
  ok("ب4 تمكين وهو مفعل → 409 already-enabled", r.status === 409 && r.j?.error === "already-enabled")
  const rRot = await postJson("/api/guest/share", { action: "rotate", mode: "drop", ttlMinutes: 15 })
  ok("ب5 rotate: رمز جديد يختلف وبصمة جديدة", rRot.status === 200 && rRot.j.token !== tok && typeof rRot.j.fingerprint === "string")

  // ب6 — GET الإدارة لا يعيد الرمز الخام أبدًا
  r = await getJson("/api/guest/share")
  ok("ب6 GET الإدارة: enabled بلا رمز خام", r.j?.enabled === true && !JSON.stringify(r.j).includes(rRot.j.token))

  // ب7 — صفحة الاستقبال (drop) بعلامة حية
  r = await get(`/api/guest/xfer?g=${encodeURIComponent(rRot.j.token)}`)
  ok("ب7 صفحة الضيف: HTML عربي RTL بنموذج رفع", r.status === 200 && r.ct.includes("text/html") && r.body.toString("utf8").includes("إرسال إلى الجهاز") && r.body.toString("utf8").includes('dir="rtl"'))

  // ب8/ب9 — رفع فعلي من الضيف إلى الصندوق
  const fd = new FormData()
  fd.append("file", new File([Buffer.from(`محتوى ضيف ${Date.now()}`)], "e51-up.txt"), "e51-up.txt")
  const up = await fetch(base + `/api/guest/xfer?g=${encodeURIComponent(rRot.j.token)}`, { method: "POST", body: fd })
  const upJ = await up.json().catch(() => null)
  ok("ب8 رفع الضيف: ok باسم مضفّر وحجم", up.status === 200 && upJ?.ok === true && upJ.saved?.[0]?.size > 0 && upJ.saved[0].name.includes("e51-up.txt"))
  r = await getJson("/api/guest/share?list=inbox")
  ok("ب9 صندوق الاستقبال يظهر الملف", (r.j?.inbox ?? []).some((x) => x.name.includes("e51-up.txt")))

  // ب10 — الرفع في وضع الإرسال مرفوض (405)
  writeState({ token: TOKEN, fingerprint: "x", mode: "send", expiresAt: FUT, label: "", files: [], createdAt: Date.now() })
  const fd2 = new FormData()
  fd2.append("file", new File([Buffer.from("x")], "y.txt"), "y.txt")
  const up2 = await fetch(base + `/api/guest/xfer?g=${encodeURIComponent(TOKEN)}`, { method: "POST", body: fd2 })
  ok("ب10 رفع في وضع send → 405 send-mode-readonly", up2.status === 405)

  // ب11/ب12 — وضع الإرسال: ملف حقيقي وتنزيل بايتات مطابقة
  const dlDir = path.join(process.cwd(), "data", "pc-fs", "Downloads")
  fs.mkdirSync(dlDir, { recursive: true })
  const samplePath = path.join(dlDir, "e51-sample.txt")
  const SAMPLE = Buffer.from("محتوى عقد E51 للمشاركة الضيوفة — بايتات حقيقية")
  fs.writeFileSync(samplePath, SAMPLE)
  writeState({ token: TOKEN, fingerprint: "x", mode: "send", expiresAt: FUT, label: "مستندات الاجتماع", files: [{ name: "e51-sample.txt", size: SAMPLE.length, absPath: samplePath }], createdAt: Date.now() })
  r = await get(`/api/guest/xfer?g=${encodeURIComponent(TOKEN)}`)
  ok("ب11 صفحة الإرسال تعرض الملف", r.status === 200 && r.body.toString("utf8").includes("e51-sample.txt") && r.body.toString("utf8").includes("مستندات الاجتماع"))
  r = await get(`/api/guest/xfer?g=${encodeURIComponent(TOKEN)}&d=0`)
  ok("ب12 التنزيل: بايتات مطابقة + مرفق", r.status === 200 && Buffer.compare(r.body, SAMPLE) === 0 && r.cd.includes("attachment"))

  // ب13 — فهرس خارج القائمة → 404
  r = await get(`/api/guest/xfer?g=${encodeURIComponent(TOKEN)}&d=9`)
  ok("ب13 فهرس غائب → 404", r.status === 404)

  // ب14/ب15 — رمز خاطئ ومفقود → 403 (وعدّاد المحاولات يعمل)
  r = await get(`/api/guest/xfer?g=wrong-token-wrong-token-wrong-token`)
  ok("ب14 رمز خاطئ → 403 صفحة صادقة", r.status === 403)
  r = await get(`/api/guest/xfer`)
  ok("ب15 بلا رمز → 403", r.status === 403)

  // ب16 — الانتهاء → 410 بصفحة صادقة
  writeState({ token: TOKEN, fingerprint: "x", mode: "send", expiresAt: Date.now() - 1_000, label: "", files: [], createdAt: Date.now() })
  r = await get(`/api/guest/xfer?g=${encodeURIComponent(TOKEN)}`)
  ok("ب16 منتهٍ → 410 (انتهت صلاحية المشاركة)", r.status === 410 && r.body.toString("utf8").includes("انتهت صلاحية المشاركة"))

  // ب17 — القفل بعد محاولات خاطئة متتالية (نمط بوابة §37) — على حالة حية
  writeState({ token: TOKEN, fingerprint: "x", mode: "send", expiresAt: FUT, label: "", files: [], createdAt: Date.now() })
  let saw429 = false
  for (let i = 0; i < 12; i++) {
    const rr = await fetch(base + `/api/guest/xfer?g=bad-${i}`)
    if (rr.status === 429) { saw429 = true; break }
  }
  ok("ب17 محاولات خاطئة متتالية → قفل 429", saw429)

  // ب18 — تعطيل فوري: الرمز يموت لحظة الحذف (404)
  writeState({ token: TOKEN, fingerprint: "x", mode: "send", expiresAt: FUT, label: "", files: [], createdAt: Date.now() })
  r = await postJson("/api/guest/share", { action: "disable" })
  ok("ب18 disable: enabled=false", r.j?.ok === true && r.j.enabled === false)
  r = await get(`/api/guest/xfer?g=${encodeURIComponent(TOKEN)}`)
  ok("ب19 بعد التعطيل: الرمز ميت 404", r.status === 404)

  // ب20 — سجل §39 يحمل أفعال الضيف (أسماء وأحجام حصرًا)
  r = await getJson("/api/enterprise/audit?limit=300")
  const kinds = new Set((r.j?.events ?? []).map((e) => e.k))
  ok("ب20 سجل §39: أفعال guest موثقة", kinds.has("guest.enable") && kinds.has("guest.upload") && kinds.has("guest.download") && kinds.has("guest.admin.denied"), `guest kinds=${[...kinds].filter((k) => k.startsWith("guest")).join(",")}`)

  // ب21 — التنظيف: الصندوق يُفرّغ (idempotent)
  r = await postJson("/api/guest/share", { action: "inbox-clear" })
  ok("ب21 تفريغ الصندوق يعمل", r.j?.ok === true)
  r = await getJson("/api/guest/share?list=inbox")
  ok("ب22 الصندوق فارغ بعد التفريغ", (r.j?.inbox ?? []).length === 0)
}

console.log(`\n═══ §51 guest-share-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
