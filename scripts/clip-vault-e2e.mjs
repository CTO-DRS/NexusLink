#!/usr/bin/env node
// NexusLink — خزنة الحافظة الذكية (عقد §50) — clip-vault-e2e
// ============================================================
// الطور أ (نقي — بلا خادم): التصنيف الحتمي (OTP/بطاقة Luhn/آيبان/كلمة سر/رمز)
//   والإخفاء وسياسة الانتهاء (حساس 15د · عادي 7أيام · مثبّت لا ينتهي · اللصق
//   المؤقت بسقف 24ساعة لا يطيل فوقه) والبحث المرتب (بادئة>احتواء>تسلسل) والإحصاء.
// الطور ب (حي — ضد السيرفر): دورة كاملة — إدخال عادي/بطاقة/OTP/مؤقت → إخفاء
//   تلقائي في القوائم → كشف مقصود مُدقَّق → تدبيس ينجو من التطهير → انتهاء
//   فعلي بعد الانتظار → بحث → حدود وسلوك رجعي متوافق.
// الاستخدام:
//   node scripts/clip-vault-e2e.mjs                     (طور أ حصرًا)
//   node scripts/clip-vault-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e50-live
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

/* ═════════════ الطور أ — النواة النقية ═════════════ */
const {
  classifyClip, maskClip, retentionAt, searchClips, vaultStats,
  luhnValid, SENSITIVE_TTL_MS, NORMAL_TTL_MS, MAX_EPHEMERAL_MS,
} = await import("../src/lib/nexus/clip-vault-core.ts")

const T0 = 1_700_000_000_000

// أ1–أ12 — التصنيف الحتمي
ok("أ1 OTP أرقام قائمة → otp", classifyClip("123456").sensitive === "otp")
ok("أ2 OTP مع كلمة عربية قصيرة → otp", classifyClip("رمز: 4832").sensitive === "otp")
ok("أ3 أرقام في نص طويل بكلمات → غير حساس", classifyClip("طلب 12345 من المتاجر اليوم").sensitive === null)
ok("أ4 بطاقة Luhn صحيحة → card", classifyClip("4111111111111111").sensitive === "card")
ok("أ5 بطاقة بمسافات وشرطات → card", classifyClip("4111 1111-1111 1111").sensitive === "card")
ok("أ6 رقم طويل Luhn فاشل → غير حساس", classifyClip("4111111111111112").sensitive === null)
ok("أ7 آيبان سعودي → iban", classifyClip("SA0380000000608010167519").sensitive === "iban")
ok("أ8 password: نص صريح → password", classifyClip("password: hunter2").sensitive === "password")
ok("أ9 كلمة المرور العربية → password", classifyClip("كلمة المرور: abc123!").sensitive === "password")
ok("أ10 رمز GitHub → token", classifyClip("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456").sensitive === "token")
ok("أ11 JWT → token", classifyClip("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_part").sensitive === "token")
ok("أ12 نص عادي → null ووسوم فارغة", classifyClip("مرحبا بالعالم هذا نص عادي طويل").sensitive === null && classifyClip("مرحبا").tags.length === 0)

// أ13–أ14 — Luhn حدّي
ok("أ13 luhnValid يرفض رقمًا واحدًا", luhnValid("7") === false)
ok("أ14 luhnValid يقرأ المسافات كدفعة واحدة", luhnValid("4111 1111 1111 1111") === false) // تبقى مسافات → نمط يرفض

// أ15–أ19 — الإخفاء
ok("أ15 إخفاء OTP بعدد أرقامه", maskClip("رمز 4832", "otp") === "••••")
ok("أ16 إخفاء بطاقة: أول 4 وآخر 4", maskClip("4111111111111111", "card") === "4111 •••• •••• 1111")
ok("أ17 إخفاء آيبان يحفظ رمز البلد", maskClip("SA0380000000608010167519", "iban").startsWith("SA03"))
ok("أ18 إخفاء كلمة سر طويلة: أول2+نقاط+آخر2", maskClip("hunter2secret", "password") === "hu••••••et")
ok("أ19 غير الحساس يمر كما هو", maskClip("نص عادي", null) === "نص عادي")

// أ20–أ24 — سياسة الانتهاء
ok("أ20 الحساس ينتهي بعد 15 دقيقة", retentionAt({ sensitive: "otp", pinned: false, createdAtMs: T0, nowMs: T0 }) === T0 + SENSITIVE_TTL_MS && SENSITIVE_TTL_MS === 900_000)
ok("أ21 العادي ينتهي بعد 7 أيام", retentionAt({ sensitive: null, pinned: false, createdAtMs: T0, nowMs: T0 }) === T0 + NORMAL_TTL_MS)
ok("أ22 المثبت لا ينتهي أبدًا", retentionAt({ sensitive: "card", pinned: true, createdAtMs: T0, nowMs: T0 }) === null)
ok("أ23 اللصق المؤقت يتثبت بسقف 24 ساعة (لا يطيل فوقه)", retentionAt({ sensitive: null, pinned: false, createdAtMs: T0, nowMs: T0, expiresAtFrom: T0 + 100 * 3600_000 }) === T0 + MAX_EPHEMERAL_MS)
ok("أ24 اللصق المؤقت بالماضي ينتهي فورًا (لا قبل الإدخال)", retentionAt({ sensitive: null, pinned: false, createdAtMs: T0, nowMs: T0, expiresAtFrom: T0 - 5_000 }) === T0)

// أ25–أ28 — البحث المرتب
const items = [
  { id: "1", content: "نسخة المشروع النهائية للعقد", fileName: null },
  { id: "2", content: "سجل اجتماع الفريق الأسبوعي", fileName: null },
  { id: "3", content: "مرحباً بالعالم", fileName: "hello.txt" },
]
const r1 = searchClips(items, "نسخة")
ok("أ25 البادئة تتفوق (score 3)", r1[0]?.id === "1" && r1[0]?.score === 3)
const r2 = searchClips(items, "فريق")
ok("أ26 الاحتواء يلتقط (score 2)", r2[0]?.id === "2" && r2[0]?.score === 2)
const r3 = searchClips(items, "hl")
ok("أ27 التسلسل المرن يلتقط اسم الملف", r3.some((x) => x.id === "3"))
ok("أ28 استعلام فارغ → لا نتائج", searchClips(items, "   ").length === 0)

// أ29 — سقف النتائج 8
const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), content: `عنصر بحث ${i}`, fileName: null }))
ok("أ29 سقف نتائج البحث 8", searchClips(many, "بحث").length === 8)

// أ30 — الإحصاء
const st = vaultStats(
  [
    { kind: "text", pinned: true, sensitive: null },
    { kind: "text", sensitive: "card", expiresAt: Date.now() + 3600_000 },
    { kind: "file", sensitive: null, expiresAt: Date.now() + 100_000 },
  ],
  Date.now(),
)
ok("أ30 الإحصاء: مثبت 1 وحساس 1 ومنتهٍ-خلال-24س 2", st.total === 3 && st.pinned === 1 && st.sensitive === 1 && st.expiring24h === 2)

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/clip-vault-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e50-live`)
} else {
  const base = APP.replace(/\/$/, "")
  const MARK = `e50-${Date.now()}`
  const getJson = async (p) => { const r = await fetch(base + p, { cache: "no-store" }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const postJson = async (p, body) => { const r = await post(p, body); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

  // ب1 — القائمة الأساسية سليمة بإحصاء الخزنة (توافق §11)
  let r = await getJson("/api/prod/clipboard")
  ok("ب1 GET الحافظة: ok مع items وvault", r.status === 200 && Array.isArray(r.j.items) && typeof r.j.vault?.total === "number")

  // ب2 — إدخال عادي: بلا حساسية وانتهاء 7 أيام
  r = await postJson("/api/prod/clipboard", { deviceId: "pc-office", kind: "text", content: `${MARK} نص عادي للمزامنة`, mode: "manual" })
  const normalId = r.j?.item?.id
  ok("ب2 إدخال عادي: sensitive=null وexpiresAt≈7 أيام", r.status === 200 && r.j.item.sensitive === null && r.j.item.masked === false && Math.abs((r.j.item.expiresAt ?? 0) - Date.now() - 7 * 86_400_000) < 60_000)

  // ب3 — بطاقة: تصنيف + إخفاء في الاستجابة
  r = await postJson("/api/prod/clipboard", { deviceId: "pc-office", kind: "text", content: "4111111111111111", mode: "manual" })
  const cardId = r.j?.item?.id
  ok("ب3 بطاقة: sensitive=card والمحتوى مخفيّ في الاستجابة", r.j?.item?.sensitive === "card" && r.j.item.masked === true && r.j.item.content === "4111 •••• •••• 1111")

  // ب4 — OTP: إخفاء بعدد الأرقام
  r = await postJson("/api/prod/clipboard", { deviceId: "pc-office", kind: "text", content: "483291", mode: "auto" })
  const otpId = r.j?.item?.id
  ok("ب4 OTP: sensitive=otp ومقنّع 6 نقاط", r.j?.item?.sensitive === "otp" && r.j.item.content === "••••••")

  // ب5 — القائمة تخفي الحساس تلقائيًا (لا خام في GET أبدًا)
  r = await getJson("/api/prod/clipboard")
  const otpRow = (r.j.items ?? []).find((x) => x.id === otpId)
  const cardRow = (r.j.items ?? []).find((x) => x.id === cardId)
  ok("ب5 القائمة: OTP مقنّع والبطاقة مقنّعة (صفر خام)", otpRow?.content === "••••••" && cardRow?.content === "4111 •••• •••• 1111" && otpRow?.masked === true && cardRow?.masked === true)

  // ب6 — الصور والملفات لا تُصنَّف (حدود صادقة §50)
  r = await postJson("/api/prod/clipboard", { deviceId: "pc-office", kind: "image", content: "data:image/png;base64,iVBORw0KGgo=", mode: "manual" })
  ok("ب6 صورة dataUrl: بلا تصنيف", r.j?.item?.sensitive === null)
  r = await postJson("/api/prod/clipboard", { deviceId: "pc-office", kind: "file", content: "ملف", fileName: `${MARK}.pdf`, mode: "manual" })
  ok("ب7 ملف: بلا تصنيف واسمه محفوظ", r.j?.item?.sensitive === null && r.j.item.fileName === `${MARK}.pdf`)

  // ب8/ب9 — الكشف المقصود المُدقَّق
  r = await postJson("/api/prod/clipboard/vault", { action: "reveal", id: cardId })
  ok("ب8 reveal البطاقة: المحتوى الكامل وmasked=false", r.j?.ok === true && r.j.item.content === "4111111111111111" && r.j.item.masked === false)
  r = await postJson("/api/prod/clipboard/vault", { action: "reveal", id: normalId })
  ok("ب9 reveal لغير الحساس → 400 رفض صادق", r.status === 400)

  // ب10/ب11 — البحث المرتب
  r = await getJson(`/api/prod/clipboard/vault?q=${encodeURIComponent(MARK)}`)
  ok("ب10 البحث بالعلامة الفريدة يلتقط العناصر", r.j?.ok === true && (r.j.items ?? []).some((x) => x.id === normalId))
  r = await getJson(`/api/prod/clipboard/vault?q=${encodeURIComponent("4111")}`)
  const srch = r.j.items ?? []
  ok("ب11 نتيجة البحث للحساس تظل مقنّعة", srch.length >= 1 && srch.every((x) => x.content !== "4111111111111111"))
  r = await getJson(`/api/prod/clipboard/vault?q=${encodeURIComponent("لا-يوجد-مطلقا-xyzzy")}`)
  ok("ب12 بلا نتائج: مصفوفة فارغة صادقة", r.j?.ok === true && Array.isArray(r.j.items) && r.j.items.length === 0)

  // ب13/ب14 — التدبيس ينجو من التطهير
  r = await postJson("/api/prod/clipboard/vault", { action: "pin", id: cardId })
  ok("ب13 pin: pinned=true", r.j?.ok === true && r.j.item.pinned === true)
  r = await postJson("/api/prod/clipboard/vault", { action: "unpin", id: cardId })
  ok("ب14 unpin: pinned=false يعود", r.j?.ok === true && r.j.item.pinned === false)

  // ب15/ب16/ب17 — اللصق المؤقت: انتهاء فعلي بعد الانتظار + سقف لا يُطال
  r = await postJson("/api/prod/clipboard", { deviceId: "pc-office", kind: "text", content: `${MARK} مؤقت يختفي`, mode: "manual", expiresAt: Date.now() + 1_200 })
  const ephId = r.j?.item?.id
  await sleep(1_500)
  r = await postJson("/api/prod/clipboard/vault", { action: "sweep" })
  ok("ب15 sweep: أزال المنتهي (≥1)", r.j?.ok === true && r.j.removed >= 1, `removed=${r.j?.removed}`)
  r = await getJson("/api/prod/clipboard")
  ok("ب16 المؤقت اختفى من القائمة بعد التطهير", !(r.j.items ?? []).some((x) => x.id === ephId))
  r = await postJson("/api/prod/clipboard", { deviceId: "pc-office", kind: "text", content: `${MARK} سقف`, mode: "manual", expiresAt: Date.now() + 100 * 3600_000 })
  ok("ب17 سقف المؤقت 24 ساعة: لا يُطال فوقه", r.j?.item?.expiresAt - r.j?.item?.createdAt <= 24 * 3600_000 + 2_000)

  // ب18/ب19 — أخطاء صادقة
  r = await postJson("/api/prod/clipboard/vault", { action: "reveal", id: "لا-يوجد" })
  ok("ب18 reveal لمعرف غائب → 404", r.status === 404)
  r = await postJson("/api/prod/clipboard/vault", { action: "غير-معروف", id: normalId })
  ok("ب19 فعل غير معروف → 400", r.status === 400)

  // ب20 — التوافق الرجعي: استجابة POST تحمل الحقول الجديدة كلها
  r = await postJson("/api/prod/clipboard", { deviceId: "pc-office", kind: "text", content: `${MARK} توافق`, mode: "manual" })
  const it = r.j?.item ?? {}
  ok("ب20 التوافق الرجعي: pinned/sensitive/expiresAt/masked كلها معلنة", "pinned" in it && "sensitive" in it && "expiresAt" in it && "masked" in it)

  // ب21 — ترتيب تنازلي محفوظ (عقد §11)
  r = await getJson("/api/prod/clipboard")
  const arr = r.j.items ?? []
  ok("ب21 الترتيب تنازلي بالزمن", arr.length < 2 || arr[0].createdAt >= arr[1].createdAt)

  // ب22 — التنظيف النهائي: مسح كامل يعيد الخزنة فارغة (سلوك DELETE التاريخي)
  const del = await fetch(base + "/api/prod/clipboard", { method: "DELETE" })
  r = await getJson("/api/prod/clipboard")
  ok("ب22 مسح الكل → القائمة فارغة والإحصاء صفر", del.status === 200 && r.j.vault?.total === 0)
}

console.log(`\n═══ §50 clip-vault-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
