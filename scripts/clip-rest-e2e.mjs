#!/usr/bin/env node
// NexusLink — قفل الخزنة الساكن (عقد §58) — clip-rest-e2e
// ============================================================
// الطور أ (نقي): علامة القفص · صحة المفتاح · كشف الشكل · ختم/فتح بحرفية
//   (عربي + dataUrl) · IV طازج كل ختم · الخطأ الثلاثي المغلق · عبث القناغة ·
//   السقف التعاقدي المحسوب · الترحيل النقي · التدوير · عزل العلامة عن §57.
// الطور ب (حي): النشر → **القاعدة (SQLite) لا ترى النص العاري** (البرهان
//   الجوهري — قراءة بايتات ملف custom.db و-wal مباشرة) · الشفافية للعرض
//   والبحث والكشف · ترحيل النص القديم (قراءة + ختم السجل) · إسقاط العبث
//   بصدق وتدقيق §39 · تدوير القفل يعيد الختم والقراءة تعمل · حرس loopback ·
//   سجل العمليات ProdOpLog مغلّف أيضًا والإعادة المحلية شفافة (سوكِت حي).
// الاستخدام:
//   node scripts/clip-rest-e2e.mjs                                   (طور أ حصرًا)
//   node scripts/clip-rest-e2e.mjs --app http://127.0.0.1:3000 --db /tmp/nexuslink-e58-live/db/custom.db
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
// خطاف حل الوحدات (درس §49): استيراد «./backup-secure-core» بلا امتداد يمر
// في مجمّع Next ويكسر node الخام — الخطاف يكمله حصرًا لصادرات TS النسبية.
const { registerTsResolve } = await import("../scripts/ts-resolve-hooks.cjs")
registerTsResolve()
const { clipCage, CLIP_AT_REST_MARKER, CLIP_AT_REST_VERSION, CLIP_AT_REST_SEALED_MAX, CLIP_CONTENT_MAX } =
  await import("../src/lib/nexus/clip-crypto.ts")
const { isValidLocalKey } = await import("../src/lib/nexus/at-rest-cage.ts")
const { inspectPayload: handoffInspect, AT_REST_MARKER: HANDOFF_MARKER } =
  await import("../src/lib/nexus/handoff-crypto.ts")

const b64url = (buf) => Buffer.from(buf).toString("base64url")
const K1 = b64url(crypto.getRandomValues(new Uint8Array(32)))
const K2 = b64url(crypto.getRandomValues(new Uint8Array(32)))
const SHORT_K = b64url(crypto.getRandomValues(new Uint8Array(16)))

// أ1–أ2 — العلامة وصحة المفتاح
ok("أ1 علامة القفص clip.at-rest بإصدارها وخوارزميتها", CLIP_AT_REST_MARKER === "clip.at-rest" && CLIP_AT_REST_VERSION === 1)
ok("أ2 مفتاح 32 بايت سليم و16 بايت والقمامة والغائب مرفوضون", isValidLocalKey(K1) === true && isValidLocalKey(SHORT_K) === false && isValidLocalKey("ليس-مفتاحا") === false && isValidLocalKey(null) === false)

// أ3–أ4 — كشف الشكل: نص عاري (عربي/dataUrl/JSON أجنبي/فارغ) يبقى plain
ok("أ3 النص العاري بأنواعه يُكشف plain", clipCage.inspect("مرحبا بالخزنة") === "plain" && clipCage.inspect("data:image/png;base64,AAAA") === "plain" && clipCage.inspect(JSON.stringify({ v: 1, alg: "a256gcm", iv: "x", ct: "y", tag: "z" })) === "plain" && clipCage.inspect("") === "plain")
const SEALED = clipCage.seal("سر-الخزنة-58", K1)
ok("أ4 المغلف يُكشف sealed بعلامته وإصداره وخوارزميته", clipCage.inspect(SEALED) === "sealed" && JSON.parse(SEALED).t === CLIP_AT_REST_MARKER && JSON.parse(SEALED).v === CLIP_AT_REST_VERSION && JSON.parse(SEALED).alg === "a256gcm" && typeof JSON.parse(SEALED).tag === "string" && JSON.parse(SEALED).tag.length > 0)

// أ5–أ8 — الختم والفتح بحرفية
ok("أ5 ختم/فتح بحرفية: عربي ورابط وdataUrl", (() => {
  const a = clipCage.open(clipCage.seal("https://nexus.example/مقال?q=1", K1), K1)
  const d = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
  const b = clipCage.open(clipCage.seal(d, K1), K1)
  return a.ok && a.payload === "https://nexus.example/مقال?q=1" && b.ok && b.payload === d
})())
ok("أ6 كل ختم IV طازج — مغلفان متباينان لنفس النص", clipCage.seal("نص", K1) !== clipCage.seal("نص", K1))
ok("أ7 الفتح بمفتاح خاطئ → auth-failed وبلا مفتاح → no-key", clipCage.open(SEALED, K2).error === "auth-failed" && clipCage.open(SEALED, null).error === "no-key")
ok("أ8 عبث القناغة → auth-failed والشكل الفاسد → bad-envelope وct القصير ← مصادقة فاشلة (GCM تدفقي)", (() => {
  const e = JSON.parse(SEALED); e.ct = "AAAA" + String(e.ct).slice(4)
  const e2 = JSON.parse(SEALED); e2.iv = "!!"
  const e3 = JSON.parse(SEALED); e3.ct = "قصير"
  return clipCage.open(JSON.stringify(e), K1).error === "auth-failed" && clipCage.open(JSON.stringify(e2), K1).error === "bad-envelope" && clipCage.open(JSON.stringify(e3), K1).error === "auth-failed"
})())
ok("أ8.ب محتوى قصير (OTP ستّي): قناغة 6 بايتات شرعية تُختم وتُفك — درس حرس §57 المُقاس", (() => {
  const otp = "483291"
  const sealedOtp = clipCage.seal(otp, K1)
  const o = clipCage.open(sealedOtp, K1)
  return o.ok && o.payload === otp
})())

// أ9 — السقف التعاقدي المحسوب: 4M محرف عربي → 12MB UTF-8 → 16M base64 + مغلف
const WORST = Math.ceil((CLIP_CONTENT_MAX * 3) / 3) * 4 + 160
ok("أ9 السقف يستوعب أسوأ حالة تعاقدية (4M عربي مغلّفًا)", CLIP_AT_REST_SEALED_MAX >= WORST, `سقف=${CLIP_AT_REST_SEALED_MAX} · أسوأ=${WORST}`)
ok("أ10 نص عربي 100KB يُختم ويُفك بحرفية", (() => {
  const big = "ص".repeat(100_000)
  const o = clipCage.open(clipCage.seal(big, K1), K1)
  return o.ok && o.payload === big
})())
ok("أ11 نص عاري ضخم فوق السقف يُكشف plain بلا JSON.parse (مسار سريع)", clipCage.inspect("د".repeat(CLIP_AT_REST_SEALED_MAX + 10)) === "plain")

// أ12 — ختم دفعة: العاري يُختم والمختوم والفارغ يُتركان وبلا مفتاح لا شيء
ok("أ12 ختم دفعة: ترحيل انتقائي صادق", (() => {
  const items = [{ content: "عاري-1" }, { content: SEALED }, { content: "" }, { content: "عاري-2" }]
  const r = clipCage.sealTextsPure(items, K1)
  const noKey = [{ content: "عاري-3" }]
  clipCage.sealTextsPure(noKey, null)
  return r.sealed === 2 && clipCage.inspect(items[0].content) === "sealed" && clipCage.inspect(items[1].content) === "sealed" && items[2].content === "" && noKey[0].content === "عاري-3"
})())

// أ13 — دورة التدوير نقيًا
ok("أ13 تدوير: k2 يفتح ما ختمه وk1 يفقد القدرة", (() => {
  const s1 = clipCage.seal("عنصر-خزنة-دائم", K1)
  const o1 = clipCage.open(s1, K1)
  const s2 = clipCage.seal(o1.payload, K2)
  return o1.ok && clipCage.open(s2, K2).payload === "عنصر-خزنة-دائم" && clipCage.open(s2, K1).error === "auth-failed"
})())

// أ14 — عزل العلامات: مغلف §58 ليس مغلف §57 والعكس صحيح (لا التباس قفص)
ok("أ14 عزل الأقفاص: كل قفص يكشف مغلفه حصرًا — والمتقاطع plain دائمًا", (() => {
  const clipSeenByHandoff = handoffInspect(SEALED)
  const handoffEnvelope = JSON.stringify({ t: HANDOFF_MARKER, v: 1, alg: "a256gcm", iv: "QQ", ct: "QQQQQQQQ", tag: "QQQQQQQQQQQQQQQQQQQQQQ" })
  const handoffSeenByClip = clipCage.inspect(handoffEnvelope)
  return clipSeenByHandoff === "plain" && handoffSeenByClip === "plain"
})())

/* ═════════════ الطور ب — السيناريو الحي ═════════════ */
if (!APP || !DB_PATH) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app/--db — شغّل: node scripts/clip-rest-e2e.mjs --app http://127.0.0.1:3000 --db /tmp/nexuslink-e58-live/db/custom.db`)
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

  // عدّاء SQLite حي عبر bun:sqlite (إدخال قديم/عبث/قراءة — بلا عميل خارجي)
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

  const SECRET_TEXT = "password: R3stLock#58"
  const SECRET_NEEDLE = "R3stLock"
  const PLAIN_TEXT = "نص-شفاف-58-عادي-بلا-حساسية"
  const LEGACY_TEXT = "نص-عاري-قديم-58-legacy"
  const LEGACY2_TEXT = "نص-عاري-ثانٍ-58-sealall"
  const SOCKET_TEXT = "نص-سوكِت-الجسر-58"

  // ب1 — النشر يعمل كالعادة (شفافية كاملة في الاستجابة)
  let r = await postJson("/api/prod/clipboard", { deviceId: "e58-honeypot", deviceName: "هاتف القفل", kind: "text", content: SECRET_TEXT, mode: "manual" })
  const id1 = r.j?.item?.id
  ok("ب1 النشر يعمل: حساسية مصنفة والإخفاء التلقائي كعقد §50", r.status === 200 && r.j?.ok === true && r.j?.item?.masked === true && r.j?.item?.sensitive === "password" && typeof id1 === "string")
  r = await postJson("/api/prod/clipboard", { deviceId: "e58-honeypot", deviceName: "هاتف القفل", kind: "text", content: PLAIN_TEXT, mode: "manual" })
  const idPlain = r.j?.item?.id
  ok("ب1.ب العادي يعود نصًّا صريحًا كاملًا في الاستجابة", r.j?.ok === true && r.j?.item?.content === PLAIN_TEXT && typeof idPlain === "string")
  ok("ب2 حالة القفل معلنة في الاستجابة", r.j?.atRest?.active === true)

  // ب3 — القاعدة لا ترى النص العاري — مغلف §58 حصرًا (البرهان الجوهري)
  ok("ب3 بايتات القاعدة بلا النص العاري وبها علامة القفص", !hasBytes(SECRET_NEEDLE) && hasBytes(CLIP_AT_REST_MARKER), `db=${dbBytes().length}B`)

  // ب4 — القائمة شفافة: العادي يعود بنصه الكامل والقفل معلن
  r = await getJson("/api/prod/clipboard")
  const listItem = (r.j?.items ?? []).find((x) => x.id === idPlain)
  const secretItem = (r.j?.items ?? []).find((x) => x.id === id1)
  ok("ب4 GET شفاف: النص العادي يعود كاملًا والقفل معلن", listItem?.content === PLAIN_TEXT && r.j?.atRest?.active === true)
  ok("ب5 الحساسية مصنفة والإخفاء التلقائي يعمل فوق المغلف", secretItem?.sensitive === "password" && secretItem?.masked === true)
  ok("ب6 الحجم بيانات وصفية صادقة (طول النص الصريح لا المغلف)", listItem?.size === Buffer.byteLength(PLAIN_TEXT, "utf8") || listItem?.size === PLAIN_TEXT.length)

  // ب7 — الكشف المقصود يعيد النص الكامل من فوق المغلف
  r = await postJson("/api/prod/clipboard/vault", { action: "reveal", id: id1 })
  ok("ب7 الكشف المقصود يعيد النص كاملًا", r.j?.ok === true && r.j?.item?.content === SECRET_TEXT)

  // ب8 — صف قديم نص عاري (موروث قبل §58): مقروء ثم يُختم تلقائيًا عند أول قراءة
  const ins = bunSql('INSERT INTO "ProdClip" ("id","deviceId","deviceName","kind","content","size","mode","received","pinned") VALUES (?,?,?,?,?,?,?,0,0)', "run", ["e58-legacy-1", "e58-honeypot", "قديم", "text", LEGACY_TEXT, LEGACY_TEXT.length, "manual"])
  ok("ب8 صف قديم غُرز نصًّا عاريًا في القاعدة مباشرة", ins && !ins.__err)
  r = await getJson("/api/prod/clipboard")
  ok("ب9 الترحيل الصامت: القديم مقروء ثم خُتم في القاعدة", (r.j?.items ?? []).some((x) => x.id === "e58-legacy-1" && x.content === LEGACY_TEXT) && (r.j?.atRest?.migrated ?? 0) >= 1 && !hasBytes(LEGACY_TEXT))

  // ب10 — البحث يعمل فوق المغلفات شفافًا (دلالات §33.أ) — بالعربي واللاتيني
  r = await getJson(`/api/prod/clipboard/vault?q=${encodeURIComponent("R3stLock")}`)
  const hitSecret = (r.j?.items ?? []).some((x) => x.id === id1)
  r = await getJson(`/api/prod/clipboard/vault?q=${encodeURIComponent("شفاف")}`)
  const hitPlain = (r.j?.items ?? []).some((x) => x.id === idPlain)
  ok("ب10 بحث الخزنة يجد النصين فوق المغلف", hitSecret && hitPlain)

  // ب11 — ختم السجل كاملًا: كل النص العاري المتبقي يُختم بإرادة صريحة
  bunSql('INSERT INTO "ProdClip" ("id","deviceId","deviceName","kind","content","size","mode","received","pinned") VALUES (?,?,?,?,?,?,?,0,0)', "run", ["e58-legacy-2", "e58-honeypot", "قديم-٢", "text", LEGACY2_TEXT, LEGACY2_TEXT.length, "manual"])
  r = await postJson("/api/prod/clipboard/vault", { action: "seal-all" })
  ok("ب11 ختم السجل: ok وعدد معلن والقاعدة بلا نص عاري", r.j?.ok === true && (r.j?.sealed ?? 0) >= 1 && !hasBytes(LEGACY2_TEXT))

  // ب12 — عبث القناغة في القاعدة مباشرة: المسموم يُسقط وحده والقائمة حية
  const rowSel = bunSql('SELECT "id","content" FROM "ProdClip" WHERE "id" = ?', "all", [id1])
  const env = JSON.parse(rowSel?.[0]?.content ?? "{}")
  env.ct = "AAAA" + String(env.ct).slice(4)
  bunSql('UPDATE "ProdClip" SET "content" = ? WHERE "id" = ?', "run", [JSON.stringify(env), id1])
  const auditBefore = (await getJson("/api/enterprise/audit?limit=400")).j?.events ?? []
  r = await getJson("/api/prod/clipboard")
  ok("ب12 العبث يُكشف: المسموم يُسقط بصدق والبقية حية", !(r.j?.items ?? []).some((x) => x.id === id1) && (r.j?.items ?? []).some((x) => x.id === idPlain))
  const auditAfter = (await getJson("/api/enterprise/audit?limit=400")).j?.events ?? []
  ok("ب13 تدقيق الإسقاط موثق (clip.crypto.drop)", auditAfter.filter((e) => e.k === "clip.crypto.drop").length > auditBefore.filter((e) => e.k === "clip.crypto.drop").length)

  // ب14 — تدوير القفل: ok + إعادة ختم معلنة والقراءة تعمل بعده
  const legacyCt = (() => { try { return JSON.parse(bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", ["e58-legacy-1"])[0].content).ct } catch { return "" } })()
  r = await postJson("/api/prod/clipboard/vault", { action: "rotate-key" })
  ok("ب14 تدوير القفل: ok وعدد مختم وساقط معلنان", r.status === 200 && r.j?.ok === true && typeof r.j?.resealed === "number" && typeof r.j?.dropped === "number")
  const legacyCtAfter = (() => { try { return JSON.parse(bunSql('SELECT "content" FROM "ProdClip" WHERE "id" = ?', "all", ["e58-legacy-1"])[0].content).ct } catch { return "" } })()
  ok("ب15 إعادة الختم بالمفتاح الجديد: قناغة متغيرة", legacyCtAfter !== "" && legacyCtAfter !== legacyCt)
  r = await getJson("/api/prod/clipboard")
  ok("ب16 القراءة بعد التدوير شفافة كاملة", (r.j?.items ?? []).some((x) => x.id === idPlain && x.content === PLAIN_TEXT) && (r.j?.items ?? []).some((x) => x.id === "e58-legacy-1" && x.content === LEGACY_TEXT) && r.j?.atRest?.active === true)
  ok("ب17 استجابة التدوير بلا مادة مفاتيح إطلاقًا", !/"?key"?\s*:/.test(JSON.stringify(r.j ?? {})) && !/"?key"?\s*:/.test(JSON.stringify((await postJson("/api/prod/clipboard/vault", { action: "rotate-key" })).j ?? {})))

  // ب18 — التدوير من خارج الجهاز → 403 (حرس loopback — FA-22 وحّدته تحت guardPcOnly فصار رد pc-only التعاقدي)
  r = await postJson("/api/prod/clipboard/vault", { action: "rotate-key" }, { "x-gw-client-ip": "10.0.0.9" })
  ok("ب18 تدوير من خارج الجهاز → 403", r.status === 403 && r.j?.error === "pc-only")

  // ب19–ب21 — الجسر الحي (سوكِت الجسر): الدفع مغلف في القاعدة وسجل العمليات معه
  const { io: sockClient } = await import("socket.io-client")
  const sock = sockClient(BRIDGE, { path: "/", transports: ["websocket"], timeout: 8000 })
  const sockEmit = (ev, payload) => new Promise((res) => sock.emit(ev, payload, res))
  const sockOnce = (ev, ms = 6000) => new Promise((res) => { const t = setTimeout(() => res(null), ms); sock.once(ev, (d) => { clearTimeout(t); res(d) }) })
  // درس مُقاس في §59: مستمع الترحيب يُسجّل قبل الاتصال — ما بعده سباق يُفقد hello
  // فيصير المؤشر صفرًا فتعود أول 200 عملية القديمة لا عمليتنا (فشل ب21 في قواعد السجلات الطويلة)
  const helloEarly = sockOnce("prod:hello", 6000)
  await new Promise((res) => { sock.on("connect", res); sock.on("connect_error", res); sock.connect() })
  const connected = sock.connected
  ok("ب19 اتصال الجسر الحي محلي", connected)
  if (connected) {
    // مؤشر الاستئناف = رأس السجل عند الاتصال (prod:hello) — فيشمل الإعادة عمليتنا حصرًا
    const hello = (await Promise.race([helloEarly, sockOnce("prod:hello", 3000)])) ?? {}
    const replayP = sockOnce("prod:replay")
    sock.emit("clip:push", { deviceId: "e58-honeypot", deviceName: "هاتف القفل", kind: "text", content: SOCKET_TEXT, mode: "manual" })
    await new Promise((res) => setTimeout(res, 1200))
    ok("ب20 دفع السوكِت: القاعدة وسجل العمليات بلا النص العاري", !hasBytes("سوكِت-الجسر") && hasBytes(CLIP_AT_REST_MARKER))
    sock.emit("prod:resume", { since: Number(hello?.lastSeq ?? 0) })
    const replay = await replayP
    const localOps = (replay?.ops ?? []).filter((o) => o.kind === "clip:new" && o.payload?.content === SOCKET_TEXT)
    ok("ب21 الإعادة المحلية شفافة: النص يعود كاملًا من فوق المغلف", localOps.length >= 1)
    sock.disconnect()
  } else {
    ok("ب20 دفع السوكِت: القاعدة وسجل العمليات بلا النص العاري", false, "بلا اتصال")
    ok("ب21 الإعادة المحلية شفافة: النص يعود كاملًا من فوق المغلف", false, "بلا اتصال")
  }

  // ب22 — سجل §39: أنواع crypto الموثقة بلا أي محتوى — §59: التهيئة الطبيعية
  // أصبحت لكل جهاز (multi.init) فـ«init» الموحد يظل بديلًا مشروعًا (الأجهزة الشاردة/الفشل)
  r = await getJson("/api/enterprise/audit?limit=500")
  const evs = r.j?.events ?? []
  const kindsSet = new Set(evs.map((e) => e.k))
  const cryptoKinds = ["clip.crypto.init", "clip.crypto.multi.init", "clip.crypto.rotate", "clip.crypto.drop", "clip.crypto.sealall"].filter((k) => kindsSet.has(k))
  const noLeak = evs.every((e) => !JSON.stringify(e.d ?? {}).includes(SECRET_NEEDLE) && !JSON.stringify(e.d ?? {}).includes("عاري-قديم"))
  ok("ب22 سجل §39: rotate/drop/sealall مع تهيئة (init أو multi.init لكل جهاز — عقد §59) بلا محتوى", ["clip.crypto.rotate", "clip.crypto.drop", "clip.crypto.sealall"].every((k) => kindsSet.has(k)) && (cryptoKinds.includes("clip.crypto.init") || cryptoKinds.includes("clip.crypto.multi.init")) && noLeak, `kinds=${cryptoKinds.join(",")}`)

  // ب23 — مسح نهائي: القاعدة تفقد كل المغلفات (فعل الحذف القديم سليم)
  r = await fetch(base + "/api/prod/clipboard", { method: "DELETE" })
  ok("ب23 المسح الكامل يعمل فوق القفل", r.status === 200)
}

console.log(`\n═══ §58 clip-rest-e2e: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
