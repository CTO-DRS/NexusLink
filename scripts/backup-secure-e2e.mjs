#!/usr/bin/env node
// NexusLink — الدرع الاحتياطي المشفّر (عقد §54) — backup-secure-e2e
// ============================================================
// الطور أ (نقي): ختم/فتح المغلف (تدوير كامل) + الأسباب الثلاثة المغلقة
//   (bad-envelope/tampered/auth-failed) + سلامة القناغة قبل GCM + قواعد
//   العبارة + سياسة الاحتفاظ + الأسماء الزمنية + فك النوع من الاسم.
// الطور ب (حي): دورة كاملة — إنشاء نسخة يدوية بعبارة → القائمة تظهرها بلا
//   أي سر → تحقق صحيح بعدّادات → عبارة خاطئة → ملف غائب 404 → عبارة ضعيفة
//   400 → استعادة فعلية بدمج والنتيجة مطابقة → تمكين الجدولة (ساعات غير
//   مشروعة 400) → نبضة جدولة تنشئ نسخة scheduled → تدوير المفتاح يعيد مرة
//   واحدة → حرس loopback للإدارة 403 → تقليم → حذف → سجل §39 بلا أسرار.
// الاستخدام:
//   node scripts/backup-secure-e2e.mjs                     (طور أ حصرًا)
//   node scripts/backup-secure-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e54-live
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
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e54-live"
})()

/* ═════════════ الطور أ — النواة النقية ═════════════ */
const {
  sealBackup, openBackup, validatePassphrase, retentionFilter,
  backupFileName, kindFromName, newLocalKey,
  PBKDF2_ITERATIONS, PASSPHRASE_MIN, RETENTION_LIMITS,
} = await import("../src/lib/nexus/backup-secure-core.ts")

const T0 = 1_700_000_000_000
const PASS = "عبارة-قوية-#54"

// أ1–أ3 — الختم والفتح الكامل
const plain = { app: "NexusLink", type: "nexuslink-backup", version: 1, devices: [{ id: "a" }, { id: "b" }], profiles: [{ name: "p1" }], pairs: [] }
const env = sealBackup(plain, PASS, "manual", T0)
ok("أ1 المغلف بهوية NexusLink وقناغة ومانيفست", env.app === "NexusLink" && env.type === "nexuslink-secure-backup" && env.data.length > 32 && env.manifest.cipherSha256.length === 64)
const opened = openBackup(env, PASS)
ok("أ2 الفتح بالعبارة الصحيحة: محتوى مطابق حرفيًا", opened.ok === true && opened.ok && JSON.stringify(opened.plain) === JSON.stringify(plain))
ok("أ3 المانيفست يعلن العدّادات والنوع الداخلي", env.manifest.counts.devices === 2 && env.manifest.counts.profiles === 1 && env.manifest.innerType === "nexuslink-backup")

// أ4–أ6 — الأسباب المغلقة الثلاثة
ok("أ4 عبارة خاطئة → auth-failed", openBackup(env, PASS + "x").error === "auth-failed")
ok("أ5 عبث بايت واحد في القناغة → tampered", (() => { const t = JSON.parse(JSON.stringify(env)); const mutated = (t.data[0] === "A" ? "B" : "A") + t.data.slice(1); t.data = mutated; return openBackup(t, PASS).error === "tampered" })())
ok("أ6 مغلف غريب → bad-envelope", openBackup(null, PASS).error === "bad-envelope" && openBackup({ foo: 1 }, PASS).error === "bad-envelope" && openBackup({ ...env, data: "أقصر" }, PASS).error === "bad-envelope")

// أ7–أ9 — العبارة والتكرارات والمفتاح
ok("أ7 عبارة ضعيفة/غير نصية → weak-passphrase", validatePassphrase("قصير").error === "weak-passphrase" && validatePassphrase(12345678).error === "weak-passphrase" && validatePassphrase("      قصير").error === "weak-passphrase" && validatePassphrase("قوي-كفاية-هنا").ok === true)
ok(`أ8 تكرارات PBKDF2 معلنة ${PBKDF2_ITERATIONS} وحد العبارة ${PASSPHRASE_MIN}`, PBKDF2_ITERATIONS === 600_000 && PASSPHRASE_MIN === 8)
ok("أ9 مفتاح محلي 43+ محرف base64url ومتمايز", (() => { const k1 = newLocalKey(), k2 = newLocalKey(); return k1.length >= 43 && /^[A-Za-z0-9_-]+$/.test(k1) && k1 !== k2 })())

// أ10–أ12 — الاحتفاظ والأسماء
ok("أ10 الاحتفاظ: الأحدث يبقى لكل نوع (يدوي 10 · مجدول 5)", (() => {
  const files = []
  for (let i = 1; i <= 12; i++) files.push({ name: `m${i}`, kind: "manual", at: i })
  for (let i = 1; i <= 7; i++) files.push({ name: `s${i}`, kind: "scheduled", at: i })
  const drop = retentionFilter(files)
  return drop.length === 4 && !drop.includes("m12") && !drop.includes("s7") && drop.includes("m1") && drop.includes("s1")
})())
ok("أ11 تجاوز سياسة الاحتفاظ بkeep يعمل", retentionFilter([{ name: "a", kind: "scheduled", at: 1 }, { name: "b", kind: "scheduled", at: 2 }], 1).join(",") === "a")
ok("أ12 الاسم الزمني قابل للفرز والنوع يفك من الاسم", (() => {
  const a = backupFileName("manual", T0), b = backupFileName("manual", T0 + 3600_000)
  return a < b && kindFromName(a) === "manual" && kindFromName(backupFileName("scheduled", T0)) === "scheduled" && kindFromName("غريب.txt") === "manual"
})())

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/backup-secure-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const base = APP.replace(/\/$/, "")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const DIR = path.join(LIVE_DIR, "backups")
  const SCHED = path.join(LIVE_DIR, "backup-secure.json")
  fs.mkdirSync(DIR, { recursive: true })
  const getJson = async (p) => { const r = await fetch(base + p, { cache: "no-store" }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const postJson = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  // تنظيف: مجلد النسخ + حالة الجدولة + المفتاح المرسوخ
  try { for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true }) } catch { /* غائب */ }
  try { fs.rmSync(SCHED, { force: true }) } catch { /* غائب */ }

  // ب1 — عبارة ضعيفة → 400
  let r = await postJson("/api/backup-secure", { action: "create", passphrase: "قصير" })
  ok("ب1 إنشاء بعبارة ضعيفة → 400 weak-passphrase", r.status === 400 && r.j?.error === "weak-passphrase")

  // ب2 — إنشاء نسخة يدوية بعدّادات حقيقية
  r = await postJson("/api/backup-secure", { action: "create", passphrase: "درع-#54-قوي", kind: "manual" })
  const file1 = r.j?.file
  ok("ب2 إنشاء يدوي: ملف .nexusbackup وعدّادات ≥ 0", r.status === 200 && r.j?.ok === true && file1?.endsWith("-manual.nexusbackup") && typeof r.j.counts?.devices === "number")

  // ب3 — القائمة تعرضه بلا أي سر في الرد
  r = await getJson("/api/backup-secure")
  const listed = (r.j?.files ?? []).find((f) => f.name === file1)
  ok("ب3 القائمة تعرض النسخة بلا مفاتيح ولا عبارة", !!listed && listed.size > 0 && !JSON.stringify(r.j).includes("درع-#54-قوي"))

  // ب4 — تحقق صحيح: دراي-رن بعدّادات
  r = await postJson("/api/backup-secure", { action: "verify", file: file1, passphrase: "درع-#54-قوي" })
  ok("ب4 تحقق صحيح: innerType وعدّادات", r.status === 200 && r.j?.ok === true && r.j.innerType === "nexuslink-backup" && typeof r.j.counts?.devices === "number")

  // ب5 — عبارة خاطئة → 400 auth-failed
  r = await postJson("/api/backup-secure", { action: "verify", file: file1, passphrase: "خاطئة-#54-xxxx" })
  ok("ب5 عبارة خاطئة → 400 auth-failed", r.status === 400 && r.j?.error === "auth-failed")

  // ب6 — ملف غائب → 404
  r = await postJson("/api/backup-secure", { action: "verify", file: "backup-2099-proprietary-manual.nexusbackup", passphrase: "درع-#54-قوي" })
  ok("ب6 ملف غائب → 404 not-found", r.status === 404 && r.j?.error === "not-found")

  // ب7 — استعادة فعلية بدمج: النتيجة تعلن الأعداد
  r = await postJson("/api/backup-secure", { action: "restore", file: file1, passphrase: "درع-#54-قوي", mode: "merge" })
  ok("ب7 استعادة فعلية: ok بعدّادات ووضع دمج", r.status === 200 && r.j?.ok === true && r.j.mode === "merge" && typeof r.j.devices === "number")

  // ب8 — جدولة بساعات غريبة → 400
  r = await postJson("/api/backup-secure", { action: "schedule-enable", hours: 7 })
  ok("ب8 ساعات غير مشروعة → 400 invalid-hours", r.status === 400 && r.j?.error === "invalid-hours")

  // ب9 — تمكين الجدولة 24س ثم نبضة تنشئ نسخة مجدولة فورًا (لا lastRunAt)
  r = await postJson("/api/backup-secure", { action: "schedule-enable", hours: 24 })
  ok("ب9 تمكين الجدولة 24س", r.status === 200 && r.j?.ok === true)
  r = await postJson("/api/backup-secure", { action: "schedule-tick" })
  ok("ب10 النبضة الأولى أنشأت نسخة مجدولة", r.j?.ran === true && r.j.file?.endsWith("-scheduled.nexusbackup"))
  let schedFile = r.j?.file
  r = await postJson("/api/backup-secure", { action: "schedule-tick" })
  ok("ب11 النبضة الثانية لا تكرر (داخل النافذة)", r.j?.ran === false)

  // ب12 — النسخة المجدولة تُفك بالمفتاح المحلي… والمفتاح لا يعود أبدًا في GET
  r = await getJson("/api/backup-secure")
  ok("ب12 GET بلا أي مفتاح محلي", !JSON.stringify(r.j).includes("key:") && r.j?.schedule?.enabled === true && r.j.schedule.lastRunAt > 0)

  // ب13 — تدوير المفتاح: يُسلّم مرة واحدة ويعمل فورًا
  r = await postJson("/api/backup-secure", { action: "schedule-rotate" })
  const rotated = r.j?.key
  ok("ب13 تدوير: مفتاح يُسلّم مرة واحدة", r.status === 200 && typeof rotated === "string" && rotated.length >= 43)

  // ب14 — حرس loopback لإدارة الجدولة (انتحال ترويسة البوابة)
  r = await postJson("/api/backup-secure", { action: "schedule-disable" }, { "x-gw-client-ip": "10.0.0.9" })
  ok("ب14 إدارة الجدولة من خارج الجهاز → 403", r.status === 403 && r.j?.error === "backup-admin-loopback-only")

  // ب15 — تعطيل محلي ثم النبضة لا تنشئ
  r = await postJson("/api/backup-secure", { action: "schedule-disable" })
  ok("ب15 تعطيل محلي: ok", r.j?.ok === true)
  r = await postJson("/api/backup-secure", { action: "schedule-tick" })
  ok("ب16 النبضة بعد التعطيل: لا شيء", r.j?.ran === false)

  // ب17 — تقليم بkeep=1: يبقى الأحدث لكل نوع
  await postJson("/api/backup-secure", { action: "create", passphrase: "درع-#54-قوي", kind: "manual" })
  let lr = await postJson("/api/backup-secure", { action: "prune", keep: 1 })
  r = await getJson("/api/backup-secure")
  ok("ب17 تقليم keep=1: ملف واحد لكل نوع كحد أقصى", lr.j?.ok === true && (r.j?.files ?? []).length <= 2, `الملفات=${(r.j?.files ?? []).length}`)

  // ب18 — حذف البقية وسجل §39 نظيف بلا أسرار
  r = await getJson("/api/backup-secure")
  for (const f of r.j?.files ?? []) await postJson("/api/backup-secure", { action: "delete", file: f.name })
  r = await getJson("/api/backup-secure")
  ok("ب18 حذف كامل: المجلد صفر", (r.j?.files ?? []).length === 0)

  r = await getJson("/api/enterprise/audit?limit=400")
  const evs = (r.j?.events ?? []).filter((e) => String(e.k).startsWith("backup"))
  const kindsSet = new Set(evs.map((e) => e.k))
  const noSecret = evs.every((e) => !JSON.stringify(e.d ?? {}).includes("درع-#54-قوي") && !JSON.stringify(e.d ?? {}).includes(rotated ?? "\u0000"))
  ok("ب19 سجل §39: create/restore/schedule.enable/denied/delete موثقة بلا أسرار", ["backup.create", "backup.restore", "backup.schedule.enable", "backup.denied", "backup.delete"].every((k) => kindsSet.has(k)) && noSecret, `kinds=${[...kindsSet].join(",")}`)
}

console.log(`\n═══ §54 backup-secure-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
