// /api/desktop/audit — سجل التدقيق الأصلي (عقد §16 — بند 3 من «صلّب الإصدار»)
// ============================================================
// كل عملية من الطبقة الأصلية (نقل/تحكم/حافظة/طاقة/وسائط/قفل) تُكتب في
// db.AuditEvent (نفس SQLite) ببادئة native-*، وهنا مراجعتها:
// · POST  ← الطبقة الأصلية في Rust (طابور منفصل — fire-and-forget)
// · GET   ← واجهة المراجعة (بطاقة «سجل التدقيق الأصلي» في الإعدادات) مع مرشحات
// · DELETE← مسح أحداث native-* فقط (تدقيق أمان الهاتف FA-10 لا يُمس)
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { writeNativeAudit } from "@/lib/nexus/desktop-hardening"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 })
  }
  const ok = await writeNativeAudit({
    action: String(body.action ?? ""),
    detail: String(body.detail ?? ""),
    severity: String(body.severity ?? "info"),
    actor: String(body.actor ?? "الكمبيوتر"),
    deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
  })
  if (!ok) return NextResponse.json({ error: "حدث غير صالح" }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  let take = Number(url.searchParams.get("take") || 200)
  take = Math.max(1, Math.min(take, 500))
  const category = url.searchParams.get("category") // مثل native-clipboard أو transfer (اختياري)
  const severity = url.searchParams.get("severity") // info | warn | critical (اختياري)
  // عقد §16 — السجل موحّد: أفعال الطبقة الأصلية (native-* حصرية لنا) + أفعال
  // مسارات السيرفر (transfer/clipboard/settings/screen — مفردات FA-10 القائمة
  // + pairing/pairing-reject — تدقيق الاقتران G-1 من عقد §6).
  const SERVER_ACTIONS = ["transfer", "clipboard", "settings", "screen", "pairing", "pairing-reject"] as const
  const where: Record<string, unknown> = {
    OR: [{ action: { startsWith: "native-" } }, { action: { in: [...SERVER_ACTIONS] } }],
  }
  if (category) {
    if (category.startsWith("native-")) where.action = { startsWith: category }
    else if ((SERVER_ACTIONS as readonly string[]).includes(category)) where.action = category
  }
  if (severity && ["info", "warn", "critical"].includes(severity)) where.severity = severity
  try {
    const rows = await db.auditEvent.findMany({ where, orderBy: { at: "desc" }, take })
    return NextResponse.json({
      ok: true,
      events: rows.map((r) => ({
        id: r.id,
        at: r.at,
        actor: r.actor,
        action: r.action,
        detail: r.detail,
        severity: r.severity,
      })),
    })
  } catch {
    // قاعدة قديمة/غير جاهزة — قائمة فارغة بلا انكسار
    return NextResponse.json({ ok: true, events: [] })
  }
}

export async function DELETE() {
  try {
    const res = await db.auditEvent.deleteMany({ where: { action: { startsWith: "native-" } } })
    return NextResponse.json({ ok: true, deleted: res.count })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "فشل المسح" },
      { status: 500 },
    )
  }
}
