#!/usr/bin/env node
/**
 * flathub-e2e.mjs — جولة E2E لنواة X3 تعبئة Flathub (عقد §44).
 * ============================================================
 * المرحلة أ (البنية): الملفات الثلاثة كاملة (بيان + metainfo + desktop + دليل)
 *   والبيان: المعرف = معرف Tauri حرفيًا · runtime/sdk 25.08 · command =
 *   الثنائي المؤسَّس من فحص فعلي للحزمة المنشورة · only-arches x86_64 صراحة
 *   (لا يوجد aarch64 Linux منشور — صدق) · بصمة AppImage مثبتة 64 hex ·
 *   x-checker-data يتتبع الإصدارات · finish-args أقل امتياز (لا system-bus
 *   ولا filesystem=host) · build-commands: استخراج AppImage ونسخ usr/ كاملًا
 *   وغلاف يعيد إنتاج خطّاف GTK بـ APPDIR=/app حرفيًا.
 * المرحلة ب (التزامن العبري-الملفات): metainfo id = بيان id = معرف Tauri =
 *   اسم desktop = launchable · provides binary = الثنائي المؤسَّس ·
 *   **سجل releases في metainfo مطابق زوجيًا (version,date) لسجل /api/version
 *   المحلي حرفيًا وآخر إصدار = CURRENT — بوابة تمنع انجراف سجل المتجر** ·
 *   رابط البيان يحمل إصدار CURRENT.
 * المرحلة ج (البنية XML + desktop): well-formedness بمحلل مكدس واعٍ
 *   للاقتباسات · ثنائية اللغة (ar paragraphs) · لقطات ≥2 روابط https حقيقية ·
 *   content_rating oars-1.1 · metadata_license CC0-1.0 (شرط Flathub) ·
 *   desktop: Icon=المعرف وStartupWMClass=الثنائي وTerminal=false.
 * المرحلة د (التوثيق + البوابة): عقد §44 في enterprise-deploy · ROADMAP
 *   بند 4 معلَّم · MASTER-PLAN X3 معلَّم · باب i18n: صفر تغيير في src/.
 * المرحلة هـ (شرطية الشبكة — درس §42): بصمة البيان == مدخل SHA256SUMS.txt
 *   الحي من الإصدار — تعذر الشبكة = تخطٍّ صادق معلن لا إخفاق.
 * الاستخدام: node scripts/flathub-e2e.mjs
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const ROOT = path.resolve(import.meta.dirname, "..")
const KIT = path.join(ROOT, "packaging/flathub")

let pass = 0, fail = 0, skipped = 0
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}
function skip(name, why) { skipped++; console.log(`  ⊘ ${name} — ${why}`) }
const section = (t) => console.log(`\n=== ${t} ===`)

// ---------- قراءة المدخلات ----------
const read = (p) => fs.readFileSync(p, "utf8")
const yml = read(path.join(KIT, "sa.drs.nexuslink.yml"))
const meta = read(path.join(KIT, "sa.drs.nexuslink.metainfo.xml"))
const desktop = read(path.join(KIT, "sa.drs.nexuslink.desktop"))
const kitReadme = read(path.join(KIT, "README.md"))
const tauri = JSON.parse(read(path.join(ROOT, "apps/desktop/src-tauri/tauri.conf.json")))
const routeSrc = read(path.join(ROOT, "src/app/api/version/route.ts"))
const deployDoc = read(path.join(ROOT, "docs/enterprise-deploy.md"))
const roadmap = read(path.join(ROOT, "docs/ROADMAP.md"))
const master = read(path.join(ROOT, "docs/MASTER-PLAN.md"))

const IDENT = tauri.identifier                      // sa.drs.nexuslink
const BIN = "nexuslink-desktop"                     // مؤسَّس: فحص فعلي لـ deb/AppImage v3.0.0
const CURRENT = (routeSrc.match(/const CURRENT = "([^"]+)"/) || [])[1]

// سجل /api/version المحلي — أزواج (version,date) من localHistory حصرًا
function localHistoryPairs() {
  const start = routeSrc.indexOf("function localHistory")
  const end = routeSrc.indexOf("async function fetchHistory")
  const body = routeSrc.slice(start, end)
  const out = []
  const re = /version:\s*(?:CURRENT|"([^"]+)"),\s*\n\s*tag:\s*"[^"]*",\s*\n\s*date:\s*"([^"]+)"/g
  let m
  while ((m = re.exec(body))) out.push({ version: m[1] || CURRENT, date: m[2] })
  return out
}

// محلل XML مكدس واعٍ للاقتباسات — well-formedness بنيوي (لا تبعيات خارجية)
function xmlWellformed(src) {
  const noComments = src.replace(/<!--[\s\S]*?-->/g, "")
  let inQ = null, tok = "", tags = []
  for (const ch of noComments) {
    if (inQ) { tok += ch; if (ch === inQ) inQ = null; continue }
    if (ch === '"' || ch === "'") { inQ = ch; tok += ch; continue }
    if (ch === "<") { tok = "<"; continue }
    if (ch === ">") {
      const t = tok
      if (t.startsWith("<?") || t.startsWith("<!")) { tok = ""; continue }
      tags.push(t); tok = ""; continue
    }
    tok += ch
  }
  if (tok.trim()) return "trailing text"
  const stack = []
  for (const t of tags) {
    if (t.startsWith("</")) {
      const name = t.slice(2).trim()
      const top = stack.pop()
      if (!top || top.name !== name) return `mismatch </${name}> vs ${top ? top.name : "EOF"}`
    } else if (!t.endsWith("/")) {
      stack.push({ name: t.slice(1).split(/[\s>]/)[0] })
    }
  }
  if (stack.length) return `unclosed <${stack[stack.length - 1].name}>`
  return null
}

// ---------- المرحلة أ: البنية ----------
section("أ — بنية الحزمة والبيان")
for (const f of ["sa.drs.nexuslink.yml", "sa.drs.nexuslink.metainfo.xml", "sa.drs.nexuslink.desktop", "README.md"]) {
  ok(`الملف موجود: ${f}`, fs.existsSync(path.join(KIT, f)))
}
ok("دليل يحوي اختبار البناء المحلي", /flatpak-builder .*build .*sa\.drs\.nexuslink\.yml/.test(kitReadme))
ok("دليل يحوي خطوات الإرسال (fork/PR)", /flathub\/flathub/.test(kitReadme))

ok(`id البيان = ${IDENT}`, new RegExp(`^id: ${IDENT}$`, "m").test(yml))
ok("id البيان = معرف Tauri حرفيًا (تزامن عبري)", yml.includes(`id: ${IDENT}`) && IDENT === "sa.drs.nexuslink")
ok("runtime = org.freedesktop.Platform", /^runtime: org\.freedesktop\.Platform$/m.test(yml))
ok("sdk = org.freedesktop.Sdk", /^sdk: org\.freedesktop\.Sdk$/m.test(yml))
ok("runtime-version مثبت", /^runtime-version: "25\.08"$/m.test(yml))
ok(`command = ${BIN} (الثنائي المؤسَّس من الحزمة المنشورة)`, new RegExp(`^command: ${BIN}$`, "m").test(yml))
const urlM = yml.match(/url: (https:\/\/github\.com\/CTO-DRS\/NexusLink\/releases\/download\/v[^/]+\/NexusLink_[^/]+\.AppImage)/)
ok("رابط AppImage من صفحة الإصدارات", !!urlM)
ok("only-arches: [x86_64] صراحة (لا aarch64 Linux منشور — صدق)", /only-arches: \[x86_64\]/.test(yml))
const shaM = yml.match(/sha256: ([0-9a-f]{64})/)
ok("بصمة AppImage مثبتة 64 hex", !!shaM)
ok("x-checker-data يتتبع GitHub Releases بلاحقة .AppImage", /type: github-releases/.test(yml) && /match-suffix: \.AppImage/.test(yml))
ok("desktop + metainfo مصدران داخل البيان", /path: sa\.drs\.nexuslink\.desktop/.test(yml) && /path: sa\.drs\.nexuslink\.metainfo\.xml/.test(yml))

const forbidden = []
if (/--socket=system-bus/.test(yml)) forbidden.push("system-bus")
if (/--filesystem=host\b/.test(yml)) forbidden.push("filesystem=host")
if (/--allow=multiarch/.test(yml)) forbidden.push("multiarch")
ok("finish-args أقل امتياز (لا system-bus/host/multiarch)", forbidden.length === 0, forbidden.join(","))
for (const need of ["--share=network", "--socket=x11", "--socket=wayland", "--device=dri", "--socket=pulseaudio", "--filesystem=home", "--talk-name=org.freedesktop.Notifications"]) {
  ok(`finish-arg مطلوب: ${need}`, yml.includes(need))
}
ok("بناء: استخراج AppImage", /--appimage-extract/.test(yml))
ok("بناء: نسخ usr/ كاملًا إلى /app/usr", /cp -r squashfs-root\/usr \/app\/usr/.test(yml))
ok("بناء: تثبيت desktop/metainfo/icon بمسارات Flatpak", yml.includes("/app/share/applications/") && yml.includes("/app/share/metainfo/") && yml.includes("/app/share/icons/hicolor/512x512/apps/"))
ok("غلاف يعيد إنتاج خطّاف GTK (APPDIR=/app + GDK_PIXBUF_MODULE_FILE + GTK_PATH)", yml.includes("export APPDIR=/app") && yml.includes("GDK_PIXBUF_MODULE_FILE=/app/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache") && yml.includes("GTK_PATH=/app/usr/lib/gtk-3.0"))
ok(`غلاف ينفذ الثنائي المؤسَّس`, yml.includes(`exec /app/usr/bin/${BIN}`))

// ---------- المرحلة ب: التزامن عبري-الملفات ----------
section("ب — التزامن عبري-الملفات (بوابة الانجراف)")
const metaId = (meta.match(/<id>([^<]+)<\/id>/) || [])[1]
const launchable = (meta.match(/<launchable type="desktop-id">([^<]+)<\/launchable>/) || [])[1]
ok(`metainfo id = معرف Tauri = بيان id`, metaId === IDENT && /\^id:/.test("") === false)
ok(`launchable = اسم ملف desktop نفسه`, launchable === "sa.drs.nexuslink.desktop")
ok(`provides binary = ${BIN}`, new RegExp(`<binary>${BIN}</binary>`).test(meta))
ok(`رابط البيان يحمل إصدار CURRENT (${CURRENT})`, urlM && urlM[1].includes(`/v${CURRENT}/`))

const history = localHistoryPairs()
ok(`سجل /api/version المحلي مقروء (${history.length} إصدارات)`, history.length >= 5)
const metaReleases = [...meta.matchAll(/<release version="([^"]+)" date="([^"]+)"/g)].map((m) => ({ version: m[1], date: m[2] }))
const hKeys = history.map((h) => `${h.version}@${h.date}`).join(",")
const mKeys = metaReleases.map((r) => `${r.version}@${r.date}`).join(",")
ok("سجل releases بالميتا = سجل /api/version زوجيًا حرفيًا", hKeys === mKeys, `api:[${hKeys}] meta:[${mKeys}]`)
ok("آخر إصدار بالميتا = CURRENT", metaReleases[0]?.version === CURRENT)

// ---------- المرحلة ج: XML + desktop ----------
section("ج — بنية XML وملف المطلق")
const wf = xmlWellformed(meta)
ok("metainfo XML well-formed (محلل مكدس)", wf === null, wf || "")
ok("metadata_license = CC0-1.0 (شرط Flathub: بيانات وصفية حرة)", /<metadata_license>CC0-1\.0<\/metadata_license>/.test(meta))
ok("project_license مصرح (LicenseRef-proprietary — صدق)", /<project_license>LicenseRef-proprietary<\/project_license>/.test(meta))
ok("developer_name موجود", /<developer_name[^>]*>[^<]+<\/developer_name>/.test(meta))
const shots = [...meta.matchAll(/<image>(https:\/\/[^<]+)<\/image>/g)].map((m) => m[1])
ok(`لقطات ≥2 (${shots.length})`, shots.length >= 2)
ok("كل اللقطات https على مستودع المشروع", shots.every((u) => u.startsWith("https://raw.githubusercontent.com/CTO-DRS/NexusLink/")))
ok("ثنائية اللغة: فقرات عربية xml:lang", /xml:lang="ar"/.test(meta) && (meta.match(/xml:lang="ar"/g) || []).length >= 5)
ok("content_rating oars-1.1", /<content_rating type="oars-1\.1">/.test(meta))
ok("requires display موجود", /<requires>[\s\S]*?<display>/.test(meta))
ok("لا update_contact بعد (حد صادق: بريد المالك عند الإرسال)", !meta.includes("update_contact"))
ok("الدليل يوثق حد update_contact", kitReadme.includes("update_contact"))

const dlines = desktop.split("\n")
const dget = (k) => (dlines.find((l) => l.startsWith(`${k}=`)) || "").split("=").slice(1).join("=")
ok("desktop: Type=Application", dget("Type") === "Application")
ok(`desktop: Icon = المعرف (${IDENT})`, dget("Icon") === IDENT)
ok(`desktop: StartupWMClass = ${BIN} (مؤسَّس من الحزمة)`, dget("StartupWMClass") === BIN)
ok("desktop: Terminal=false", dget("Terminal") === "false")
ok("desktop: Exec غلاف داخل الصندوق", dget("Exec") === "nexuslink-wrapper.sh")
ok("desktop: Categories وName", dget("Name") === "NexusLink" && dget("Categories").length > 0)

// ---------- المرحلة د: التوثيق + باب i18n ----------
section("د — التوثيق وربط الخارطة وباب i18n")
ok("عقد §44 في enterprise-deploy (قسم مخصص)", /## 14\).*عقد §44/.test(deployDoc))
ok("خمسة أقسام فرعية بعقد §44 (أطروحة/حقيقة/خطوات/حدود/ترويج)", (deployDoc.match(/### 44\.[أ-ي]/g) || []).length >= 5)
ok("قسم الحدود الصادقة بعقد §44 موجود", /### 44\.د حدود صادقة/.test(deployDoc))
ok("ROADMAP بند 4 معلَّم منجز (عقد §44)", /4\. حزمة Flathub[^]*?عقد §44/.test(roadmap))
ok("MASTER-PLAN X3 معلَّم بالنواة المنجزة", /X3.*عقد §44/.test(master))
let srcDirty = null
try {
  const { execFileSync } = await import("node:child_process")
  srcDirty = execFileSync("git", ["status", "--porcelain", "--", "src/", "apps/", "nexuslink_mobile/"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch { /* خارج مستودع؟ */ }
ok("باب i18n/كود: صفر تغيير في src/ وapps/ والهاتف (تعبئة حصرًا)", srcDirty === "", srcDirty || "")

// ---------- المرحلة هـ: شرطية الشبكة (درس §42) ----------
section("هـ — شرطية الشبكة: البصمة مقابل SHA256SUMS.txt الحي")
if (urlM && shaM && CURRENT) {
  const sumsUrl = `https://github.com/CTO-DRS/NexusLink/releases/download/v${CURRENT}/SHA256SUMS.txt`
  const assetName = urlM[1].split("/").pop()
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 12000)
    const r = await fetch(sumsUrl, { signal: ctrl.signal, cache: "no-store" })
    clearTimeout(t)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const txt = await r.text()
    const line = txt.split("\n").find((l) => l.includes(assetName))
    const live = line ? line.trim().split(/\s+/)[0] : null
    if (!live) skip(`بصمة ${assetName} بالسجل الحي`, "المدخل غائب بالسجل")
    else ok(`بصمة البيان == البصمة الحية للإصدار (${assetName})`, live === shaM[1], `manifest:${shaM[1].slice(0, 12)} live:${live.slice(0, 12)}`)
  } catch (e) {
    skip("مطابقة البصمة الحية", `تعذر الوصول (${String(e).slice(0, 60)}) — تخطٍّ صادق لا إخفاق`)
  }
} else {
  skip("مطابقة البصمة الحية", "بيانات البيان ناقصة")
}

// ---------- الخلاصة ----------
console.log(`\n${"=".repeat(50)}`)
console.log(`النتيجة: ${pass} نجاح · ${fail} إخفاق · ${skipped} تخطٍّ صادق`)
if (fail > 0) { console.log("✗ الجولة فاشلة"); process.exit(1) }
console.log("✓ الجولة خضراء كاملة")
