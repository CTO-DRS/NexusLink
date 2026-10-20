import { NextRequest, NextResponse } from "next/server"
import { searchAll, cleanQuery } from "@/lib/nexus/intel-search"

export const dynamic = "force-dynamic"

/** البحث الموحد (عقد §33.أ — M2.3): استعلام واحد عبر ثمانية مخازن محلية
 *  (الأجهزة · الروتينات · الحافظة · الرسائل · جهات الاتصال · النداءات ·
 *  التسليم المتصل · الملفات المتزامنة) — كلها SQLite/ذاكرة على الجهاز،
 *  صفر بايت يغادر. بنفس مستوى كشف واجهات المحتوى القائمة (REST عبر 3000). */
export async function GET(req: NextRequest) {
  const qRaw = req.nextUrl.searchParams.get("q") ?? ""
  const q = cleanQuery(qRaw)
  if (!q) {
    return NextResponse.json({ ok: false, error: "استعلام مطلوب (1..80 حرفًا)", q: "", total: 0, took: 0, groups: [] }, { status: 400 })
  }
  try {
    return NextResponse.json(await searchAll(q))
  } catch {
    return NextResponse.json({ ok: false, error: "فشل البحث", q, total: 0, took: 0, groups: [] }, { status: 200 })
  }
}
