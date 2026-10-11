// /api/desktop/shortcuts — مزامنة الاختصارات العالمية لسطح المكتب
// ============================================================
// المخزن المصدر واحد: zustand store في الواجهة (localStorage: nexus-shortcuts).
// مكوّن الجسر (desktop-bridge) يقرأ المخزن نفسه ويدفع الخريطة إلى هنا،
// ومدير العمليات في Tauri (procman) يستطلعها عبر GET ويُسجّلها عالميًا.
// تخزين: ملف JSON بجانب بيانات السيرفر (نفس نمط كتابة الخادم الحالي).
import { promises as fs } from "fs"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { DESKTOP_SHORTCUT_DEFAULTS, desktopUiStorePath } from "@/lib/nexus/desktop-shortcuts"

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
  return NextResponse.json({ ok: true, shortcuts: await readMap() })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 })
  }
  const incoming = (body as { shortcuts?: Record<string, unknown> }).shortcuts
  if (!incoming || typeof incoming !== "object") {
    return NextResponse.json({ error: "shortcuts مطلوب" }, { status: 400 })
  }
  // تنظيف: مفاتيح نصية غير فارغة فقط، ودمج فوق القائم (عميل قديم لا يمسح البقية)
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "string" && v.trim() && v.length <= 40) clean[k] = v.trim()
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
  return NextResponse.json({ ok: true, shortcuts: merged })
}
