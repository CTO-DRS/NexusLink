// NexusLink — رياضيات قياس الاقتران (عقد §30 — بند M1.1)
// ============================================================
// دالٌّ نقي مشترك المنطق (ويب/خادم/فحص) — بلا I/O ولا React:
//  · العتبة التعاقدية: من إصدار QR إلى أول قيمة أقل من 30 ثانية (M1.1).
//  · مئين أقرب-رتبة (nearest-rank) على سلسلة الأزمنة المكتملة.
//  · لقطة إحصائية موحدة تستهلكها اللوحة الحية وواجهة الهاتف والفحوص.

/** العتبة التعاقدية M1.1 — الاقتران الفوري الكامل (QR → أول قيمة) */
export const PAIR_TARGET_MS = 30_000

/** نوع أول قيمة بعد الاقتران — prod: أول حافظة/تسليم من جسر الإنتاجية · control: أول جلسة تحكم مقبولة */
export type PairFirstValueKind = "prod" | "control"

/** إدخال قياس اقتران واحد — بيانات وصفية حصرًا (لا محتوى — حرس F6 متوافق) */
export interface PairEntry {
  id: number
  deviceId: string
  deviceName: string
  /** إعادة تسجيل جهاز قائم بسر QR صحيح (نفس المسار التعاقدي) */
  reregister: boolean
  /** الزمن من إصدار آخر QR (الذي استُخدم حصرًا) إلى نجاح الاقتران */
  qrToPairMs: number
  /** الزمن من نجاح الاقتران إلى أول قيمة — null قبل اكتمال السلسلة */
  pairToFirstValueMs: number | null
  /** الإجمالي التعاقدي المقيس (QR → أول قيمة) — null قبل الاكتمال */
  totalMs: number | null
  firstValueKind: PairFirstValueKind | null
  /** العتبة مستوفاة؟ null قبل الاكتمال */
  pass: boolean | null
  at: number
}

/** مئين بأقرب رتبة على مصفوفة مصنفة تصاعديًا — دالٌّ نقي للفحص */
export function nearestRankPct(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length
  if (n === 0) return null
  const rank = Math.max(1, Math.ceil((p / 100) * n))
  return sortedAsc[Math.min(rank, n) - 1] ?? sortedAsc[n - 1]
}

export interface PairSnapshot {
  /** عدد الإدخالات المعروضة (المكتملة منهم هي عينة القياس) */
  n: number
  /** عدد السلاسل المكتملة (وصلت أول قيمة) */
  completed: number
  /** إجمالي آخر اقتران مكتمل */
  last: number | null
  avg: number | null
  p95: number | null
  max: number | null
  /** نسبة الاجتياز 0..1 على المكتملة */
  passRate: number | null
  /** كل المكتملة اجتازت العتبة (بحد أدنى 1) */
  pass: boolean
}

/** لقطة إحصائية من إدخالات خام (ترتيب التخزين: الأحدث أولًا) — دالٌّ نقي */
export function pairStats(entries: PairEntry[], minCompleted = 1): PairSnapshot {
  const done = entries.filter((e) => e.totalMs != null)
  const totals = done.map((e) => e.totalMs as number).sort((a, b) => a - b)
  const passCount = done.filter((e) => e.pass === true).length
  if (!done.length) {
    return { n: entries.length, completed: 0, last: null, avg: null, p95: null, max: null, passRate: null, pass: false }
  }
  // الأحدث زمنًا (أول إدخال مكتمل بترتيب التخزين) — لا الأكبر قيمة (مصنفة تصاعديًا)
  const newest = done.reduce((a, b) => (b.at > a.at ? b : a))
  const sum = totals.reduce((a, b) => a + b, 0)
  return {
    n: entries.length,
    completed: done.length,
    last: newest.totalMs,
    avg: Math.round(sum / totals.length),
    p95: nearestRankPct(totals, 95),
    max: totals[totals.length - 1] ?? null,
    passRate: done.length ? passCount / done.length : null,
    pass: passCount > 0 && passCount === done.length && done.length >= minCompleted,
  }
}
