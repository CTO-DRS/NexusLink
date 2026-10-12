// /api/desktop/shortcuts — مزامنة الاختصارات العالمية + إعدادات الحافظة والأمان لسطح المكتب
// ============================================================
// المخزن المصدر واحد: zustand store في الواجهة (localStorage: nexus-shortcuts).
// مكوّن الجسر (desktop-bridge) يقرأ المخزن نفسه ويدفع الخريطة إلى هنا،
// ومدير العمليات في Tauri (procman) يستطلعها عبر GET ويُسجّلها عالميًا.
// FA-clipboard-sync: نفس المسار يحمل الآن كائن clip (mode/maxAutoBytes)
// — مراقب الحافظة في Rust يقرؤه من status.desktop.clip (عقد §11).
// FA-power: نفس المسار يحمل كائن security (autoLock) — تقرؤه الطبقة
// الأصلية من status.desktop.security لبوابة القفل التلقائي (عقد §12).
// تخزين: ملف JSON بجانب بيانات السيرفر (نفس نمط كتابة الخادم الحالي).
import { promises as fs } from "fs"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import {
  DESKTOP_SHORTCUT_DEFAULTS,
  desktopUiStorePath,
  readDesktopClip,
  writeDesktopClip,
  readDesktopSecurity,
  writeDesktopSecurity,
  readDesktopSync,
  writeDesktopSync,
  readDesktopMedia,
  writeDesktopMedia,
} from "@/lib/nexus/desktop-shortcuts"

export const dynamic = "force-dynamic"

const STORE_PATH = desktopUiStorePath()

async function readMap(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8")
    const j = JSON.parse(raw) as { shortcuts?: Record<string, string> }
    return { ...DESKTOP_SHORTCUT_DEFAULTS, ...(j.shortcuts || {}) }
  } catch {
    return { ...DESKTOP_SHORTCUT_DEFAULTS }
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    shortcuts: await readMap(),
    clip: await readDesktopClip(),
    security: await readDesktopSecurity(),
    sync: await readDesktopSync(),
    media: await readDesktopMedia(),
  })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 })
  }
  const incoming = (body as { shortcuts?: Record<string, unknown> }).shortcuts
  const clipIn = (body as { clip?: unknown }).clip
  const secIn = (body as { security?: unknown }).security
  const syncIn = (body as { sync?: unknown }).sync
  const mediaIn = (body as { media?: unknown }).media
  if (
    (!incoming || typeof incoming !== "object") &&
    (!clipIn || typeof clipIn !== "object") &&
    (!secIn || typeof secIn !== "object") &&
    (!syncIn || typeof syncIn !== "object") &&
    (!mediaIn || typeof mediaIn !== "object")
  ) {
    return NextResponse.json({ error: "shortcuts أو clip أو security أو sync أو media مطلوب" }, { status: 400 })
  }
  // تنظيف: مفاتيح نصية غير فارغة فقط، ودمج فوق القائم (عميل قديم لا يمسح البقية)
  const clean: Record<string, string> = {}
  if (incoming && typeof incoming === "object") {
    for (const [k, v] of Object.entries(incoming)) {
      if (typeof v === "string" && v.trim() && v.length <= 40) clean[k] = v.trim()
    }
  }
  const merged = { ...(await readMap()), ...clean }
  try {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true })
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as Record<string, unknown>
    } catch {
      /* ملف غير موجود/تالف — نبدأ نظيفًا */
    }
    await fs.writeFile(
      STORE_PATH,
      JSON.stringify({ ...parsed, shortcuts: merged, updatedAt: Date.now() }, null, 2),
      "utf8"
    )
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "فشل التخزين" },
      { status: 500 }
    )
  }
  // FA-clipboard-sync: تحديث إعدادات مراقب الحافظة إن وُجد في نفس الطلب
  let clip = await readDesktopClip()
  if (clipIn && typeof clipIn === "object") {
    try {
      clip = await writeDesktopClip(clipIn as Record<string, never>)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "فشل حفظ إعدادات الحافظة" },
        { status: 500 }
      )
    }
  }
  // FA-power: تحديث إعدادات الأمان (autoLock) إن وُجد في نفس الطلب
  let security = await readDesktopSecurity()
  if (secIn && typeof secIn === "object") {
    try {
      security = await writeDesktopSecurity(secIn as Record<string, never>)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "فشل حفظ إعدادات الأمان" },
        { status: 500 }
      )
    }
  }
  // FA-files: تحديث أزواج مزامنة المجلدات إن وُجد في نفس الطلب
  let sync = await readDesktopSync()
  if (syncIn && typeof syncIn === "object") {
    try {
      sync = await writeDesktopSync(syncIn as { pairs?: never[] })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "فشل حفظ أزواج المزامنة" },
        { status: 500 }
      )
    }
  }
  // FA-media (عقد §15): حالة طبقة الوسائط إن وُجدت في نفس الطلب
  let media = await readDesktopMedia()
  if (mediaIn && typeof mediaIn === "object") {
    try {
      media = await writeDesktopMedia(mediaIn as Record<string, never>)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "فشل حفظ حالة الوسائط" },
        { status: 500 }
      )
    }
  }
  return NextResponse.json({ ok: true, shortcuts: merged, clip, security, sync, media })
}
