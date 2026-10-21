import { NextResponse } from "next/server"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { readEnterprisePolicy } from "@/lib/enterprise-policy"
import { appendAudit, observePolicy } from "@/lib/enterprise-audit"

export const dynamic = "force-dynamic"

// API عام 2.0 — الوصول البعيد برمز اقتران (عقد §37 — إغلاق حد §36.هـ.1)
// ============================================================
// GET  → حالة فقط: { enabled, fingerprint, createdAt } — الرمز الخام لا يعود
//        أبدًا في GET (يُعرض مرة واحدة عند التمكين/التدوير حصرًا).
// POST { action: "enable" | "rotate" | "disable" } — إدارة الاقتران.
//        حرس loopback للإدارة: واصل عبر البوابة من خارج الجهاز (ترويسة
//        x-gw-client-ip التي تستبدلها البوابة دائمًا) لا يُدير الاقتران ولو
//        حمل رمزًا صحيحًا — الإدارة بيد الجهاز حصرًا (الجهاز هي الحدود).
// صفر تغيير مخطط وصفر db: مصدر الحقيقة الواحد ملف JSON خارج المخطط
// (.zstate/pair-token.json أو NEXUSLINK_PAIR_FILE) تقرؤه البوابة بمتغير
// تعديل-الوقت — حذف الملف = تعطيل فوري لحظي بلا إعادة تشغيل.

const PAIR_FILE =
  process.env.NEXUSLINK_PAIR_FILE || path.join(process.cwd(), ".zstate", "pair-token.json")

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

function readPairFile(): { token: string; fingerprint: string; createdAt: string } | null {
  try {
    const j = JSON.parse(fs.readFileSync(PAIR_FILE, "utf8"))
    if (j && typeof j.token === "string" && j.token.length >= 16) {
      return { token: j.token, fingerprint: String(j.fingerprint ?? ""), createdAt: String(j.createdAt ?? "") }
    }
    return null
  } catch {
    return null
  }
}

function fingerprintOf(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)
}

function writePairFile(token: string): { fingerprint: string; createdAt: string } {
  const fingerprint = fingerprintOf(token)
  const createdAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(PAIR_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${PAIR_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ token, fingerprint, createdAt }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, PAIR_FILE)
  try { fs.chmodSync(PAIR_FILE, 0o600) } catch { /* أنظمة بلا أذونات بوزيكس */ }
  return { fingerprint, createdAt }
}

/** الرمز الجديد: 32 بايت عشوائية base64url — 43 محرفًا بلا غموض طباعي */
function newToken(): string {
  return crypto.randomBytes(32).toString("base64url")
}

export async function GET() {
  const p = readPairFile()
  // §38 — تلميح الإدارة للبطاقة: ما تفرضه السياسة المؤسسية (بلا حساسيات —
  // اسم المؤسسة ووضع الفرض فقط، وبصمة السياسة في /api/enterprise/compliance).
  const pol = readEnterprisePolicy()
  // §39 — رصد انتقالات السياسة عند القراءات الإدارية (رصد لا فرض)
  await observePolicy(pol)
  const policy = { remoteAccess: pol.remoteAccess, organization: pol.organization }
  if (!p) return NextResponse.json({ ok: true, enabled: false, policy })
  return NextResponse.json({
    ok: true,
    enabled: true,
    fingerprint: p.fingerprint,
    createdAt: p.createdAt,
    policy,
    // الرمز الخام عمدًا غائب — يُسلَّم مرة واحدة في استجابة enable/rotate حصرًا
  })
}

export async function POST(request: Request) {
  // §39 — تحليل الجسم أولًا (بلا أثر جانبي) ليُوثق الفعل المرفوض في السجل كاملًا
  let body: { action?: string } = {}
  try { body = await request.json() } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")

  // حرس loopback للإدارة: البوابة تستبدل x-gw-client-ip دائمًا بعنوان العميل
  // الحقيقي — إن وصلت الترويسة من خارج loopback فالواصل عبر الشبكة (حتى
  // برمز صحيح) ولا يُدير الاقتران. المتصل المباشر بواجهة الجهاز (بلا ترويسة)
  // أو عبر البوابة من loopback يُسمح له.
  const fwd = request.headers.get("x-gw-client-ip")
  if (fwd && !isLoopbackIp(fwd)) {
    // §39 — محاولة إدارة من خارج الجهاز: دليل أمني (وسم خارجي — بلا عناوين خام F6)
    await appendAudit("pair.admin.denied", false, "remote", { action: action.slice(0, 24), reason: "loopback" })
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
    // §39 — دليل التعطيل: بصمة الرمز الأخير (لا رمزه)
    await appendAudit("pair.disable", true, "local", { fp: last?.fingerprint ?? null })
    return NextResponse.json({ ok: true, enabled: false })
  }

  if (action === "enable") {
    if (readPairFile()) {
      await appendAudit("pair.admin.denied", false, "local", { action, reason: "conflict" })
      return NextResponse.json({ ok: false, error: "already-enabled", hint: "rotate" }, { status: 409 })
    }
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
