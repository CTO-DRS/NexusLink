// NexusLink — ناقل حقائق الروتينات داخل عملية Next (عقد §26)
// ============================================================
// جسور عملية Next الواحدة تنشر حقائقها هنا (حاليًا: prod ينشر clip.received)
// ويستهلكها جسر الروتينات :3008. ناقل داخل العملية فقط — لا يغير أي بروتوكول
// سلكي قائم، ولا يعتمد على شبكة.

export type AutomationFact =
  | {
      kind: "clip.received"
      deviceId?: string
      deviceName?: string
      clipKind?: string
      at: number
    }

export type FactListener = (f: AutomationFact) => void

const g = globalThis as unknown as { __nexusAutoFacts?: FactListener[] }

function listeners(): FactListener[] {
  if (!g.__nexusAutoFacts) g.__nexusAutoFacts = []
  return g.__nexusAutoFacts
}

/** نشر حقيقة من أي جسر داخل العملية (آمن مع عدم وجود مستهلكين). */
export function emitAutomationFact(f: AutomationFact): void {
  for (const l of listeners()) {
    try { l(f) } catch { /* مستهلك معطوب لا يعطّل الناشر */ }
  }
}

/** اشتراك جسر الروتينات — يعيد دالة إلغاء الاشتراك. */
export function onAutomationFact(l: FactListener): () => void {
  listeners().push(l)
  return () => {
    const i = listeners().indexOf(l)
    if (i >= 0) listeners().splice(i, 1)
  }
}
