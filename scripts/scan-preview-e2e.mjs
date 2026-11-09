#!/usr/bin/env node
// NexusLink — معاينة المعالجة الحية (عقد §62) — scan-preview-e2e
// ============================================================
// إكمال UX عقد §61: المستخدم يرى أثر الفلتر/العتبة قبل الختم — نفس منطق
// الختم حرفًا حرفًا (none → الأصل · gray/bw → اشتقاق الذاكرة بsharp) فما
// يُعايَن هو ما يُختم بلا مفاجأة — والعيادة على حاسوب المالك حصرًا (مقابل
// Adobe Scan الذي يعالج على سحابة الغير).
// الطور أ (نقي): حساب البايتات المتوقعة محليًا بوظيفة الاشتقاق نفسها
//   (deriveScanPage) — المرجع البايتي الذي يجب أن يطابق رد المعاينة حرفيًا
//   (نفس الدخل ونفس المعاملات = نفس البايتات — حتمية sharp).
// الطور ب (حي): فتح جلسة ورفع صفحة → معاينة none = بايتات الأصل حرفيًا مع
//   ترويسة الفلتر → gray → المعاينة تطابق المرجع البايتي → bw@120 → تطابق →
//   تغيير العتبة 200 → بايتات تختلف → الأخطاء الصادقة (جلسة غائبة 404 ·
//   صفحة غائبة 400 · n فاسد 400) → الأصل على القرص لم يُمس بعد كل المعاينات
//   → المعاينة بعد الختم 404 (لا جلسات زومبي) → سجل §39 بscan.preview
//   وصفيةً بلا بايتات → حارس المعدل 120/د يضرب 429 في النهاية (بعد كل
//   الفحوص حتى لا يفسد إخوتها).
// الاستخدام:
//   node scripts/scan-preview-e2e.mjs                     (طور أ حصرًا)
//   node scripts/scan-preview-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e62-live
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
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e62-live"
})()

/* ═════════════ الطور أ — المرجع البايتي النقي ═════════════ */
// خطاف حل الوحدات (درس §49): استيراد «./scan-core» بلا امتداد من scan-image
// يمر في مجمّع Next ويكسر node الخام — الخطاف يكمله حصرًا لصادرات TS النسبية.
const { registerTsResolve } = await import("../scripts/ts-resolve-hooks.cjs")
registerTsResolve()
const { isJpegBytes, jpegDimensions } = await import("../src/lib/nexus/scan-core.ts")
const { deriveScanPage } = await import("../src/lib/nexus/scan-image.ts")
const sharp = (await import("sharp")).default

// صورة مرجعية: تدرج + أشكال داكنة/فاتحة (200×140) — دخلا حتميًا للاشتقاق
const TEST_PNG = await sharp({
  create: { width: 200, height: 140, channels: 3, background: { r: 128, g: 128, b: 128 } },
}).composite([
  { input: Buffer.from(`<svg width="200" height="140"><rect x="10" y="10" width="80" height="60" fill="#101010"/><rect x="110" y="60" width="70" height="50" fill="#f0f0f0"/><rect x="0" y="0" width="200" height="140" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient></defs></svg>`), top: 0, left: 0 },
]).jpeg({ quality: 92 }).toBuffer()

ok("أ1 الصورة المرجعية JPEG سليم السحر والأبعاد", isJpegBytes(TEST_PNG) && jpegDimensions(TEST_PNG).w === 200 && jpegDimensions(TEST_PNG).h === 140)
const REF_GRAY = await deriveScanPage(TEST_PNG, "gray")
const REF_BW120 = await deriveScanPage(TEST_PNG, "bw", 120)
const REF_BW200 = await deriveScanPage(TEST_PNG, "bw", 200)
ok("أ2 المراجع الثلاثة محسوبة سليمة ومتباينة بايتيًا", REF_GRAY.ok && REF_BW120.ok && REF_BW200.ok && !REF_GRAY.page.bytes.equals(TEST_PNG) && !REF_BW120.page.bytes.equals(REF_GRAY.page.bytes) && !REF_BW200.page.bytes.equals(REF_BW120.page.bytes))
ok("أ3 الحتمية: إعادة الاشتقاق بنفس المعاملات تعيد البايتات نفسها", (() => { return true })() && (await deriveScanPage(TEST_PNG, "bw", 120)).ok && (await deriveScanPage(TEST_PNG, "bw", 120)).page.bytes.equals(REF_BW120.page.bytes))

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/scan-preview-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const base = APP.replace(/\/$/, "")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const SCANS = path.join(LIVE_DIR, "scans")
  fs.mkdirSync(SCANS, { recursive: true })
  try { for (const d of fs.readdirSync(SCANS)) fs.rmSync(path.join(SCANS, d), { recursive: true, force: true }) } catch { /* غائب */ }
  const postJson = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const upload = async (id, buf) => {
    const fd = new FormData()
    fd.append("file", new File([buf], "page.jpg", { type: "image/jpeg" }))
    const r = await fetch(base + `/api/scan/page?id=${encodeURIComponent(id)}`, { method: "POST", body: fd })
    return r.status
  }
  const preview = async (id, n) => {
    const r = await fetch(base + `/api/scan/preview?id=${encodeURIComponent(id)}&n=${n}`, { cache: "no-store" })
    const buf = Buffer.from(await r.arrayBuffer())
    return { status: r.status, buf, filter: r.headers.get("x-scan-filter") }
  }

  // ب1 — جلسة وصفحة
  let r = await postJson("/api/scan", { action: "open", title: "معاينة §62" })
  const sid = r.j?.session?.id
  const up = await upload(sid, TEST_PNG)
  ok("ب1 جلسة وصفحة جاهزتان", r.status === 200 && typeof sid === "string" && up === 200)

  // ب2 — معاينة none: بايتات الأصل حرفيًا وترويسة الفلتر
  let pv = await preview(sid, 1)
  ok("ب2 معاينة بلا فلتر = بايتات الأصل حرفيًا + ترويسة none", pv.status === 200 && pv.buf.equals(TEST_PNG) && pv.filter === "none" && isJpegBytes(pv.buf))

  // ب3 — gray: المعاينة تطابق المرجع البايتي المحسوب بوظيفة الاشتقاق نفسها
  await postJson("/api/scan", { action: "filter", id: sid, n: 1, filter: "gray" })
  pv = await preview(sid, 1)
  ok("ب3 معاينة gray = المرجع البايتي حرفيًا (ما يُعايَن هو ما يُختم)", pv.status === 200 && pv.filter === "gray" && pv.buf.equals(REF_GRAY.page.bytes))

  // ب4 — bw@120 ثم bw@200: تطابق المرجع واختلاف العتبتين
  await postJson("/api/scan", { action: "filter", id: sid, n: 1, filter: "bw", thr: 120 })
  pv = await preview(sid, 1)
  const pv120 = pv.buf
  ok("ب4 معاينة bw@120 = المرجع حرفيًا", pv.status === 200 && pv.filter === "bw" && pv120.equals(REF_BW120.page.bytes))
  await postJson("/api/scan", { action: "filter", id: sid, n: 1, filter: "bw", thr: 200 })
  pv = await preview(sid, 1)
  ok("ب5 تغيير العتبة يغير المعاينة لحظيًا (bw@200 ≠ bw@120 = المرجع)", pv.status === 200 && pv.buf.equals(REF_BW200.page.bytes) && !pv.buf.equals(pv120))

  // ب6 — الأخطاء الصادقة (JSON لا بايتات)
  const getJson = async (p) => { const rr = await fetch(base + p, { cache: "no-store" }); try { return { status: rr.status, j: await rr.json() } } catch { return { status: rr.status, j: null } } }
  let e = await getJson(`/api/scan/preview?id=sغائب-x-y&n=1`)
  ok("ب6 جلسة غائبة → 404 JSON not-found", e.status === 404 && e.j?.error === "not-found")
  e = await getJson(`/api/scan/preview?id=${encodeURIComponent(sid)}&n=99`)
  ok("ب7 صفحة غائبة → 400 page-not-found", e.status === 400 && e.j?.error === "page-not-found")
  e = await getJson(`/api/scan/preview?id=${encodeURIComponent(sid)}&n=abc`)
  ok("ب8 n فاسد → 400 page-not-found (رفض مبكر قبل الجلسة)", e.status === 400 && e.j?.error === "page-not-found")

  // ب9 — بعد كل المعاينات: الأصل على القرص لم يُمس بايتيًا
  const disk = fs.readFileSync(path.join(SCANS, sid, "p-001.jpg"))
  ok("ب9 الأصل على القرص لم يُمس بعد كل المعاينات", disk.equals(TEST_PNG))

  // ب10 — سجل §39: scan.preview وصفية (الصفحة والفلتر — لا بايتات) 
  r = await postJson("/api/scan", { action: "seal", id: sid })
  ok("ب10 الختم بعد المعاينات سليم (المعاينة لا تفسد الجلسة)", r.status === 200 && r.j?.ok === true && r.j?.filtered === 1)
  e = await getJson("/api/enterprise/audit?limit=300")
  const evs = (e.j?.events ?? []).filter((ev) => String(ev.k).startsWith("scan"))
  const previews = evs.filter((ev) => ev.k === "scan.preview")
  const noBinary = evs.every((ev) => !JSON.stringify(ev.d ?? {}).includes("JFIF") && !JSON.stringify(ev.d ?? {}).includes("GIF89a"))
  ok("ب11 سجل §39: scan.preview بالصفحة والفلتر وصفيةً — بلا بايتات", previews.length >= 3 && previews.some((ev) => JSON.stringify(ev.d ?? {}).includes('"filter":"gray"')) && previews.some((ev) => JSON.stringify(ev.d ?? {}).includes('"filter":"bw"')) && noBinary, `preview=${previews.length}`)

  // ب12 — المعاينة بعد الختم: 404 (لا جلسات زومبي — نمط PERSIST)
  pv = await preview(sid, 1)
  ok("ب12 معاينة جلسة مختومة → 404", pv.status === 404)

  // ب13 — حارس المعدل 120/د يضرب 429 (آخر الفحوص حتى لا يفسد إخوتها —
  // المحاسب عالم لكل المعاينات الناجحة: 6 قبل هذا + الدفعة حتى 429)
  let got429 = 0
  let calls = 0
  r = await postJson("/api/scan", { action: "open", title: "معدل" })
  const sid2 = r.j?.session?.id
  await upload(sid2, TEST_PNG)
  for (let i = 0; i < 200; i++) {
    calls++
    const rr = await preview(sid2, 1)
    if (rr.status === 429) { got429 = rr.status; break }
  }
  ok("ب13 حارس المعدل: 429 بعد السقف (120/د + ما قبلها)", got429 === 429 && calls <= 125, `calls=${calls}`)
  await postJson("/api/scan", { action: "cancel", id: sid2 })
}

console.log(`\n═══ §62 scan-preview-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
