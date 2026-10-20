import { NextResponse } from "next/server"
import { buildPredictPayload } from "@/lib/nexus/predict"

export const dynamic = "force-dynamic"

// API عام 2.0 — التنبؤ الاستباقي (عقد §35.ج — عمق M2 الاختياري المعلن)
// ============================================================
// GET → توقعات إطلاق الروتينات + اقتراحات روتينات جديدة مسبّبة بالدليل.
// قراءة حصرًا من الجداول القائمة (صفر تغيير مخطط) — أرقام/أزمنة/معرفات
// حصرًا بلا أي محتوى (F6 متوافق) — والاقتراح لا ينشئ شيئًا تلقائيًا:
// إنشاء القاعدة يمر بمسار الواجهة/الـAPI الموجود بيد المستخدم حصرًا.

export async function GET() {
  try {
    const payload = await buildPredictPayload()
    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    )
  }
}
