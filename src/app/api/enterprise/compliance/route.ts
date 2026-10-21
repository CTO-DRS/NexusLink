import { NextResponse } from "next/server"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { readEnterprisePolicy, policyPaths, POLICY_CONTRACT } from "@/lib/enterprise-policy"
import { observePolicy, auditSummary, AUDIT_CONTRACT } from "@/lib/enterprise-audit"

export const dynamic = "force-dynamic"

// §38 — تقرير الامتثال المؤسسي (M4.1 النواة المحلية)
// ============================================================
// GET → تقرير توصيفي لحالة الإدارة: من يدير الجهاز، وما تفرضه السياسة،
// وبصمة ملف السياسة، وحالة بوابة الاقتران، والإصدار والمنصة. بلا أي مفاتيح
// ولا رموز ولا محتوى مستخدم (حرس F6 متوافق: بيانات وصفية حصرًا).
// حرس loopback (نمط §37.د حرفيًا): التقرير بيد الجهاز حصرًا — واصله عبر
// البوابة من خارج الجهاز (ترويسة x-gw-client-ip التي تستبدلها البوابة دائمًا)
// مرفوض ولو حمل رمز اقتران صحيحًا. التقارير عبر الشبكة/الوكيل المركزي بند
// النشر الخارجي (حد §38.هـ.5 — النفق/النطاق/TLS ما تبقى من M4).
// تعمل النقطة بلا إعادة تشغيل: قراءة السياسة بمتغير تعديل-الوقت في كل نداء.

const PAIR_FILE =
  process.env.NEXUSLINK_PAIR_FILE || path.join(process.cwd(), ".zstate", "pair-token.json")

/** مطابق حرفيًا لقراءة §37 في /api/remote-access — نمط النسختين المتطابقتين */
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

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

/** الإصدار الموحد من package.json (توصيفي — غيابه لا يفشل التقرير) */
function appVersion(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version
    return typeof v === "string" && v ? v : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const fwd = request.headers.get("x-gw-client-ip")
  if (fwd && !isLoopbackIp(fwd)) {
    return NextResponse.json(
      { ok: false, error: "compliance-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  const pol = readEnterprisePolicy()
  // §39 — رصد انتقالات السياسة عند قراءات الامتثال (إدارة التغيير — أدلة SOC 2)
  await observePolicy(pol)
  const pair = readPairFile()
  return NextResponse.json({
    ok: true,
    contract: POLICY_CONTRACT,
    policyState: pol.state,
    managed: pol.state === "managed",
    policyPath: pol.path,
    policyPathsConfigured: policyPaths(),
    policyHash: pol.hash,
    policySchemaVersion: pol.schemaVersion,
    organization: pol.organization,
    enforced: {
      remoteAccess: pol.remoteAccess,
      blockedBridges: pol.blockedBridges,
    },
    pairGate: {
      enabled: !!pair,
      fingerprint: pair?.fingerprint ?? null,
      createdAt: pair?.createdAt ?? null,
    },
    // §39 — ملخص السجل التدقيقي المحلي (أدلة الإدارة والتغيير — توصيفي حصرًا)
    audit: { contract: AUDIT_CONTRACT, ...auditSummary() },
    appVersion: appVersion(),
    platform: process.platform,
    generatedAt: new Date().toISOString(),
  })
}
