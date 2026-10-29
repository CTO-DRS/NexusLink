#!/usr/bin/env node
// NexusLink — أداة مالك وصف المستودع (عقد §45) — repo-metadata
// ============================================================
// تحديث وصف GitHub ثنائي اللغة + الـtopics عبر API الرسمي — حصرًا بيد المالك.
// قواعد الرمز الصارمة (غير قابلة للتفاوض):
//   · الرمز من متغير البيئة GITHUB_TOKEN حصرًا — لا بارامتر ولا ملف ولا سؤال تفاعلي.
//   · غياب الرمز = فشل مغلق (exit 2) مع دليل الإصدار الصحيح.
//   · --dry-run: صفر شبكة — يعرض الحمولة وينتهي.
//   · الرمز لا يُطبع أبدًا: لا في السجل ولا في رسائل الخطأ (تعتيم إجباري).
//   · بعد الدفع: قراءة مرتدة حية وتحقق صدى قبل إعلان النجاح.
// الاستعمال:
//   GITHUB_TOKEN=ghp_xxx node scripts/repo-metadata.mjs --dry-run   (بلا شبكة)
//   GITHUB_TOKEN=ghp_xxx node scripts/repo-metadata.mjs             (دفع فعلي)

const OWNER = "CTO-DRS"
const REPO = "NexusLink"
const API = `https://api.github.com/repos/${OWNER}/${REPO}`

/** الوصف التعاقدي ثنائي اللغة (يظهر في البحث والمشاركة — حد GitHub 350 حرفًا) */
const DESCRIPTION =
  "One local hub for your devices: screen mirroring & control, clipboard, " +
  "file transfer, media streaming and routines — fully on your Wi-Fi, " +
  "end-to-end encrypted, no cloud, no accounts. " +
  "| ربط كل أجهزتك على شبكتك: مرآة الشاشة، نقل ملفات، مزامنة حافظة، تحكم عن بعد — بلا سحابة ولا حسابات."

/** 20 topic تعاقدية (حرف صغير، شرطات، بلا نقاط — قواعد GitHub) */
const TOPICS = [
  "device-management", "local-first", "e2ee", "lan", "file-transfer",
  "screen-mirroring", "remote-control", "clipboard-sync", "webrtc", "mdns",
  "tauri", "flutter", "react", "typescript", "kotlin",
  "cross-platform", "android", "windows", "linux", "privacy-tools",
]

const payload = {
  description: DESCRIPTION,
  homepage: "https://cto-drs.github.io/NexusLink/",
  topics: TOPICS,
  has_discussions: false,
  has_wiki: false,
}

function redact(msg) {
  const t = process.env.GITHUB_TOKEN
  return t ? String(msg).split(t).join("***") : String(msg)
}

const dryRun = process.argv.includes("--dry-run")

// dry-run أولًا: صفر شبكة وصفر رمز — المعاينة متاحة لمن لا يملك رمزًا أصلًا
if (dryRun) {
  console.log("── dry-run — صفر شبكة ─────────────────────────────")
  console.log(`PATCH ${API}`)
  console.log(JSON.stringify(payload, null, 2))
  console.log(`\nالوصف: ${DESCRIPTION.length} حرفًا · الـtopics: ${TOPICS.length}`)
  console.log("لا دفع جرى — شغّل بلا --dry-run للدفع الفعلي بعد المراجعة.")
  process.exit(0)
}

if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_TOKEN.trim()) {
  console.error("✗ فشل مغلق: GITHUB_TOKEN غير موجود في البيئة (عقد §45.د — الرمز من البيئة حصرًا).")
  console.error("  الاستعمال الصحيح:  GITHUB_TOKEN=<رمز قصير العمر بصلاحية public_repo> node scripts/repo-metadata.mjs")
  console.error("  معاينة بلا رمز:    node scripts/repo-metadata.mjs --dry-run")
  process.exit(2)
}

const headers = {
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "nexuslink-repo-metadata/1.0",
}

try {
  // 1) الدفع — PATCH الوصف والصفحة الرئيسية
  const patchRes = await fetch(API, { method: "PATCH", headers, body: JSON.stringify({
    description: payload.description, homepage: payload.homepage,
    has_discussions: payload.has_discussions, has_wiki: payload.has_wiki,
  }) })
  if (!patchRes.ok) throw new Error(`PATCH فشل: ${patchRes.status} ${redact(await patchRes.text())}`)

  // 2) دفع الـtopics — مساره المستقل في GitHub API
  const topicsRes = await fetch(`${API}/topics`, { method: "PUT", headers, body: JSON.stringify({ names: TOPICS }) })
  if (!topicsRes.ok) throw new Error(`topics فشل: ${topicsRes.status} ${redact(await topicsRes.text())}`)

  // 3) قراءة مرتدة حية — تحقق صدى قبل إعلان النجاح
  const back = await fetch(API, { headers: { ...headers, Authorization: headers.Authorization } })
  if (!back.ok) throw new Error(`القراءة المرتدة فشلت: ${back.status}`)
  const repo = await back.json()
  const descOk = repo.description === DESCRIPTION
  const topicsBack = repo.topics ?? []
  const topicsOk = TOPICS.every((t) => topicsBack.includes(t))

  console.log(`الوصف: ${descOk ? "✅ صدى مطابق" : "❌ اختلاف في الصدى"} — ${repo.description?.length} حرفًا`)
  console.log(`الـtopics: ${topicsOk ? "✅ كل العشرين صدت" : "❌ ناقصة"} (${topicsBack.length})`)
  if (!descOk || !topicsOk) { console.error("✗ فشل تحقق الصدى — أعد التشغيل أو راجع الاستجابة."); process.exit(1) }
  console.log("✅ ميتاداتا المستودع محدثة ومتحقق منها حيًا.")
} catch (e) {
  console.error(`✗ فشل: ${redact(e.message)}`)
  process.exit(1)
}
