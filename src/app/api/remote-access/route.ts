import { NextResponse } from "next/server"
import fs from "node:fs"
import { readEnterprisePolicy, oemPrivacyActive, resolveEffectivePosture, rotationDue, type PostureSource } from "@/lib/enterprise-policy"
import { appendAudit, observePolicy } from "@/lib/enterprise-audit"
import { guardPcOnly } from "@/lib/nexus/http-guard"
import { PAIR_FILE, readPairFile, writePairFile, newPairToken as newToken, pairDisabled, setPairDisabled } from "@/lib/nexus/pair-token"

export const dynamic = "force-dynamic"

// API عام 2.0 — الوصول البعيد برمز اقتران (عقد §37 — إغلاق حد §36.هـ.1)
// ============================================================
// GET  → حالة فقط: { enabled, fingerprint, createdAt } — الرمز الخام لا يعود
//        أبدًا في GET (يُعرض مرة واحدة عند التمكين/التدوير حصرًا).
// POST { action: "enable" | "rotate" | "disable" } — إدارة الاقتران.
//        حرس loopback للإدارة (FA-23 — الحرس المنظومي guardPcOnly، نمط §37):
//        واصل عبر البوابة من خارج الجهاز (ترويسة x-gw-client-ip التي تستبدلها
//        البوابة دائمًا) لا يُدير الاقتران ولو حمل رمزًا صحيحًا — الإدارة بيد
//        الجهاز حصرًا (الجهاز هي الحدود).
// صفر تغيير مخطط وصفر db: مصدر الحقيقة الواحد ملف JSON خارج المخطط
// (.zstate/pair-token.json أو NEXUSLINK_PAIR_FILE) تقرؤه البوابة بمتغير
// تعديل-الوقت — G1: غياب الملف = الخارج مغلق (فشل-مغلق)، لا مفتوح.

// G1 — مصدر الحقيقة المشترك مع QR الاقتران والبوابة (src/lib/nexus/pair-token.ts):
// الرمز إلزامي افتراضيًا ويُولَّد عند أول تشغيل؛ «disable» يغلق الخارج كليًا.

// §47 — رصد انتقال التقادم (نمط observePolicy §39): «استحق التدوير» يُوثق مرة
// عند الانتقال لا عند كل قراءة (لا إغراق السجل) — إعادة تشغيل الخادم قد
// تعيد التسجيل مرة (مقبول وموثق: الدليل فوق الضجيج).
let lastOverdueFp: string | null = null
function rotationInfoOf(
  p: { fingerprint: string; createdAt: string } | null,
  rotationDays: number | null,
): { days: number | null; ageDays: number | null; due: boolean } {
  if (!p || !rotationDays) return { days: rotationDays, ageDays: null, due: false }
  const t = Date.parse(p.createdAt)
  const ageDays = Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null
  const due = rotationDue(p.createdAt, rotationDays)
  if (due && lastOverdueFp !== p.fingerprint) {
    lastOverdueFp = p.fingerprint
    void appendAudit("pair.rotation.overdue", false, "local", {
      fp: p.fingerprint,
      days: rotationDays,
      ageDays: ageDays ?? null,
    })
  } else if (!due) {
    lastOverdueFp = null
  }
  return { days: rotationDays, ageDays, due }
}

export async function GET() {
  const p = readPairFile()
  // §38 — تلميح الإدارة للبطاقة: ما تفرضه السياسة المؤسسية (بلا حساسيات —
  // اسم المؤسسة ووضع الفرض فقط، وبصمة السياسة في /api/enterprise/compliance).
  const pol = readEnterprisePolicy()
  // §39 — رصد انتقالات السياسة عند القراءات الإدارية (رصد لا فرض)
  await observePolicy(pol)
  // §40 — وضع OEM «خصوصية افتراضية» للبطاقة: العلم الفعّال ومصدر الفرض الفعلي
  // (بلا حساسيات — توصيفي حصرًا، وسياسة المؤسسة هي من يحسم عند وجودها)
  const posture = resolveEffectivePosture(pol)
  const oemPrivacy = { active: oemPrivacyActive(), source: posture.source as PostureSource }
  const policy = { remoteAccess: pol.remoteAccess, organization: pol.organization }
  // §47 — إجبار تدوير رمز الوصول: عمر الرمز مقابل أجلة السياسة (توصيفي —
  // إعلان صاخب لا قطع ذاتي: الحد 47.و.2 — الاستمرارية فوق الصرامة الصامتة)
  const rotation = rotationInfoOf(p, pol.state === "managed" ? pol.accessCodeRotationDays : null)
  // G1 — الرمز إلزامي دائمًا لغير loopback؛ disabled = الخارج مغلق كليًا (علامة صريحة)
  const required = true
  if (!p) return NextResponse.json({ ok: true, enabled: false, required, disabled: pairDisabled(), policy, oemPrivacy, rotation })
  return NextResponse.json({
    ok: true,
    enabled: true,
    required,
    disabled: false,
    fingerprint: p.fingerprint,
    createdAt: p.createdAt,
    policy,
    oemPrivacy,
    rotation,
    // الرمز الخام عمدًا غائب — يُسلَّم مرة واحدة في استجابة enable/rotate حصرًا
  })
}

export async function POST(request: Request) {
  // §39 — تحليل الجسم أولًا (بلا أثر جانبي) ليُوثق الفعل المرفوض في السجل كاملًا
  let body: { action?: string } = {}
  try { body = await request.json() } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")

  // حرس loopback للإدارة (FA-23 — توحيد تحت guardPcOnly، نمط §37): البوابة
  // تستبدل x-gw-client-ip دائمًا بعنوان العميل الحقيقي — إن وصلت الترويسة من
  // خارج loopback فالواصل عبر الشبكة (حتى برمز صحيح) ولا يُدير الاقتران.
  // المتصل المباشر بواجهة الجهاز (بلا ترويسة) أو عبر البوابة من loopback يُسمح له.
  if (!guardPcOnly(request, "pair.admin.denied", action, "loopback")) {
    // §39 — محاولة إدارة من خارج الجهاز: دليل أمني (وسم خارجي — بلا عناوين خام F6)
    return NextResponse.json(
      { ok: false, error: "pair-admin-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  // §38 — قفل السياسة المؤسسية (الأولوية المعتمدة: المُدار فوق المستخدم):
  //  - force-off → التفعيل والتدوير مرفوضان (الوصول البعيد مغلق مؤسسيًا)
  //  - force-on  → التعطيل مرفوض — التدوير متروك (دورة الرمز نفسها بلا فجوة أمنية)
  // القفل بعد حرس loopback حصرًا: الإدارة بيد الجهاز أولًا ثم بيد المؤسسة.
  const pol = readEnterprisePolicy()
  // §39 — رصد السياسة قبل الحسم (كل قفل/سماح يُوثق في السجل التدقيقي)
  await observePolicy(pol)
  // §40 — قفل المولود خاصًا: بلا سياسة صالحة + العلم = الخارج مغلق بالتصميم،
  // فالتفعيل والتدوير بلا معنى للخارج (البوابة ترفضه ولو برمز صحيح) — نرفض
  // بصدق بدل إصدار رمز وهمي، والفكّ حصرًا بنشر ملف سياسة صالح (المصدر الفعلي
  // حينئذ "policy" فتُطبَّق أقفال §38 بدلًا من هذا القفل). التعطيل متروك:
  // حذف رمز لا يزيد تعريضًا أبدًا.
  const postureForLock = resolveEffectivePosture(pol)
  if (postureForLock.source === "oem-default" && (action === "enable" || action === "rotate")) {
    await appendAudit("pair.admin.denied", false, "local", { action, reason: "oem-privacy-default" })
    return NextResponse.json(
      { ok: false, error: "oem-privacy-default", hint: "deploy-policy-file" },
      { status: 403 },
    )
  }
  if (pol.state === "managed" && pol.remoteAccess === "force-off" && (action === "enable" || action === "rotate")) {
    await appendAudit("pair.admin.denied", false, "local", { action, reason: "policy-force-off" })
    return NextResponse.json({ ok: false, error: "policy-remote-access-locked", policy: "force-off" }, { status: 403 })
  }
  if (pol.state === "managed" && pol.remoteAccess === "force-on" && action === "disable") {
    await appendAudit("pair.admin.denied", false, "local", { action, reason: "policy-force-on" })
    return NextResponse.json({ ok: false, error: "policy-remote-access-locked", policy: "force-on" }, { status: 403 })
  }

  if (action === "disable") {
    const last = readPairFile()
    try { fs.rmSync(PAIR_FILE, { force: true }) } catch { /* غائب أصلًا */ }
    // G1 — علامة صريحة: لا توليد تلقائي عند الإقلاع والبوابة ترفض الخارج 403
    try { setPairDisabled(true) } catch { /* القرص للقراءة فقط — الخارج مغلق على أي حال (فشل-مغلق) */ }
    // §39 — دليل التعطيل: بصمة الرمز الأخير (لا رمزه)
    await appendAudit("pair.disable", true, "local", { fp: last?.fingerprint ?? null })
    return NextResponse.json({ ok: true, enabled: false })
  }

  if (action === "enable") {
    if (readPairFile()) {
      await appendAudit("pair.admin.denied", false, "local", { action, reason: "conflict" })
      return NextResponse.json({ ok: false, error: "already-enabled", hint: "rotate" }, { status: 409 })
    }
    setPairDisabled(false)
    const token = newToken()
    const { fingerprint, createdAt } = writePairFile(token)
    await appendAudit("pair.enable", true, "local", { fp: fingerprint })
    return NextResponse.json({ ok: true, enabled: true, token, fingerprint, createdAt, urlQuery: `?pair=${token}` })
  }

  if (action === "rotate") {
    const last = readPairFile()
    if (!last) {
      await appendAudit("pair.admin.denied", false, "local", { action, reason: "conflict" })
      return NextResponse.json({ ok: false, error: "not-enabled", hint: "enable" }, { status: 409 })
    }
    const token = newToken()
    const { fingerprint, createdAt } = writePairFile(token)
    // §39 — دليل التدوير: من بصمة إلى بصمة (الهوية تغيّرت — لا الرمز الخام)
    await appendAudit("pair.rotate", true, "local", { from: last.fingerprint, to: fingerprint })
    return NextResponse.json({ ok: true, enabled: true, token, fingerprint, createdAt, urlQuery: `?pair=${token}` })
  }

  await appendAudit("pair.admin.denied", false, "local", { action: action.slice(0, 24), reason: "unknown-action" })
  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
