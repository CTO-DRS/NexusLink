#!/usr/bin/env node
// NexusLink — خزنة الحافظة للأجهزة المتعددة (عقد §59) — clip-multikey-e2e
// ============================================================
// الطور أ (نقي): kid حتمي مشتق · شكل المغلف بkid وترتيبه · الفتح بالحلال
//   (kid←مفتاح) · kid غائب → no-key · v1 بلا kid يفتح بالمفتاح الموحد (توافق
//   §58) · عبث kid (فاسد/مستبدل) · عزل الأجهزة التام · OTP القصير بkid (درس
//   minCtBytes) · atRestKid · IV طازج · deviceSettingKey يرفض الشارد · عزل
//   الأقفاص مع kid · حلّال الحلقة.
// الطور ب (حي): النشر من جهازين → **كل صف بمغلف kid جهازه بايتيًا (kidA≠kidB —
//   البرهان الجوهري للعزل)** · جهاز ثالث عبر سوكِت الجسر · القوائم شفافة ·
//   تدوير جهاز مفرد: صفوفه kid جديد وصفوف الجهاز الآخر **بنفس البايتات حرفيًا**
//   (برهان العزل البايتي) · القراءة بعده سليمة للطرفين · حرس loopback للمفرد ·
//   deviceId الشارد مرفوض · حذف مفتاح جهاز من الإعدادات → صفوفه تُسقط بصدق
//   (تدقيق) وأجهزة أخرى حية · ختم السجل بمفاتيح الأجهزة · التدوير الشامل يعيد
//   الختم كله · الإعادة المحلية شفافة · سجل §39 بالنوعين الجديدين بلا محتوى.
// الاستخدام:
//   node scripts/clip-multikey-e2e.mjs                                   (طور أ حصرًا)
//   node scripts/clip-multikey-e2e.mjs --app http://127.0.0.1:3000 --db /tmp/nexuslink-e59-live/db/custom.db
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
const DB_PATH = (() => {
  const i = process.argv.indexOf("--db")
  return i > 0 ? process.argv[i + 1] : null
})()
const BRIDGE = (() => {
  const i = process.argv.indexOf("--bridge")
  return i > 0 ? process.argv[i + 1] : "http://127.0.0.1:3007"
})()

/* ═════════════ الطور أ — النواة النقية ═════════════ */
// خطاف حل الوحدات (درس §49): استيراد بلا امتداد يكسر node الخام — الخطاف يكمله
const { registerTsResolve } = await import("../scripts/ts-resolve-hooks.cjs")
registerTsResolve()
const { clipCage, CLIP_AT_REST_MARKER, CLIP_CONTENT_MAX } = await import("../src/lib/nexus/clip-crypto.ts")
const { isValidLocalKey, isValidKid, atRestKid } = await import("../src/lib/nexus/at-rest-cage.ts")
const {
  kidForKey, deviceSettingKey, ringResolver, ringKeyCount,
  CLIP_DEV_KEY_PREFIX,
} = await import("../src/lib/nexus/clip-multikey.ts")
const { inspectPayload: handoffInspect } = await import("../src/lib/nexus/handoff-crypto.ts")

const b64url = (buf) => Buffer.from(buf).toString("base64url")
const K_PC = b64url(crypto.getRandomValues(new Uint8Array(32)))
const K_PH = b64url(crypto.getRandomValues(new Uint8Array(32)))
const K_TAB = b64url(crypto.getRandomValues(new Uint8Array(32)))
const K_LEGACY = b64url(crypto.getRandomValues(new Uint8Array(32)))

const KID_PC = kidForKey(K_PC)
const KID_PH = kidForKey(K_PH)

// أ1 — kid حتمي مشتق: نفس المفتاع نفس kid ومختلف المفاتيح مختلفون (16 hex)
ok("أ1 kid حتمي مشتق: نفسه لنفس المفتاح ومتباين لمختلفين و16 hex", (() => {
  const a = kidForKey(K_PC)
  const b = kidForKey(K_PC)
  const c = kidForKey(K_PH)
  return a === b && a !== c && /^[0-9a-f]{16}$/.test(a) && /^[0-9a-f]{16}$/.test(c)
})())

// أ2 — صحة kid: الصالح يمر والشارد (فراغ/محارف/طول) يُرفض
ok("أ2 isValidKid: الصالح يمر والفراغ والمحارف الشاردة والطويل يُرفضون", (() => {
  const good = ["a", "dev-1", "PC_2.5", "A".repeat(64)]
  const bad = ["", ".start", "-start", "_start", "بمحارف-عربية", "has space", "A".repeat(65), 42, null, undefined]
  return good.every((k) => isValidKid(k)) && bad.every((k) => !isValidKid(k))
})())

// أ3 — المغلف بkid: حقل أخير بعد tag والبادئة الأمامية ثابتة (§57 لا يُمس)
ok("أ3 مغلف بkid: الحقل الأخير بعد الوسم والبادئة الأمامية ثابتة", (() => {
  const env = clipCage.seal("سر-جهاز-الكمبيوتر", K_PC, KID_PC)
  const j = JSON.parse(env)
  const keys = Object.keys(j)
  return clipCage.inspect(env) === "sealed"
    && j.t === CLIP_AT_REST_MARKER && j.kid === KID_PC
    && keys[0] === "t" && keys[1] === "v" && keys[keys.length - 1] === "kid"
    && env.startsWith(`{"t":${JSON.stringify(CLIP_AT_REST_MARKER)},"v":1,`)
})())

// أ4 — الفتح بالحلال: kid ← مفتاح جهازه والنص يعود حرفيًا
ok("أ4 الفتح بالحلال: kid الكمبيوتر ← مفتاحه والنص حرفي", (() => {
  const env = clipCage.seal("سر-جهاز-الكمبيوتر", K_PC, KID_PC)
  const ring = ringResolver(K_LEGACY, new Map([[KID_PC, { device: "pc", kid: KID_PC, key: K_PC }], [KID_PH, { device: "ph", kid: KID_PH, key: K_PH }]]))
  const o = clipCage.open(env, ring)
  return o.ok && o.payload === "سر-جهاز-الكمبيوتر"
})())

// أ5 — kid غائب في الحلقة → no-key بصدق
ok("أ5 kid غائب في الحلقة → no-key (لا auth-failed ولا انهيار)", (() => {
  const env = clipCage.seal("سر-تابلت", K_TAB, kidForKey(K_TAB))
  const ring = ringResolver(K_LEGACY, new Map([[KID_PC, { device: "pc", kid: KID_PC, key: K_PC }]]))
  return clipCage.open(env, ring).error === "no-key"
})())

// أ6 — النمط التاريخي: مفتاح مفرد (نص) يفتح مغلفًا بkid متجاهلًا إياه (توافق)
ok("أ6 مفتاح مفرد يفتح مغلف بkid (النمط التاريخي متجاوزًا إياه)", (() => {
  const env = clipCage.seal("نص-58-التاريخي", K_PC, KID_PC)
  return clipCage.open(env, K_PC).ok && clipCage.open(env, K_PC).payload === "نص-58-التاريخي"
})())

// أ7 — توافق §58: مغلف v1 بلا kid يفتح بالمفتاح الموحد عبر الحلال (null←legacy)
ok("أ7 مغلف v1 بلا kid يفتح بالمفتاح الموحد عبر الحلال", (() => {
  const env = clipCage.seal("نص-قديم-بلا-kid", K_LEGACY) // بلا kid — شكل §58 الحرفي
  const ring = ringResolver(K_LEGACY, new Map([[KID_PC, { device: "pc", kid: KID_PC, key: K_PC }]]))
  const o = clipCage.open(env, ring)
  return o.ok && o.payload === "نص-قديم-بلا-kid" && atRestKid(env) === null
})())

// أ8 — عبث kid: شكل فاسد → bad-envelope · kid مستبدل بآخر سليم → المصادقة ترفض (GCM لا يفتح بمفتاح غريب)
ok("أ8 عبث kid: الفاسد bad-envelope والمستبدل auth-failed (GCM يحمي)", (() => {
  const env = clipCage.seal("سر-مختوم", K_PC, KID_PC)
  const j1 = JSON.parse(env); j1.kid = "!!فاسد!!"
  const j2 = JSON.parse(env); j2.kid = KID_PH
  const ring = ringResolver(K_LEGACY, new Map([[KID_PC, { device: "pc", kid: KID_PC, key: K_PC }], [KID_PH, { device: "ph", kid: KID_PH, key: K_PH }]]))
  return clipCage.open(JSON.stringify(j1), ring).error === "bad-envelope" && clipCage.open(JSON.stringify(j2), ring).error === "auth-failed"
})())

// أ9 — العزل التام: مغلف الكمبيوتر لا يُفتح بمفتاح الهاتف الخام ولا العكس — والحلقة تفتح بصاحبه
ok("أ9 العزل: مغلف الكمبيوتر لا يُفتح بمفتاح الهاتف ولا العكس", (() => {
  const envPC = clipCage.seal("نص-الكمبيوتر", K_PC, KID_PC)
  const envPH = clipCage.seal("نص-الهاتف", K_PH, KID_PH)
  const ring = ringResolver(null, new Map([[KID_PC, { device: "pc", kid: KID_PC, key: K_PC }], [KID_PH, { device: "ph", kid: KID_PH, key: K_PH }]]))
  const oPC = clipCage.open(envPC, ring)
  const oPH = clipCage.open(envPH, ring)
  return clipCage.open(envPC, K_PH).error === "auth-failed" && clipCage.open(envPH, K_PC).error === "auth-failed" && oPC.ok && oPC.payload === "نص-الكمبيوتر" && oPH.ok && oPH.payload === "نص-الهاتف"
})())

// أ10 — OTP القصير بkid: قناغة 6 بايتات شرعية تُختم وتُفك (درس minCtBytes المُقاس)
ok("أ10 OTP ستّي بkid: قناغة قصيرة شرعية تُختم وتُفك", (() => {
  const env = clipCage.seal("483291", K_PC, KID_PC)
  const o = clipCage.open(env, ringResolver(null, new Map([[KID_PC, { device: "pc", kid: KID_PC, key: K_PC }]])))
  return o.ok && o.payload === "483291" && clipCage.inspect(env) === "sealed"
})())

// أ11 — atRestKid: يستخرج kid من المغلف وnull للعاري وبلا kid والفاسد
ok("أ11 atRestKid: المغلف يعود بkidه والعاري والفاسد null", (() => {
  const env = clipCage.seal("نص", K_PC, KID_PC)
  const noKid = clipCage.seal("نص", K_PC)
  return atRestKid(env) === KID_PC && atRestKid(noKid) === null && atRestKid("نص-عاري") === null && atRestKid("{فاسد") === null && atRestKid(42) === null
})())

// أ12 — IV طازج كل ختم حتى بkid: مغلفان متباينان لنفس النص والمفتاح
ok("أ12 IV طازج بkid: مغلفان متباينان لنفس النص", (() => {
  const a = clipCage.seal("نص-واحد", K_PC, KID_PC)
  const b = clipCage.seal("نص-واحد", K_PC, KID_PC)
  return a !== b && JSON.parse(a).iv !== JSON.parse(b).iv
})())

// أ13 — deviceSettingKey: الصالح بمقدمته والشارد null (مسار الحماية من الحقن)
ok("أ13 deviceSettingKey: الصالح بمقدمته والشارد null", (() => {
  return deviceSettingKey("galaxy-s24") === CLIP_DEV_KEY_PREFIX + "galaxy-s24"
    && deviceSettingKey("PC.01_x") === CLIP_DEV_KEY_PREFIX + "PC.01_x"
    && deviceSettingKey("") === null
    && deviceSettingKey("بالعربية") === null
    && deviceSettingKey("has/slash") === null
    && deviceSettingKey("A".repeat(65)) === null
    && deviceSettingKey(42) === null
    && deviceSettingKey(null) === null
})())

// أ14 — حلقة كاملة: العدد والأجهزة والحلال ثلاثي الحالات
ok("أ14 الحلقة: العدد يشمل الموحد والأجهزة والحلال ثلاثي الحالات", (() => {
  const byKid = new Map([
    [KID_PC, { device: "pc", kid: KID_PC, key: K_PC }],
    [KID_PH, { device: "ph", kid: KID_PH, key: K_PH }],
  ])
  const ring = { legacy: K_LEGACY, legacyKid: kidForKey(K_LEGACY), byKid, byDevice: new Map(), resolver: ringResolver(K_LEGACY, byKid) }
  const plainEnv = clipCage.seal("نص", K_PC, KID_PC)
  return ringKeyCount(ring) === 3 && ring.resolver(null) === K_LEGACY && ring.resolver(KID_PH) === K_PH && ring.resolver("مجهول0000000000") === null && isValidLocalKey(ring.resolver(JSON.parse(plainEnv).kid))
})())

// أ15 — عزل الأقفاص مع kid: مغلف clip بعلامته يبقى أجنبيًا عن قفص §57
ok("أ15 عزل الأقفاص مع kid: قفص §57 يرى مغلف §59 بkidه plain", (() => {
  const env = clipCage.seal("نص-خزنة-59", K_PC, KID_PC)
  return handoffInspect(env) === "plain" && clipCage.inspect(env) === "sealed"
})())

// أ16 — السقف التعاقدي: محتوى فوق 4M محرف يُقص في مسار الكتابة (الثابت موثق)
ok("أ16 سقف المحتوى التعاقدي 4M محرف ثابت موثق", CLIP_CONTENT_MAX === 4_000_000)

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP || !DB_PATH) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app/--db — شغّل: node scripts/clip-multikey-e2e.mjs --app http://127.0.0.1:3000 --db /tmp/nexuslink-e59-live/db/custom.db`)
} else {
  const base = APP.replace(/\/$/, "")
  const fs = await import("node:fs")
  const { execFileSync } = await import("node:child_process")

  const getJson = async (p) => { const r = await fetch(base + p, { cache: "no-store" }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }
  const postJson = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); try { return { status: r.status, j: await r.json() } } catch { return { status: r.status, j: null } } }

  // قراءة بايتات القاعدة مباشرة (custom.db + -wal + -shm) — البرهان الجوهري
  const dbBytes = () => {
    let bufs = []
    for (const suffix of ["", "-wal", "-shm"]) {
      try { bufs.push(fs.readFileSync(DB_PATH + suffix)) } catch { /* غائب */ }
    }
    return Buffer.concat(bufs)
  }
  const hasBytes = (needle) => dbBytes().includes(Buffer.from(needle, "utf8"))

  // عدّاء SQLite حي عبر bun:sqlite (قراءة بايتية/عبث/حذف مفتاح — بلا عميل خارجي)
  const bunSql = (sql, mode = "run", params = []) => {
    const code = `import { Database } from "bun:sqlite"; const db = new Database(process.env.DB_PATH); const p = JSON.parse(process.env.PARAMS); try { const out = ${mode === "all" ? 'db.prepare(process.env.SQL).all(...p)' : 'db.prepare(process.env.SQL).run(...p)'}; console.log("OK:" + JSON.stringify(out)); } catch (e) { console.log("ERR:" + String(e)); } db.close()`
    try {
      const out = execFileSync("bun", ["-e", code], {
        env: { ...process.env, DB_PATH, SQL: sql, PARAMS: JSON.stringify(params) },
        encoding: "utf8", timeout: 30_000,
      }).trim()
      return out.startsWith("OK:") ? JSON.parse(out.slice(3)) : { __err: out }
    } catch (e) { return { __err: String(e) } }
  }

  const DEV_PC = "e59-pc"
  const DEV_PH = "e59-phone"
  const DEV_TAB = "e59-tablet"
  const TEXT_PC = "password: MultiKey#59-كمبيوتر"
  const NEEDLE_PC = "MultiKey#59"
  const TEXT_PH = "نص-الهاتف-59-عادي-شفاف"
  const TEXT_TAB = "نص-التابلت-59-عبر-السوكِت"
  const NEEDLE_TAB = "التابلت-59"
  const LEGACY_TEXT = "نص-عاري-قديم-59-للختم-الشامل"

  // ب1 — النشر من جهاز الكمبيوتر: حساسية مصنفة والقفل بمفتاح جهازه (keyed)
  let r = await postJson("/api/prod/clipboard", { deviceId: DEV_PC, deviceName: "كمبيوتر المكتب", kind: "text", content: TEXT_PC, mode: "manual" })
  const idPC = r.j?.item?.id
  ok("ب1 نشر الكمبيوتر: حساسية مصنفة ومخفي والختم بمفتاح جهازه (keyed)", r.status === 200 && r.j?.ok === true && r.j?.item?.masked === true && r.j?.atRest?.active === true && r.j?.atRest?.keyed === true && typeof idPC === "string")

  // ب2 — النشر من الهاتف: عادي شفاف
  r = await postJson("/api/prod/clipboard", { deviceId: DEV_PH, deviceName: "هاتف الجيب", kind: "text", content: TEXT_PH, mode: "manual" })
  const idPH = r.j?.item?.id
  ok("ب2 نشر الهاتف: عادي يعود نصًّا صريحًا كاملًا", r.j?.ok === true && r.j?.item?.content === TEXT_PH && typeof idPH === "string")

  // ب3 — البرهان الجوهري البايتي: كل صف بمغلف kid جهازه وkidA≠kidB (مفتاحان فعليان)
  const rowPC = bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", [idPC])?.[0]
  const rowPH = bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", [idPH])?.[0]
  const envPC = (() => { try { return JSON.parse(rowPC.content) } catch { return null } })()
  const envPH = (() => { try { return JSON.parse(rowPH.content) } catch { return null } })()
  ok("ب3 بايتات القاعدة: كل صف بمغلف بعلامة §58 وkid جهازه — وkidA≠kidB",
    !!envPC && !!envPH
    && envPC.t === CLIP_AT_REST_MARKER && envPH.t === CLIP_AT_REST_MARKER
    && typeof envPC.kid === "string" && typeof envPH.kid === "string"
    && envPC.kid !== envPH.kid, `kidPC=${envPC?.kid} kidPH=${envPH?.kid}`)

  // ب3.ب — لا نص عاري في القاعدة كليًا
  ok("ب3.ب بايتات القاعدة بلا أي نص عاري من الجهازين", !hasBytes(NEEDLE_PC) && !hasBytes(TEXT_PH))

  // ب4 — حالة الحلقة معلنة: أقفال ≥ 2 وأسماء الجهازين (مسار الخزنة الفرعي)
  r = await getJson("/api/prod/clipboard")
  const rv = await getJson("/api/prod/clipboard/vault")
  ok("ب4 حالة الحلقة: أقفال ≥ 2 والجهازان معلنان بالأسماء",
    (r.j?.atRest?.keys ?? 0) >= 2
    && (rv.j?.atRest?.keys ?? 0) >= 2
    && (rv.j?.atRest?.devices ?? []).includes(DEV_PC)
    && (rv.j?.atRest?.devices ?? []).includes(DEV_PH),
    `keys=${r.j?.atRest?.keys} devices=${(rv.j?.atRest?.devices ?? []).join(",")}`)

  // ب5 — القوائم شفافة: حساس الكمبيوتر مخفيّ فوق المغلف وعادي الهاتف نصًّا كاملًا
  const itPC = (r.j?.items ?? []).find((x) => x.id === idPC)
  const itPH = (r.j?.items ?? []).find((x) => x.id === idPH)
  ok("ب5 القوائم شفافة للجهازين: الحساس مخفيّا والعادي كاملًا — كلاهما فوق مغلفيهما",
    itPC?.masked === true && itPC?.sensitive === "password" && itPH?.content === TEXT_PH)

  // ب6 — جهاز ثالث عبر سوكِت الجسر: يُختم بمفتاحه الخاص (kid ثالث بايتيًا)
  const { io: sockClient } = await import("socket.io-client")
  const sock = sockClient(BRIDGE, { path: "/", transports: ["websocket"], timeout: 8000 })
  // درس مُقاس: مستمع الترحيب يُسجّل قبل الاتصال — ما بعده سباق يُفقد hello فيصير المؤشر صفرًا
  const helloP = new Promise((res) => { const t = setTimeout(() => res(null), 6000); sock.once("prod:hello", (d) => { clearTimeout(t); res(d) }) })
  await new Promise((res) => { sock.on("connect", res); sock.on("connect_error", res); sock.connect() })
  const connected = sock.connected
  ok("ب6 اتصال الجسر الحي محلي", connected)
  let kidTAB = null
  let opKidTAB = null
  let helloSeq = 0
  if (connected) {
    const hello = (await Promise.race([helloP, new Promise((res) => setTimeout(() => res(null), 6000))])) ?? {}
    helloSeq = Number(hello?.lastSeq ?? 0)
    sock.emit("clip:push", { deviceId: DEV_TAB, deviceName: "التابلت", kind: "text", content: TEXT_TAB, mode: "manual" })
    await new Promise((res) => setTimeout(res, 1500))
    const rowTAB = bunSql('SELECT "content" FROM "ProdClip" WHERE "deviceId" = ? ORDER BY "createdAt" DESC LIMIT 1', "all", [DEV_TAB])?.[0]
    const envTAB = (() => { try { return JSON.parse(rowTAB.content) } catch { return null } })()
    kidTAB = envTAB?.kid ?? null
    // kid مغلف العملية في سجل العمليات (قبل أي تدوير — للمقارنة بعد التدوير الشامل)
    const opRow = bunSql(`SELECT payload FROM "ProdOpLog" WHERE "kind" = 'clip:new' AND "deviceId" = ? ORDER BY "seq" DESC LIMIT 1`, "all", [DEV_TAB])?.[0]
    const opEnv = (() => { try { return JSON.parse(JSON.parse(opRow.payload).content) } catch { return null } })()
    opKidTAB = opEnv?.kid ?? null
    ok("ب7 دفع السوكِت لجهاز ثالث: مغلف kid ثالث لا يساوي الأولين وبلا نص عاري",
      !!envTAB && envTAB.t === CLIP_AT_REST_MARKER && typeof kidTAB === "string"
      && kidTAB !== envPC.kid && kidTAB !== envPH.kid && !hasBytes(NEEDLE_TAB))
  } else {
    ok("ب7 دفع السوكِت لجهاز ثالث: مغلف kid ثالث لا يساوي الأولين وبلا نص عاري", false, "بلا اتصال")
  }

  // ب8 — البحث شفاف فوق مغلفات أجهزة مختلفة (دلالات §33.أ)
  r = await getJson(`/api/prod/clipboard/vault?q=${encodeURIComponent("MultiKey")}`)
  const hitPC = (r.j?.items ?? []).some((x) => x.id === idPC)
  r = await getJson(`/api/prod/clipboard/vault?q=${encodeURIComponent("الهاتف-59")}`)
  const hitPH = (r.j?.items ?? []).some((x) => x.id === idPH)
  ok("ب8 بحث الخزنة يجد نصي الجهازين فوق مغلفيهما", hitPC && hitPH)

  // ب9 — تدوير جهاز مفرد: صفوف الهاتف kid جديد وصفوف الكمبيوتر بنفس البايتات حرفيًا
  const pcBytesBefore = rowPC.content
  r = await postJson("/api/prod/clipboard/vault", { action: "rotate-key", deviceId: DEV_PH })
  ok("ب9 تدوير قفل الهاتف المفرد: ok بجهازه ومعرفات معلنة بلا مفتاح",
    r.status === 200 && r.j?.ok === true && r.j?.device === DEV_PH && typeof r.j?.kid === "string" && typeof r.j?.resealed === "number" && !/"?key"?\s*:/.test(JSON.stringify(r.j)))
  const rowPC2 = bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", [idPC])?.[0]
  const rowPH2 = bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", [idPH])?.[0]
  const envPH2 = (() => { try { return JSON.parse(rowPH2.content) } catch { return null } })()
  ok("ب9.ب العزل البايتي: صفوف الكمبيوتر بنفس البايتات حرفيًا وkid الهاتف تغير",
    rowPC2.content === pcBytesBefore && !!envPH2 && envPH2.kid !== envPH.kid && envPH2.kid === r.j?.kid)

  // ب10 — القراءة بعد التدوير المفرد شفافة للطرفين (الكشف المقصود يعيد نص الكمبيوتر كاملًا)
  r = await getJson("/api/prod/clipboard")
  const revPC = await postJson("/api/prod/clipboard/vault", { action: "reveal", id: idPC })
  ok("ب10 القراءة بعد التدوير المفرد: الجهازان يعودان بنصيهما",
    revPC.j?.item?.content?.includes(NEEDLE_PC)
    && (r.j?.items ?? []).some((x) => x.id === idPH && x.content === TEXT_PH))

  // ب11 — تدوير جهاز مفرد من خارج الجهاز → 403 (حرس loopback نفسه — FA-22 وحّدته تحت guardPcOnly فصار رد pc-only التعاقدي)
  r = await postJson("/api/prod/clipboard/vault", { action: "rotate-key", deviceId: DEV_PC }, { "x-gw-client-ip": "10.0.0.9" })
  ok("ب11 تدوير مفرد من خارج الجهاز → 403", r.status === 403 && r.j?.error === "pc-only")

  // ب12 — deviceId الشارد → invalid-device (مسار الحماية من الحقن)
  r = await postJson("/api/prod/clipboard/vault", { action: "rotate-key", deviceId: "بالعربية/slash" })
  ok("ب12 deviceId الشارد → invalid-device", r.status === 200 && r.j?.ok === false && r.j?.error === "invalid-device")

  // ب13 — حذف مفتاح جهاز من الإعدادات مباشرة → صفوفه تُسقط بصدق والبقية حية
  const auditBefore = (await getJson("/api/enterprise/audit?limit=400")).j?.events ?? []
  bunSql('DELETE FROM "DesktopSetting" WHERE "key" = ?', "run", [`clip.at-rest-key:${DEV_PH}`])
  r = await getJson("/api/prod/clipboard")
  ok("ب13 ضياع مفتاح جهاز: صفوفه تُسقط من القائمة بصدق وصفوف غيره حية",
    !(r.j?.items ?? []).some((x) => x.id === idPH) && (r.j?.items ?? []).some((x) => x.id === idPC) && r.j?.atRest?.active === true)
  const auditAfter = (await getJson("/api/enterprise/audit?limit=400")).j?.events ?? []
  ok("ب13.ب تدقيق الإسقاط موثق (clip.crypto.drop)", auditAfter.filter((e) => e.k === "clip.crypto.drop").length > auditBefore.filter((e) => e.k === "clip.crypto.drop").length)

  // ب14 — ختم السجل الشامل: صف عاري قديم يُختم بمفتاح جهاز صاحبه (kid معلن)
  bunSql('INSERT INTO "ProdClip" ("id","deviceId","deviceName","kind","content","size","mode","received","pinned") VALUES (?,?,?,?,?,?,?,0,0)', "run", ["e59-legacy-1", DEV_PC, "قديم", "text", LEGACY_TEXT, LEGACY_TEXT.length, "manual"])
  r = await postJson("/api/prod/clipboard/vault", { action: "seal-all" })
  const rowLegacy = bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", ["e59-legacy-1"])?.[0]
  const envLegacy = (() => { try { return JSON.parse(rowLegacy.content) } catch { return null } })()
  ok("ب14 ختم السجل بمفتاح الجهاز: القديم مغلف بkid الكمبيوتر نفسه وبلا نص عاري",
    r.j?.ok === true && !hasBytes("قديم-59-للختم") && !!envLegacy && envLegacy.t === CLIP_AT_REST_MARKER && envLegacy.kid === envPC.kid,
    `keys=${r.j?.keys}`)

  // ب15 — التدوير الشامل: كل الصفوف قناغاتها تغيرت (بما فيها الجهاز ذو المفتاح المحذوف)
  const pcBytes3 = bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", [idPC])?.[0]?.content ?? ""
  r = await postJson("/api/prod/clipboard/vault", { action: "rotate-key" })
  const pcBytes4 = bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", [idPC])?.[0]?.content ?? ""
  ok("ب15 التدوير الشامل: ok بأعداد معلنة وقناغة الكمبيوتر تغيرت",
    r.status === 200 && r.j?.ok === true && typeof r.j?.resealed === "number" && typeof r.j?.keys === "number" && pcBytes4 !== "" && pcBytes4 !== pcBytes3, `keys=${r.j?.keys}`)
  r = await getJson("/api/prod/clipboard")
  const revPC2 = await postJson("/api/prod/clipboard/vault", { action: "reveal", id: idPC })
  ok("ب15.ب القراءة بعد الشامل شفافة: الكمبيوتر (بالوكشف) والقديم حرفيهما",
    revPC2.j?.item?.content?.includes(NEEDLE_PC)
    && (r.j?.items ?? []).some((x) => x.id === "e59-legacy-1" && x.content === LEGACY_TEXT))

  // ب16 — الإعادة المحلية عبر الجسر: نص التابلت يعود شفافًا من فوق مغلفه
  // حتى بعد التدوير الشامل — §59 يعيد ختم مغلفات السجل (إغلاق فجوة §58)
  if (connected) {
    const replayP = new Promise((res) => { const t = setTimeout(() => res(null), 6000); sock.once("prod:replay", (d) => { clearTimeout(t); res(d) }) })
    sock.emit("prod:resume", { since: helloSeq })
    const replay = await replayP
    const localOps = (replay?.ops ?? []).filter((o) => o.kind === "clip:new" && o.payload?.content === TEXT_TAB)
    ok("ب16 الإعادة المحلية شفافة بعد التدوير الشامل: نص التابلت يعود كاملًا", localOps.length >= 1)
    const opRow2 = bunSql(`SELECT payload FROM "ProdOpLog" WHERE "kind" = 'clip:new' AND "deviceId" = ? ORDER BY "seq" DESC LIMIT 1`, "all", [DEV_TAB])?.[0]
    const opEnv2 = (() => { try { return JSON.parse(JSON.parse(opRow2.payload).content) } catch { return null } })()
    const rowTAB2 = bunSql('SELECT "content" FROM "ProdClip" WHERE "deviceId" = ? ORDER BY "createdAt" DESC LIMIT 1', "all", [DEV_TAB])?.[0]
    const envTAB2 = (() => { try { return JSON.parse(rowTAB2.content) } catch { return null } })()
    ok("ب16.ب مغلف السجل أعيد ختمه: kid العملية تغير ويطابق kid صف جهازه الحالي",
      !!opEnv2 && !!envTAB2 && typeof opKidTAB === "string" && opKidTAB !== opEnv2.kid && opEnv2.kid === envTAB2.kid,
      `kidBefore=${opKidTAB} kidAfter=${opEnv2?.kid} rowKid=${envTAB2?.kid}`)
    sock.disconnect()
  } else {
    ok("ب16 الإعادة المحلية شفافة بعد التدوير الشامل: نص التابلت يعود كاملًا", false, "بلا اتصال")
    ok("ب16.ب مغلف السجل أعيد ختمه: kid العملية تغير عن ما قبل التدوير", false, "بلا اتصال")
  }

  // ب17 — سجل §39: النوعان الجديدان موثقان بلا أي محتوى
  r = await getJson("/api/enterprise/audit?limit=600")
  const evs = r.j?.events ?? []
  const kindsSet = new Set(evs.map((e) => e.k))
  const hasMultiInit = kindsSet.has("clip.crypto.multi.init")
  const hasRotateDev = kindsSet.has("clip.crypto.rotate.dev")
  const noLeak = evs.every((e) => !JSON.stringify(e.d ?? {}).includes(NEEDLE_PC) && !JSON.stringify(e.d ?? {}).includes("قديم-59"))
  ok("ب17 سجل §39: multi.init وrotate.dev موثقان بلا محتوى", hasMultiInit && hasRotateDev && noLeak)

  // ب18 — المسح الكامل يعمل فوق الحلقة
  r = await fetch(base + "/api/prod/clipboard", { method: "DELETE" })
  ok("ب18 المسح الكامل يعمل فوق الحلقة", r.status === 200)
}

console.log(`\n═══ §59 clip-multikey-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
