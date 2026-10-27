#!/usr/bin/env node
// NexusLink — بوابة الترخيص الصادق (عقد §45) — license-e2e
// ============================================================
// 44 فحصًا × 5 أطوار تحرس «الازدواجية الصادقة»:
//   الطور 1 — بنية LICENSE وLICENSES/MIT.txt (13 فحصًا)
//   الطور 2 — تزامن تصريحات SPDX مع docs/OPEN-COMPONENTS.md (12 فحصًا)
//   الطور 3 — حرمة النواة: لا تصريح SPDX يتسلل لملف مغلق (8 فحوص)
//   الطور 4 — لا انجراف في بيان Flathub (4 فحوص)
//   الطور 5 — تزامن الوثائق: README §8 + BUILD §7 + الإحالات (7 فحوص)
// القاعدة: تشغيلان متتاليان أخضران شرط الإغلاق. خروج 0 = أخضر، 1 = أحمر.
// لا شبكة إطلاقًا — ملفات محلية حصرًا.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const ROOT = join(import.meta.dirname, "..")
let pass = 0
let fail = 0
const failures = []

/** فحص واحد — يُحصى دائمًا (نجاح أو فشل) حتى يبقى العدد التعاقدي 44 ثابتًا */
function check(name, ok, detail = "") {
  if (ok) pass++
  else {
    fail++
    failures.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

const read = (p) => {
  try { return readFileSync(join(ROOT, p), "utf8") } catch { return "" }
}
const exists = (p) => read(p).length > 0

/* ───────────── المجموعة المفتوحة التعاقدية + قائمة الإعفاء ───────────── */
const OPEN_SET = [
  "src/lib/pair-math.ts",
  "src/lib/nexus/oplog.ts",
  "sdk/index.mjs",
  "cli/nexus.mjs",
  "docs/sdk-guide.md",
  "docs/protocol-contract.md",
]
/** ملفات يُسمح لها بـ«ذكر» SPDX بلا تصريح (توثيق/حارس/أداة مالك) — عقد §45.ج */
const ALLOWED_MENTIONS = new Set([
  "LICENSE",
  "LICENSES/MIT.txt",
  "README.md",
  "BUILD.md",
  "docs/OPEN-COMPONENTS.md",
  "scripts/license-e2e.mjs",
  "scripts/repo-metadata.mjs",
])

/** مشية تكرارية تجمع مسارات الملفات تحت مجلد (تتجاهل node_modules/.next/.git) */
function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(join(ROOT, dir)) } catch { return out }
  for (const e of entries) {
    if (["node_modules", ".next", ".git", "dist", "build", ".dart_tool"].includes(e)) continue
    const rel = dir ? `${dir}/${e}` : e
    let st
    try { st = statSync(join(ROOT, rel)) } catch { continue }
    if (st.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

/* ═════════════ الطور 1 — بنية ملفي الترخيص (13 فحصًا) ═════════════ */
const lic = read("LICENSE")
const mit = read("LICENSES/MIT.txt")

check("1.1 LICENSE موجود", exists("LICENSE"))
check("1.2 النواة: جميع الحقوق محفوظة (عربي)", lic.includes("جميع الحقوق محفوظة"))
check("1.3 النواة: Copyright (c) 2026 CTO-DRS", lic.includes("Copyright (c) 2026 CTO-DRS"))
check("1.4 النواة: All rights reserved (إنجليزي)", lic.includes("All rights reserved"))
check("1.5 النواة: معرِّف LicenseRef-proprietary", lic.includes("LicenseRef-proprietary"))
check("1.6 المجموعة المفتوحة مسماة في LICENSE", lic.includes("المجموعة المفتوحة") && lic.includes("Open Set"))
check("1.7 LICENSE يحيل إلى LICENSES/MIT.txt", lic.includes("LICENSES/MIT.txt"))
check("1.8 LICENSE يحيل إلى docs/OPEN-COMPONENTS.md", lic.includes("docs/OPEN-COMPONENTS.md"))
check("1.9 LICENSE يوثق نمط الازدواج (Obsidian)", lic.includes("Obsidian"))
check("1.10 LICENSE يوثق توافق Flathub", lic.includes("Flathub") && lic.includes("project_license"))
check("1.11 LICENSE يوثق الحارس المضاد للانجراف", lic.includes("license-e2e"))
check("1.12 MIT: النص القياسي (Permission is hereby granted)", mit.includes("Permission is hereby granted, free of charge"))
check("1.13 MIT: حقوق 2026 CTO-DRS + شرط الترويسة + حصر النطاق",
  mit.includes("Copyright (c) 2026 CTO-DRS") && mit.includes("The above copyright notice") && mit.includes("NexusLink Open Set"))

/* ═════════ الطور 2 — تصريحات SPDX × تزامن OPEN-COMPONENTS (12 فحصًا) ═════════ */
for (let i = 0; i < OPEN_SET.length; i++) {
  const f = OPEN_SET[i]
  const head = read(f).slice(0, 600) // الترويسة حصرًا — التصريح في أول الملف
  check(`2.${i + 1} تصريح MIT في ترويسة ${f}`, head.includes("SPDX-License-Identifier: MIT"))
}
const oc = read("docs/OPEN-COMPONENTS.md")
const ocListed = ["src/lib/pair-math.ts", "src/lib/nexus/oplog.ts", "sdk/index.mjs", "cli/nexus.mjs", "docs/sdk-guide.md", "docs/protocol-contract.md"]
  .filter((p) => oc.includes(`\`${p}\``)).length
check("2.7 OPEN-COMPONENTS يسرد المكونات الست كاملة", ocListed === 6, `المسرود ${ocListed}/6`)
check("2.8 OPEN-COMPONENTS يصرّح MIT صراحة", oc.includes("ترخيص MIT") && oc.includes("**MIT**"))
check("2.9 OPEN-COMPONENTS يوثق نظام SPDX منذ §45", oc.includes("SPDX-License-Identifier: MIT") && oc.includes("§45"))
check("2.10 OPEN-COMPONENTS يحيل إلى LICENSE", oc.includes("`LICENSE`"))
check("2.11 OPEN-COMPONENTS يحيل إلى LICENSES/MIT.txt", oc.includes("LICENSES/MIT.txt"))
check("2.12 OPEN-COMPONENTS يحيل إلى الحارس", oc.includes("license-e2e"))

/* ═════════════ الطور 3 — حرمة النواة (8 فحوص) ═════════════ */
// تصنيف موضعي سطر-بسطر (درس §45.ج): «التصريح» سطر يبدأ بـ SPDX-License-Identifier
// بعد نزع بادئة التعليق — وكل ما عدا ذلك «ذكر» (اقتباس داخل نص/كود).
//  · تصريح مسموح حصرًا في: أعضاء المجموعة المفتوحة (ويجب أن يكون MIT) + ملف LICENSE
//    نفسه (المستند الجذري — يعلن LicenseRef-proprietary ويعرض سطر MIT توثيقًا)
//    + ملفات الطرف الثالث المورَّدة (ترويساتها من المصدر الأعلى لا منّا).
//  · ذكر مسموح حصرًا في قائمة ALLOWED_MENTIONS (توثيق/حارس/أداة مالك).
const COMMENT_PREFIX = /^(?:\/\/|#|\*|\/\*+|<!--)\s*/
function classifySpx(txt) {
  const decls = []
  let mentions = 0
  for (const raw of txt.split("\n")) {
    if (!raw.includes("SPDX-License-Identifier")) continue
    const stripped = raw.replace(COMMENT_PREFIX, "").replace(/-->\s*$/, "").trim()
    if (stripped.startsWith("SPDX-License-Identifier:")) decls.push(stripped)
    else mentions++
  }
  return { decls, mentions }
}
/** ملفات طرف ثالث مورَّدة ترويسة SPDX فيها من المصدر الأعلى — لا تُمس ولا تُعدّ تصريحًا منّا */
const VENDORED = [
  "scripts/deps-verify/fwr/android/src/main/java/com/cloudwebrtc/webrtc/record/VideoFileRenderer.java",
]
const scanned = [...walk("src"), ...walk("apps"), ...walk("nexuslink_mobile"), ...walk("sdk"),
  ...walk("cli"), ...walk("scripts"), ...walk("docs"), ...walk("packaging"),
  "LICENSE", "README.md", "BUILD.md"].filter((p, i, a) => a.indexOf(p) === i)
const strays = []
for (const f of scanned) {
  const txt = read(f)
  if (!txt.includes("SPDX-License-Identifier")) continue
  const { decls, mentions } = classifySpx(txt)
  for (const d of decls) {
    if (OPEN_SET.includes(f)) { if (d !== "SPDX-License-Identifier: MIT") strays.push(`${f} (تصريح غير MIT)`) }
    else if (f === "LICENSE" || VENDORED.includes(f)) continue // المستند الجذري / مورَّد من الأعلى
    else strays.push(`${f} (تصريح في ملف مغلق)`)
  }
  if (mentions > 0 && !ALLOWED_MENTIONS.has(f) && !VENDORED.includes(f)) strays.push(`${f} (ذكر بلا إعفاء)`)
}
check("3.1 صفر تصريح شارد في src/**", !strays.some((f) => f.startsWith("src/") && !OPEN_SET.includes(f)),
  strays.filter((f) => f.startsWith("src/") && !OPEN_SET.includes(f)).join(", "))
check("3.2 صفر تصريح شارد في apps/** (سطح المكتب)", !strays.some((f) => f.startsWith("apps/")))
check("3.3 صفر تصريح شارد في nexuslink_mobile/** (وكيل Flutter)", !strays.some((f) => f.startsWith("nexuslink_mobile/")))
check("3.4 صفر تصريح شارد في sdk/** و cli/** خارج العضوين", !strays.some((f) => (f.startsWith("sdk/") || f.startsWith("cli/")) && !OPEN_SET.includes(f)))
check("3.5 صفر تصريح شارد في scripts/** خارج المعفيين", !strays.some((f) => f.startsWith("scripts/") && !ALLOWED_MENTIONS.has(f)))
check("3.6 صفر تصريح شارد في docs/** خارج أعضاء المجموعة", !strays.some((f) => f.startsWith("docs/") && !OPEN_SET.includes(f)))
check("3.7 صفر تصريح شارد في packaging/**", !strays.some((f) => f.startsWith("packaging/")))
check("3.8 الجرد الكلي = أعضاء (6) + معفيون بلا شارد",
  strays.length === 0 && scanned.filter((f) => OPEN_SET.includes(f)).length === 6,
  strays.join(", "))

/* ═════════════ الطور 4 — لا انجراف في بيان Flathub (4 فحوص) ═════════════ */
const meta = read("packaging/flathub/sa.drs.nexuslink.metainfo.xml")
const yml = read("packaging/flathub/sa.drs.nexuslink.yml")
check("4.1 metainfo: metadata_license = CC0-1.0 (الميتاداتا وحدها)", meta.includes("<metadata_license>CC0-1.0</metadata_license>"))
check("4.2 metainfo: project_license = LicenseRef-proprietary (متسق مع LICENSE)", meta.includes("<project_license>LicenseRef-proprietary</project_license>"))
check("4.3 metainfo لا يدّعي MIT على التطبيق الكلي", !/project_license>[^<]*MIT/.test(meta))
check("4.4 وصفة Flathub بلا حقل ترخيص مغاير", exists("packaging/flathub/sa.drs.nexuslink.yml") && !/license\s*:/i.test(yml))

/* ═════════════ الطور 5 — تزامن الوثائق (7 فحوص) ═════════════ */
const readme = read("README.md")
const build = read("BUILD.md")
check("5.1 README يحمل قسم الترخيص (§8)", readme.includes("## 8) الترخيص"))
check("5.2 README §8 يوثق النواة المغلقة والمجموعة المفتوحة",
  /## 8\)[\s\S]*النواة المغلقة[\s\S]*المجموعة المفتوحة/.test(readme))
check("5.3 README §8 يحيل إلى LICENSE وLICENSES/MIT.txt",
  /## 8\)[\s\S]*`LICENSE`[\s\S]*`LICENSES\/MIT\.txt`/.test(readme))
check("5.4 BUILD يحمل قسم الترخيص (§7)", build.includes("## 7) الترخيص"))
check("5.5 BUILD §7 يشرح نظام SPDX", /## 7\)[\s\S]*SPDX/.test(build))
check("5.6 LICENSE يذكر إجمالي الفحص التعاقدي (44)", lic.includes("44"))
check("5.7 قائمة الإعفاء موثقة في الحارس نفسه (§45.ج)", read("scripts/license-e2e.mjs").includes("ALLOWED_MENTIONS"))

/* ───────────────────────── التقرير ───────────────────────── */
const total = pass + fail
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
console.log(`license-e2e — بوابة الازدواجية الصادقة (عقد §45)`)
console.log(`النتيجة: ${pass}/${total} فحصًا أخضر — ${fail === 0 ? "✅ أخضر" : "❌ أحمر"}`)
if (fail) {
  console.log("الإخفاقات:")
  for (const f of failures) console.log(f)
  process.exit(1)
}
console.log("الأطوار: بنية 13 · تصريحات 12 · حرمة النواة 8 · Flathub 4 · وثائق 7")
process.exit(0)
