import { NextResponse } from "next/server"
import {
  verifyAuditChain,
  readAuditTail,
  readAuditFiltered,
  isAuditKind,
  resolveAuditPath,
  rotateAuditEpoch,
  AUDIT_CONTRACT,
} from "@/lib/enterprise-audit"
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
// FA-25 (تكليف 56): الاسترجاع الانتقائي — ?type= و?action= (قائمة الأنواع المولّدة
// حصرًا + شكل الفعل الصارم، الغريب 400 بلا أي قراءة) فمدقق SOC 2 يسأل السلسلة
// أسئلتها عبر النقطة المحرسة نفسها لا بقراءة الملف على الجهاز — وبروفيل القائمة
// (limit) يُطبق على المطابقات (آخر N مطابقة بالترتيب الزمني + matched/truncated).
// بلا بارامترات: الاستجابة بحرفها كما كانت (صفر حقل جديد — العقد القديم سليم).
// FA-26 (تكليف 57): المخرج المعلن في تحذير التجميد نفسه — POST = تدوير الحقبة:
// سلسلة مكسورة تُختم إعادة تسمية حصرًا (الدليل محفوظ حرفًا) والسلسلة الجديدة تبدأ
// بسجل audit.epoch.rotate واحد بأبعاد الاستمرارية — الإغلاق موثق لا إعادة صامتة.
// فوق المكسور حصرًا (السلسلة الصحيحة ترفض audit-epoch-valid — ضمانة عدم المحو:
// دليل سليم لا يُدار عبر النقطة) — والسبب بالشكل الصارم قبل أي قراءة/كتابة.
// الحرس أول الدالة بنوع audit.denied وفعل audit-epoch-rotate (نمط عائلة إدارة
// التدقيق الثلاثة حرفًا) — ورفض LAN له يوثق في السلسلة نفسها (مخفف 3 ثوانٍ).

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

  // FA-25 — بارامترات الاسترجاع الانتقائي: قائمة الأنواع المولّدة حصرًا (الغريب 400
  // بلا أي قراءة للملف) وشكل الفعل الصارم (حرف صغير أو رقم أولًا — 1..64 محرفًا)
  const rawType = url.searchParams.get("type")
  const rawAction = url.searchParams.get("action")
  if (rawType !== null && !isAuditKind(rawType)) {
    return NextResponse.json(
      { ok: false, error: "bad-audit-type", detail: "unknown-audit-kind" },
      { status: 400 },
    )
  }
  if (rawAction !== null && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(rawAction)) {
    return NextResponse.json(
      { ok: false, error: "bad-audit-action", detail: "malformed-action" },
      { status: 400 },
    )
  }
  const filtering = rawType !== null || rawAction !== null

  const v = verifyAuditChain()
  if (!filtering) {
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

  // الاسترجاع الانتقائي: نفس ملخص السلسلة + أبعاد الاستعلام — وسلسلة مكسورة
  // تحجب المطابقات أيضًا (توافق مع سلوك العرض الصامت في tail: لا أثر فوق دليل مكسور)
  const q = v.valid ? readAuditFiltered({ type: rawType ?? undefined, action: rawAction ?? undefined, limit }) : { items: [], total: 0, truncated: false }
  return NextResponse.json({
    ok: true,
    contract: AUDIT_CONTRACT,
    file: resolveAuditPath(),
    exists: v.exists,
    count: v.count,
    valid: v.valid,
    brokenAt: v.brokenAt,
    head: v.head,
    filter: {
      ...(rawType !== null ? { type: rawType } : {}),
      ...(rawAction !== null ? { action: rawAction } : {}),
    },
    matched: q.total,
    truncated: q.truncated,
    events: q.items,
  })
}

// FA-26 (تكليف 57) — تدوير الحقبة: ختم الدليل المكسور وإعادة إطلاق موثقة لا صامتة
export async function POST(request: Request) {
  if (!guardPcOnly(request, "audit.denied", "audit-epoch-rotate")) {
    return NextResponse.json(
      { ok: false, error: "audit-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  // الشكل الصارم للسبب قبل أي قراءة/كتابة: حرف أول أبجدية/رقم، 2..120 محرفًا
  // (حروف صغيرة وأرقام ومسافة ونقطة وشرطة وشرطة سفلية — ملاحظة مدقق مقروءة)
  let body: { reason?: unknown } = {}
  try {
    body = (await request.json()) as { reason?: unknown }
  } catch {}
  const reason = typeof body.reason === "string" ? body.reason : ""
  if (reason.length === 0) {
    return NextResponse.json(
      { ok: false, error: "missing-epoch-reason", detail: "reason-required" },
      { status: 400 },
    )
  }
  if (!/^[a-z0-9][a-z0-9 ._-]{1,119}$/.test(reason)) {
    return NextResponse.json(
      { ok: false, error: "bad-epoch-reason", detail: "malformed-reason" },
      { status: 400 },
    )
  }

  const res = await rotateAuditEpoch(reason)
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: res.error,
        detail:
          res.error === "audit-epoch-valid"
            ? "chain-valid-no-rotation"
            : res.error === "audit-epoch-missing"
              ? "chain-missing-no-rotation"
              : "rotation-io-failed",
      },
      { status: res.error === "audit-epoch-io" ? 500 : 400 },
    )
  }
  return NextResponse.json({
    ok: true,
    rotated: true,
    contract: AUDIT_CONTRACT,
    epoch: res.epoch,
    sealedFile: res.sealedFile,
    brokenAt: res.brokenAt,
    prevCount: res.prevCount,
    prevHead: res.prevHead,
  })
}
