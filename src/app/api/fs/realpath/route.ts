// /api/fs/realpath — المسار الفعلي على قرص الكمبيوتر لإدخال في نظام الملفات الافتراضي
// ============================================================
// FA-files (عقد §14): واجهة الويب تطلبه قبل استدعاء أمر Tauri «files_reveal»
// (إظهار في Explorer/Finder). فقط الأجهزة ذات جذر حقيقي على القرص تعمل —
// والكل حقيقي في هذا السيرفر (pc-fs/agents/…) لذا الفشل = جهاز/مسار غير صالح.
import { NextRequest, NextResponse } from "next/server"
import { realPathFor } from "@/lib/nexus/fs-server"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const device = req.nextUrl.searchParams.get("device") ?? ""
  const vpath = req.nextUrl.searchParams.get("path") ?? "/"
  if (!device.trim()) {
    return NextResponse.json({ ok: false, error: "device مطلوب" }, { status: 400 })
  }
  const r = realPathFor(device, vpath)
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 404 })
  }
  return NextResponse.json({ ok: true, device, path: vpath, realPath: r.realPath })
}
