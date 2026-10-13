// /api/desktop/settings — إعدادات التقوية المشتركة (نفس SQLite — عقد §16)
// ============================================================
// نسخة الويب ونسخة التطبيق (Tauri) يقرآن ويكتبان الكائن نفسه:
// · appLock: قفل التطبيق (enabled/idleLockMin/biometric/hasPin — الهاش محلي في Rust)
// · idle: تحسين الخمول (optMinutes/reducePolling — يقرؤه Rust من status.desktop.hardening)
// · updater: المحدّث الموقّع (autoCheck)
// PUT يقبل أي كائن منها (دمج جزئي — آخر كاتب يفوز) بتنقية صارمة.
import { NextRequest, NextResponse } from "next/server"
import { readDesktopHardening, writeDesktopHardening } from "@/lib/nexus/desktop-hardening"

export const dynamic = "force-dynamic"

export async function GET() {
  const cfg = await readDesktopHardening()
  return NextResponse.json({ ok: true, ...cfg })
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 })
  }
  const hasAny =
    body.appLock !== undefined || body.idle !== undefined || body.updater !== undefined
  if (!hasAny) {
    return NextResponse.json({ error: "appLock أو idle أو updater مطلوب" }, { status: 400 })
  }
  try {
    const cfg = await writeDesktopHardening({
      appLock: body.appLock,
      idle: body.idle,
      updater: body.updater,
    })
    return NextResponse.json({ ok: true, ...cfg })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "فشل حفظ الإعدادات" },
      { status: 500 },
    )
  }
}
