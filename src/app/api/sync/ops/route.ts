import { NextRequest, NextResponse } from "next/server"
import { headSeq, opsSince, REPLAY_LIMIT } from "@/lib/nexus/oplog"
import { readEnterprisePolicy } from "@/lib/enterprise-policy"
import { appendAudit, observePolicy } from "@/lib/enterprise-audit"

export const dynamic = "force-dynamic"

// API عام 2.0 — قراءة سجل العمليات القابل للاستئناف (عقد §34.أ + §32)
// ============================================================
// قراءة حصرًا: رأس السجل + نافذة أخيرة من العمليات. الكتابة تبقى عبر
// القنوات القائمة (prod:*) — الـAPI العام لا يغير تاريخ المزامنة.
// F6 متوافق: المحتوى النصي للمقاطع يُخفى حصرًا (فارغ مع العلم) كما في replay.
//
// §47 — تعطيل قدرة المزامنة العامة مؤسسيًا: managed.disabledCapabilities
// تحتوي "sync" → القناة العامة (هذه النقطة حصرًا) → 403 — الحد الصادق
// 47.و.5: قناة الوكيل الداخلية (جسور prod) لا تُمسّ — الأجهزة المقترنة
// تعمل كاملًا؛ هذا إغلاق القناة المفتوحة للخارج (عقد §34) لا قلب الجهاز.

export async function GET(req: NextRequest) {
  // §47 — حسم التعطيل قبل أي منطق (بلا أثر جانبي) + دليل §39
  const pol = readEnterprisePolicy()
  await observePolicy(pol)
  if (pol.state === "managed" && pol.disabledCapabilities.includes("sync")) {
    await appendAudit("capability.denied", false, "local", { capability: "sync", action: "ops-read" })
    return NextResponse.json(
      { ok: false, error: "capability-disabled-by-policy", detail: { capability: "sync" } },
      { status: 403 },
    )
  }
  try {
    const sinceRaw = Number(req.nextUrl.searchParams.get("since") ?? 0)
    const since = Number.isFinite(sinceRaw) ? Math.max(0, Math.floor(sinceRaw)) : 0
    const head = await headSeq()
    const safeSince = Math.min(since, head) // لا نافذة سالبة/فوق الرأس (§32 شطدات)
    const ops = await opsSince(safeSince, REPLAY_LIMIT)
    return NextResponse.json({
      head,
      since: safeSince,
      truncated: head - safeSince > ops.length,
      count: ops.length,
      ops: ops.map((o) => ({
        seq: o.seq,
        opId: o.opId,
        at: o.at,
        kind: o.kind,
        deviceId: o.deviceId,
        // F6: حمولة الحافظة لا تغادر عبر الـAPI العام — نفس حارس replay حرفيًا
        hasPayload: Object.keys(o.payload ?? {}).length > 0,
        payload: {},
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 })
  }
}
