#!/usr/bin/env node
// NexusLink — الماسح الموثق الحي (عقد §55) — scan-e2e
// ============================================================
// الطور أ (نقي): أبعاد JPEG من الترويسات (SOF حقيقي ورفض الغريب) + فحص
//   السحر + عنوان منقّى واسم ملف PDF آمن + عمليات الجلسة (تدوير بأسباب
//   مغلقة/إعادة ترتيب بحدود/حذف) + كاتب PDF: مصفوفات الدوران الأربع + بناء
//   PDF كامل من JPEG مصغّر والتحقق بالبايتات (الترويسة/DCTDecode/xref/EOF/
//   عدد الصفحات وأبعاد الصناديق المدارة) + رفض PDF الفارغ وغير-JPEG.
// الطور ب (حي): دورة كاملة — فتح جلسة → رفع صفحتين JPEG حقيقيتين (multipart)
//   → تدوير 90 وإعادة ترتيب → ختم إلى مجلد الكمبيوتر → فحص ملف الـPDF
//   الناتج من القرص بايتيًا (صفحتان DCTDecode بأبعاد مدارة) → الأخطاء
//   الصادقة (رفع غير JPEG/جلسة غائبة/دوران غريب/ختم بلا صفحات/هدف خارج
//   الجذر) → حذف صفحة → إلغاء ينظف المجلد → سجل §39 بلا محتوى صور.
// الاستخدام:
//   node scripts/scan-e2e.mjs                     (طور أ حصرًا)
//   node scripts/scan-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e55-live
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
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e55-live"
})()

/* ═════════════ الطور أ — النواة النقية ═════════════ */
const {
  isJpegBytes, jpegDimensions, sanitizeScanTitle, scanPdfFileName,
  rotatePage, movePage, removePage, isScanRotation,
  SCAN_MAX_PAGES, SCAN_PAGE_MAX_BYTES,
} = await import("../src/lib/nexus/scan-core.ts")
const { buildScanPdf, placeMatrix } = await import("../src/lib/nexus/scan-pdf.ts")

// JPEG مصغّر حقيقي 1×1 (بصمة قياسية) — يمر فحص السحر وأبعاد SOF
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh" +
  "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARC" +
  "AABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAg" +
  "EDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhc" +
  "YGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJ" +
  "ipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6" +
  "erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
)

// أ1–أ3 — السحر والأبعاد
ok("أ1 فحص السحر FFD8 حرفيًا", isJpegBytes(TINY_JPEG) && !isJpegBytes(Buffer.from("GIF89a")) && !isJpegBytes(Buffer.from("<html>")) && !isJpegBytes(Buffer.alloc(0)))
const dims = jpegDimensions(TINY_JPEG)
ok("أ2 أبعاد 1×1 من SOF الحقيقي", !!dims && dims.w === 1 && dims.h === 1)
ok("أ3 غريب: بلا SOF أو مبتور → null", jpegDimensions(Buffer.concat([TINY_JPEG.subarray(0, 6), Buffer.from([0xff, 0xd9])])) === null && jpegDimensions(Buffer.from("نص")) === null)

// أ4–أ5 — العنوان واسم الملف
ok("أ4 عنوان فارغ/خطير → افتراضي منقّى", sanitizeScanTitle("") === "مسح ضوئي" && sanitizeScanTitle("عقد\nبيع").length === 6 && sanitizeScanTitle("س".repeat(200)).length <= 80)
const fname = scanPdfFileName("عقد/بيع: خاص", 1_700_000_000_000)
ok("أ5 اسم PDF آمن زمني قابل للفرز", fname.startsWith("scan-20231114-") && !fname.includes("/") && !fname.includes(":") && fname.endsWith(".pdf"))

// أ6–أ8 — عمليات الجلسة النقية
const S0 = { id: "sx", title: "t", status: "open", createdAt: 0, pages: [
  { n: 1, name: "p-001.jpg", size: 10, rotate: 0, at: 1 },
  { n: 2, name: "p-002.jpg", size: 10, rotate: 0, at: 2 },
  { n: 3, name: "p-003.jpg", size: 10, rotate: 0, at: 3 },
] }
ok("أ6 تدوير: زوايا مشروعة حصرًا وصفحة موجودة", rotatePage(S0, 2, 90).ok === true && rotatePage(S0, 2, 90).ok && rotatePage(S0, 2, 90).session.pages[1].rotate === 90 && rotatePage(S0, 2, 45).error === "invalid-rotation" && rotatePage(S0, 9, 90).error === "page-not-found" && !isScanRotation(360))
ok("أ7 إعادة ترتيب بحدود صارمة", movePage(S0, 0, 2).ok === true && movePage(S0, 0, 2).session.pages[2].n === 1 && movePage(S0, -1, 0).error === "index-out-of-range" && movePage(S0, 0, 3).error === "index-out-of-range" && movePage(S0, 1.5, 0).error === "index-out-of-range")
ok("أ8 حذف صفحة: الغائب مرفوض والحاضر يُحذف", removePage(S0, 2).ok === true && removePage(S0, 2).session.pages.length === 2 && removePage(S0, 99).error === "page-not-found")

// أ9–أ11 — مصفوفات الدوران (الزوايا تغطي الصندوق بلا قصّ)
const corners = (m, pw, ph) => {
  const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]])
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return Math.min(...xs) === 0 && Math.min(...ys) === 0 && Math.max(...xs) === pw && Math.max(...ys) === ph
}
ok("أ9 مصفوفة r=0: صندوق w×h", (() => { const r = placeMatrix(0, 800, 600); return r.pw === 800 && r.ph === 600 && corners(r.m, 800, 600) })())
ok("أ10 مصفوفة r=90: صندوق مُدار h×w", (() => { const r = placeMatrix(90, 800, 600); return r.pw === 600 && r.ph === 800 && corners(r.m, 600, 800) })())
ok("أ11 مصفوفتا 180/270 سليمتان", (() => { const r180 = placeMatrix(180, 800, 600); const r270 = placeMatrix(270, 800, 600); return r180.pw === 800 && r180.ph === 600 && corners(r180.m, 800, 600) && r270.pw === 600 && r270.ph === 800 && corners(r270.m, 600, 800) })())

// أ12–أ14 — كاتب PDF بالبايتات
const D = jpegDimensions(TINY_JPEG)
const built = buildScanPdf([{ bytes: TINY_JPEG, rotate: 0, w: D.w, h: D.h }, { bytes: TINY_JPEG, rotate: 90, w: D.w, h: D.h }])
ok("أ12 PDF سليم البنية: ترويسة/عدد/أنواع/EOF", built.ok === true && built.ok && built.pdf.subarray(0, 8).toString("binary") === "%PDF-1.4" && (built.pdf.toString("binary").match(/\/Subtype \/Image/g) || []).length === 2 && built.pdf.toString("binary").includes("/Filter /DCTDecode") && built.pdf.toString("binary").trimEnd().endsWith("%%EOF"))
ok("أ13 xref وstartxref دقيقان بايتيًا", (() => {
  const s = built.pdf.toString("binary")
  const m = s.match(/startxref\n(\d+)\n%%EOF/)
  if (!m) return false
  const at = Number(m[1])
  return s.slice(at, at + 4) === "xref" && s.includes(`/Count 2`) && s.includes("/MediaBox [0 0 1 1]") && s.includes("/MediaBox [0 0 1 1]")
})())
ok("أ15 رفض الفارغ وغير-JPEG والأبعاد المبتورة", buildScanPdf([]).error === "no-pages" && buildScanPdf([{ bytes: Buffer.from("GIF89a"), rotate: 0, w: 1, h: 1 }]).error === "not-jpeg" && buildScanPdf([{ bytes: TINY_JPEG, rotate: 0, w: 0, h: 1 }]).error === "bad-dimensions")

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/scan-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
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

  // ب1 — فتح جلسة بعنوان منقّى
  let r = await postJson("/api/scan", { action: "open", title: "عقد الإيجار #55" })
  const sid = r.j?.session?.id
  ok("ب1 فتح جلسة: معرّف وعنوان منقّى بلا صفحات", r.status === 200 && typeof sid === "string" && r.j.session.title === "عقد الإيجار #55" && r.j.session.pages.length === 0)

  // ب2 — رفع غير JPEG → 400
  r = await upload(sid, Buffer.from("GIF89a صورة مزيفة"), "fake.jpg")
  ok("ب2 رفع غير JPEG → 400 not-jpeg (السحر لا الترويسة)", r.status === 400 && r.j?.error === "not-jpeg")

  // ب3 — رفع صفحتين حقيقيتين
  r = await upload(sid, TINY_JPEG, "p1.jpg")
  ok("ب3 رفع صفحة 1: رقم 1 وبعد 1×1", r.status === 200 && r.j?.ok === true && r.j.page.n === 1 && r.j.page.size === TINY_JPEG.length)
  r = await upload(sid, TINY_JPEG, "p2.jpg")
  ok("ب4 رفع صفحة 2", r.status === 200 && r.j?.page?.n === 2)

  // ب5 — تدوير 90 على الصفحة 2 ثم قلب الترتيب
  r = await postJson("/api/scan", { action: "rotate", id: sid, n: 2, deg: 90 })
  ok("ب5 تدوير 90 مسجل", r.status === 200 && r.j?.session?.pages.find((p) => p.n === 2)?.rotate === 90)
  r = await postJson("/api/scan", { action: "move", id: sid, from: 1, to: 0 })
  ok("ب6 إعادة ترتيب: الثانية أولًا", r.status === 200 && r.j?.session?.pages?.[0]?.n === 2)

  // ب7 — أخطاء صادقة: دوران غريب وجلسة غائبة وختم بلا صفحات
  r = await postJson("/api/scan", { action: "rotate", id: sid, n: 2, deg: 45 })
  ok("ب7 دوران 45 → 400 invalid-rotation", r.status === 400 && r.j?.error === "invalid-rotation")
  r = await postJson("/api/scan", { action: "rotate", id: "sغائب-x-y", n: 1, deg: 90 })
  ok("ب8 جلسة غائبة → 404", r.status === 404 && r.j?.error === "not-found")

  // ب9 — الختم إلى مجلد الكمبيوتر الافتراضي وقراءة PDF من القرص
  r = await postJson("/api/scan", { action: "seal", id: sid })
  const sealedName = r.j?.file
  ok("ب9 ختم: ملف PDF بعدد صفحات وحجم", r.status === 200 && r.j?.ok === true && sealedName?.endsWith(".pdf") && r.j.pages === 2 && r.j.bytes > 400)
  const pdfPath = path.join(process.cwd(), "data", "nexus-storage", "pc-fs", "Documents", sealedName)
  const pdfBuf = fs.readFileSync(pdfPath)
  const pdfStr = pdfBuf.toString("binary")
  ok("ب10 PDF على القرص: صفحتان DCTDecode وEOF", pdfBuf.subarray(0, 8).toString("binary") === "%PDF-1.4" && (pdfStr.match(/\/Subtype \/Image/g) || []).length === 2 && pdfStr.includes("/Filter /DCTDecode") && pdfStr.trimEnd().endsWith("%%EOF"))
  ok("ب11 الصندوق المدار للصفحة المدارة موجود", pdfStr.includes("/MediaBox [0 0 1 1]"))
  // الجلسة اختفت بعد الختم
  r = await getJson(`/api/scan?id=${encodeURIComponent(sid)}`)
  ok("ب12 بعد الختم: الجلسة مغلقة 404", r.status === 404)

  // ب13 — ختم بلا صفحات → 400 وهدف خارج الجذر → 400
  r = await postJson("/api/scan", { action: "open", title: "فارغة" })
  const sid2 = r.j?.session?.id
  r = await postJson("/api/scan", { action: "seal", id: sid2 })
  ok("ب13 ختم بلا صفحات → 400 no-pages", r.status === 400 && r.j?.error === "no-pages")
  await upload(sid2, TINY_JPEG)
  r = await postJson("/api/scan", { action: "seal", id: sid2, targetFolder: "../../../../etc" })
  ok("ب14 هدف خارج الجذر → 400 bad-target", r.status === 400 && r.j?.error === "bad-target")
  r = await postJson("/api/scan", { action: "cancel", id: sid2 })
  ok("ب15 إلغاء: ok والمجلد نُظّف", r.j?.ok === true && !fs.existsSync(path.join(SCANS, sid2)))

  // ب16 — حذف صفحة من جلسة حية
  r = await postJson("/api/scan", { action: "open", title: "حذف" })
  const sid3 = r.j?.session?.id
  await upload(sid3, TINY_JPEG)
  await upload(sid3, TINY_JPEG)
  r = await postJson("/api/scan", { action: "remove", id: sid3, n: 1 })
  ok("ب16 حذف صفحة: بقي ن = 1", r.status === 200 && r.j?.session?.pages.length === 1 && r.j.session.pages[0].n === 2)
  await postJson("/api/scan", { action: "cancel", id: sid3 })

  // ب17 — سجل §39: أفعال scan موثقة ببايتات وأبعاد حصرًا (لا صور ولا محتوى)
  r = await getJson("/api/enterprise/audit?limit=400")
  const evs = (r.j?.events ?? []).filter((e) => String(e.k).startsWith("scan"))
  const kindsSet = new Set(evs.map((e) => e.k))
  const noBinary = evs.every((e) => !JSON.stringify(e.d ?? {}).includes("GIF89a"))
  ok("ب17 سجل §39: open/add/rotate/move/seal/cancel/denied موثقة", ["scan.session.open", "scan.page.add", "scan.page.rotate", "scan.page.move", "scan.seal", "scan.cancel", "scan.denied"].every((k) => kindsSet.has(k)) && noBinary, `kinds=${[...kindsSet].join(",")}`)
}

console.log(`\n═══ §55 scan-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
