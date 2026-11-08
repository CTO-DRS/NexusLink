#!/usr/bin/env node
// NexusLink — قفل التسليم الساكن (عقد §57) — handoff-rest-e2e
// ============================================================
// الطور أ (نقي): صحة المفتاح · كشف المغلف · ختم/فتح بحرفية · IV طازج كل ختم ·
//   الخطأ الثلاثة المغلق (bad-envelope/no-key/auth-failed) · عبث القناغة ·
//   التدوير بمفتاحين · الترحيل النقي · يونيكود وسقوف 8KB.
// الطور ب (حي): الدفع → **القرص لا يرى النص العاري** (البرهان الجوهري) ·
//   الشفافية للعرض والنسخ · ترحيل النص القديم عند أول كتابة · إسقاط العبث
//   بصدق وبقية القائمة حية · تدوير القفل يعيد الختم والقراءة تعمل · حرس
//   loopback للتدوير · سجل §39 بأنواع crypto بلا محتوى.
// الاستخدام:
//   node scripts/handoff-rest-e2e.mjs                     (طور أ حصرًا)
//   node scripts/handoff-rest-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e57-live
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
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e57-live"
})()

/* ═════════════ الطور أ — النواة النقية ═════════════ */
// خطاف حل الوحدات (درس §49): استيراد «./backup-secure-core» بلا امتداد من
// handoff-crypto.ts يمر في مجمّع Next ويكسر node الخام — الخطاف يكمله حصرًا
// لصادرات TS النسبية، صفر أثر خارج البوابة.
const { registerTsResolve } = await import("../scripts/ts-resolve-hooks.cjs")
registerTsResolve()
const {
  isValidLocalKey, inspectPayload, sealPayload, openPayload, sealItemsPure,
  AT_REST_MARKER, AT_REST_VERSION, AT_REST_IV_BYTES,
} = await import("../src/lib/nexus/handoff-crypto.ts")
const { newLocalKey } = await import("../src/lib/nexus/backup-secure-core.ts")

const b64url = (buf) => Buffer.from(buf).toString("base64url")
const K1 = b64url(crypto.getRandomValues(new Uint8Array(32)))
const K2 = b64url(crypto.getRandomValues(new Uint8Array(32)))
const SHORT_K = b64url(crypto.getRandomValues(new Uint8Array(16)))

// أ1–أ2 — صحة المفتاح
ok("أ1 مفتاح 32 بايت base64url سليم و16 بايت مرفوض", isValidLocalKey(K1) === true && isValidLocalKey(SHORT_K) === false)
ok("أ2 المفتاح القمامة والغائب مرفوضان", isValidLocalKey("ليس-مفتاحا") === false && isValidLocalKey("") === false && isValidLocalKey(null) === false)

// أ3–أ5 — كشف الشكل
ok("أ3 نص عاري يُكشف plain", inspectPayload("https://example.com") === "plain" && inspectPayload("مرحبا بالعالم") === "plain")
ok("أ4 JSON بلا علامة §57 يُكشف plain", inspectPayload(JSON.stringify({ v: 1, alg: "a256gcm", iv: "x", ct: "y" })) === "plain")
const SEALED = sealPayload("سر-التسليم-53", K1)
ok("أ5 المغلف يُكشف sealed بعلامته وإصداره", inspectPayload(SEALED) === "sealed" && JSON.parse(SEALED).t === AT_REST_MARKER && JSON.parse(SEALED).v === AT_REST_VERSION && JSON.parse(SEALED).alg === "a256gcm")

// أ6–أ9 — الختم والفتح
ok("أ6 ختم/فتح بحرفية: عربي ورابط", openPayload(sealPayload("https://nexus.example/مقال?q=1", K1), K1).payload === "https://nexus.example/مقال?q=1")
ok("أ7 كل ختم IV طازج — مغلفان متباينان لنفس النص", sealPayload("نص", K1) !== sealPayload("نص", K1))
ok("أ8 الفتح بمفتاح خاطئ → auth-failed", openPayload(SEALED, K2).error === "auth-failed")
ok("أ9 الفتح بلا مفتاح → no-key", openPayload(SEALED, null).error === "no-key")

// أ10–أ11 — الأسباب المغلقة للشكل والعبث
ok("أ10 قناغة مسمومة → auth-failed لا انهيار", (() => { const e = JSON.parse(SEALED); e.ct = "AAAA" + e.ct.slice(4); return openPayload(JSON.stringify(e), K1).error === "auth-failed" })())
ok("أ11 شكل فاسد → bad-envelope", (() => { const e = JSON.parse(SEALED); e.iv = "!!"; return openPayload(JSON.stringify(e), K1).error === "bad-envelope" })() && (() => { const e = JSON.parse(SEALED); e.ct = "قصير"; return openPayload(JSON.stringify(e), K1).error === "bad-envelope" })())

// أ12 — نص 8KB بالحد التعاقدي
ok("أ12 نص 8KB عربي يُختم ويُفك بحرفية", (() => { const big = "س".repeat(8192); return openPayload(sealPayload(big, K1), K1).payload === big })())

// أ13 — ختم قائمة: النص العاري يُختم والمختوم يُترك وبلا مفتاح لا شيء
ok("أ13 ختم قائمة: ترحيل انتقائي صادق", (() => {
  const items = [{ payload: "عاري-1" }, { payload: SEALED }, { payload: "عاري-2" }]
  const r = sealItemsPure(items, K1)
  const afterNoKey = [{ payload: "عاري-3" }]
  sealItemsPure(afterNoKey, null)
  return r.sealed === 2 && inspectPayload(items[0].payload) === "sealed" && inspectPayload(items[1].payload) === "sealed" && afterNoKey[0].payload === "عاري-3"
})())

// أ14 — دورة التدوير الكاملة نقيًا
ok("أ14 تدوير: k2 يفتح ما ختمه وk1 يفقد القدرة", (() => {
  const s1 = sealPayload("عنصر-دائم", K1)
  const o1 = openPayload(s1, K1)
  const s2 = sealPayload(o1.payload, K2)
  return o1.ok === true && openPayload(s2, K2).payload === "عنصر-دائم" && openPayload(s2, K1).error === "auth-failed"
})())

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/handoff-rest-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const base = APP.replace(/\/$/, "")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const HANDOFF_FILE = path.join(LIVE_DIR, "handoff.json")
  fs.mkdirSync(LIVE_DIR, { recursive: true })
  const getJson = async (p) => { const r = await fetch(base + p, { cache: "no-store" }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const postJson = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const readDisk = () => { try { return JSON.parse(fs.readFileSync(HANDOFF_FILE, "utf8")) } catch { return { items: [] } } }
  const reset = () => { try { fs.rmSync(HANDOFF_FILE, { force: true }) } catch { /* غائب */ } }
  reset()

  const SECRET_TEXT = "password: R3stLock#57"

  // ب1 — الدفع → القرص لا يحمل النص العاري (البرهان الجوهري للعقد)
  let r = await postJson("/api/handoff", { action: "push", kind: "text", payload: SECRET_TEXT, sourceDevice: "هاتف القفل" })
  const id1 = r.j?.item?.id
  ok("ب1 الدفع يعمل كالعادة (شفافية كاملة)", r.status === 200 && r.j?.ok === true && typeof id1 === "string")
  const disk1 = readDisk()
  const rawDisk1 = fs.existsSync(HANDOFF_FILE) ? fs.readFileSync(HANDOFF_FILE, "utf8") : ""
  ok("ب2 القرص لا يرى النص العاري — مغلف §57 حصرًا", !rawDisk1.includes("R3stLock") && rawDisk1.includes(AT_REST_MARKER), `bytes=${rawDisk1.length}`)

  // ب3 — الشفافية: GET يعرض معاينة وatRest.active=true وcopy يعيد الحمولة كاملة
  r = await getJson("/api/handoff")
  ok("ب3 GET شفاف: فك حي وحالة القفل معلنة", r.j?.count === 1 && r.j?.atRest?.active === true && String(r.j?.items?.[0]?.preview ?? "").length > 0)
  r = await postJson("/api/handoff", { action: "copy", id: id1 })
  ok("ب4 copy يعيد الحمولة كاملة (الفك عند الاستهلاك)", r.j?.directive?.text === SECRET_TEXT)

  // ب5 — رابط أيضًا: القرص بلا الرابط الخام
  await postJson("/api/handoff", { action: "push", kind: "url", payload: "https://rest.example/مقال/57", sourceDevice: "هاتف القفل" })
  const rawDisk2 = fs.readFileSync(HANDOFF_FILE, "utf8")
  ok("ب5 الرابط أيضًا مغلف على القرص", !rawDisk2.includes("https://rest.example") && rawDisk2.includes(AT_REST_MARKER))

  // ب6 — ترحيل النص العاري القديم عند أول كتابة تالية
  const legacy = { id: "قديم-1", kind: "text", payload: "نص-عاري-قديم-57", sourceDevice: "هاتف", note: "", at: Date.now(), hits: 1, expiresAt: Date.now() + 3_600_000 }
  fs.writeFileSync(HANDOFF_FILE, JSON.stringify({ items: [legacy] }, null, 2))
  r = await getJson("/api/handoff")
  const sawLegacy = (r.j?.items ?? []).some((x) => x.id === "قديم-1")
  await postJson("/api/handoff", { action: "push", kind: "text", payload: "دفعة-ترحيل", sourceDevice: "هاتف القفل" })
  const rawDisk3 = fs.readFileSync(HANDOFF_FILE, "utf8")
  ok("ب6 النص القديم مقروء ثم يُختم عند أول كتابة", sawLegacy && !rawDisk3.includes("نص-عاري-قديم-57") && rawDisk3.includes(AT_REST_MARKER))

  // ب7 — عبث القناغة: العنصر المسموم يُسقط وحده والبقية حية + تدقيق الإسقاط
  const diskBefore = readDisk()
  const victim = JSON.parse(diskBefore.items[0].payload)
  victim.ct = "AAAA" + String(victim.ct).slice(4)
  diskBefore.items[0].payload = JSON.stringify(victim)
  fs.writeFileSync(HANDOFF_FILE, JSON.stringify(diskBefore, null, 2))
  const countBefore = diskBefore.items.length
  r = await getJson("/api/handoff")
  ok("ب7 العبث يُكشف: العنصر المسوموم يُسقط بصدق والقائمة حية", r.j?.count === countBefore - 1)

  // ب8 — تدوير القفل: ok + إعادة ختم + تغير القناغة + القراءة تعمل بالمفتاح الجديد
  const ctBefore = JSON.parse(readDisk().items[0].payload).ct
  r = await postJson("/api/handoff", { action: "rotate-key" })
  ok("ب8 تدوير القفل: ok وعدد مختم معلن", r.status === 200 && r.j?.ok === true && typeof r.j?.resealed === "number")
  const diskAfter = readDisk()
  const ctAfter = diskAfter.items.length > 0 ? JSON.parse(diskAfter.items[0].payload).ct : ""
  ok("ب9 إعادة الختم بالمفتاح الجديد: قناغة متغيرة وحجم محفوظ", ctAfter !== "" && ctAfter !== ctBefore)
  const survivor = (await getJson("/api/handoff")).j?.items?.[0]?.id
  r = await postJson("/api/handoff", { action: "copy", id: survivor })
  ok("ب10 القراءة بعد التدوير سليمة (شفافية كاملة)", r.j?.ok === true && typeof r.j?.directive?.text === "string" && r.j.directive.text.length > 0)

  // ب11 — التدوير من خارج الجهاز → 403 (حرس loopback)
  r = await postJson("/api/handoff", { action: "rotate-key" }, { "x-gw-client-ip": "10.0.0.9" })
  ok("ب11 تدوير من خارج الجهاز → 403", r.status === 403 && r.j?.error === "handoff-admin-loopback-only")

  // ب12 — تفريغ ثم سجل §39 بلا محتوى
  r = await postJson("/api/handoff", { action: "clear" })
  ok("ب12 التفريغ يعمل والقرص قائمة فارغة", r.j?.ok === true && readDisk().items.length === 0)
  r = await getJson("/api/enterprise/audit?limit=400")
  const evs = (r.j?.events ?? []).filter((e) => String(e.k).startsWith("handoff.crypto"))
  const kindsSet = new Set(evs.map((e) => e.k))
  const noLeak = evs.every((e) => !JSON.stringify(e.d ?? {}).includes("R3stLock") && !JSON.stringify(e.d ?? {}).includes("نص-عاري-قديم"))
  ok("ب13 سجل §39: crypto.rotate وcrypto.drop موثقة بلا محتوى", kindsSet.has("handoff.crypto.rotate") && kindsSet.has("handoff.crypto.drop") && noLeak, `kinds=${[...kindsSet].join(",")}`)

  // ب14 — المفتاح لا يسافر أبدًا: استجابة التدوير بلا أي مفتاح
  r = await postJson("/api/handoff", { action: "rotate-key" })
  ok("ب14 استجابة التدوير بلا مادة مفاتيح إطلاقًا", !JSON.stringify(r.j ?? {}).match(/["']?key["']?\s*:/))
}

console.log(`\n═══ §57 handoff-rest-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
