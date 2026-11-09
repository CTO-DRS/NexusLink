// FA-18 (تكليف 45) — وكيل قائمة وسائط الهاتف — نفس الأصل بلا أي استثناء CSP
// ===========================================================================
// الثغرة المغلقة (طبقتان):
// 1) عميل التخزين في الواجهة كان يجلب القائمة مباشرة من الهاتف
//    `http://<lanIp>:<port>/list?token=…` — طلب عبر الأصل كان يُجبر CSP على
//    `connect-src` مفتوح للشبكة كلها. الوكيل يجعل الطلب نفس الأصل حصرًا
//    (`connect-src 'self'` صافية) والرمز لا يظهر في متصفح المالك أصلًا.
// 2) الوجهة تُحل من حالة السيرفر حصرًا (agentMedia() من جسر الحرس 3006) —
//    صفر URL من العميل ⇒ صفر SSRF بنيويًا (الوكيل لا ينفذ طلبًا لمسار يحدده
//    المستدعي — `dir` يمر كقيمة معلمة للهاتف الذي يعقّمها بنفسه).
// الحرس: guardPcOnly (طبقة FA-16) — قراءة الهاتف عبر البوابة من غير
// loopback تُرفض 403 (سطح المكتب loopback يمر). الهاتف نفسه لا يستهلك
// هذا المسار (تصفح التخزين ميزة سطح المكتب حصرًا).
import { NextRequest, NextResponse } from "next/server"
import { agentMedia } from "@/lib/nexus/guard-bridge"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // FA-16 (تكليف 45): تصفح وسائط الهاتف فعل على الكمبيوتر — loopback حصرًا
  if (!guardPcOnly(req, "prod.denied", "phone-media-list")) {
    return NextResponse.json(
      { ok: false, error: "pc-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }
  const media = agentMedia()
  if (!media?.lanIp || !media.port || !media.token) {
    return NextResponse.json(
      { ok: false, error: "phone-media-offline" },
      { status: 503 },
    )
  }
  const dir = String(new URL(req.url).searchParams.get("dir") ?? "/").slice(0, 512)
  const target = `http://${media.lanIp}:${media.port}/list?token=${encodeURIComponent(media.token)}&dir=${encodeURIComponent(dir)}`
  try {
    const r = await fetch(target, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: "application/json" },
    })
    const j = (await r.json().catch(() => null)) as { ok?: boolean; entries?: unknown[] } | null
    return NextResponse.json(j ?? { ok: false, error: "bad-agent-response" })
  } catch {
    return NextResponse.json({ ok: false, error: "phone-media-unreachable" }, { status: 502 })
  }
}
