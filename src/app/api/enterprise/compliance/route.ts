import { NextResponse } from "next/server"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { readEnterprisePolicy, policyPaths, POLICY_CONTRACT, oemPrivacyActive, resolveEffectivePosture, rotationDue } from "@/lib/enterprise-policy"
import { observePolicy, auditSummary, AUDIT_CONTRACT } from "@/lib/enterprise-audit"
import { guardPcOnly } from "@/lib/nexus/http-guard"

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

// FA-23 (تكليف 54): الحرس موحّد فوق حرس http-guard الواحد.
// FA-24 (تكليف 55): نهاية الرفض الصامت المعلن في FA-23 — كل رفض LAN لقراءة
// تقرير الامتثال يُوثق في سلسلة §39 نفسها (evidence.denied actor=remote
// reason=loopback بمخفف 3 ثوانٍ) والاستجابة بحرفها: نفس 403 بنفس السلسلة
// (عقود enterprise-e2e B7 وoem-e2e ج9 وfa13 FA-23 كلها محفوظة بلا تحديث سطر).

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
  if (!guardPcOnly(request, "evidence.denied", "compliance-view", "loopback")) {
    return NextResponse.json(
      { ok: false, error: "compliance-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  const pol = readEnterprisePolicy()
  // §39 — رصد انتقالات السياسة عند قراءات الامتثال (إدارة التغيير — أدلة SOC 2)
  await observePolicy(pol)
  // §40 — وضع OEM «خصوصية افتراضية»: العلم الفعّال ومصدر الفرض الفعلي فوق
  // حالة الملف (المولود خاصًا فشل-مغلق — الملف التالف لا يفتح جهازًا خاصًا)
  const posture = resolveEffectivePosture(pol)
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
      // §47 — فرض المخطط v2 معلن كاملًا في الامتثال (v1/غير مُدار = محايد):
      // الأقسام المقفولة · أجلة تدوير الرمز · القدرات المعطلة · أرضية الإصدار
      lockedSettings: pol.lockedSettings,
      accessCodeRotationDays: pol.accessCodeRotationDays,
      disabledCapabilities: pol.disabledCapabilities,
      minimumVersion: pol.minimumVersion,
    },
    // §40 — الفرض الفعلي: من يملك الحسم (سياسة صالحة | مولود خاص | المستخدم)
    // وما يترتب عليه فعليًا على الخارج — التوصيف الصادق للوضع المطبق الآن
    oemPrivacy: {
      active: oemPrivacyActive(),
      source: posture.source,
      effective: {
        remoteAccess: posture.remoteAccess,
        blockedBridges: posture.blockedBridges,
        closed: posture.closed,
      },
    },
    pairGate: {
      enabled: !!pair,
      fingerprint: pair?.fingerprint ?? null,
      createdAt: pair?.createdAt ?? null,
      // §47 — استحقاق تدوير الرمز معلن في الامتثال (توصيفي صادق)
      rotation: {
        days: pol.state === "managed" ? pol.accessCodeRotationDays : null,
        due: rotationDue(pair?.createdAt, pol.state === "managed" ? pol.accessCodeRotationDays : null),
      },
    },
    // §39 — ملخص السجل التدقيقي المحلي (أدلة الإدارة والتغيير — توصيفي حصرًا)
    audit: { contract: AUDIT_CONTRACT, ...auditSummary() },
    appVersion: appVersion(),
    platform: process.platform,
    generatedAt: new Date().toISOString(),
  })
}
