#!/usr/bin/env node
// فاحص الأسرار — صفر اعتماد (عقد بنود الثلاثين يومًا: اليوم 1–2 — فحص أسرار تاريخ المستودع)
// =====================================================================
// الغرض: فحص الشجرة الحالية المتتبعة + كامل تاريخ Git (كل الكتل النصية
// المرّة بالتاريخ) بحثًا عن أسرار مكشوفة بفهرس أنماط مُغلق — نفس عقيدة
// «تصريحي لا تنفيذي، والغريب يرفض» في سوق التكاملات §34.ب.
//
// الضمانات:
//  · الإخراج مقنّع حصرًا: أول 6 محارف + قناع — لا يُطبع سر كامل أبدًا
//    (حتى تقرير الفحص نفسه آمن للنسخ في سجل العمل والمستندات).
//  · الملفات الثنائية تُتخطى (بايت NUL في أول 8KB) وحجم الكتلة مُسقوف.
//  · قائمة سماح موثقة لكل نمط (بقايا توثيقية وقيم شكلية) — كل استثناء مكتوب.
//
// الاستعمال:
//  node scripts/secret-scan.mjs                # شجرة + تاريخ (كامل)
//  node scripts/secret-scan.mjs --worktree-only # الشجرة الحالية حصرًا (سريع — لحرس CI)
//  node scripts/secret-scan.mjs --history-only  # التاريخ حصرًا
//  node scripts/secret-scan.mjs --json          # إخراج JSON للآلة
//
// رمز الخروج: 0 = نظيف · 1 = ملاحظات · 2 = خطأ استخدام/بيئة
// (يُستعمل حرسًا في .github/workflows/security.yml — حرس الانجراف الآلي)

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const worktreeOnly = args.includes("--worktree-only")
const historyOnly = args.includes("--history-only")
const jsonOut = args.includes("--json")

if (worktreeOnly && historyOnly) {
  console.error("خطأ: --worktree-only و --history-only يتعارضان")
  process.exit(2)
}

// ---------- الفهرس المغلق للأنماط (كليّة: المعلن يفحص والمجهول لا) ----------
const PLACEHOLDER = /(?:your[_-]?|xxx|changeme|change[_-]?me|placeholder|example|sample|dummy|lorem|ipsum|redacted|\$\{|\$\(|%s|\{\}|<[^>]{2,}>|insert[_-]?|replace[_-]?|fixme|todo|test[_-]?only|not[_-]?a[_-]?real|fake|github[_-]?token[_-]?env|token[_-]?env)/i

const PATTERNS = [
  {
    id: "github-pat-classic",
    desc: "رمز وصول شخصي GitHub كلاسيكي (ghp_/gho_/ghu_/ghs_/ghr_)",
    sev: "حرج",
    re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
    allow: () => false,
  },
  {
    id: "github-pat-fine",
    desc: "رمز GitHub دقيق الإذن (github_pat_)",
    sev: "حرج",
    re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    allow: () => false,
  },
  {
    id: "aws-access-key",
    desc: "مفتاح وصول AWS (AKIA/ASIA)",
    sev: "حرج",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    allow: () => false,
  },
  {
    id: "private-key-block",
    desc: "ترويسة مفتاح خاص (BEGIN PRIVATE KEY)",
    sev: "حرج",
    re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
    allow: () => false,
  },
  {
    id: "google-api-key",
    desc: "مفتاح Google API (AIza)",
    sev: "عالٍ",
    re: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
    allow: () => false,
  },
  {
    id: "slack-token",
    desc: "رمز Slack (xox...)",
    sev: "عالٍ",
    re: /\bxox[baprs]-[0-9A-Za-z\-_]{10,}/g,
    allow: () => false,
  },
  {
    id: "stripe-key",
    desc: "مفتاح Stripe سري (sk_live/sk_test/rk_)",
    sev: "عالٍ",
    re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{20,}\b/g,
    allow: (m) => PLACEHOLDER.test(m),
  },
  {
    id: "jwt",
    desc: "معرف JWT كامل الأجزاء الثلاثة",
    sev: "متوسط",
    re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{8,}\b/g,
    allow: (m) => PLACEHOLDER.test(m),
  },
  {
    id: "url-credentials",
    desc: "بيانات اعتماد مضمّنة في رابط (scheme://user:pass@)",
    sev: "حرج",
    re: /[a-z][a-z0-9+.\-]*:\/\/[^\s\/@:"'<>]{1,64}:[^\s@"'<>\/]{3,128}@/g,
    // استثناءات موثقة: روابط توضيحية بعناصر نائبة معلنة في الأدلة، ومتغيرات بيئة
    allow: (m, line) =>
      PLACEHOLDER.test(m) ||
      /\$\{[^}]*\}|\$[A-Z_]{2,}|\{\{[^}]*\}\}|%(?:USER|PASS)/.test(m) ||
      /(?:^|[^a-z])(?:user|username|login|pass|password|token|key|secret|apikey|api[_-]?key|access|admin|name|me|myuser|mypassword|xxxxxx|placeholder)(?:[^a-z]|$)/i.test(m.split("://")[1]?.split(":")[0] ?? "") ||
      /(?:^|[^a-z])(?:pass|password|token|key|secret|xxxxxx|placeholder|changeme)(?:[^a-z]|$)/i.test(m.split(":").slice(2).join(":")?.split("@")[0] ?? ""),
  },
  {
    id: "secret-assignment",
    desc: "إسناد قيمة سرّية شكلها حرفي (key = 'قيمة-نصية-طويلة')",
    sev: "عالٍ",
    re: /(?:\bapi[_-]?key\b|\bapikey\b|\bsecret\b|\btoken\b|\bpasswd\b|\bpassword\b|\bpwd\b)["']?\s*(?:[:=]|:=|=>)\s*["']([A-Za-z0-9+\/_.=\-]{16,})["']/gi,
    // استثناءات موثقة: مفاتيح مركبة بلا قيمة سرية (عدادات/أنواع/مسارات)، بصمات
    // وملخصات عامة، قيم شكلية، وأسماء تُجلب من البيئة لا قيم.
    allow: (m, line) =>
      PLACEHOLDER.test(m) ||
      /(?:_count|_length|_kind|_type|_name|_id|_file|_path|_prefix|_expiry|_due|_days|_hint|_label|_title|_msg|_error|Type|Kind|Prefix|Label|Title|Hint)\s*["']?\s*[:=]/i.test(m) ||
      /(?:sha256|sha1|sha512|digest|checksum|checksum|fingerprint|بصمة|hash|integrity|hmac[_-]?of|blake)/i.test(line) ||
      /^[0-9]+$/.test(m.match(/["']([A-Za-z0-9+\/_.=\-]{16,})["']/i)?.[1] ?? "") ||
      /(?:process\.env|os\.environ|getenv|System\.getenv|ENV\[|secrets\.[A-Z_]+\b|secretName|SecretsManager|keychain|Keychain)/.test(line) ||
      /^\s*(?:#|\/\/|\/\*|\*)/.test(line),
  },
]

// مسارات تُتخطى كاملة (أدلة مولّدة/مفهرسة بلا أسرار ممكنة)
const SKIP_PATH = /(?:^|\/)(?:SHA256SUMS[^\/]*|ar-en-map\.json)$/

// ---------- خط الأساس (baseline): استثناءات موثقة فوق ثوابت الاختبار ----------
// الملف سطر لكل استثناء بصيغة: <pattern>|<where>|<preview-masque>
// المعاينة مقنّعة بذاتها — الملف آمن للنشر. أي ملاحظة خارج خط الأساس = فشل.
// التحديث واعٍ دائمًا: --update-baseline يعيد التوليد فيُراجع المالك الفرق.
let BASELINE = null
let baselinePath = null
const bi = args.indexOf("--baseline")
if (bi >= 0 && args[bi + 1]) {
  baselinePath = args[bi + 1]
  try {
    BASELINE = new Set(
      fs.readFileSync(baselinePath, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    )
  } catch {
    // عند --update-baseline فالتوليد الأول مقبول بلا ملف سابق؛ غير ذلك خطأ بيئة
    if (!args.includes("--update-baseline")) {
      console.error(`خطأ: تعذّرت قراءة خط الأساس: ${baselinePath}`)
      process.exit(2)
    }
  }
}
const keyOf = (f) => `${f.pattern}|${f.where}|${f.preview}`
const updateBaseline = args.includes("--update-baseline")

// ---------- أدوات ----------
function sh(cmd, cargs, opts = {}) {
  const r = spawnSync(cmd, cargs, { encoding: "utf8", maxBuffer: 1 << 30, ...opts })
  if (r.status !== 0) {
    console.error(`خطأ بيئة: ${cmd} ${cargs.join(" ")} خرج بـ${r.status}\n${r.stderr?.slice(0, 500)}`)
    process.exit(2)
  }
  return r.stdout
}

function mask(m) {
  const keep = Math.min(6, Math.max(0, m.length - 2))
  return m.slice(0, keep) + "…" + "•".repeat(Math.min(18, Math.max(4, m.length - keep)))
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

const findings = []

function scanText(text, where, commitInfo) {
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 4096) continue
    for (const p of PATTERNS) {
      p.re.lastIndex = 0
      let m
      while ((m = p.re.exec(line)) !== null) {
        if (SKIP_PATH.test(where)) break
        if (p.allow(m[0], line)) continue
        findings.push({
          pattern: p.id,
          sev: p.sev,
          desc: p.desc,
          where,
          line: i + 1,
          commit: commitInfo ?? null,
          preview: mask(m[0]),
        })
        break // مطابقة واحدة لكل سطر/نمط تكفي للتقرير
      }
    }
  }
}

// ---------- 1) الشجرة الحالية المتتبعة (قراءة من القرص — لا من الفهرس) ----------
const files = sh("git", ["ls-files", "-z"]).split("\0").filter(Boolean)
let wtScanned = 0
for (const f of files) {
  if (SKIP_PATH.test(f)) continue
  let buf
  try { buf = fs.readFileSync(f) } catch { continue } // ملف حُذف من القرص فقط
  if (buf.length > 2 << 20) continue
  if (isBinary(buf)) continue
  wtScanned++
  scanText(buf.toString("utf8"), f, null)
}

// ---------- 2) كامل التاريخ (كل الكتل النصية) ----------
let blobsSeen = 0
if (!worktreeOnly) {
  const objs = sh("git", ["rev-list", "--all", "--objects"])
    .split("\n")
    .map((l) => l.split(" ")[0])
    .filter((s) => /^[0-9a-f]{40}$/.test(s))
  const pathsBySha = new Map()
  for (const l of sh("git", ["rev-list", "--all", "--objects"]).split("\n")) {
    const sp = l.indexOf(" ")
    if (sp > 0) {
      const sha = l.slice(0, sp), p = l.slice(sp + 1)
      if (!pathsBySha.has(sha)) pathsBySha.set(sha, p)
    }
  }
  // cat-file --batch دفعة واحدة: الترويسة تحدد النوع والحجم
  const child = spawnSync("git", ["cat-file", "--batch"], {
    input: objs.join("\n") + "\n",
    maxBuffer: 1 << 30,
  })
  if (child.status !== 0) { console.error("خطأ بيئة: git cat-file --batch فشل"); process.exit(2) }
  const out = child.stdout
  let pos = 0
  while (pos < out.length) {
    const nl = out.indexOf(0x0a, pos)
    if (nl < 0) break
    const header = out.slice(pos, nl).toString("utf8") // "<sha> blob <size>" أو "<sha> missing"
    pos = nl + 1
    const parts = header.split(" ")
    if (parts.length < 3 || parts[1] !== "blob") continue // commits/trees تُتخطى
    const size = parseInt(parts[2], 10)
    if (!Number.isFinite(size)) continue
    const body = out.slice(pos, pos + size)
    pos += size + 1 // +1 لسطر فارغ بعد الكتلة
    if (size > 2 << 20 || isBinary(body)) continue
    blobsSeen++
    const p = pathsBySha.get(parts[0]) ?? "?"
    if (SKIP_PATH.test(p)) continue
    scanText(body.toString("utf8"), p, parts[0])
  }
}

// إسناد أول التزام حيّ لكل ملاحظة تاريخية (للقليل فقط)
for (const f of findings) {
  if (f.commit && f.commit.length === 40) {
    try {
      f.commit = execFileSync("git", ["log", "--all", "--find-object=" + f.commit, "-n", "1", "--format=%h %ad %s", "--date=short"], { encoding: "utf8" }).trim() || f.commit.slice(0, 10)
    } catch { f.commit = f.commit.slice(0, 10) }
  }
}

// ---------- التقرير ----------
const fullFindingsArr = findings.slice() // قبل فلترة خط الأساس — لـ --update-baseline
const fullFindings = () => fullFindingsArr

// خط الأساس يُطبق بعد الجمع وقبل الحسم (الملاحظات المقبولة تُحصى بذاتها)
let baselineAccepted = 0
if (BASELINE) {
  const kept = []
  for (const f of findings) {
    if (BASELINE.has(keyOf(f))) baselineAccepted++
    else kept.push(f)
  }
  findings.length = 0
  findings.push(...kept)
}

// كتابة متزامنة دائمًا: process.exit قد يقطع مخارج الأنبوب غير المتزامنة
function out(s) {
  try { fs.writeSync(1, s + "\n") } catch { console.log(s) }
}
if (updateBaseline) {
  const lines = [
    "# خط أساس فاحص الأسرار — استثناءات موثقة فوق ثوابت الاختبار والأدلة",
    "# كل سطر: <النمط>|<المسار>|<معاينة مقنعة> — الملف آمن للنشر (لا يضم سرًا كاملًا أبدًا)",
    "# المنشأ: رموز اختبار مولّدة في عدادات E2E + عنصر نائب GITHUB_TOKEN_ENV + SECRET اختباري للمرحّل المحلي",
    "# أي سطر جديد فوق هذه القائمة = سر جديد يفشل الحرس فورًا — التحديث واعٍ بمراجعة المالك",
    ...fullFindings().map((f) => keyOf(f)),
  ]
  fs.writeFileSync(baselinePath ?? "scripts/secret-scan-baseline.txt", lines.join("\n") + "\n")
  out(`✍️  خط الأساس حُدّث: ${fullFindingsArr.length} استثناءً في ${baselinePath ?? "scripts/secret-scan-baseline.txt"}`)
  process.exit(0)
}
if (jsonOut) {
  out(JSON.stringify({ ok: findings.length === 0, worktreeFiles: wtScanned, historyBlobs: blobsSeen, baselineAccepted, findings }, null, 2))
} else {
  const scope = historyOnly ? `كامل التاريخ (${blobsSeen} كتلة نصية)` : worktreeOnly ? `الشجرة الحالية (${wtScanned} ملفًا متتبعًا)` : `الشجرة الحالية (${wtScanned} ملفًا) + كامل التاريخ (${blobsSeen} كتلة نصية)`
  if (findings.length === 0) {
    out(`✅ فحص الأسرار: نظيف — صفر أسرار في ${scope}`)
    if (baselineAccepted) out(`   خط الأساس: ${baselineAccepted} استثناءً موثقًا فوق ثوابت الاختبار (المسار: ${baselinePath})`)
    out("   الفهرس المغلق: 10 أنماط (GitHub PAT كلاسيكي ودقيق · AWS · مفتاح خاص · Google · Slack · Stripe · JWT · اعتماديات روابط · إسناد أسرار) — الإخراج مقنّع دائمًا")
  } else {
    out(`⚠️  فحص الأسرار: ${findings.length} ملاحظة جديدة فوق خط الأساس في ${scope} — المعاينات مقنّعة`)
    for (const f of findings.slice(0, 50)) {
      out(`  [${f.sev}] ${f.pattern} — ${f.where}:${f.line}${f.commit ? ` — التزام ${f.commit}` : ""} — ${f.preview}`)
    }
    if (findings.length > 50) out(`  … و${findings.length - 50} أخرى`)
    out("   الإجراء: إبطال السر المصاب فورًا (لا حذف التاريخ يكفي — الإبطال هو العلاج) · إن كان ثابت اختبار مشروعًا فحدّث خط الأساس بمراجعة: --update-baseline")
  }
}
process.exit(findings.length === 0 ? 0 : 1)
