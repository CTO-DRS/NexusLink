#!/usr/bin/env node
// NexusLink — عتبة الماسح الموثق (عقد §61) — scan-threshold-e2e
// ============================================================
// إغلاق الحد المعلن من §55/§56 «عتبة/معالجة الصور»: معالجة اختيارية لكل
// صفحة (رمادي محسّن / أبيض وأسود بعتبة) تُطبَّق عند الختم حصرًا في الذاكرة —
// ملف الصفحة الأصلي على القرص لا يُمس بايتيًا ومرور §55 النقي افتراضيًا.
// الطور أ (نقي): مجموعة الفلاتر المغلقة والعتبة 1..254 + setPageFilter
//   بأسبابه المغلقة (bad-filter · bad-threshold · page-not-found · سقوط
//   العتبة الافتراضي 160 · رفض العتبة مع فلتر غير bw · تنظيف العتبة عند
//   العودة إلى none) + تطبيع الجلسة القديمة (ترحيل صامت) + تحقق الاشتقاق
//   المبكر + اشتقاق sharp حقيقي (رمادي/عتبة بالحدّين 1 و254) بفحص السحر
//   والأبعاد واختلاف البايتات عن الأصل وسقف 12MB.
// الطور ب (حي): فتح جلسة → رفع صفحتين JPEG حقيقيتين (مولّدتان بsharp:
//   تدرج رمادي بأشكال) → إثبات أن ملف الصفحة على القرص مطابق للرفع بايتيًا
//   → فلتر رمادي للصفحة 1 وعتبة 120 للصفحة 2 → الأسباب المغلقة حية
//   (فلتر غريب/عتبة 0/عتبة كسرية/صفحة غائبة) → ملف القرص ما يزال الأصل
//   → ختم filtered=2 → PDF على القرص بلا بايتات الصفحات الأصلية (اشتقاق
//   فعلي) → جلسة رجعت بلا معالجة → ختم filtered=0 وبايتات الأصل في الـPDF
//   حرفيًا (مرور §55 النقي) → سجل §39 بـscan.page.filter وscan.seal
//   بfiltered — بلا محتوى صور.
// الاستخدام:
//   node scripts/scan-threshold-e2e.mjs                     (طور أ حصرًا)
//   node scripts/scan-threshold-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e61-live
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
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e61-live"
})()

/* ═════════════ الطور أ — النواة النقية ═════════════ */
// خطاف حل الوحدات (درس §49): استيراد «./scan-core» بلا امتداد من scan-image
// يمر في مجمّع Next ويكسر node الخام — الخطاف يكمله حصرًا لصادرات TS النسبية.
const { registerTsResolve } = await import("../scripts/ts-resolve-hooks.cjs")
registerTsResolve()
const {
  isScanFilter, isValidThreshold, setPageFilter, normalizeScanSession,
  isJpegBytes, jpegDimensions,
  SCAN_FILTERS, SCAN_THR_MIN, SCAN_THR_MAX, SCAN_THR_DEFAULT, SCAN_PAGE_MAX_BYTES,
} = await import("../src/lib/nexus/scan-core.ts")
const { validateDeriveArgs, deriveScanPage } = await import("../src/lib/nexus/scan-image.ts")
const sharp = (await import("sharp")).default

// أ1 — المجموعة المغلقة والحارس
ok("أ1 SCAN_FILTERS مغلقة {none,gray,bw} والغريب مرفوض", SCAN_FILTERS.length === 3 && isScanFilter("none") && isScanFilter("gray") && isScanFilter("bw") && !isScanFilter("sepia") && !isScanFilter("") && !isScanFilter(undefined))

// أ2 — حدود العتبة
ok("أ2 العتبة عدد صحيح 1..254 حصرًا", isValidThreshold(1) && isValidThreshold(254) && isValidThreshold(160) && !isValidThreshold(0) && !isValidThreshold(255) && !isValidThreshold(1.5) && !isValidThreshold("160") && !isValidThreshold(NaN) && SCAN_THR_MIN === 1 && SCAN_THR_MAX === 254 && SCAN_THR_DEFAULT === 160)

// أ3–أ6 — setPageFilter بأسبابه المغلقة
const S0 = { id: "s61", title: "t", status: "open", createdAt: 0, pages: [
  { n: 1, name: "p-001.jpg", size: 10, rotate: 0, at: 1, filter: "none" },
  { n: 2, name: "p-002.jpg", size: 10, rotate: 0, at: 2, filter: "none" },
] }
ok("أ3 فلتر غريب → bad-filter وصفحة غائبة → page-not-found", setPageFilter(S0, 1, "sepia").error === "bad-filter" && setPageFilter(S0, 99, "bw").error === "page-not-found")
ok("أ4 bw بلا عتبة → السقوط على 160 وبعتبة → تثبيتها", setPageFilter(S0, 1, "bw").session.pages[0].thr === 160 && setPageFilter(S0, 1, "bw", 120).ok && setPageFilter(S0, 1, "bw", 120).session.pages[0].filter === "bw" && setPageFilter(S0, 1, "bw", 120).session.pages[0].thr === 120)
ok("أ5 عتبة غريبة (0/255/كسري/نص) → bad-threshold", setPageFilter(S0, 1, "bw", 0).error === "bad-threshold" && setPageFilter(S0, 1, "bw", 255).error === "bad-threshold" && setPageFilter(S0, 1, "bw", 1.5).error === "bad-threshold" && setPageFilter(S0, 1, "bw", "120").error === "bad-threshold")
ok("أ6 عتبة مع فلتر غير bw مرفضة والعودة إلى none تنظف العتبة", setPageFilter(S0, 1, "gray", 120).error === "bad-threshold" && setPageFilter(S0, 1, "none", 120).error === "bad-threshold" && (() => { const r = setPageFilter(S0, 1, "bw", 200); const back = setPageFilter(r.session, 1, "none"); return back.ok && back.session.pages[0].filter === "none" && !("thr" in back.session.pages[0]) })())

// أ7 — تطبيع الجلسة القديمة (ترحيل صامت للقراءة حصرًا)
const LEGACY = { id: "sL", title: "t", status: "open", createdAt: 0, pages: [
  { n: 1, name: "p-001.jpg", size: 10, rotate: 0, at: 1 },
  { n: 2, name: "p-002.jpg", size: 10, rotate: 0, at: 2, filter: "none", thr: 99 },
] }
const LN = normalizeScanSession(LEGACY)
ok("أ7 تطبيع الجلسة القديمة: بلا filter → none وthr اليتيم يُنظف والسليمة لا تُمس", LN.pages[0].filter === "none" && !("thr" in LN.pages[0]) && LN.pages[1].filter === "none" && !("thr" in LN.pages[1]) && (() => { const clean = normalizeScanSession(S0); return clean === S0 })())

// أ8 — تحقق الاشتقاق المبكر (قبل أي sharp)
ok("أ8 validateDeriveArgs: none مرفوض والعتبة الغريبة تُصطاد مبكرًا", validateDeriveArgs("none").error === "bad-filter" && validateDeriveArgs("sepia").error === "bad-filter" && validateDeriveArgs("bw", 300).error === "bad-threshold" && validateDeriveArgs("gray").ok === true && validateDeriveArgs("bw", 1).ok === true)

// صورة اختبار حقيقية: تدرج رمادي + أشكال داكنة/فاتحة (200×140)
const TEST_PNG = await sharp({
  create: { width: 200, height: 140, channels: 3, background: { r: 128, g: 128, b: 128 } },
}).composite([
  { input: Buffer.from(`<svg width="200" height="140"><rect x="10" y="10" width="80" height="60" fill="#101010"/><rect x="110" y="60" width="70" height="50" fill="#f0f0f0"/><rect x="0" y="0" width="200" height="140" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient></defs></svg>`), top: 0, left: 0 },
]).jpeg({ quality: 92 }).toBuffer()

// أ9–أ12 — الاشتقاق الحقيقي بsharp
ok("أ9 الصورة المرجعية JPEG سيلة السحر والأبعاد", isJpegBytes(TEST_PNG) && jpegDimensions(TEST_PNG).w === 200 && jpegDimensions(TEST_PNG).h === 140)
const dg = await deriveScanPage(TEST_PNG, "gray")
ok("أ10 اشتقاق رمادي: JPEG سليم بالأبعاد نفسها وبايتات مختلفة عن الأصل", dg.ok === true && dg.ok && isJpegBytes(dg.page.bytes) && dg.page.w === 200 && dg.page.h === 140 && !dg.page.bytes.equals(TEST_PNG))
const db1 = await deriveScanPage(TEST_PNG, "bw", 1)
const db254 = await deriveScanPage(TEST_PNG, "bw", 254)
ok("أ11 اشتقاق عتبة بالحدّين 1 و254: JPEG سليم ومختلف عن الأصل", db1.ok === true && db1.ok && db254.ok === true && db254.ok && isJpegBytes(db1.page.bytes) && isJpegBytes(db254.page.bytes) && !db1.page.bytes.equals(TEST_PNG))
ok("أ12 الاشتقاق يرفض فاسد الدخل ويحترم السقف", (await deriveScanPage(Buffer.from("GIF89a"), "gray")).error === "bad-dimensions" && (await deriveScanPage(TEST_PNG, "none")).error === "bad-filter" && SCAN_PAGE_MAX_BYTES === 12 * 1024 * 1024)

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/scan-threshold-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const base = APP.replace(/\/$/, "")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const SCANS = path.join(LIVE_DIR, "scans")
  fs.mkdirSync(SCANS, { recursive: true })
  try { for (const d of fs.readdirSync(SCANS)) fs.rmSync(path.join(SCANS, d), { recursive: true, force: true }) } catch { /* غائب */ }
  const getJson = async (p) => { const r = await fetch(base + p, { cache: "no-store" }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const postJson = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const upload = async (id, buf, filename = "page.jpg") => {
    const fd = new FormData()
    fd.append("file", new File([buf], filename, { type: "image/jpeg" }))
    const r = await fetch(base + `/api/scan/page?id=${encodeURIComponent(id)}`, { method: "POST", body: fd })
    try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } }
  }

  // ب1 — فتح جلسة
  let r = await postJson("/api/scan", { action: "open", title: "عتبة §61" })
  const sid = r.j?.session?.id
  ok("ب1 فتح جلسة بعنوان", r.status === 200 && typeof sid === "string")

  // ب2 — رفع صفحتين حقيقيتين (المرجعية بsharp)
  r = await upload(sid, TEST_PNG, "a.jpg")
  ok("ب2 رفع صفحة 1 بفلتر none الافتراضي", r.status === 200 && r.j?.page?.n === 1)
  r = await getJson(`/api/scan?id=${encodeURIComponent(sid)}`)
  ok("ب3 حالة الجلسة تعرض filter=none لكل صفحة (thr=null)", r.j?.session?.pages?.every((p) => p.filter === "none" && p.thr === null))

  // ب4 — ملف الصفحة على القرص مطابق للرفع بايتيًا (الأصل قبل أي فلتر)
  const diskBefore = fs.readFileSync(path.join(SCANS, sid, "p-001.jpg"))
  ok("ب4 الأصل على القرص مطابق للرفع بايتيًا", diskBefore.equals(TEST_PNG))

  // ب5 — فلتر رمادي للصفحة 1 وعتبة 120 للصفحة 2
  await upload(sid, TEST_PNG, "b.jpg")
  r = await postJson("/api/scan", { action: "filter", id: sid, n: 1, filter: "gray" })
  ok("ب5 فلتر gray مسجل على الصفحة 1", r.status === 200 && r.j?.session?.pages?.find((p) => p.n === 1)?.filter === "gray")
  r = await postJson("/api/scan", { action: "filter", id: sid, n: 2, filter: "bw", thr: 120 })
  ok("ب6 فلتر bw بعتبة 120 مسجل على الصفحة 2", r.status === 200 && r.j?.session?.pages?.find((p) => p.n === 2)?.filter === "bw" && r.j.session.pages.find((p) => p.n === 2)?.thr === 120)

  // ب7 — الأسباب المغلقة حية
  r = await postJson("/api/scan", { action: "filter", id: sid, n: 1, filter: "sepia" })
  ok("ب7 فلتر غريب → 400 bad-filter", r.status === 400 && r.j?.error === "bad-filter")
  r = await postJson("/api/scan", { action: "filter", id: sid, n: 1, filter: "bw", thr: 0 })
  ok("ب8 عتبة 0 → 400 bad-threshold", r.status === 400 && r.j?.error === "bad-threshold")
  r = await postJson("/api/scan", { action: "filter", id: sid, n: 1, filter: "bw", thr: 1.5 })
  ok("ب9 عتبة كسرية → 400 bad-threshold", r.status === 400 && r.j?.error === "bad-threshold")
  r = await postJson("/api/scan", { action: "filter", id: sid, n: 99, filter: "bw", thr: 160 })
  ok("ب10 صفحة غائبة → 400 page-not-found", r.status === 400 && r.j?.error === "page-not-found")

  // ب11 — بعد كل الفلاتر: ملف القرص ما يزال الأصل بايتيًا (الأصل لا يُمس)
  const diskAfter = fs.readFileSync(path.join(SCANS, sid, "p-001.jpg"))
  ok("ب11 بعد الفلاتر: الأصل على القرص لم يُمس بايتيًا", diskAfter.equals(TEST_PNG))

  // ب12 — الختم: filtered=2 والرد يعلنها
  r = await postJson("/api/scan", { action: "seal", id: sid })
  const sealedName = r.j?.file
  ok("ب12 ختم مُعالَج: ok وfiltered=2", r.status === 200 && r.j?.ok === true && r.j?.filtered === 2 && r.j?.pages === 2 && sealedName?.endsWith(".pdf"))

  // ب13 — PDF على القرص بلا بايتات الأصل حرفيًا (الاشتقاق فعلي لا شكلي)
  const DATA_ROOT = (() => { const i = process.argv.indexOf("--data-root"); return i > 0 ? process.argv[i + 1] : path.join(process.cwd(), "data") })()
  const pdfBuf = fs.readFileSync(path.join(DATA_ROOT, "nexus-storage", "pc-fs", "Documents", sealedName))
  const pdfStr = pdfBuf.toString("binary")
  ok("ب13 PDF على القرص: صفحتان DCTDecode وبلا بايتات الأصل (اشتقاق فعلي)", pdfBuf.subarray(0, 8).toString("binary") === "%PDF-1.4" && (pdfStr.match(/\/Subtype \/Image/g) || []).length === 2 && pdfStr.includes("/Filter /DCTDecode") && !pdfBuf.includes(TEST_PNG))

  // ب14 — جلسة العودة إلى مرور §55 النقي: فلتر ثم none ثم ختم filtered=0 وبايتات الأصل في الـPDF
  r = await postJson("/api/scan", { action: "open", title: "مرور نقي" })
  const sid2 = r.j?.session?.id
  await upload(sid2, TEST_PNG)
  await postJson("/api/scan", { action: "filter", id: sid2, n: 1, filter: "bw", thr: 200 })
  r = await postJson("/api/scan", { action: "filter", id: sid2, n: 1, filter: "none" })
  ok("ب14 العودة إلى none تنظف العتبة في الجلسة الحية", r.status === 200 && r.j?.session?.pages?.[0]?.filter === "none" && r.j.session.pages[0].thr === null)
  r = await postJson("/api/scan", { action: "seal", id: sid2 })
  const sealed2 = r.j?.file
  ok("ب15 ختم بلا معالجة: filtered=0", r.status === 200 && r.j?.filtered === 0)
  const pdf2 = fs.readFileSync(path.join(DATA_ROOT, "nexus-storage", "pc-fs", "Documents", sealed2))
  ok("ب16 مرور §55 النقي: بايتات الأصل في الـPDF حرفيًا", pdf2.includes(TEST_PNG))

  // ب17 — سجل §39: scan.page.filter وscan.seal بfiltered — بلا محتوى صور
  r = await getJson("/api/enterprise/audit?limit=400")
  const evs = (r.j?.events ?? []).filter((e) => String(e.k).startsWith("scan"))
  const kindsSet = new Set(evs.map((e) => e.k))
  const filterEvs = evs.filter((e) => e.k === "scan.page.filter")
  const sealEvs = evs.filter((e) => e.k === "scan.seal")
  const lastSeal = sealEvs[sealEvs.length - 1]
  const noBinary = evs.every((e) => !JSON.stringify(e.d ?? {}).includes("GIF89a") && !JSON.stringify(e.d ?? {}).includes("JFIF"))
  ok("ب17 سجل §39: scan.page.filter موثق بالفلتر والعتبة وصفيةً (bw@120 وnone بعد التنظيف) وscan.seal بfiltered (2 ثم 0) — بلا محتوى صور",
    kindsSet.has("scan.page.filter") && filterEvs.some((e) => JSON.stringify(e.d ?? {}).includes('"filter":"gray"')) && filterEvs.some((e) => JSON.stringify(e.d ?? {}).includes('"filter":"bw"')) && filterEvs.some((e) => JSON.stringify(e.d ?? {}).includes('"thr":120')) && sealEvs.some((e) => e.d?.filtered === 2) && !!lastSeal && lastSeal.d?.filtered === 0 && noBinary,
    `kinds=${[...kindsSet].join(",")}`)

  // ب18 — إلغاء ينظف
  r = await postJson("/api/scan", { action: "open", title: "تنظيف" })
  const sid3 = r.j?.session?.id
  await upload(sid3, TEST_PNG)
  r = await postJson("/api/scan", { action: "cancel", id: sid3 })
  ok("ب18 إلغاء الجلسة ينظف مجلدها", r.j?.ok === true && !fs.existsSync(path.join(SCANS, sid3)))
}

console.log(`\n═══ §61 scan-threshold-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
