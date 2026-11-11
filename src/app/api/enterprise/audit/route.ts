import { NextResponse } from "next/server"
import { verifyAuditChain, readAuditTail, resolveAuditPath, AUDIT_CONTRACT } from "@/lib/enterprise-audit"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

// §39 — نقطة عرض السجل التدقيقي المؤسسي (M4.2 نواة أدلة SOC 2)
// ============================================================
// GET → ملخص السلسلة (العدد والصحة وموضع الكسر إن وجد) + آخر الأحداث.
// حرس loopback (نمط §37.د/§38.د حرفيًا): الدليل بيد الجهاز حصرًا — واصله عبر
// البوابة من خارج الجهاز مرفوض ولو برمز اقتران صحيحًا. الجمع المركزي للأدلة
// (وكيل مؤسسي/سحابة تدقيق) بند النشر الخارجي (حد §38.هـ.5 الموروث — §39.هـ.2).
// منظرٌ لا إجراء: السجل يكتبه خادم الويب عند الأفعال الإدارية والرصد حصرًا —
// لا إلحاق من هذه النقطة إطلاقًا (القراءة قراءة).
// ?limit=N (1..500، الافتراضي 100) — آخر N حدث بالترتيب الزمني.

// FA-23 (تكليف 54): الحرس موحّد فوق حرس http-guard الواحد.
// FA-24 (تكليف 55): نهاية الرفض الصامت المعلن في FA-23 — كل رفض LAN لقراءة الدليل
// يُوثق في سلسلة §39 نفسها (evidence.denied actor=remote reason=loopback بمخفف 3
// ثوانٍ) — متجرّب الأدلة لا يترك أثرًا. الاستجابة بحرفها: نفس 403 بنفس السلسلة
// (عقود audit-e2e S15 المحدثة بالعدّ + fa13 FA-23 + enterprise B7 كلها محفوظة).

export async function GET(request: Request) {
  if (!guardPcOnly(request, "evidence.denied", "audit-view", "loopback")) {
    return NextResponse.json(
      { ok: false, error: "audit-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  const url = new URL(request.url)
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100

  const v = verifyAuditChain()
  return NextResponse.json({
    ok: true,
    contract: AUDIT_CONTRACT,
    file: resolveAuditPath(),
    exists: v.exists,
    count: v.count,
    valid: v.valid,
    brokenAt: v.brokenAt,
    head: v.head,
    events: v.valid ? readAuditTail(limit) : [],
  })
}
