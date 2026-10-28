#!/usr/bin/env node
// NexusLink — بوابة الإدارة المركزية الجماعية الموسّعة (عقد §47) — enterprise47-e2e
// ============================================================
// الطور أ (نقي — بلا خادم، 24 فحصًا): رياضيات المخطط v2 — قبول/رفض كل مفتاح
//   جديد، توافق v1 الرجعي، لا مزج إصدارات، حدود التدوير 1–365، المكررات،
//   semver (شكلًن ومقارنة رقمية)، استحقاق التدوير، بايتات PDF (ترويسة/xref/
//   EOF/بلا بايتات غير-لاتينية/توازن BT-ET)، أقسام التقرير الإنجليزية
//   (العربية محذوفة بصدق)، وبنية حزم MDM التعريفية الثلاث.
// الطور ب (حي — ضد السيرفر، 24 فحصًا): خط الأساس غير المُدار → نشر v2 →
//   قفل إعدادات انتقائي → استحقاق تدوير → تدوير يصفّر → تعطيل القدرات
//   الثلاث → ختم الإصدار → تقرير JSON/PDF → تعديل حي بلا إعادة تشغيل →
//   فشل-آمن لملف تالف → سجل §39 يحمل الأنواع الخمسة → خاتمة نظيفة.
// الاستخدام:
//   node scripts/enterprise47-e2e.mjs                     (طور أ حصرًا)
//   node scripts/enterprise47-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e47-live
//   (السيرفر يُقلع بمتغيري NEXUSLINK_POLICY_FILE/NEXUSLINK_PAIR_FILE على ملفي
//    --dir نفسه — .zscripts/boot-e47.sh يفعل ذلك)
// خروج 0 = أخضر، 1 = أحمر. القاعدة: جولتان متتاليتان أخضرتان (كما في كل البوابات).

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
  return i > 0 ? process.argv[i + 1] : "/tmp/nexuslink-e47-live"
})()

/* ═════════════ الطور أ — رياضيات المخطط v2 (24 فحصًا) ═════════════ */
const {
  readEnterprisePolicy, isValidSemver, semverGte, rotationDue,
  ROTATION_DAYS_MIN, ROTATION_DAYS_MAX, LOCKABLE_SETTINGS, POLICY_CAPABILITIES,
} = await import("../src/lib/enterprise-policy.ts")
const { buildPdf, buildCompliancePdf, complianceSections } = await import("../src/lib/nexus/report-pdf.ts")

const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), "nexuslink-e47a-"))
let scenario = 0
/** قراءة سياسة من ملف سيناريو مستقل (مسار جديد = قراءة جديدة — كاش المسار) */
function readWithPolicy(objOrRaw) {
  const p = path.join(tmpA, `policy-${String(++scenario).padStart(2, "0")}.json`)
  fs.writeFileSync(p, typeof objOrRaw === "string" ? objOrRaw : JSON.stringify(objOrRaw))
  process.env.NEXUSLINK_POLICY_FILE = p
  return readEnterprisePolicy()
}

const FULL_V2 = {
  schemaVersion: 2,
  organization: "E2E Org",
  managed: {
    remoteAccess: "force-on",
    blockedBridges: [3005, 3006],
    lockedSettings: ["appLock", "updater"],
    accessCodeRotationDays: 30,
    disabledCapabilities: ["market", "sync"],
    minimumVersion: "3.1.0",
  },
}

// أ1 — v2 كامل صالح: managed وكل المفاتيح مقروءة كما كُتبت
const p1 = readWithPolicy(FULL_V2)
ok(
  "أ1 v2 كامل صالح — كل المفاتيح مقروءة",
  p1.state === "managed" && p1.schemaVersion === 2 && p1.organization === "E2E Org" &&
    p1.remoteAccess === "force-on" && JSON.stringify(p1.blockedBridges) === "[3005,3006]" &&
    JSON.stringify(p1.lockedSettings) === JSON.stringify(["appLock", "updater"].sort()) &&
    p1.accessCodeRotationDays === 30 &&
    JSON.stringify(p1.disabledCapabilities) === JSON.stringify(["market", "sync"].sort()) &&
    p1.minimumVersion === "3.1.0",
  `state=${p1.state}`,
)

// أ2 — v1 خالص: يعمل كاملًا والمفاتيح الجديدة محايدة (توافق رجعي)
const p2 = readWithPolicy({ schemaVersion: 1, organization: "Old", managed: { remoteAccess: "force-off", blockedBridges: [3003] } })
ok(
  "أ2 v1 خالص صالح — الجديد محايد (توافق رجعي)",
  p2.state === "managed" && p2.schemaVersion === 1 && p2.remoteAccess === "force-off" &&
    p2.lockedSettings.length === 0 && p2.accessCodeRotationDays === null &&
    p2.disabledCapabilities.length === 0 && p2.minimumVersion === null,
)

// أ3 — v1 يحمل مفتاح v2 → invalid (لا مزج إصدارات في ملف واحد)
const p3 = readWithPolicy({ schemaVersion: 1, managed: { lockedSettings: ["appLock"] } })
ok("أ3 v1 يحمل مفتاح v2 → invalid", p3.state === "invalid")

// أ4/أ5 — أسماء غريبة في القائمتين → invalid (لا فرض جزئي)
const p4 = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, lockedSettings: ["appLock", "theme"] } })
ok("أ4 lockedSettings اسم غريب → invalid", p4.state === "invalid")
const p5 = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, disabledCapabilities: ["cloud"] } })
ok("أ5 disabledCapabilities اسم غريب → invalid", p5.state === "invalid")

// أ6/أ7/أ8/أ9 — حدود التدوير
const p6 = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, accessCodeRotationDays: 0 } })
ok("أ6 تدوير 0 يومًا → invalid", p6.state === "invalid")
const p7 = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, accessCodeRotationDays: 366 } })
ok("أ7 تدوير 366 يومًا → invalid", p7.state === "invalid")
const p8 = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, accessCodeRotationDays: 1.5 } })
ok("أ8 تدوير عائم → invalid", p8.state === "invalid")
const p9a = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, accessCodeRotationDays: ROTATION_DAYS_MIN } })
const p9b = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, accessCodeRotationDays: ROTATION_DAYS_MAX } })
ok(
  `أ9 الحدان شاملان (${ROTATION_DAYS_MIN} و${ROTATION_DAYS_MAX} صالحان)`,
  p9a.state === "managed" && p9b.state === "managed" && p9a.accessCodeRotationDays === ROTATION_DAYS_MIN,
)

// أ10 — مكررات → invalid (توافق التوأم: البوابة ترفضها والمحرك كذلك)
const p10 = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, lockedSettings: ["appLock", "appLock"] } })
ok("أ10 قائمة مكررة → invalid (توأم)", p10.state === "invalid")

// أ11/أ12 — شكل semver
const p11 = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, minimumVersion: "3.1" } })
ok("أ11 minimumVersion «3.1» → invalid", p11.state === "invalid")
const p12 = readWithPolicy({ ...FULL_V2, managed: { ...FULL_V2.managed, minimumVersion: "v3.1.0" } })
ok("أ12 minimumVersion «v3.1.0» → invalid", p12.state === "invalid")

// أ13/أ14/أ15 — مقارنة الأرضية الرقمية
ok("أ13 semverGte 3.1.0 ≥ 3.0.9", semverGte("3.1.0", "3.0.9") === true)
ok("أ14 semverGte 3.0.0 < 3.1.0", semverGte("3.0.0", "3.1.0") === false)
ok("أ15 مقارنة رقمية لا معجمية (10.0.0 ≥ 9.9.9)", semverGte("10.0.0", "9.9.9") === true)

// أ16/أ17 — استحقاق التدوير
const fresh = new Date(Date.now() - 86_400_000).toISOString()
const stale = new Date(Date.now() - 31 * 86_400_000).toISOString()
ok(
  "أ16 rotationDue: رمز حديث لا يستحق + بلا أيام لا استحقاق",
  rotationDue(fresh, 30) === false && rotationDue(fresh, null) === false && rotationDue(null, 30) === false,
)
ok("أ17 rotationDue: عمر 31 يومًا بأجلة 30 → مستحق", rotationDue(stale, 30) === true)

// أ18–أ21 — بايتات PDF (ترويسة/خاتمة/xref/بلا بايتات عالية)
const REPORT = {
  contract: "§47", generatedAt: new Date().toISOString(), organization: "مؤسسة عربية Acme",
  policy: { state: "managed", hash: "0123456789abcdef", schemaVersion: 2 },
  enforced: { remoteAccess: "force-on", blockedBridges: [3005], lockedSettings: ["appLock"], accessCodeRotationDays: 30, disabledCapabilities: ["market"], minimumVersion: "3.1.0" },
  posture: { source: "policy", closed: false },
  pairGate: { enabled: true, fingerprint: "fp0123456789abcde", createdAt: stale, rotation: { days: 30, ageDays: 57, due: true } },
  devices: {
    total: 30, byKind: { phone: 20, pc: 10 },
    items: Array.from({ length: 30 }, (_, i) => ({ name: `Device-${i} جهاز`, kind: i % 2 ? "phone" : "pc", state: "online", lastSeenAgo: `${i}m ago`, rttMs: 5 + i })),
  },
  versions: { app: "3.0.0", minimum: "3.1.0", belowMinimum: true },
  metrics: { pairTargetMs: 30000, pairing: { n: 9, last: 21000, avg: 26000, p95: 41000, max: 52000, passRate: 77 } },
  audit: { count: 40, valid: true, brokenAt: null },
}
const pdfBytes = Buffer.from(buildCompliancePdf(REPORT))
ok("أ18 PDF: ترويسة %PDF-1.4 وخاتمة %%EOF", pdfBytes.subarray(0, 8).toString("latin1") === "%PDF-1.4" && pdfBytes.subarray(-6).toString("latin1") === "%%EOF\n", `${pdfBytes.length}B`)
const txt = pdfBytes.toString("latin1")
const startxrefM = txt.match(/startxref\n(\d+)\n%%EOF/)
const startxref = startxrefM ? Number(startxrefM[1]) : -1
ok("أ19 PDF: startxref يشير لكلمة xref حرفيًا", startxref >= 0 && txt.slice(startxref, startxref + 4) === "xref", `offset=${startxref}`)
// كل مدخل n يشير إلى «N 0 obj» الصحيح — إعادة بناء مستقلة للجدول
const nEntries = [...txt.matchAll(/^(\d{10}) 00000 n /gm)]
let xrefValid = true
nEntries.forEach((e, idx) => {
  const off = Number(e[1])
  const expect = `${idx + 1} 0 obj`
  if (txt.slice(off, off + expect.length) !== expect) xrefValid = false
})
const sizeMatchM = txt.match(/\/Size (\d+)/)
const sizeMatch = sizeMatchM ? sizeMatchM[1] : "0"
ok(
  "أ20 PDF: كل مدخلات xref تشير لكائنها الصحيح + /Size متسق",
  xrefValid && nEntries.length > 0 && Number(sizeMatch) === nEntries.length + 1,
  `entries=${nEntries.length}`,
)
ok("أ21 PDF: صفر بايتات فوق 0x7E (WinAnsi آمن)", [...pdfBytes].every((b) => b <= 0x7e))

// أ22/أ23 — أقسام التقرير الإنجليزية + تعدد الصفحات وتوازن BT/ET
const secs = complianceSections(REPORT)
const ARABIC = /[؀-ۿ]/
// النص المعروض داخل تروائس المحتوى (أسطر «(...) Tj ET») — العربي محذوف منها
const rendered = [...txt.matchAll(/\((.*?)\) Tj ET/g)].map((m) => m[1] ?? "")
ok(
  "أ22 التقرير 8 أقسام إنجليزية والعربية محذوفة من النص المعروض",
  secs.length === 8 &&
    (secs[0] ? secs[0].title : "") === "NexusLink Enterprise Compliance Report" &&
    rendered.length > 30 && rendered.every((l) => !ARABIC.test(l)),
  `${secs.length} أقسام · ${rendered.length} سطرًا معروضًا`,
)
const pageCount = (txt.match(/\/Type \/Page[^s]/g) || []).length
const btCount = (txt.match(/^BT /gm) || []).length
const etCount = (txt.match(/ET$/gm) || []).length
ok(
  "أ23 PDF متعدد الصفحات بتوازن BT/ET تام",
  pageCount >= 2 && btCount === etCount && btCount > 30,
  `pages=${pageCount} BT=${btCount}`,
)

// أ24 — حزم MDM التعريفية: بنية مطابقة للمخطط (فحص سطري صادق — لا محلل XML)
const admx = fs.readFileSync(path.join(process.cwd(), "packaging/mdm/windows/nexuslink.admx"), "utf8")
const adml = fs.readFileSync(path.join(process.cwd(), "packaging/mdm/windows/nexuslink.adml"), "utf8")
const plist = fs.readFileSync(path.join(process.cwd(), "packaging/mdm/macos/com.nexuslink.policy.plist"), "utf8")
const android = JSON.parse(fs.readFileSync(path.join(process.cwd(), "packaging/mdm/android/managed_config.json"), "utf8"))
const tmpl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/enterprise/policy.template.v2.json"), "utf8"))
const ADMX_POLICIES = ["Organization", "RemoteAccess", "BlockedBridges", "LockedSettings", "AccessCodeRotationDays", "DisabledCapabilities", "MinimumVersion"]
const MANAGED_KEYS = ["remoteAccess", "blockedBridges", "lockedSettings", "accessCodeRotationDays", "disabledCapabilities", "minimumVersion"]
// كل مرجع $(string.x) في ADMX له معرف id="x" في ADML — تحقق تقاطع حقيقي
const admxStringRef = [...admx.matchAll(/\$\(string\.([A-Za-z0-9_]+)\)/g)].map((m) => m[1])
const admlIds = new Set([...adml.matchAll(/<string id="([^"]+)">/g)].map((m) => m[1]))
ok(
  "أ24 حزم MDM الثلاث + القالب: مفاتيح المخطط v2 كاملة ومتطابقة",
  ADMX_POLICIES.every((name) => admx.includes(`name="${name}"`)) &&
    admx.includes("minValue=\"1\"") && admx.includes("maxValue=\"365\"") &&
    admxStringRef.length > 0 && admxStringRef.every((x) => admlIds.has(x)) &&
    MANAGED_KEYS.every((k) => plist.includes(`<key>${k}</key>`)) && plist.includes("<integer>2</integer>") &&
    MANAGED_KEYS.every((k) => k in android.managed) && android.schemaVersion === 2 &&
    MANAGED_KEYS.every((k) => k in tmpl.managed) && tmpl.schemaVersion === 2,
  `admx↔adml strings=${admxStringRef.length}`,
)

/* ═════════════ الطور ب — السيناريو الحي (24 فحصًا) ═════════════ */
if (!APP) {
  console.log(`\nالطور ب تخطٍّ صادق: بلا --app — شغّل: node scripts/enterprise47-e2e.mjs --app http://127.0.0.1:3000 --dir ${LIVE_DIR}`)
} else {
  const base = APP.replace(/\/$/, "")
  const POLICY = path.join(LIVE_DIR, "policy.json")
  const PAIR = path.join(LIVE_DIR, "pair-token.json")
  fs.mkdirSync(LIVE_DIR, { recursive: true })
  const get = (p) => fetch(base + p, { cache: "no-store" }).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.arrayBuffer() }))
  const getJson = async (p) => {
    const r = await get(p)
    try { return { status: r.status, j: JSON.parse(Buffer.from(r.body).toString("utf8")) } } catch { return { status: r.status, j: null } }
  }
  const put = (p, body) => fetch(base + p, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const writePolicy = (objOrRaw) => fs.writeFileSync(POLICY, typeof objOrRaw === "string" ? objOrRaw : JSON.stringify(objOrRaw, null, 2))
  const writePair = (createdAt) =>
    fs.writeFileSync(PAIR, JSON.stringify({ token: "e47-" + "k".repeat(40), fingerprint: "e47fingerprint0000", createdAt }, null, 2))
  const LIVE_V2 = {
    schemaVersion: 2,
    organization: "E2E Live Org",
    managed: {
      remoteAccess: "force-on",
      blockedBridges: [],
      lockedSettings: ["appLock"],
      accessCodeRotationDays: 30,
      disabledCapabilities: ["market", "assist", "sync"],
      minimumVersion: "3.1.0",
    },
  }

  // ب1/ب2 — خط الأساس غير المُدار: لا قفل والكتابة تعمل
  writePolicy({ schemaVersion: 2, organization: "E2E Live Org", managed: {} })
  let r = await getJson("/api/desktop/settings")
  ok("ب1 خط الأساس: GET settings سليم بلا أقفال", r.status === 200 && r.j.ok === true && Array.isArray(r.j.policy?.lockedSettings) && r.j.policy.lockedSettings.length === 0)
  let rr = await put("/api/desktop/settings", { idle: { optMinutes: 7, reducePolling: true } })
  ok("ب2 خط الأساس: PUT idle يعمل (غير مُدار)", rr.status === 200 && (await rr.json()).ok === true)

  // ب3/ب4 — نشر v2: قفل انتقائي (appLock وحده)
  writePolicy(LIVE_V2)
  rr = await put("/api/desktop/settings", { appLock: { enabled: true } })
  let rj = await rr.json()
  ok(
    "ب3 PUT appLock المقفول → 403 settings-locked-by-policy",
    rr.status === 403 && rj.error === "settings-locked-by-policy" && Array.isArray(rj.detail?.locked) && rj.detail.locked.includes("appLock"),
  )
  rr = await put("/api/desktop/settings", { idle: { optMinutes: 9, reducePolling: true } })
  ok("ب4 PUT idle (غير مقفول) → 200 — القفل انتقائي", rr.status === 200 && (await rr.json()).ok === true)
  r = await getJson("/api/desktop/settings")
  ok("ب4-ب GET settings يعلن الأقسام المقفولة للمخططة", r.j.policy?.lockedSettings?.includes("appLock") === true)

  // ب5/ب6/ب7 — إجبار التدوير: حديث → مستحق → التدوير يصفّر
  writePair(new Date().toISOString())
  r = await getJson("/api/remote-access")
  ok(
    "ب5 رمز حديث: rotation {days:30, due:false}",
    r.j.ok === true && r.j.rotation?.days === 30 && r.j.rotation?.due === false,
    `age=${r.j.rotation?.ageDays}`,
  )
  writePair(new Date(Date.now() - 40 * 86_400_000).toISOString())
  r = await getJson("/api/remote-access")
  ok(
    "ب6 رمز عمره 40 يومًا بأجلة 30 → due:true صاخب",
    r.j.rotation?.due === true && r.j.rotation?.ageDays === 40 && r.j.enabled === true,
  )
  rr = await post("/api/remote-access", { action: "rotate" })
  rj = await rr.json()
  r = await getJson("/api/remote-access")
  ok(
    "ب7 التدوير يصفّر العداد (رمز جديد → due:false)",
    rr.status === 200 && rj.ok === true && typeof rj.token === "string" && r.j.rotation?.due === false,
  )

  // ب8/ب9 — تعطيل market: GET يعلن وPOST يرفض
  r = await getJson("/api/marketplace")
  ok("ب8 GET market يعلن policy.marketDisabled=true", r.j.policy?.marketDisabled === true)
  rr = await post("/api/marketplace", { action: "pub-list" })
  rj = await rr.json()
  ok(
    "ب9 POST market (pub-list) → 403 capability-disabled-by-policy",
    rr.status === 403 && rj.error === "capability-disabled-by-policy" && rj.detail?.capability === "market",
  )

  // ب10/ب11 — تعطيل assist: اللقطة تصمت والطلب يُرفض
  r = await getJson("/api/devices/assist")
  ok(
    "ب10 GET assist: assistDisabled=true والرمز مطوي",
    r.j.ok === true && r.j.policy?.assistDisabled === true && r.j.code === null && r.j.active === false,
  )
  rr = await post("/api/devices/assist", { action: "request", assistCode: "123456", name: "fam-phone", model: "X" })
  rj = await rr.json()
  ok(
    "ب11 POST assist request → 403 (مساعدة العائلة مطوية)",
    rr.status === 403 && rj.error === "capability-disabled-by-policy" && rj.detail?.capability === "assist",
  )

  // ب12 — تعطيل sync: القناة العامة مغلقة
  r = await getJson("/api/sync/ops")
  ok(
    "ب12 GET sync/ops → 403 (القناة العامة §34 مغلقة)",
    r.status === 403 && r.j?.error === "capability-disabled-by-policy" && r.j?.detail?.capability === "sync",
  )

  // ب13 — ختم الإصدار الأدنى: إعلان صادق (الجهاز 3.0.0 تحت أرضية 3.1.0)
  r = await getJson("/api/version")
  ok(
    "ب13 GET version: minimumVersion=3.1.0 وbelowMinimum=true (إعلان لا حجب)",
    r.j.policy?.minimumVersion === "3.1.0" && r.j.policy?.belowMinimum === true,
    `current=${r.j.current}`,
  )

  // ب14 — الامتثال §38 يرى المخطط v2 كاملًا
  r = await getJson("/api/enterprise/compliance")
  ok(
    "ب14 الامتثال: managed بمخطط v2 وكل الفرض الجديد معلن",
    r.j.policyState === "managed" && r.j.policySchemaVersion === 2 &&
      JSON.stringify(r.j.enforced?.lockedSettings) === '["appLock"]' &&
      r.j.enforced?.accessCodeRotationDays === 30 &&
      Array.isArray(r.j.enforced?.disabledCapabilities) && r.j.enforced.disabledCapabilities.includes("market") &&
      r.j.enforced?.minimumVersion === "3.1.0" && typeof r.j.policyHash === "string",
  )

  // ب15/ب16 — تقرير JSON: العقد §47 بكل أذرعه
  r = await getJson("/api/enterprise/report?format=json")
  ok(
    "ب15 تقرير JSON: ok بعقد §47 ومؤسسة وبصمة سياسة",
    r.status === 200 && r.j.ok === true && r.j.contract === "§47" && r.j.organization === "E2E Live Org" &&
      r.j.policy?.hash === (await getJson("/api/enterprise/compliance")).j.policyHash,
  )
  ok(
    "ب16 تقرير JSON: الأجهزة والإصدارات والسجل متماسكة مع المصادر",
    typeof r.j.devices?.total === "number" && Array.isArray(r.j.devices?.items) &&
      r.j.versions?.belowMinimum === true && typeof r.j.audit?.count === "number" &&
      typeof r.j.audit?.valid === "boolean" && r.j.pairGate?.rotation?.days === 30 &&
      typeof r.j.metrics?.pairing === "object",
  )

  // ب17/ب18/ب19 — تقرير PDF حي + شكل غير معروف
  let rp = await get("/api/enterprise/report?format=pdf")
  const pdfLive = Buffer.from(rp.body)
  ok(
    "ب17 تقرير PDF: content-type وتنزيل مرفق",
    rp.status === 200 && rp.headers.get("content-type") === "application/pdf" &&
      (rp.headers.get("content-disposition") || "").includes("attachment"),
  )
  ok(
    "ب18 تقرير PDF حي: بايتات سليمة (ترويسة/EOF/بلا بايتات عالية)",
    pdfLive.subarray(0, 8).toString("latin1") === "%PDF-1.4" && pdfLive.subarray(-6).toString("latin1") === "%%EOF\n" &&
      [...pdfLive].every((b) => b <= 0x7e) && pdfLive.length > 1200,
    `${pdfLive.length}B`,
  )
  r = await getJson("/api/enterprise/report?format=xml")
  ok("ب19 صيغة غير معروفة → 400 unknown-format", r.status === 400 && r.j?.error === "unknown-format")

  // ب20 — تعديل حي بلا إعادة تشغيل: رفع التعطيل يعيد القناة فورًا
  writePolicy({ ...LIVE_V2, managed: { ...LIVE_V2.managed, disabledCapabilities: [] } })
  r = await getJson("/api/sync/ops")
  ok("ب20 تعديل حي: إزالة التعطيل → sync/ops يعمل 200 فورًا", r.status === 200 && typeof r.j.head === "number")

  // ب21 — فشل-آمن: ملف تالف = لا فرض (القفل يُرفع والامتثال invalid)
  writePolicy("{schemaVersion: 2, corrupted")
  r = await getJson("/api/enterprise/compliance")
  const ra = await getJson("/api/enterprise/report?format=json")
  rr = await put("/api/desktop/settings", { appLock: { enabled: false } })
  ok(
    "ب21 فشل-آمن: ملف تالف → invalid ولا قفل (PUT appLock يعمل)",
    r.j.policyState === "invalid" && ra.j.policy?.state === "invalid" && rr.status === 200,
  )

  // ب22 — سجل §39 يحمل أنواع §47 الخمسة الجديدة
  r = await getJson("/api/enterprise/audit?limit=200")
  const kinds = new Set((r.j.events ?? []).map((e) => e.k))
  ok(
    "ب22 سجل §39: الأنواع الخمسة الجديدة موثقة (قفل/تدوير/قدرات)",
    kinds.has("settings.write.denied") && kinds.has("pair.rotation.overdue") && kinds.has("capability.denied") &&
      (r.j.events ?? []).some((e) => e.k === "capability.denied" && e.d?.capability === "market") &&
      (r.j.events ?? []).some((e) => e.k === "capability.denied" && e.d?.capability === "assist") &&
      (r.j.events ?? []).some((e) => e.k === "capability.denied" && e.d?.capability === "sync"),
    `kinds=${[...kinds].filter((k) => k.includes("denied") || k.includes("rotation")).join(",")}`,
  )

  // ب23 — استعادة v2 بأرضية أخفض: الفرض يعود والأرضية تصدق
  writePolicy({ ...LIVE_V2, managed: { ...LIVE_V2.managed, disabledCapabilities: ["sync"], minimumVersion: "2.0.0" } })
  r = await getJson("/api/sync/ops")
  const rv = await getJson("/api/version")
  ok(
    "ب23 استعادة v2 (أرضية 2.0.0): sync 403 عائد وbelowMinimum=false",
    r.status === 403 && rv.j.policy?.belowMinimum === false && rv.j.policy?.minimumVersion === "2.0.0",
  )

  // ب24 — خاتمة نظيفة: حذف السياسة والرمز معًا → unmanaged (السلوك التاريخي)
  // (حذف الرمز أيضًا عزلُ بوابات: §38 اللاحقة تبدأ بلا تعارض enable 409)
  fs.rmSync(POLICY, { force: true })
  fs.rmSync(PAIR, { force: true })
  r = await getJson("/api/enterprise/compliance")
  const rg = await getJson("/api/remote-access")
  ok(
    "ب24 حذف السياسة والرمز → unmanaged فورًا (خاتمة نظيفة)",
    r.j.policyState === "unmanaged" && rg.j.enabled === false,
  )
}

console.log(`\n═══ §47 enterprise47-e2e: ${pass} ✅ / ${fail} ❌ (من ${APP ? 49 : 24}) ═══`)
process.exit(fail > 0 ? 1 : 0)
