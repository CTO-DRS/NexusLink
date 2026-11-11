// عقد §53 — التسليم اليدوي الذكي — المسار العام
// ============================================================
// GET                    → القائمة الحية (تقليم + معاينات مقنّعة — الحمولة الكاملة
//                          لا تعود في GET أبدًا؛ تعود عبر act حصرًا عند الاستهلاك)
// POST { action: "push" | "open" | "copy" | "dismiss" | "clear" | "rotate-key" }
//  - push: { kind, payload, sourceDevice?, note? } — من الأجهزة المقترنة عبر
//    البوابة (رمز §37 تلقائيًا) ومن الجهاز المحلي — هو جوهر العقد.
//  - open/copy: { id } — يستهلك العنصر ويعيد التوجيه الإرشادي.
//  - dismiss: { id } — إزالة بلا فعل.
//  - clear: تفريغ كامل — يد محلية حصرًا (حرس loopback نمط §37/§51).
//  - rotate-key (§57): تدوير مفتاح القفل الساكن وإعادة ختم القائمة —
//    يد محلية حصرًا، والمفتاح لا يُعرض أبدًا.
// كل فعل يُدوَّن §39 بأطوال وبصمات حصرًا — المحتوى لا يدخل الدليل (F6).
import { NextResponse } from "next/server"
import { guardPcOnly } from "@/lib/nexus/http-guard"
import {
  listHandoff, pushHandoff, actHandoff, clearHandoff, rotateRestKey,
} from "@/lib/nexus/handoff-server"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(await listHandoff())
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")

  if (action === "push") {
    const r = await pushHandoff({
      kind: body.kind,
      payload: body.payload,
      sourceDevice: body.sourceDevice,
      note: body.note,
      rateKey: String(body.sourceDevice ?? "push").slice(0, 60),
    })
    if (!r.ok) {
      const status = r.error === "rate-limited" ? 429 : 400
      return NextResponse.json({ ok: false, error: r.error }, { status })
    }
    return NextResponse.json(r)
  }

  if (action === "open" || action === "copy" || action === "dismiss") {
    const id = String(body.id ?? "")
    if (!id) return NextResponse.json({ ok: false, error: "missing-id" }, { status: 400 })
    const r = await actHandoff(id, action)
    if (!r.ok) return NextResponse.json(r, { status: 404 })
    return NextResponse.json(r)
  }

  if (action === "clear") {
    // حرس loopback للإدارة (FA-23 — توحيد تحت guardPcOnly، نمط §37/§51): التفريغ بيد الجهاز حصرًا
    if (!guardPcOnly(req, "handoff.denied", "clear", "loopback")) {
      return NextResponse.json(
        { ok: false, error: "handoff-admin-loopback-only", detail: "via-gateway-non-loopback" },
        { status: 403 },
      )
    }
    return NextResponse.json(await clearHandoff())
  }

  if (action === "rotate-key") {
    // حرس loopback للإدارة (FA-23 — توحيد تحت guardPcOnly، نمط §37/§51) — تدوير القفل بيد الجهاز حصرًا
    if (!guardPcOnly(req, "handoff.denied", "rotate-key", "loopback")) {
      return NextResponse.json(
        { ok: false, error: "handoff-admin-loopback-only", detail: "via-gateway-non-loopback" },
        { status: 403 },
      )
    }
    return NextResponse.json(await rotateRestKey())
  }

  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
