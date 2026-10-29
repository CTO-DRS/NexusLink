// NexusLink — API الطوارئ الذكي (عقد §48 — القتل النهائي أحادي الاتجاه)
// ============================================================
// GET  → الحالة: مسلَّح؟ القواعد؟ قائمة القتل (بصمات لا أسرار) + كلمة
//        التأكيد معلنة (حدود صادقة: المالك يعرف حرفيًا ماذا يكتب).
// POST { action }:
//   arm  { pin, rules }            — تسليح التصعيد الذاتي (48.د)
//   kill { pin, confirm, deviceId } — القتل النهائي (48.ب): إلحاق القائمة
//        + تدوير رمز §37 فورًا + إطلاق dev:kill على الوكيل المتصل + §39.
//   unkill (وأي فعل آخر) — مرفوض 400 صريحًا: «no-unkill-ever». لا API عودة
//        في أي مكان — هذا حد بنيوي لا إهمال (الحد 48.و.3).
// حرس loopback (نمط §37 حرفيًا): واصل عبر البوابة من خارج الجهاز يُرفض
// حتى لو حمل كل أسرار الدنيا — الإدارة بيد الجهاز، والـPIN يمنع الطلقة
// العرضية لا المدير (الحد 48.و.5).
import { NextResponse } from "next/server"
import { appendAudit } from "@/lib/enterprise-audit"
import { guardEmit, emitKillToDevice } from "@/lib/nexus/guard-bridge"
import {
  armEmergency, killDevice, readEmergencyState, KILL_WORD,
} from "@/lib/nexus/emergency"

export const dynamic = "force-dynamic"

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

export async function GET() {
  const st = readEmergencyState()
  return NextResponse.json({
    ok: true,
    armed: !!st.pinSha256 && !!st.rules,
    armedAt: st.armedAt,
    rules: st.rules,
    // حدود صادقة: الكلمة معلنة للمالك — الهدف منع الطلقة العرضية لا إخفاء العقد
    killWord: KILL_WORD,
    kills: st.kills.map((k) => ({ deviceId: k.deviceId, fingerprint: k.fingerprint, at: k.at, pairRotated: k.pairRotated })),
    // هاش PIN عمدًا غائب — لا يعود أبدًا في أي استجابة
  })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")

  // حرس loopback للإدارة (نمط §37): البوابة تستبدل x-gw-client-ip بعنوان
  // العميل الحقيقي — وجودها من غير loopback يعني واصلًا عبر الشبكة.
  const fwd = request.headers.get("x-gw-client-ip")
  if (fwd && !isLoopbackIp(fwd)) {
    await appendAudit("emergency.kill.denied", false, "remote", { action: action.slice(0, 24), reason: "loopback" })
    return NextResponse.json(
      { ok: false, error: "emergency-admin-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  // الحد البنيوي الأول: لا إلغاء قتل — أبدًا ولا بأي صيغة
  if (action === "unkill" || action === "un-kill" || action === "revive" || action === "unlock-kill") {
    await appendAudit("emergency.kill.denied", false, "local", { action, reason: "no-unkill-ever" })
    return NextResponse.json(
      { ok: false, error: "no-unkill-ever", detail: "kill is one-way by design (§48.و.3)" },
      { status: 400 },
    )
  }

  if (action === "arm") {
    const out = await armEmergency(body.pin, body.rules)
    if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: out.status })
    // بث قواعد التسليح للهاتف المتصل (guard:arm) — يكرر عند كل تعديل
    guardEmit("guard:arm", { rules: out.rules, at: out.armedAt })
    return NextResponse.json({ ok: true, armed: true, rules: out.rules, notes: out.notes, armedAt: out.armedAt })
  }

  if (action === "kill") {
    const out = await killDevice(body.pin, body.confirm, body.deviceId)
    if (!out.ok) return NextResponse.json({ ok: false, error: out.error, reason: out.reason }, { status: out.status })
    // إطلاق القتل على الوكيل المتصل حصرًا من الخادم (لا حقن بالمقبس —
    // dev:kill خارج CMDS): إن كان متصلًا وصلته الآن، وإن قطع وصله عند
    // عودته (48.ج) أو سلَّم نفسه بنفسه (48.د).
    const delivered = emitKillToDevice(out.entry!.deviceId)
    return NextResponse.json({
      ok: true,
      killed: true,
      refired: !!out.refired,
      deviceId: out.entry!.deviceId,
      fingerprint: out.entry!.fingerprint,
      pairRotated: out.entry!.pairRotated,
      deliveredToAgent: delivered,
    })
  }

  await appendAudit("emergency.kill.denied", false, "local", { action: action.slice(0, 24), reason: "unknown-action" })
  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
