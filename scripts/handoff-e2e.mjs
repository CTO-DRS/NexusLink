#!/usr/bin/env node
// NexusLink — التسليم اليدوي الذكي (عقد §53) — handoff-e2e
// ============================================================
// الطور أ (نقي): التدقيق والأسباب المغلقة (مخططات/أطوال/موضع وسائط) + التكرار
//   الذكي داخل النافذة + السقف والطرد + التقليم + المعاينة المقنّعة بتآزر §50
//   + بصمة العرض + توجيهات الأفعال الثلاثة.
// الطور ب (حي): دورة كاملة — دفع من «هاتف» → ظهور مقنّع → فعل فاتح → النسخ
//   → الإزالة → الأخطاء الصادقة (نوع غريب/رابط خطير/موضع فاسد/معرف غائب)
//   → التكرار الذكي حيًا → السقف 50 حيًا → معدل 429 → حرس loopback للتفريغ
//   → تقليم TTL بحقن ملف → مشغل الروتينات handoff.arrived يُطلق فعلًا حيًا
//   → سجل §39 يحمل أفعال handoff بأطوال وبصمات حصرًا.
// الاستخدام:
//   node scripts/handoff-e2e.mjs                     (طور أ حصرًا)
//   node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e53-live
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
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e53-live"
})()

/* ═════════════ الطور أ — النواة النقية ═════════════ */
const {
  isHandoffKind, validateHandoff, pruneHandoff, pushHandoffPure,
  handoffFingerprint, handoffPreview, handoffPreviewWith, parseMediaPosition,
  publicHandoffItem, actDirective,
  HANDOFF_URL_MAX, HANDOFF_TEXT_MAX, HANDOFF_CAP, HANDOFF_TTL_MS, HANDOFF_DEDUPE_MS,
} = await import("../src/lib/nexus/handoff-core.ts")

const T0 = 1_700_000_000_000

// أ1–أ3 — الأنواع والصحة الأساسية
ok("أ1 الأنواع الأربعة معروفة والغريب مرفوض", isHandoffKind("url") && isHandoffKind("text") && isHandoffKind("file-ref") && isHandoffKind("media-position") && !isHandoffKind("exec"))
ok("أ2 دفع url سليم يمر بمصدر وملاحظة منقّاة", validateHandoff({ kind: "url", payload: "https://example.com/a?b=1", sourceDevice: "جا لسياسـة\nلكس", note: "ملاحظة" }).ok === true)
ok("أ3 نص فارغ → empty-payload", validateHandoff({ kind: "text", payload: "  " }).error === "empty-payload")

// أ4–أ7 — أسباب الرفض المغلقة
ok("أ4 رابط بلا مخطط أو بمخطط تنفيذ → url-scheme", validateHandoff({ kind: "url", payload: "example.com/x" }).error === "url-scheme" && validateHandoff({ kind: "url", payload: "javascript:alert(1)" }).error === "url-scheme" && validateHandoff({ kind: "url", payload: "file:///etc/passwd" }).error === "url-scheme")
ok("أ5 رابط طويل فوق السقف → url-too-long", validateHandoff({ kind: "url", payload: "https://a.com/" + "x".repeat(HANDOFF_URL_MAX) }).error === "url-too-long")
ok("أ6 نص طويل → text-too-long", validateHandoff({ kind: "text", payload: "س".repeat(HANDOFF_TEXT_MAX + 1) }).error === "text-too-long")
ok("أ7 نوع غريب → unknown-kind", validateHandoff({ kind: "cmd", payload: "x" }).error === "unknown-kind")

// أ8–أ10 — موضع الوسائط
ok("أ8 موضع وسائط سليم يُفكك", parseMediaPosition(JSON.stringify({ media: "فيديو.mp4", positionMs: 65_000 }))?.positionMs === 65_000)
ok("أ9 موضع سالب أو عائم أو فاسد → رفض", parseMediaPosition("{\"media\":\"م\",\"positionMs\":-1}") === null && parseMediaPosition("{\"media\":\"م\",\"positionMs\":1.5}") === null && parseMediaPosition("نص") === null)
ok("أ10 دفع media-position فاسد → bad-media-position", validateHandoff({ kind: "media-position", payload: "{\"media\":\"م\",\"positionMs\":-5}" }).error === "bad-media-position")

// أ11–أ13 — التقليم والسقف والطرد
const mk = (i, at, exp) => ({ id: `id${i}`, kind: "text", payload: `نص${i}`, sourceDevice: "هاتف", note: "", at, hits: 1, expiresAt: exp })
ok("أ11 المنتهي يُقلَّم والح活的 يبقى", pruneHandoff([mk(1, T0, T0 - 1), mk(2, T0, T0 + 100)], T0).map((x) => x.id).join(",") === "id2")
ok("أ12 سقف 50: طرد الأقدم حتميًا", (() => { const items = []; for (let i = 0; i < HANDOFF_CAP + 3; i++) items.push(mk(i, T0 + i, T0 + HANDOFF_TTL_MS)); const r = pushHandoffPure(items, mk(99, T0 + 999, T0 + HANDOFF_TTL_MS), T0); return r.items.length === HANDOFF_CAP && r.deduped === false && !r.items.some((x) => x.id === "id0") && r.items.some((x) => x.id === "id99") })())
ok("أ13 التكرار داخل نافذة 60ث: يرفع hits ولا يضاعف", (() => { const base = [mk(1, T0, T0 + HANDOFF_TTL_MS)]; const again = { ...mk(2, T0 + 10_000, T0 + HANDOFF_TTL_MS), kind: "text", payload: "نص1" }; const r = pushHandoffPure(base, again, T0 + 10_000); return r.deduped === true && r.items.length === 1 && r.items[0].hits === 2 })())

// أ14–أ16 — التكرار خارج النافذة والمعاينة
ok("أ14 نفس النص بعد النافذة = عنصر جديد", (() => { const base = [{ ...mk(1, T0 - HANDOFF_DEDUPE_MS - 1, T0 + HANDOFF_TTL_MS) }]; const again = { ...mk(2, T0, T0 + HANDOFF_TTL_MS), payload: "نص1" }; const r = pushHandoffPure(base, again, T0); return r.deduped === false && r.items.length === 2 })())
ok("أ15 معاينة url: مضيف + مقطع", handoffPreview("url", "https://docs.example.com/عميق/مسار?q=1").startsWith("docs.example.com"))
ok("أ16 معاينة نص مع حساسية §50 تُقنَّع", handoffPreviewWith("text", "password: Sup3rSecret99", (s) => ({ sensitive: /pass/i.test(s) ? "password" : null }), (s, sen) => (sen ? "••••••" : s)).includes("•") === true)
ok("أ17 معاينة نص عادي تُقص عند 80", handoffPreview("text", "ا".repeat(200)).length <= 80)

// أ18–أ20 — البصمة والتوجيهات والعرض العام
ok("أ18 بصمة حتمية متمايزة 16 سداسي", /^[0-9a-f]{16}$/.test(handoffFingerprint("نص")) && handoffFingerprint("نص") === handoffFingerprint("نص") && handoffFingerprint("نص") !== handoffFingerprint("نص2"))
ok("أ19 توجيهات الأفعال الثلاثة صادقة", actDirective("url", "https://a.b").directive === "open-url" && actDirective("text", "مرحبا").directive === "copy" && actDirective("file-ref", "/Downloads/x.pdf").directive === "open-file" && actDirective("media-position", JSON.stringify({ media: "م", positionMs: 1000 })).directive === "resume-media")
ok("أ20 العرض العام بلا حمولة كاملة", (() => { const v = publicHandoffItem(mk(1, T0, T0 + 1000), "معاينة"); return !JSON.stringify(v).includes("نص1") && v.fingerprint.length === 16 && v.preview === "معاينة" })())

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const base = APP.replace(/\/$/, "")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const HANDOFF_FILE = path.join(LIVE_DIR, "handoff.json")
  fs.mkdirSync(LIVE_DIR, { recursive: true })
  const getJson = async (p) => { const r = await fetch(base + p, { cache: "no-store" }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const postJson = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const writeState = (items) => fs.writeFileSync(HANDOFF_FILE, JSON.stringify({ items }, null, 2))
  const reset = () => { try { fs.rmSync(HANDOFF_FILE, { force: true }) } catch { /* غائب */ } }
  reset()

  // ب1 — دفع رابط من «هاتف» → ظهور معاينة مضيف بلا حمولة كاملة
  let r = await postJson("/api/handoff", { action: "push", kind: "url", payload: "https://nexus.example/article/53", sourceDevice: "هاتف الاختبار", note: "أكمل القراءة" })
  const id1 = r.j?.item?.id
  ok("ب1 دفع url: معرّف ومعاينة مضيف وبصمة", r.status === 200 && r.j.ok === true && typeof id1 === "string" && r.j.item.preview.startsWith("nexus.example") && r.j.item.fingerprint.length === 16)

  // ب2 — GET يعيد القائمة بلا الحمولة الكاملة (المخطط https:// هو مؤشر التسريب — المعاينة مقصودة)
  r = await getJson("/api/handoff")
  ok("ب2 GET: عنصر واحد بالمعاينة بلا الرابط الخام", r.j?.count === 1 && !JSON.stringify(r.j).includes("https://nexus.example"))

  // ب3 — التكرار الذكي حيًا: نفس الرابط خلال 60ث → hits=2 بلا مضاعفة
  r = await postJson("/api/handoff", { action: "push", kind: "url", payload: "https://nexus.example/article/53", sourceDevice: "هاتف الاختبار" })
  ok("ب3 تكرار حي: deduped=true وhits=2", r.j?.deduped === true && r.j.item.hits === 2)

  // ب4 — الفعل open يستهلك ويعيد توجيه open-url
  r = await postJson("/api/handoff", { action: "open", id: id1 })
  ok("ب4 open: توجيه open-url بالرابط", r.j?.ok === true && r.j.directive?.directive === "open-url" && r.j.directive.url === "https://nexus.example/article/53")
  r = await getJson("/api/handoff")
  ok("ب5 بعد open: القائمة فارغة (استُهلك)", r.j?.count === 0)

  // ب6 — نص حساس يظهر مقنّعًا في القائمة ويُنسخ كاملًا عند الفعل
  r = await postJson("/api/handoff", { action: "push", kind: "text", payload: "password: T0pSecret#53", sourceDevice: "هاتف" })
  const sid = r.j?.item?.id
  const masked = r.j?.item?.preview ?? ""
  ok("ب6 نص حساس: معاينة مقنّعة بلا السر", masked.includes("T0pSecret") === false && masked.length > 0)
  r = await postJson("/api/handoff", { action: "copy", id: sid })
  ok("ب7 copy: الحمولة الكاملة عند الاستهلاك حصرًا", r.j?.directive?.text === "password: T0pSecret#53")

  // ب8 — الأخطاء الصادقة
  r = await postJson("/api/handoff", { action: "push", kind: "url", payload: "javascript:alert(1)" })
  ok("ب8 مخطط تنفيذ → 400 url-scheme", r.status === 400 && r.j?.error === "url-scheme")
  r = await postJson("/api/handoff", { action: "push", kind: "media-position", payload: "فاسد" })
  ok("ب9 موضع فاسد → 400 bad-media-position", r.status === 400 && r.j?.error === "bad-media-position")
  r = await postJson("/api/handoff", { action: "open", id: "h-غائب" })
  ok("ب10 معرف غائب → 404 not-found", r.status === 404 && r.j?.error === "not-found")
  r = await postJson("/api/handoff", { action: "غريب" })
  ok("ب11 فعل غريب → 400 unknown-action", r.status === 400 && r.j?.error === "unknown-action")

  // ب12 — حرس loopback للتفريغ (انتحال ترويسة البوابة)
  r = await postJson("/api/handoff", { action: "clear" }, { "x-gw-client-ip": "10.0.0.9" })
  ok("ب12 تفريغ من خارج الجهاز → 403", r.status === 403 && r.j?.error === "handoff-admin-loopback-only")

  // ب13 — السقف 50 حيًا: دفع 55 نصًا مميزًا → لا يتجاوز 50 والأقدم طُرد
  reset()
  let capOk = true
  for (let i = 0; i < 55; i++) {
    const rr = await postJson("/api/handoff", { action: "push", kind: "text", payload: `عنصر-${i}-${"x".repeat(10)}`, sourceDevice: `ضخّاخ-${i}` })
    if (!rr.j?.ok) { capOk = false; break }
  }
  r = await getJson("/api/handoff")
  ok("ب13 سقف 50 حيًا والأقدم طُرد", capOk && r.j?.count === 50 && !JSON.stringify(r.j).includes("عنصر-0-") && JSON.stringify(r.j).includes("عنصر-54-"))

  // ب14 — معدل الدفع: 30/د لكل مصدر — مصدر مختلف يعمل والنافذة تفتح
  reset()
  let saw429 = false
  for (let i = 0; i < 32; i++) {
    const rr = await postJson("/api/handoff", { action: "push", kind: "text", payload: `معدل-${i}`, sourceDevice: "مصدر-المعدل" })
    if (rr.status === 429) { saw429 = true; break }
  }
  const other = await postJson("/api/handoff", { action: "push", kind: "text", payload: "مصدر آخر حر", sourceDevice: "مصدر-آخر" })
  ok("ب14 معدل 30/د: قفل للمصدر الممتلئ وحرية لغيره", saw429 && other.j?.ok === true)

  // ب15 — تقليم TTL بحقن ملف منتهٍ
  writeState([{ id: "قديم", kind: "text", payload: "نص قديم", sourceDevice: "هاتف", note: "", at: Date.now() - 86_500_000, hits: 1, expiresAt: Date.now() - 500_000 }])
  r = await getJson("/api/handoff")
  ok("ب15 المنتهي يُقلَّم حيًا من القرص", r.j?.count === 0 && !fs.existsSync(HANDOFF_FILE) === false && JSON.parse(fs.readFileSync(HANDOFF_FILE, "utf8")).items.length === 0)

  // ب16 — مشغل الروتينات handoff.arrived يُطلق حيًا (عقد §26 فوق ناقل الحقائق)
  reset()
  const ruleName = "e53-handoff-rule"
  let cr = await postJson("/api/automation/rules", { action: "upsert", rule: { name: ruleName, enabled: true, trigger: { kind: "handoff.arrived" }, action: { kind: "notify", text: "وصل تسليم يدوي" } } })
  const ruleId = cr.j?.rule?.id
  ok("ب16 إنشاء قاعدة handoff.arrived عبر API مقبول", cr.status === 200 && cr.j?.ok === true && typeof ruleId === "string")
  await postJson("/api/handoff", { action: "push", kind: "url", payload: "https://trigger.example/53", sourceDevice: "هاتف التشغيل" })
  await new Promise((res) => setTimeout(res, 1500))
  cr = await postJson("/api/automation/rules", { action: "fires" })
  const fired = (cr.j?.fires ?? []).some((f) => f.ruleName === ruleName || f.ruleId === ruleId)
  ok("ب17 الدفع أطلق القاعدة (إطلاق مرسوخ)", fired, `fires=${(cr.j?.fires ?? []).length}`)
  if (ruleId) await postJson("/api/automation/rules", { action: "delete", id: ruleId })

  // ب18 — التفريغ المحلي أولًا (ليُدوَّن handoff.clear) ثم فحص السجل كاملًا
  r = await postJson("/api/handoff", { action: "clear" })
  ok("ب18 تفريغ محلي: ok وعدد محذوف ≥ 1", r.j?.ok === true && r.j.removed >= 1)
  r = await getJson("/api/enterprise/audit?limit=400")
  const evs = (r.j?.events ?? []).filter((e) => String(e.k).startsWith("handoff"))
  const kindsSet = new Set(evs.map((e) => e.k))
  const noLeak = evs.every((e) => !JSON.stringify(e.d ?? {}).includes("T0pSecret") && !JSON.stringify(e.d ?? {}).includes("https://trigger.example") && !JSON.stringify(e.d ?? {}).includes("https://nexus.example"))
  ok("ب19 سجل §39: arrive/dedupe/open/clear/denied موثقة بلا محتوى", ["handoff.arrive", "handoff.dedupe", "handoff.open", "handoff.clear", "handoff.denied"].every((k) => kindsSet.has(k)) && noLeak, `kinds=${[...kindsSet].join(",")}`)

  // ب20 — بعد التفريغ: القائمة صفر
  r = await getJson("/api/handoff")
  ok("ب20 بعد التفريغ: القائمة صفر", r.j?.count === 0)
}

console.log(`\n═══ §53 handoff-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
