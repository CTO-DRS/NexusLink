// NexusLink — محول النموذج المحلي للمساعد (عقد §33.ب — M2.1)
// ============================================================
// الكشف عن مُشغّل LLM محلي على نفس الجهاز + التصفية الاختيارية فوق الإجابة
// الحتمية. العقد الصارم: 127.0.0.1 حصرًا — أي عنوان خارجي مرفوض بالتصميم
// (بُنية بلا سحابة ولا حسابات: لا بايت واحد يغادر الجهاز). الكشف بمهلة قصيرة
// (600ms) وفشله غير خاطئ: المساعد يعمل بلا نموذج إطلاقًا (المحرك الحتمي).
// المُشغّلات المدعومة: Ollama (:11434) · llama.cpp server (:8080).

const PROBE_TIMEOUT_MS = 600
const LLM_TIMEOUT_MS = 4000

export type LlmRuntime = "ollama" | "llama.cpp" | null

export interface LlmStatus {
  available: boolean
  runtime: LlmRuntime
  /** اسم النموذج الأول المتاح (Ollama فقط) — للعرض لا للقرار. */
  model?: string
}

/** هل العنوان المحلي المسموح حصرًا؟ حرس النطاق — أي مضيف آخر يُرفض. */
function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]") && (u.protocol === "http:" || u.protocol === "https:")
  } catch {
    return false
  }
}

async function fetchLocal(url: string, timeoutMs: number): Promise<Response | null> {
  if (!isLocalhostUrl(url)) return null
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    const res = await fetch(url, { signal: ac.signal, cache: "no-store" })
    clearTimeout(t)
    return res
  } catch {
    return null
  }
}

/** كشف المُشغّل المحلي: Ollama أولًا (له قائمة نماذج) ثم llama.cpp. */
export async function probeLocalLlm(): Promise<LlmStatus> {
  const ollama = await fetchLocal("http://127.0.0.1:11434/api/tags", PROBE_TIMEOUT_MS)
  if (ollama?.ok) {
    try {
      const j = (await ollama.json()) as { models?: Array<{ name?: string }> }
      const model = j?.models?.[0]?.name
      return { available: true, runtime: "ollama", ...(model ? { model } : {}) }
    } catch { /* استجابة غير متوقعة — نعتبرها غير متاح */ }
  }
  const llama = await fetchLocal("http://127.0.0.1:8080/health", PROBE_TIMEOUT_MS)
  if (llama?.ok) return { available: true, runtime: "llama.cpp" }
  return { available: false, runtime: null }
}

/** إعادة الصياغة المحلية الاختيارية فوق الإجابة الحتمية — بلا اختراع حقائق:
 *  رسالة النظام تمنع تجاوز الحقائق، وفشل النموذج يعيد النص الأصلي بلا هلع. */
export async function llmRefine(status: LlmStatus, question: string, deterministicAnswer: string, lang: "ar" | "en"): Promise<string> {
  if (!status.available || !status.runtime) return deterministicAnswer
  try {
    const prompt = [
      lang === "ar"
        ? "أنت مساعد NexusLink المحلي. أعد صياغة الإجابة التالية بجملة أو جملتين واضحتين. ممنوع إضافة أي معلومة غير موجودة فيها. أعد النص فقط."
        : "You are NexusLink's local assistant. Rewrite the answer below in one or two clear sentences. Never add facts that are not in it. Return text only.",
      `Q: ${question}`,
      `A: ${deterministicAnswer}`,
    ].join("\n")
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS)
    let res: Response | null = null
    if (status.runtime === "ollama") {
      res = await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST", signal: ac.signal, cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: status.model || "llama3", prompt, stream: false }),
      })
    } else {
      res = await fetch("http://127.0.0.1:8080/completion", {
        method: "POST", signal: ac.signal, cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, n_predict: 128 }),
      })
    }
    clearTimeout(t)
    if (!res?.ok) return deterministicAnswer
    const j = (await res.json()) as { response?: string; content?: string }
    const text = (j?.response ?? j?.content ?? "").trim()
    return text.length > 8 ? text.slice(0, 600) : deterministicAnswer
  } catch {
    return deterministicAnswer
  }
}
