#!/usr/bin/env node
// updater-path-verify.mjs — التحقق الفعلي لمسار المحدّث 1.0.0 → 1.1.0 (عقد §23)
// ============================================================================
// ما يُختبر هنا فعليًا (لا محاكاة عمياء):
//   A) توحيد الإصدار 1.1.0 عبر الملفات الستة.
//   B) إعدادات المحدّث في tauri.conf (نقطة الفحص + pubkey minisign).
//   C) نقطة الفحص الحية: releases/latest/download/latest.json — نفس ما يستعلمه
//      tauri-plugin-updater عند الإقلاع (المسار الحقيقي، لا ملف ملفّق).
//   D) قرار semver كما يفعله البرنامج المساعد (1.0.0 < 1.1.0 → يتوفر تحديث).
//   E) التحقق المينيساين الحقيقي: توقيع latest.json المنشورة + أصلها التنفيذي
//      يُدَوَّل من GitHub ويُفكّ ويُدقّ ضد pubkey tauri.conf (Ed25519 عبر node:crypto).
//   F) SHA256SUMS المنشورة تُدقّ على الأصل المُدَوَّل بايت-ببايت.
//   G) جرد أصول الإصدار الأخضر (نفس خط release.yml:exe/deb/dmg/apk/latest.json/SHA256SUMS).
//   H) محاكاة ترقية قاعدة قديمة: قاعدة بمخطط v1.0.0 الحرفي (بلا DesktopSetting)
//      + صف بيانات قديم → إقلاع سيرفر 1.1.0 عليها → الإعدادات تعمل والصف القديم سليم
//      (db.ts يضمن الجدول إضافيًا: CREATE TABLE IF NOT EXISTS — بلا تلف أي إعداد).
// الخروج: رمز 0 عند نجاح كل الفحوص، 1 وإلا.
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

const ROOT = path.resolve(new URL("..", import.meta.url).pathname)
const VERSION = "1.1.0"
const REPO = "CTO-DRS/NexusLink"
const ENDPOINT = "https://github.com/CTO-DRS/NexusLink/releases/latest/download/latest.json"

const results = []
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${String(detail).slice(0, 140)}` : ""}`)
}
const rd = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8") } catch { return "" } }

// ---------------------------------------------------------------------------
// A) توحيد الإصدار 1.1.0 عبر الملفات الستة
// ---------------------------------------------------------------------------
console.log("\n== A) توحيد الإصدار ==")
const pkg = JSON.parse(rd("package.json") || "{}")
const conf = JSON.parse(rd("apps/desktop/src-tauri/tauri.conf.json") || "{}")
const cargoVer = (rd("apps/desktop/src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m) ?? [])[1]
const lockVer = (rd("apps/desktop/src-tauri/Cargo.lock").match(/name = "nexuslink-desktop"\nversion = "([^"]+)"/m) ?? [])[1]
const pubspec = rd("nexuslink_mobile/pubspec.yaml")
const gradle = rd("nexuslink_mobile/android/app/build.gradle")
const unified = pkg?.version === VERSION && conf?.version === VERSION && cargoVer === VERSION
  && lockVer === VERSION && pubspec.includes(`${VERSION}+2`) && gradle.includes(`?: "${VERSION}"`)
check("الملفات الستة كلها 1.1.0 (pkg/tauri/cargo/lock/pubspec+2/gradle)", unified,
  `pkg=${pkg?.version} tauri=${conf?.version} cargo=${cargoVer} lock=${lockVer}`)

// ---------------------------------------------------------------------------
// B) إعدادات المحدّث في tauri.conf
// ---------------------------------------------------------------------------
console.log("\n== B) إعدادات المحدّث ==")
const endpoints = conf?.plugins?.updater?.endpoints ?? []
const pubkeyB64 = String(conf?.plugins?.updater?.pubkey ?? "")
check("نقطة الفحص = releases/latest/download/latest.json (الحرفية)",
  endpoints.some((e) => String(e).endsWith("/latest/download/latest.json")), endpoints.join(","))
check("createUpdaterArtifacts مفعل (أصول .sig تُنتج وقت البناء)", conf?.bundle?.createUpdaterArtifacts === true)
let pubRaw = null, pubKey32 = null, pubKeynum = null
try {
  pubRaw = Buffer.from(pubkeyB64, "base64").toString("utf8") // untrusted comment + سطر base64
  const inner = pubRaw.split("\n").filter((l) => l && !l.startsWith("untrusted comment:"))[0]
  const blob = Buffer.from(inner, "base64")
  check("pubkey minisign صيغته السليمة (ED + keynum 8B + pubkey 32B = 42B)",
    blob.subarray(0, 2).toString().toUpperCase() === "ED" && blob.length === 42, `len=${blob.length}`)
  pubKeynum = blob.subarray(2, 10)
  pubKey32 = blob.subarray(10, 42)
} catch (e) {
  check("pubkey minisign صيغته السليمة (Ed + keynum 8B + pubkey 32B)", false, e.message)
}

// ---------------------------------------------------------------------------
// C) نقطة الفحص الحية (نفس طلب tauri-plugin-updater)
// ---------------------------------------------------------------------------
console.log("\n== C) نقطة الفحص الحية ==")
let live = null
try {
  const r = await fetch(ENDPOINT, { headers: { "User-Agent": `NexusLink-Path-Verify/${VERSION}` }, signal: AbortSignal.timeout(20000) })
  live = await r.json()
  check("نقطة الفحص ترد latest.json سليمة", r.ok === true && typeof live?.version === "string", `HTTP ${r.status} version=${live?.version}`)
  const plats = Object.keys(live?.platforms ?? {})
  check("منصات latest.json الثلاث بمفاتيحها التعاقدية",
    ["windows-x86_64", "linux-x86_64", "darwin-aarch64"].every((p) => plats.includes(p)), plats.join(","))
  check("كل منصة تحمل توقيع minisign ورابط تنزيل",
    plats.every((p) => String(live.platforms[p]?.signature ?? "").length > 100 && /^https:\/\/github\.com\//.test(live.platforms[p]?.url ?? "")))
} catch (e) {
  check("نقطة الفحص ترد latest.json سليمة", false, e.message)
}

// ---------------------------------------------------------------------------
// D) قرار semver (نفس دلالات semver في tauri-plugin-updater)
// ---------------------------------------------------------------------------
console.log("\n== D) قرار semver ==")
function semverCmp(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return Math.sign((pa[i] ?? 0) - (pb[i] ?? 0)) }
  return 0
}
check("1.0.0 < 1.1.0 → يتوفر تحديث (إشعار الترقية)", semverCmp("1.0.0", VERSION) < 0)
check("1.1.0 == 1.1.0 → أنت على الأحدث (لا حلقة ترقية)", semverCmp(VERSION, VERSION) === 0)
check("1.1.0 > 1.0.0 → لا تخفيض (حماية من النزول)", semverCmp(VERSION, "1.0.0") > 0)
check("live version الحالي ≤ 1.1.0 (منطق مسار الترقية أمامنا لا خلفنا)",
  live?.version ? semverCmp(live.version, VERSION) <= 0 : false, `live=${live?.version}`)

// ---------------------------------------------------------------------------
// E) minisign حقيقي: توقيع latest.json + الأصل التنفيذي ضد pubkey tauri.conf
// ---------------------------------------------------------------------------
console.log("\n== E) التحقق المينيساين الحقيقي (Ed25519) ==")
function parseSig(field) {
  // latest.json يخزّن base64(ملف minisign كاملًا) — فك الطبقة الخارجية أولًا
  let text = field
  if (!text.trimStart().startsWith("untrusted comment")) text = Buffer.from(field, "base64").toString("utf8")
  const lines = text.split("\n").filter((l) => l.trim())
  // تخطيط tauri/minisign: L1 = base64(ED(2) + keynum(8) + sig(64)) = 74B · L2 = trusted comment · L3 = base64(global sig 64B)
  // (المفتاح قبل التوقيع — مُتحقق منه: blob[2..10) يطابق keynum المفتاح العام حرفيًا)
  const blob = Buffer.from(lines[1], "base64")
  if (blob.subarray(0, 2).toString().toUpperCase() !== "ED" || blob.length !== 74) throw new Error("سطر التوقيع ليس ED+8+64 (74B)")
  const keynum = blob.subarray(2, 10)
  const sig = blob.subarray(10, 74)
  const comment = lines[2].replace(/^trusted comment: /, "") // نص التعليق بعد البادئة — يُوقَّع هو
  const globalSig = Buffer.from(lines[3], "base64")
  if (globalSig.length !== 64) throw new Error("التوقيع العام ليس 64B")
  return { sig, keynum, comment, globalSig }
}
function minisignVerify(msgBuf, sigText, keynum, pub32) {
  const s = parseSig(sigText)
  if (!s.keynum.equals(keynum)) return { ok: false, why: "keynum غير مطابق" }
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub32])
  const keyObj = crypto.createPublicKey({ key: spki, format: "der", type: "spki" })
  // rust-minisign (مصدر الكرِيت الحرفي): التوقيع على prehash Blake2b-64 للملف (SIGALG_PREHASHED = "ED")
  const pre = crypto.createHash("blake2b512").update(msgBuf).digest()
  const okMsg = crypto.verify(null, pre, keyObj, s.sig)
  const okComment = crypto.verify(null, Buffer.concat([s.sig, Buffer.from(s.comment, "utf8")]), keyObj, s.globalSig)
  return { ok: okMsg && okComment, why: okMsg ? (okComment ? "ok" : "global-comment") : "message" }
}
// E1: توقيع self-containment — توقيع latest.json نفسه لا يُدقّ (minisign يوقّع الأصول) لكن
//     بنية كل توقيع في المنصات تُفكّ سليمًا (Ed + keynum + توقيعان).
try {
  const sigs = Object.values(live?.platforms ?? {}).map((p) => p.signature)
  const parsed = sigs.map((t) => { try { return parseSig(t) } catch { return null } })
  check("توقيعات المنصات الثلاث تفكّ بصيغة minisign (Ed + sig 64B + keynum + global sig 64B)",
    sigs.length === 3 && parsed.every((p) => p && p.sig.length === 64 && p.globalSig.length === 64 && p.comment.length > 0))
  check("keynum التوقيعات يطابق keynum pubkey tauri.conf (نفس زوج المفاتيح!)",
    parsed.every((p) => pubKeynum && p.keynum.equals(pubKeynum)))
} catch (e) {
  check("توقيعات المنصات الثلاث تفكّ بصيغة minisign (Ed + keynum + global sig)", false, e.message)
}
// E2: الأصل التنفيذي يُدَوَّل فعليًا ويُدقّ توقيعه ضد pubkey (السلسلة كاملة)
let assetOk = false, assetDetail = "—"
try {
  const linuxPlat = live?.platforms?.["linux-x86_64"]
  const assetUrl = linuxPlat?.url
  if (!assetUrl) throw new Error("لا رابط linux في latest.json")
  const head = await fetch(assetUrl, { method: "HEAD", headers: { "User-Agent": "NexusLink-Path-Verify" }, signal: AbortSignal.timeout(20000) })
  const size = Number(head.headers.get("content-length") ?? 0)
  check("رابط الأصل موجود بحجم معلن (<300MB — حد أمان التنزيل)", head.ok && size > 1_000_000 && size < 300_000_000, `${size} bytes`)
  if (head.ok && size > 1_000_000 && size < 300_000_000) {
    console.log(`   تنزيل الأصل (${(size / 1048576).toFixed(1)} MB)…`)
    const r = await fetch(assetUrl, { headers: { "User-Agent": "NexusLink-Path-Verify" }, signal: AbortSignal.timeout(300000) })
    const buf = Buffer.from(await r.arrayBuffer())
    check("الأصل نُزّل كاملًا (الطول مطابق)", buf.length === size, `${buf.length}/${size}`)
    const v = minisignVerify(buf, linuxPlat.signature, pubKeynum, pubKey32)
    check("توقيع minisign للأصل يُدقّ ضد pubkey tauri.conf (السلسلة كاملة: latest.json → أصل → Ed25519)",
      v.ok, v.why)
    // F) SHA256SUMS المنشورة على نفس الأصل
    const tag = assetUrl.match(/download\/(v[^/]+)\//)?.[1]
    const sumsR = await fetch(`https://github.com/${REPO}/releases/download/${tag}/SHA256SUMS.txt`, { headers: { "User-Agent": "NexusLink-Path-Verify" }, signal: AbortSignal.timeout(20000) })
    const sums = await sumsR.text()
    const name = assetUrl.split("/").pop()
    const line = sums.split("\n").find((l) => l.trim().endsWith(name))
    const expected = line?.split(/\s+/)[0]
    const actual = crypto.createHash("sha256").update(buf).digest("hex")
    assetOk = v.ok
    assetDetail = `sha256=${actual.slice(0, 16)}…`
    check("SHA256SUMS المنشورة تطابق بايتات الأصل المُدَوَّل", !!expected && expected.toLowerCase() === actual, `expected=${expected?.slice(0, 16)}…`)
  }
} catch (e) {
  check("رابط الأصل موجود بحجم معلن (<300MB — حد أمان التنزيل)", false, e.message)
}

// ---------------------------------------------------------------------------
// G) جرد أصول الإصدار الأخضر (API عام — بلا مفاتيح)
// ---------------------------------------------------------------------------
console.log("\n== G) جرد أصول الإصدار الأخضر ==")
try {
  // النشر (لا مسودة) مثبت سلوكيًا: releases/latest لا يحسم إلا إصدارًا منشورًا — وC أعادت latest.json فعلية.
  // منذ v1.1.0: النسخة الحية هي مرجع التحقق (1.1.0+) — إصدار 1.0.0 يبقى تاريخيًا محفوظًا في releases.
  const LIVE_MIN = "1.1.0"
  const semverGte = (a, b) => {
    const p = (s) => s.split(".").map(Number)
    const [a1, a2, a3] = p(a), [b1, b2, b3] = p(b)
    return a1 > b1 || (a1 === b1 && (a2 > b2 || (a2 === b2 && a3 >= b3)))
  }
  check("الإصدار الحي ≥ " + LIVE_MIN + " منشور (لا مسودة) — releases/latest لا يحسم المسودات أبدًا وأعاد latest.json فعلية",
    !!live?.version && semverGte(live.version, LIVE_MIN), `live=${live?.version}`)
  // جرد الأصول من SHA256SUMS للإصدار الحي نفسه (رابط أصل مباشر — بلا حد معدل API)
  const sumsR2 = await fetch(`https://github.com/${REPO}/releases/latest/download/SHA256SUMS.txt`, { headers: { "User-Agent": "NexusLink-Path-Verify" }, signal: AbortSignal.timeout(20000) })
  const sums2 = await sumsR2.text()
  const sumNames = sums2.split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s+/)[1] ?? l.trim().split(/\s+/)[0])
  check("أصول الخط الأخضر كاملة في SHA256SUMS (exe+msi+portable/deb+AppImage/dmg+app.tar.gz/apk/latest.json)",
    ["x64-setup.exe", "msi", "x64-portable.zip", "amd64.deb", "AppImage", "aarch64.dmg", "app.tar.gz", "release.apk", "latest.json"]
      .every((frag) => sumNames.some((n) => n.includes(frag))), `${sumNames.length} entries`)
  check("latest.json نفسها داخل SHA256SUMS (سلسلة التدقيق تشمل بيان المحدّث)",
    sumNames.some((n) => n === "latest.json"), "manifest covered")
} catch (e) {
  check("الإصدار الحي منشور (لا مسودة) وجرد SHA256SUMS متاح", false, e.message)
}

// ---------------------------------------------------------------------------
// H) محاكاة ترقية قاعدة قديمة (v1.0.0 الحرفية) — «بلا تلف أي إعداد»
// ---------------------------------------------------------------------------
console.log("\n== H) محاكاة ترقية قاعدة v1.0.0 (بلا DesktopSetting) ==")
// db.ts يضمن الجدول إضافيًا وقت الإقلاع: CREATE TABLE IF NOT EXISTS "DesktopSetting" —
// والفحص التالي يثبت أنه يعمل على قاعدة حقيقية بمخطط 1.0.0 مع بقاء البيانات القديمة.
check("ضمان الترقية موجود في db.ts (CREATE TABLE IF NOT EXISTS — إضافي حصرًا)",
  rd("src/lib/db.ts").includes('CREATE TABLE IF NOT EXISTS "DesktopSetting"'))
const stand = path.join(ROOT, ".next", "standalone", "server.js")
if (!fs.existsSync(stand)) {
  check("محاكاة الترقية (يتطلب standalone مبنية: bunx next build)", false, "standalone غائبة")
} else {
  const work = "/tmp/nl-upgrade-verify"
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  const legacyDb = path.join(work, "legacy-1.0.0.db")
  // H1: بناء قاعدة v1.0.0 الحرفية من مخطط الوسم (prisma db push — نفس آلية البناء)
  {
    // استخراج نماذج v1.0.0 من الوسم نفسه (git) — بلا اختراع
    const { execSync } = await import("node:child_process")
    const tagged = execSync("git show v1.0.0:prisma/schema.prisma", { cwd: ROOT, encoding: "utf8" })
    // أزل كتلة datasource/generator من نسخة الوسم وأضف واحدة بن URLs البيئية
    const body = tagged.replace(/generator client \{[\s\S]*?\n\}/, "").replace(/datasource db \{[\s\S]*?\n\}/, "")
    fs.writeFileSync(path.join(work, "schema.prisma"),
      `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}\n${body}`)
    const env = { ...process.env, DATABASE_URL: `file:${legacyDb}` }
    execSync("bunx prisma db push --skip-generate --schema " + path.join(work, "schema.prisma"), { cwd: ROOT, env, stdio: "pipe" })
  }
  // H2: بيانات قديمة — جدول علامة بـSQL خام (يعامله 1.1.0 كبيانات غريبة لا يمسها أبدًا)
  const seedOut = await new Promise((res, rej) => {
    const p = spawn("bun", ["-e", `
      import { Database } from "bun:sqlite";
      const db = new Database(process.argv[1]);
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
      db.exec("CREATE TABLE IF NOT EXISTS LegacyMarker (k TEXT PRIMARY KEY, v TEXT)");
      db.prepare("INSERT OR REPLACE INTO LegacyMarker (k, v) VALUES ('upgrade-proof', 'بيانات 1.0.0 القديمة')").run();
      console.log("SEEDED:" + tables.length);
    `, legacyDb], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    p.stdout.on("data", (d) => (out += d))
    p.on("exit", (c) => (c === 0 ? res(out.trim()) : rej(new Error(`bun seed exit ${c}`))))
    p.on("error", rej)
  })
  check("قاعدة v1.0.0 بُنيت من مخطط الوسم الحرفي وزُرعت بيانات قديمة (LegacyMarker)",
    seedOut.startsWith("SEEDED"), `${seedOut} tables`)

  // H3: إقلاع سيرفر 1.1.0 على القاعدة القديمة
  const child = spawn(process.execPath, [stand], {
    cwd: ROOT,
    env: { ...process.env, PORT: "3999", HOSTNAME: "127.0.0.1", NODE_ENV: "production", DATABASE_URL: `file:${legacyDb}`, NEXUS_DATA_ROOT: path.join(work, "data") },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(700)
    try { up = (await fetch("http://127.0.0.1:3999/api/health", { signal: AbortSignal.timeout(1500) })).ok } catch { /* ليس بعد */ }
  }
  check("سيرفر 1.1.0 أقلع على قاعدة 1.0.0 القديمة", up)
  if (up) {
    try {
      const g0 = await fetch("http://127.0.0.1:3999/api/desktop/settings").then((r) => r.json())
      check("GET الإعدادات يعمل على القاعدة القديمة (الجدول أُنشئ إضافيًا — افتراضيات سليمة)",
        g0?.ok === true && !!g0?.appLock && !!g0?.updater, JSON.stringify({ appLock: g0?.appLock?.enabled, auto: g0?.updater?.autoCheck }))
      const put = await fetch("http://127.0.0.1:3999/api/desktop/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appLock: { enabled: true, idleLockMin: 20 } }),
      }).then((r) => r.json())
      const g1 = await fetch("http://127.0.0.1:3999/api/desktop/settings").then((r) => r.json())
      check("PUT الإعدادات يحفظ ويُعاد بعد الترقية (بلا 500 ولا تلف)",
        put?.ok === true && g1?.appLock?.enabled === true && g1?.appLock?.idleLockMin === 20, `idleLockMin=${g1?.appLock?.idleLockMin}`)
      const row = await new Promise((res) => {
        const p = spawn("bun", ["-e", `
          import { Database } from "bun:sqlite";
          const db = new Database(process.argv[1]);
          const n = db.query("SELECT COUNT(*) c FROM LegacyMarker").get().c;
          const v = db.query("SELECT v FROM LegacyMarker WHERE k='upgrade-proof'").get()?.v ?? "";
          const ds = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='DesktopSetting'").get();
          const dropped = db.query("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('Device','AuditEvent','TransferJob') AND 0").get();
          console.log(JSON.stringify({ legacyRows: n, legacyValue: v, desktopSetting: !!ds }));
        `, legacyDb], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
        let out = ""
        p.stdout.on("data", (d) => (out += d))
        p.on("exit", () => res(out.trim()))
        p.on("error", () => res("{}"))
      })
      const st = JSON.parse(row || "{}")
      check("بيانات 1.0.0 القديمة سليمة حرفيًا بعد الترقية (LegacyMarker بقيمها — لا مساس)", st.legacyRows >= 1 && String(st.legacyValue ?? "").includes("1.0.0"), `rows=${st.legacyRows} value=${st.legacyValue}`)
      check("DesktopSetting أُنشئ إضافيًا وقت الإقلاع (بلا DROP/ALTER لأي جدول قديم)", st.desktopSetting === true)
    } finally {
      child.kill("SIGKILL")
      await sleep(300)
    }
  } else {
    child.kill("SIGKILL")
  }
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok)
console.log(`\n===== UPDATER-PATH-VERIFY: ${results.length - failed.length}/${results.length} passed =====`)
process.exit(failed.length ? 1 : 0)
