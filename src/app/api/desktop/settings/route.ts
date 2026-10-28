// /api/desktop/settings — إعدادات التقوية المشتركة (نفس SQLite — عقد §16)
// ============================================================
// نسخة الويب ونسخة التطبيق (Tauri) يقرآن ويكتبان الكائن نفسه:
// · appLock: قفل التطبيق (enabled/idleLockMin/biometric/hasPin — الهاش محلي في Rust)
// · idle: تحسين الخمول (optMinutes/reducePolling — يقرؤه Rust من status.desktop.hardening)
// · updater: المحدّث الموقّع (autoCheck)
// PUT يقبل أي كائن منها (دمج جزئي — آخر كاتب يفوز) بتنقية صارمة.
//
// §47 — قفل الإعدادات المؤسسي: managed.lockedSettings في ملف السياسة v2
// يجعل PUT على قسم مقفول → 403 (المستخدم لا يفكّ ما أقفله المدير) — القفل
// انتقائي لا كلي: الأقسام غير المذكورة تُكتب طبيعيًا. القراءة GET دائمًا
// مفتوحة (البطاقة ترى ما يفرضه المدير — الصدق قبل الصرامة). فشل-آمن §38:
// ملف تالف/غير مُدار = لا قفل (السلوك التاريخي حرفيًا).
import { NextRequest, NextResponse } from "next/server"
import { readDesktopHardening, writeDesktopHardening } from "@/lib/nexus/desktop-hardening"
import { readEnterprisePolicy, LOCKABLE_SETTINGS } from "@/lib/enterprise-policy"
import { appendAudit, observePolicy } from "@/lib/enterprise-audit"

export const dynamic = "force-dynamic"

export async function GET() {
  const cfg = await readDesktopHardening()
  // §47 — علم القفل للبطاقة (توصيفي: أقسام مقفولة فقط — بلا اسم مؤسسة هنا،
  // محله الامتثال §38)
  const pol = readEnterprisePolicy()
  const locked = pol.state === "managed" ? pol.lockedSettings : []
  return NextResponse.json({ ok: true, ...cfg, policy: { lockedSettings: locked } })
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 })
  }
  const requested = LOCKABLE_SETTINGS.filter((k) => body[k] !== undefined)
  if (requested.length === 0) {
    return NextResponse.json({ error: "appLock أو idle أو updater مطلوب" }, { status: 400 })
  }
  // §47 — حسم القفل قبل أي كتابة (بلا أثر جانبي قبل الحسم — نمط §39)
  const pol = readEnterprisePolicy()
  await observePolicy(pol)
  if (pol.state === "managed" && pol.lockedSettings.length > 0) {
    const blocked = requested.filter((k) => pol.lockedSettings.includes(k))
    if (blocked.length > 0) {
      await appendAudit("settings.write.denied", false, "local", {
        sections: blocked.join(","),
        reason: "locked-by-policy",
      })
      return NextResponse.json(
        {
          ok: false,
          error: "settings-locked-by-policy",
          detail: { locked: blocked, organization: pol.organization },
        },
        { status: 403 },
      )
    }
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
