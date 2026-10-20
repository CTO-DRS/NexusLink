import { NextRequest, NextResponse } from "next/server"
import { buildAnswer, classifyIntent, assistantIndexStats } from "@/lib/nexus/assistant"
import { probeLocalLlm, llmRefine } from "@/lib/nexus/assistant-llm"

export const dynamic = "force-dynamic"

/** المساعد على الجهاز (عقد §33.ب — M2.1): NLU حتمي بلا أي نموذج + إجابات من
 *  المخازن المحلية حصرًا + تصفية اختيارية عبر مُشغّل LLM محلي (127.0.0.1
 *  حصرًا — Ollama/llama.cpp). صفر بايت يغادر الجهاز بالتصميم (حرس F6 متوافق:
 *  REST بمستوى كشف واجهات المحتوى القائمة). */
export async function GET() {
  // تشخيص الفهرس — بيانات وصفية حصرًا (لا محتوى)
  try {
    const [stats, llm] = await Promise.all([assistantIndexStats(), probeLocalLlm()])
    return NextResponse.json({ ok: true, index: stats, llm })
  } catch {
    return NextResponse.json({ ok: false, index: null, llm: { available: false, runtime: null } }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  let q = ""
  try {
    const body = (await req.json()) as { q?: unknown }
    if (typeof body?.q === "string") q = body.q.trim().slice(0, 300)
  } catch { /* جسم غير صالح */ }
  if (!q) {
    return NextResponse.json({ ok: false, error: "سؤال مطلوب (q)", intent: "help", confidence: 0, answer: "", sources: [], took: 0, llm: { available: false, runtime: null } }, { status: 400 })
  }
  try {
    const result = await buildAnswer(q)
    // الكشف ثم التصفية الاختيارية — الفشل هنا يعيد النص الحتمي (غير خاطئ)
    const llm = await probeLocalLlm()
    const refined = llm.available ? await llmRefine(llm, q, result.answer, "ar") : result.answer
    return NextResponse.json({ ...result, answer: refined, llm })
  } catch {
    const fallback = classifyIntent(q)
    return NextResponse.json({ ok: false, error: "فشل بناء الإجابة", intent: fallback.intent, confidence: fallback.confidence, answer: "تعذّر بناء الإجابة الآن.", sources: [], took: 0, llm: { available: false, runtime: null } }, { status: 200 })
  }
}
