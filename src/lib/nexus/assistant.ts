// NexusLink — المساعد على الجهاز (عقد §33.ب — M2.1)
// ============================================================
// مساعد يفهرس الأجهزة والملفات والروتينات — بلا مغادرة أي بايت:
//  - NLU حتمي (تصنيف نوايا بكلمات مفتاحية عربية/إنجليزية + درجات) يعمل بلا
//    أي نموذج إطلاقًا: status · find · suggest · explain · help.
//  - الإجابات تُبنى من المخازن المحلية القائمة حصرًا (سجل الأجهزة · القواعد
//    المرسوخة · الإطلاقات · عينات الصحة · سجل العمليات) — وكل إجابة تصرّح
//    بمصادرها (بذليل مسبب — ربط §33.ج).
//  - إن وُجد مُشغّل LLM محلي (Ollama/llama.cpp — §33.ب) تُعاد صياغة الإجابة
//    محليًا فوق النص الحتمي نفسه — بلا اختراع حقائق وفشله غير خاطئ.
// استعلام الفهرسة الوظيفي: نفس نواة البحث الموحد (searchAll — §33.أ) للنية
// find — فالمساعد والبحث مصدر واحد للحقائق لا مسارَين متوازيين.
import { db, dbReady } from "../db"
import { store } from "./devices"
import { searchAll } from "./intel-search"
import { automationBridgeStatus } from "./automation-bridge"
import type { LlmStatus } from "./assistant-llm"

export type AssistantIntent = "status" | "find" | "suggest" | "explain" | "help"

export interface AssistantSource {
  kind: string
  label: string
  count: number
}

export interface AssistantResult {
  ok: boolean
  intent: AssistantIntent
  confidence: number
  answer: string
  sources: AssistantSource[]
  took: number
  llm: LlmStatus
}

/** قاموس النوايا: كلمات مفتاحية بوزن — العربية والإنجليزية معًا (المنتج
 *  ثنائي اللغة بأدنى تعقيد: لا محلل صرفي — تطابق جزئي آمن بالطول ≥ 3). */
const INTENT_KEYWORDS: Record<AssistantIntent, Array<[string, number]>> = {
  status: [["حالة", 3], ["الجهاز", 2], ["الأجهزة", 3], ["بطارية", 2], ["متصل", 2], ["status", 3], ["battery", 2], ["devices", 3], ["connected", 2]],
  find: [["ابحث", 3], ["أين", 3], ["جدة", 0], ["أعثر", 3], ["بحث", 3], ["find", 3], ["search", 3], ["where", 3]],
  suggest: [["اقترح", 3], ["روتين", 3], ["أتمتة", 2], ["أوتومات", 2], ["suggest", 3], ["routine", 3], ["automate", 3]],
  explain: [["لماذا", 3], ["اسباب", 3], ["أسباب", 3], ["فسّر", 3], ["فسر", 3], ["تنبيه", 2], ["explain", 3], ["why", 3], ["alert", 2]],
  help: [["مساعدة", 3], ["ماذا تستطيع", 3], ["كيف", 1], ["help", 3], ["how", 1]],
}

/** تصنيف النية — حتمي قابل للاختبار بلا أي نموذج: أعلى مجموع أوزان يفوز،
 *  والتعادل/الصفر → help. الدقة = أعلى مجموع ÷ 3 مقيدة بـ 1. */
export function classifyIntent(q: string): { intent: AssistantIntent; confidence: number } {
  const s = q.toLowerCase()
  const scores = new Map<AssistantIntent, number>()
  for (const [intent, kws] of Object.entries(INTENT_KEYWORDS) as Array<[AssistantIntent, Array<[string, number]>]>) {
    let sum = 0
    for (const [kw, w] of kws) {
      if (!kw) continue
      if (s.includes(kw)) sum += w
    }
    scores.set(intent, sum)
  }
  let best: AssistantIntent = "help"
  let bestScore = 0
  for (const [intent, sc] of scores) {
    if (sc > bestScore) { best = intent; bestScore = sc }
  }
  return { intent: best, confidence: Math.min(1, bestScore / 3) }
}

/** جملة الدليل التفسيري للإطلاقات — نفس البادئة التعاقدية «الدليل:» (§33.ج). */
function reasonOfDetail(detail: string): string | null {
  const i = detail.indexOf("الدليل:")
  return i >= 0 ? detail.slice(i + "الدليل:".length).trim() : null
}

async function buildStatusAnswer(): Promise<{ answer: string; sources: AssistantSource[] }> {
  const devs = store().devices
  const connected = devs.filter((d) => d.state === "connected")
  const lowBatt = devs.filter((d) => typeof d.battery === "number" && d.battery <= 20)
  const lines: string[] = []
  lines.push(`لديك ${devs.length} أجهزة متابعة، منها ${connected.length} متصل الآن: ${connected.map((d) => d.name).join("، ") || "لا شيء"}.`)
  if (lowBatt.length) lines.push(`تنبيه: بطارية منخفضة (≤ 20%) لدى: ${lowBatt.map((d) => `${d.name} (${d.battery}%)`).join("، ")}.`)
  try {
    await dbReady
    const ops = await db.prodOpLog.count()
    const fires = await db.nexusAutomationFire.count()
    lines.push(`سجل العمليات يضم ${ops} عملية مرسوخة، وسجل الروتينات ${fires} إطلاقًا.`)
  } catch { /* القاعدة غير جاهزة — نكتفي بحالة الأجهزة */ }
  return {
    answer: lines.join(" "),
    sources: [
      { kind: "devices", label: "سجل الأجهزة", count: devs.length },
      { kind: "oplog", label: "سجل العمليات", count: -1 },
      { kind: "fires", label: "سجل الإطلاقات", count: -1 },
    ],
  }
}

async function buildFindAnswer(q: string): Promise<{ answer: string; sources: AssistantSource[] }> {
  // تجريد كلمات النية من السؤال — البحث بالمعنى لا بالجملة كاملة
  const stripped = q.replace(/^(\s*(?:ابحث\s*(?:عن|في)?|أعثر\s*(?:على|عن)?|أين|find|search\s*(?:for)?|where\s*(?:is)?)\s*)/i, "").trim()
  const res = await searchAll(stripped || q)
  const shown: string[] = []
  for (const g of res.groups.slice(0, 3)) {
    shown.push(`${g.label}: ${g.items.slice(0, 3).map((i) => `«${i.title}»`).join("، ")}`)
  }
  const answer = res.total
    ? `وجدت ${res.total} نتيجة خلال ${res.took}ms — ${shown.join(" · ")}.`
    : `لا نتائج لـ«${stripped || q}» في الفهرس المحلي (الأجهزة، الروتينات، الحافظة، الرسائل، الملفات المتزامنة).`
  return {
    answer,
    sources: res.groups.map((g) => ({ kind: g.kind, label: g.label, count: g.items.length })),
  }
}

async function buildSuggestAnswer(): Promise<{ answer: string; sources: AssistantSource[] }> {
  // اقتراحات من التاريخ المحلي الحقيقي — لا قوالب جاهزة بلا دليل:
  //  (أ) إطلاقات بطارية متكررة → روتين بطارية مستمر · (ب) جهاز صامت كثيرًا
  //  → روتين صمت · (ج) لا إطلاقات بعد → دعوة لإنشاء أول روتين من المحرر.
  try {
    await dbReady
    const batteryFires = await db.nexusAutomationFire.count({ where: { ruleName: { contains: "بطارية" } } })
    const silenceFires = await db.nexusAutomationFire.count({ where: { detail: { contains: "صمت" } } })
    const rules = await db.nexusAutomationRule.count()
    const parts: string[] = []
    if (batteryFires > 0) parts.push(`سجّل الروتينات ${batteryFires} إطلاقًا لتنبيهات البطارية — اقتراح: روتين تاريخي مركب «بطارية ≤ 15% لمدة ساعة والجهاز غير متصل» (§33.ج) لرنين الهاتف قبل النفاد.`)
    if (silenceFires > 0) parts.push(`لوحظ ${silenceFires} تنبيه صمت جهاز — اقتراح: روتين «لا عينات صحة لمدة 30 دقيقة» ليخبرك مبكرًا.`)
    if (!parts.length) parts.push(rules ? "لا نمط تكرار واضح في الإطلاقات بعد — فعّل الروتينات التاريخية ودعها تجمع تاريخًا لأسبوع ثم اسألني مجددًا." : "لا قواعد بعد — ابدأ بروتين «بطارية جهاز منخفضة» من عرض الروتينات، وسيبني التاريخ اقتراحات أعمق لاحقًا.")
    return { answer: parts.join(" "), sources: [{ kind: "fires", label: "سجل الإطلاقات", count: batteryFires + silenceFires }] }
  } catch {
    return { answer: "فهرس الروتينات غير جاهز بعد — أعد المحاولة بعد إقلاع الخدمات.", sources: [] }
  }
}

async function buildExplainAnswer(): Promise<{ answer: string; sources: AssistantSource[] }> {
  try {
    await dbReady
    const last = await db.nexusAutomationFire.findFirst({ orderBy: { at: "desc" } })
    if (!last) return { answer: "لا تنبيهات بعد في السجل المرسوخ — عندما تُطلق روتيناتك سأشرح سبب كل تنبيه بدليله (عدد العينات ومدة الاستمرار).", sources: [] }
    const reason = reasonOfDetail(last.detail)
    const when = new Date(last.at).toLocaleString("ar")
    const answer = reason
      ? `آخر تنبيه «${last.ruleName}» (${when}): ${reason}.`
      : `آخر تنبيه «${last.ruleName}» (${when}) — ${last.detail} (لا دليل تاريخي مرفق: روتين لحظي لا تاريخي).`
    return { answer, sources: [{ kind: "fires", label: "سجل الإطلاقات", count: 1 }] }
  } catch {
    return { answer: "سجل الإطلاقات غير جاهز بعد.", sources: [] }
  }
}

function buildHelpAnswer(): { answer: string; sources: AssistantSource[] } {
  return {
    answer: "أنا مساعد NexusLink المحلي — أعمل كاملًا على جهازك بلا سحابة. اسألني: «ما حالة الأجهزة؟» · «ابحث عن تقرير» · «اقترح روتينًا» · «لماذا آخر تنبيه؟». فهري من سجل الأجهزة والروتينات والحافظة والرسائل والملفات المتزامنة.",
    sources: [],
  }
}

/** بناء الإجابة الحتمية كاملة — النواة القابلة للاختبار. */
export async function buildAnswer(qRaw: string): Promise<AssistantResult> {
  const t0 = Date.now()
  const q = qRaw.trim().slice(0, 300)
  const { intent, confidence } = classifyIntent(q)
  let built: { answer: string; sources: AssistantSource[] }
  switch (intent) {
    case "status": built = await buildStatusAnswer(); break
    case "find": built = await buildFindAnswer(q); break
    case "suggest": built = await buildSuggestAnswer(); break
    case "explain": built = await buildExplainAnswer(); break
    default: built = buildHelpAnswer(); break
  }
  return {
    ok: true, intent, confidence, answer: built.answer, sources: built.sources,
    took: Date.now() - t0,
    llm: { available: false, runtime: null }, // يُستكمل بعد الكشف في مسار الـAPI
  }
}

/** عدّادات الفهرس للتشخيص — بيانات وصفية حصرًا (حرس F6 متوافق). */
export async function assistantIndexStats() {
  try {
    await dbReady
    const [rules, fires, ops, samples] = await Promise.all([
      db.nexusAutomationRule.count(),
      db.nexusAutomationFire.count(),
      db.prodOpLog.count(),
      db.nexusHealthSample.count(),
    ])
    return { rules, fires, ops, samples, devices: store().devices.length, booted: automationBridgeStatus().booted }
  } catch {
    return { rules: 0, fires: 0, ops: 0, samples: 0, devices: 0, booted: false }
  }
}
