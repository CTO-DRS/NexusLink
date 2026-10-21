import { NextResponse } from "next/server"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { readEnterprisePolicy } from "@/lib/enterprise-policy"

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
  // حرس loopback للإدارة: البوابة تستبدل x-gw-client-ip دائمًا بعنوان العميل
  // الحقيقي — إن وصلت الترويسة من خارج loopback فالواصل عبر الشبكة (حتى
  // برمز صحيح) ولا يُدير الاقتران. المتصل المباشر بواجهة الجهاز (بلا ترويسة)
  // أو عبر البوابة من loopback يُسمح له.
  const fwd = request.headers.get("x-gw-client-ip")
  if (fwd && !isLoopbackIp(fwd)) {
    return NextResponse.json(
      { ok: false, error: "pair-admin-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  let body: { action?: string } = {}
  try { body = await request.json() } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")

  // §38 — قفل السياسة المؤسسية (الأولوية المعتمدة: المُدار فوق المستخدم):
  //  - force-off → التفعيل والتدوير مرفوضان (الوصول البعيد مغلق مؤسسيًا)
  //  - force-on  → التعطيل مرفوض — التدوير متروك (دورة الرمز نفسها بلا فجوة أمنية)
  // القفل بعد حرس loopback حصرًا: الإدارة بيد الجهاز أولًا ثم بيد المؤسسة.
  const pol = readEnterprisePolicy()
  if (pol.state === "managed" && pol.remoteAccess === "force-off" && (action === "enable" || action === "rotate")) {
    return NextResponse.json({ ok: false, error: "policy-remote-access-locked", policy: "force-off" }, { status: 403 })
  }
  if (pol.state === "managed" && pol.remoteAccess === "force-on" && action === "disable") {
    return NextResponse.json({ ok: false, error: "policy-remote-access-locked", policy: "force-on" }, { status: 403 })
  }

  if (action === "disable") {
    try { fs.rmSync(PAIR_FILE, { force: true }) } catch { /* غائب أصلًا */ }
    return NextResponse.json({ ok: true, enabled: false })
  }

  if (action === "enable") {
    if (readPairFile()) {
      return NextResponse.json({ ok: false, error: "already-enabled", hint: "rotate" }, { status: 409 })
    }
    const token = newToken()
    const { fingerprint, createdAt } = writePairFile(token)
    return NextResponse.json({ ok: true, enabled: true, token, fingerprint, createdAt, urlQuery: `?pair=${token}` })
  }

  if (action === "rotate") {
    if (!readPairFile()) {
      return NextResponse.json({ ok: false, error: "not-enabled", hint: "enable" }, { status: 409 })
    }
    const token = newToken()
    const { fingerprint, createdAt } = writePairFile(token)
    return NextResponse.json({ ok: true, enabled: true, token, fingerprint, createdAt, urlQuery: `?pair=${token}` })
  }

  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
