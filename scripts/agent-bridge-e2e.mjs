#!/usr/bin/env node
// NexusLink — بوابة عقد الوكيل المحمول (§56) — agent-bridge-e2e
// ============================================================
// تثبت حيًا أن استدعاءات REST التي يؤديها وكيل Flutter حرفيًا
// (nexuslink_mobile/lib/data/nexus_api.dart — handoffPush وscanOpen/
// scanAddPage/scanAct/scanSeal/scanCancel) تطابق السيرفر بايتيًا:
//
// §53 التسليم اليدوي (مرآة handoffPush):
//   push رابط صالح {sourceDevice} → ok · القائمة تعرض معاينة مقنّعة ·
//   push نص → ok ثم act copy يعيد الحمولة كاملة (ما يفعله جرس الكمبيوتر) ·
//   الأسباب المغلقة من السيرفر نفسها التي يتحقق منها الوكيل محليًا مرآةً:
//   مخطط غريب url-scheme · فارغ empty-payload · رابط >2048 url-too-long ·
//   نص >8192 text-too-long · نوع مجهول unknown-kind.
//
// §55 الماسح الموثق (مرآة دورة الوكيل open → page → seal):
//   open بعنوان → جلسة · رفع صفحتين JPEG حقيقيتين بنفس شكل multipart
//   الذي يبنيه http.MultipartRequest (حقل file + filename) · تدوير 90 ·
//   إعادة ترتيب from/to صفريي الأساس · رفض PNG (فحص السحر مرآةً محليًا
//   في الوكيل والسيرفر) · رفض دوران 45 (مجموعة مغلقة) · ختم → PDF حقيقي
//   على القرص يبدأ %PDF ويعود file/bytes/pages/target · الحالة sealed ·
//   إلغاء جلسة أخرى → not-found بعده (404).
//
// الاستخدام:
//   node scripts/agent-bridge-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e56-live
// خروج 0 = أخضر، 1 = أحمر. القاعدة: جولتان متتاليتان أخضرتان.

let pass = 0
let fail = 0
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? " — " + extra : ""}`) }
  else { fail++; console.log(`❌ ${name}${extra ? " — " + extra : ""}`) }
}

const APP = (() => {
  const i = process.argv.indexOf("--app")
  return i > 0 ? process.argv[i + 1] : "http://127.0.0.1:3000"
})()
const LIVE_DIR = (() => {
  const i = process.argv.indexOf("--dir")
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e56-live"
})()

import fs from "node:fs"
import path from "node:path"

async function postJson(p, body) {
  const r = await fetch(APP + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  let j = null
  try { j = await r.json() } catch { /* بلا جسم */ }
  return { status: r.status, j }
}
async function getJson(p) {
  const r = await fetch(APP + p)
  let j = null
  try { j = await r.json() } catch { /* بلا جسم */ }
  return { status: r.status, j }
}

/** نفس الشكل الذي يبنيه http.MultipartRequest.fromBytes في الوكيل: حقل file مع filename */
async function uploadPage(sessionId, fileName, bytes) {
  const boundary = "nexus-agent-boundary-e56"
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: image/jpeg\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  const body = Buffer.concat([head, bytes, tail])
  const r = await fetch(`${APP}/api/scan/page?id=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: body,
  })
  let j = null
  try { j = await r.json() } catch { /* بلا جسم */ }
  return { status: r.status, j }
}

// JPEG مصغّر حقيقي 1×1 (نفس بصمة scan-e2e القياسية — تمر فحص السحر وأبعاد SOF)
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
// PNG مصغّر (توقيع حقيقي) — يجب أن يرفضه الطرفان
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

const PHONE = "Galaxy S24 (agent-e56)"

/* ═════════════ §53 — مرآة handoffPush ═════════════ */
console.log("—— §53 التسليم اليدوي: مرآة استدعاءات الوكيل ——")

{
  let r = await postJson("/api/handoff", { action: "push", kind: "url", payload: "https://example.com/nexus-article", sourceDevice: PHONE })
  ok("د1 push رابط صالح يقبله السيرفر", r.status === 200 && r.j?.ok === true, `status=${r.status}`)

  r = await getJson("/api/handoff")
  const item = (r.j?.items ?? []).find((x) => x.kind === "url" && x.sourceDevice === PHONE)
  ok("د2 العنصر في القائمة بمعاينة مقنّعة (مضيف+مسار بلا مخطط)", !!item && item.preview === "example.com/nexus-article" && !String(item.preview).includes("https://"), item ? `preview="${item.preview}"` : "لا عنصر")
  ok("د3 الحمولة الكاملة لا تعود في GET", !!item && item.payload === undefined, "GET معاينات حصرًا")

  r = await postJson("/api/handoff", { action: "push", kind: "url", payload: "ftp://example.com/x", sourceDevice: PHONE })
  ok("د4 مخطط غريب → url-scheme (مرآة تحقق الوكيل المحلي)", r.status === 400 && r.j?.error === "url-scheme", `status=${r.status}`)

  r = await postJson("/api/handoff", { action: "push", kind: "url", payload: "   ", sourceDevice: PHONE })
  ok("د5 فارغ → empty-payload", r.status === 400 && r.j?.error === "empty-payload", `status=${r.status}`)

  r = await postJson("/api/handoff", { action: "push", kind: "url", payload: "https://example.com/" + "ط".repeat(2100), sourceDevice: PHONE })
  ok("د6 رابط >2048 → url-too-long", r.status === 400 && r.j?.error === "url-too-long", `status=${r.status}`)

  r = await postJson("/api/handoff", { action: "push", kind: "text", payload: "ن".repeat(8300), sourceDevice: PHONE })
  ok("د7 نص >8192 → text-too-long", r.status === 400 && r.j?.error === "text-too-long", `status=${r.status}`)

  r = await postJson("/api/handoff", { action: "push", kind: "clipboard", payload: "x", sourceDevice: PHONE })
  ok("د8 نوع مجهول → unknown-kind", r.status === 400 && r.j?.error === "unknown-kind", `status=${r.status}`)

  r = await postJson("/api/handoff", { action: "push", kind: "text", payload: "بطاقة عمل الدكتور سامي — هاتف 0500000000", sourceDevice: PHONE, note: "من اجتماعه" })
  ok("د9 push نص بملاحظة يُقبل", r.status === 200 && r.j?.ok === true, `status=${r.status}`)
  const tid = r.j?.item?.id ?? r.j?.id
  r = await postJson("/api/handoff", { action: "copy", id: tid })
  ok("د10 الاستهلاك copy يعيد التوجيه بالحمولة الكاملة (ما يفعله جرس الكمبيوتر)", r.status === 200 && r.j?.ok === true && r.j?.directive?.directive === "copy" && String(r.j.directive?.text ?? "").includes("0500000000"), `status=${r.status}`)
}

/* ═════════════ §55 — مرآة دورة الماسح ═════════════ */
console.log("—— §55 الماسح الموثق: مرآة دورة الوكيل open → page → seal ——")

{
  let r = await postJson("/api/scan", { action: "open", title: "فواتير نوفمبر — من الوكيل" })
  ok("س1 open يفتح جلسة بعنوان", r.status === 200 && r.j?.ok === true && typeof r.j.session?.id === "string" && r.j.session.title === "فواتير نوفمبر — من الوكيل", `status=${r.status}`)
  const sid = r.j.session.id

  r = await getJson(`/api/scan?id=${encodeURIComponent(sid)}`)
  ok("س2 scanGet يعيد حالة بلا بايتات", r.status === 200 && r.j?.ok === true && Array.isArray(r.j.session?.pages) && r.j.session.pages.length === 0, `status=${r.status}`)

  let up = await uploadPage(sid, "page-1.jpg", TINY_JPEG)
  ok("س3 رفع صفحة 1 بنفس شكل multipart الوكيل", up.status === 200 && up.j?.ok === true && up.j.page?.n === 1, `status=${up.status}`)
  up = await uploadPage(sid, "page-2.jpg", TINY_JPEG)
  ok("س4 رفع صفحة 2", up.status === 200 && up.j?.ok === true && up.j.page?.n === 2, `status=${up.status}`)

  up = await uploadPage(sid, "not-image.png", TINY_PNG)
  ok("س5 PNG مرفوض → not-jpeg (مرآة فحص السحر المحلي في الوكيل)", up.status === 400 && up.j?.error === "not-jpeg", `status=${up.status}`)

  r = await postJson("/api/scan", { action: "rotate", id: sid, n: 2, deg: 90 })
  ok("س6 تدوير 90 يُقبل", r.status === 200 && r.j?.session?.pages?.[1]?.rotate === 90, `status=${r.status}`)

  r = await postJson("/api/scan", { action: "move", id: sid, from: 1, to: 0 })
  ok("س7 إعادة ترتيب from=1→to=0 (صفري الأساس كما يرسل الوكيل)", r.status === 200 && r.j?.session?.pages?.[0]?.n === 2, `status=${r.status}`)

  r = await postJson("/api/scan", { action: "rotate", id: sid, n: 1, deg: 45 })
  ok("س8 دوران 45 مرفوض (مجموعة مغلقة)", r.status === 400, `status=${r.status}`)

  r = await postJson("/api/scan", { action: "seal", id: sid })
  const file = r.j?.file ?? ""
  // الختم يكتب في جذر pc-office (data/nexus-storage/pc-fs) + الهدف الافتراضي /Documents
  // درس مُقاس في §59: سيرفر standalone يغيّر cwd إلى .next/standalone — جذر القراءة
  // قابل للتجاوز بـ--data-root (نمط scan-e2e)
  const DATA_ROOT = (() => { const i = process.argv.indexOf("--data-root"); return i > 0 ? process.argv[i + 1] : path.join(process.cwd(), "data") })()
  const pdfOnDisk = file ? (() => { try { return fs.readFileSync(path.join(DATA_ROOT, "nexus-storage/pc-fs/Documents", file)) } catch { return null } })() : null
  ok("س9 ختم → PDF حقيقي على قرص الكمبيوتر", r.status === 200 && r.j?.ok === true && r.j?.pages === 2 && pdfOnDisk && pdfOnDisk.subarray(0, 4).toString() === "%PDF", `bytes=${r.j?.bytes}`)
  ok("س10 نتيجة الختم file/bytes/pages/target كما يفككها الوكيل", typeof file === "string" && file.length > 0 && Number.isInteger(r.j?.bytes) && r.j.bytes > 0 && typeof r.j?.target === "string", `target=${r.j?.target}`)

  r = await getJson(`/api/scan?id=${encodeURIComponent(sid)}`)
  ok("س11 الجلسة المختومة تُحذف من المفتوحة (الأثر = ملف الـPDF نفسه) → 404", r.status === 404 && r.j?.error === "not-found", `status=${r.status}`)

  // دورة إلغاء — المرآة الثانية لscanCancel
  r = await postJson("/api/scan", { action: "open", title: "ستُلغى" })
  const sid2 = r.j.session.id
  await uploadPage(sid2, "x.jpg", TINY_JPEG)
  r = await postJson("/api/scan", { action: "cancel", id: sid2 })
  ok("س12 إلغاء جلسة يُقبل", r.status === 200 && r.j?.ok === true, `status=${r.status}`)
  r = await getJson(`/api/scan?id=${encodeURIComponent(sid2)}`)
  ok("س13 الجلسة الملغاة → not-found بـ404 (ما يتوقعه scanGet في الوكيل)", r.status === 404 && r.j?.error === "not-found", `status=${r.status}`)
}

console.log(`\n═══ agent-bridge-e2e: ${pass} ناجح · ${fail} فاشل ═══`)
process.exit(fail > 0 ? 1 : 0)
