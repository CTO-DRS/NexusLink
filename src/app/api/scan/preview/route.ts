// عقد §62 — الماسح الموثق — معاينة المعالجة الحية (GET ?id=…&n=…)
// ============================================================
// بايتات JPEG للصفحة بعد فلترها الحالي — نفس منطق الختم حرفًا حرفًا
// (none → الأصل كما رُفع · gray/bw → اشتقاق الذاكرة) فما يراه المستخدم
// قبل الختم هو ما سيُختم بعده بلا مفاجأة. الجلسة المفتوحة حصرًا ومعدل
// 120/د والرد no-store (كل معاينة انعكاس لحظي صادق — نمط §55: بلا بايتات
// في أي JSON — الصورة تُقدَّم بايتات مباشرة).
import { NextResponse } from "next/server"
import { previewScanPage } from "@/lib/nexus/scan-server"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  // FA-22 (تكليف 51): معاينة وثائق الماسح فعل المالك على الكمبيوتر — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "scan.denied", "scan-preview")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  const url = new URL(req.url)
  const id = url.searchParams.get("id") ?? ""
  const n = Number(url.searchParams.get("n"))
  if (!id || !Number.isInteger(n)) {
    return NextResponse.json({ ok: false, error: id ? "page-not-found" : "not-found" }, { status: id ? 400 : 404 })
  }
  const r = await previewScanPage(id, n)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status })
  return new NextResponse(new Uint8Array(r.bytes), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Scan-Filter": r.filter },
  })
}
