#!/usr/bin/env node
// NexusLink — بوابة أنواع الدفع الكاملة من الهاتف (§60) — agent-handoff-kinds-e2e
// ============================================================
// إغلاق الحد المعلن من §56 حرفيًا: الأنواع الأربعة التي تعرفها نواة §53
// (url · text · file-ref · media-position) كلها دافوعة من وكيل Flutter.
//
// الطور أ (نقي): مرآة تحقق الوكيل (nexus_api.dart — handoffPush/handoffPushFileRef/
//   handoffPushMediaPosition) تطابق نواة السيرفر validateHandoff/parseMediaPosition
//   حالةً حالة — حدود السقوف بايتيًا (512 حرفيًا · موضع 0..86400000 · اسم ≤200)
//   + معاينتا النوعين الجديدين (basename · name @ m:ss).
//
// الطور ب (حي): الاستدعاءات الحرفية التي يبنيها الوكيل تلحق السيرفر:
//   push file-ref → القائمة بمعاينة basename وبلا حمولة في GET · فعل open
//   يرجع open-file بالمسار · push media-position → معاينة name @ m:ss · فعل
//   open يرجع resume-media بالموضع نفسه · الأسباب المغلقة حية (ref-too-long ·
//   bad-media-position بثلاث فجواتها) · التكرار الذكي يرفع hits · القائمة
//   المختلطة بالأنواع الأربعة وإزالة فردية صادقة.
//
// الاستخدام:
//   node scripts/agent-handoff-kinds-e2e.mjs                    (طور أ حصرًا)
//   node scripts/agent-handoff-kinds-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e60-live
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

/* ═════════════ الطور أ — النواة النقية: مرآة الوكيل ═════════════ */
const {
  validateHandoff, parseMediaPosition, handoffPreview, actDirective,
  HANDOFF_REF_MAX, HANDOFF_POSITION_MAX_MS,
} = await import("../src/lib/nexus/handoff-core.ts")

console.log("—— الطور أ: مرآة تحقق الوكيل (nexus_api.dart) ضد نواة §53 ——")

{
  // سقوف file-ref — الحدود بالضبط كما يتحقق منها handoffPush في الوكيل
  const refBase = "/storage/emulated/0/Download/"
  const ref512 = refBase + "م".repeat(512 - refBase.length - ".pdf".length) + ".pdf"
  ok("أ1 file-ref عند السقف 512 يُقبل طرفًا وطرفًا", ref512.length === 512 && HANDOFF_REF_MAX === 512 && validateHandoff({ kind: "file-ref", payload: ref512 }).ok === true)
  ok("أ2 file-ref ‏513 → ref-too-long (الحد الحرفي)", validateHandoff({ kind: "file-ref", payload: "م".repeat(513) }).error === "ref-too-long")
  ok("أ3 file-ref فارغ → empty-payload", validateHandoff({ kind: "file-ref", payload: "   " }).error === "empty-payload")

  // موضع الوسائط — مرآة parseMediaPosition بايتيًا (jsonEncode في Dart يبني الشكل نفسه)
  const mp = (media, positionMs) => JSON.stringify({ media, positionMs })
  ok("أ4 موضع سليم يُفكك (فيديو @ 65_000)", parseMediaPosition(mp("فيديو.mp4", 65_000))?.positionMs === 65_000)
  ok("أ5 حدود الموضع: 0 و86400000 يقبلان وفوقهما وسالب وعائم ترفض", parseMediaPosition(mp("م", 0))?.positionMs === 0 && parseMediaPosition(mp("م", HANDOFF_POSITION_MAX_MS))?.positionMs === HANDOFF_POSITION_MAX_MS && parseMediaPosition(mp("م", HANDOFF_POSITION_MAX_MS + 1)) === null && parseMediaPosition(mp("م", -1)) === null && parseMediaPosition(mp("م", 1.5)) === null)
  ok("أ6 اسم الوسيط: 200 يقبل و201 وفارغ يرفضان", parseMediaPosition(mp("و".repeat(200), 1)) !== null && parseMediaPosition(mp("و".repeat(201), 1)) === null && parseMediaPosition(mp("", 1)) === null)

  // الشكل الفاسد — ما يرميه الوكيل محليًا bad-media-position قبل أي رحلة شبكة
  ok("أ7 شكل فاسد: نص خام ومصفوفة ونوع خاطئ → bad-media-position", validateHandoff({ kind: "media-position", payload: "نص" }).error === "bad-media-position" && validateHandoff({ kind: "media-position", payload: "[1,2]" }).error === "bad-media-position" && validateHandoff({ kind: "media-position", payload: mp("م", "125") }).error === "bad-media-position")
  ok("أ8 موضع وسائط حمولته >512 محرفًا → ref-too-long (السقف المشترك قبل الشكل)", validateHandoff({ kind: "media-position", payload: mp("و".repeat(490), 1) }).error === "ref-too-long")

  // المعاينتان — ما يعرضه جرس الكمبيوتر للنوعين الجديدين
  ok("أ9 معاينة file-ref = الاسم الأخير بفاصلَي / و \\", handoffPreview("file-ref", "/storage/emulated/0/Download/عقد.pdf") === "عقد.pdf" && handoffPreview("file-ref", "C:\\Users\\sami\\تقرير.docx") === "تقرير.docx")
  ok("أ10 معاينة media-position = «name @ m:ss»", handoffPreview("media-position", mp("فيديو.mp4", 65_000)) === "فيديو.mp4 @ 1:05")

  // جدول المرآة الكامل — كل مدخل يرميه الوكيل محليًا يرميه السيرفر بالنفس
  const mirror = [
    { kind: "file-ref", payload: "/a/ب.pdf", want: true },
    { kind: "file-ref", payload: "م".repeat(513), want: "ref-too-long" },
    { kind: "media-position", payload: mp("م", 42_000), want: true },
    { kind: "media-position", payload: "{not-json", want: "bad-media-position" },
    { kind: "media-position", payload: mp("م", 86_400_001), want: "bad-media-position" },
    { kind: "media-position", payload: "  ", want: "empty-payload" },
    { kind: "file-position", payload: "x", want: "unknown-kind" },
  ]
  const parity = mirror.every((c) => {
    const r = validateHandoff({ kind: c.kind, payload: c.payload })
    return c.want === true ? r.ok === true : r.error === c.want
  })
  ok("أ11 جدول المرآة سبعة مداخل يطابق السيرفر حالةً حالة", parity)
  ok("أ12 توجيهات الفعل: open-file وresume-media بالموضع نفسه", actDirective("file-ref", "/a/ب.pdf").directive === "open-file" && actDirective("media-position", mp("م", 42_000)).directive === "resume-media" && actDirective("media-position", mp("م", 42_000)).positionMs === 42_000)
}

/* ═════════════ الطور ب — الحي: استدعاءات الوكيل على السيرفر ═════════════ */
if (APP) {
  console.log("—— الطور ب: حي — استدعاءات handoffPush الفعلية للوكيل ——")
  const PHONE = "Galaxy S24 (agent-e60)"
  const mp = (media, positionMs) => JSON.stringify({ media, positionMs })

  // ب1 — push file-ref بالشكل الحرفي الذي يبنيه handoffPushFileRef
  let r = await postJson("/api/handoff", { action: "push", kind: "file-ref", payload: "/storage/emulated/0/Documents/عقد-الإيجار.pdf", sourceDevice: PHONE, note: "من المعرض" })
  ok("ب1 push file-ref يقبله السيرفر", r.status === 200 && r.j?.ok === true, `status=${r.status}`)
  const refId = r.j?.item?.id ?? r.j?.id

  r = await getJson("/api/handoff")
  const refItem = (r.j?.items ?? []).find((x) => x.kind === "file-ref" && x.sourceDevice === PHONE)
  ok("ب2 القائمة تعرض معاينة basename والحمولة لا تعود في GET", !!refItem && refItem.preview === "عقد-الإيجار.pdf" && refItem.payload === undefined, refItem ? `preview="${refItem.preview}"` : "لا عنصر")

  r = await postJson("/api/handoff", { action: "open", id: refId })
  ok("ب3 فعل open على file-ref يرجع open-file بالمسار الكامل", r.status === 200 && r.j?.ok === true && r.j?.directive?.directive === "open-file" && r.j.directive?.path === "/storage/emulated/0/Documents/عقد-الإيجار.pdf", `status=${r.status}`)

  // ب4 — push media-position بالشكل الحرفي الذي يبنيه handoffPushMediaPosition
  r = await postJson("/api/handoff", { action: "push", kind: "media-position", payload: mp("محاضرة-الذكاء.mp4", 65_000), sourceDevice: PHONE })
  ok("ب4 push media-position يقبله السيرفر", r.status === 200 && r.j?.ok === true, `status=${r.status}`)
  const medId = r.j?.item?.id ?? r.j?.id

  r = await getJson("/api/handoff")
  const medItem = (r.j?.items ?? []).find((x) => x.kind === "media-position" && x.sourceDevice === PHONE)
  ok("ب5 معاينته «name @ m:ss» وبلا حمولة في GET", !!medItem && medItem.preview === "محاضرة-الذكاء.mp4 @ 1:05" && medItem.payload === undefined, medItem ? `preview="${medItem.preview}"` : "لا عنصر")

  r = await postJson("/api/handoff", { action: "open", id: medId })
  ok("ب6 فعل open يرجع resume-media بالموضع نفسه", r.status === 200 && r.j?.ok === true && r.j?.directive?.directive === "resume-media" && r.j.directive?.media === "محاضرة-الذكاء.mp4" && r.j.directive?.positionMs === 65_000, `status=${r.status}`)

  // الأسباب المغلقة حية — ما يصطاده الوكيل محليًا يصطاده السيرفر بالنفس
  r = await postJson("/api/handoff", { action: "push", kind: "file-ref", payload: "م".repeat(513), sourceDevice: PHONE })
  ok("ب7 file-ref ‏513 حيًا → 400 ref-too-long", r.status === 400 && r.j?.error === "ref-too-long", `status=${r.status}`)

  r = await postJson("/api/handoff", { action: "push", kind: "media-position", payload: "{not-json", sourceDevice: PHONE })
  ok("ب8 موضع JSON فاسد حيًا → 400 bad-media-position", r.status === 400 && r.j?.error === "bad-media-position", `status=${r.status}`)

  r = await postJson("/api/handoff", { action: "push", kind: "media-position", payload: mp("م", 86_400_001), sourceDevice: PHONE })
  ok("ب9 موضع فوق 24س حيًا → 400 bad-media-position", r.status === 400 && r.j?.error === "bad-media-position", `status=${r.status}`)

  r = await postJson("/api/handoff", { action: "push", kind: "media-position", payload: mp("و".repeat(201), 1), sourceDevice: PHONE })
  ok("ب10 اسم وسيط >200 حيًا → 400 bad-media-position", r.status === 400 && r.j?.error === "bad-media-position", `status=${r.status}`)

  // التكرار الذكي — «فتح» ب3 أزل العنصر فدفعتان جديدتان = عنصر واحد hits=2
  await postJson("/api/handoff", { action: "push", kind: "file-ref", payload: "/storage/emulated/0/Documents/عقد-الإيجار.pdf", sourceDevice: PHONE })
  r = await postJson("/api/handoff", { action: "push", kind: "file-ref", payload: "/storage/emulated/0/Documents/عقد-الإيجار.pdf", sourceDevice: PHONE })
  const refId2 = r.j?.item?.id
  const refList = await getJson("/api/handoff")
  const bumped = (refList.j?.items ?? []).filter((x) => x.kind === "file-ref" && x.sourceDevice === PHONE)
  ok("ب11 التكرار الذكي: دفعتان نفس المرجع → عنصر واحد hits=2", bumped.length === 1 && bumped[0].hits === 2, `count=${bumped.length} hits=${bumped[0]?.hits}`)

  // القائمة المختلطة — الأنواع الأربعة من الهاتف نفسه تتعايش (ومسار §53 القديم سليم)
  await postJson("/api/handoff", { action: "push", kind: "url", payload: "https://example.com/nexus-e60", sourceDevice: PHONE })
  await postJson("/api/handoff", { action: "push", kind: "media-position", payload: mp("بودكاست-صباحي.mp3", 30_000), sourceDevice: PHONE })
  r = await postJson("/api/handoff", { action: "push", kind: "text", payload: "نص من الوكيل بعد التوسعة", sourceDevice: PHONE })
  ok("ب12 مسار §53 القديم (نص) يعمل بعد التوسعة بلا انحدار", r.status === 200 && r.j?.ok === true, `status=${r.status}`)
  const mixed = await getJson("/api/handoff")
  const kinds = new Set((mixed.j?.items ?? []).filter((x) => x.sourceDevice === PHONE).map((x) => x.kind))
  ok("ب13 القائمة المختلطة تحمل الأنواع الأربعة من الهاتف نفسه", kinds.has("url") && kinds.has("text") && kinds.has("file-ref") && kinds.has("media-position"), `kinds=${[...kinds].join(",")}`)

  // الإزالة الفردية الصادقة — dismiss على عنصر الملف يزيله وحده
  await postJson("/api/handoff", { action: "dismiss", id: refId2 })
  const after = await getJson("/api/handoff")
  const stillThere = (after.j?.items ?? []).find((x) => x.id === refId2)
  const medStill = (after.j?.items ?? []).find((x) => x.kind === "media-position" && x.sourceDevice === PHONE)
  ok("ب14 dismiss على عنصر الملف يزيله حصرًا والوسائط باقية", !stillThere && !!medStill, `med=${!!medStill}`)
}

console.log(`\n═══ agent-handoff-kinds-e2e: ${pass} ناجح · ${fail} فاشل ═══`)
process.exit(fail > 0 ? 1 : 0)
