// NexusLink — سجل قياس الاقتران (عقد §30 — بند M1.1)
// ============================================================
// التسييل الزمني التعاقدي: QR (t0 — pairingIssuedAt للسر المطابَق حصرًا)
//   → نجاح الاقتران (t1 — ختم عند pair ok) → أول قيمة (t2 — ختم عند أول
//   حافظة/تسليم من جسر الإنتاجية أو أول جلسة تحكم مقبولة لنفس الجهاز).
// الترسيخ SQLite (جدول PairMetric — ضمان بنمط §28 الآمن) لأن القياس
// مؤسسي يبقى مرجعًا بعد إعادة التشغيل (روح «99.9% أسبوعيًا»).
// حرس F6 متوافق بالتصميم: أرقام وأزمنة وأسماء حصرًا — لا محتوى أبدًا،
// والقراءة REST عبر 3000 (سطح ثقة الجهاز المحلي — حد §13 الصادق).
import { db } from "@/lib/db"
import { PAIR_TARGET_MS, type PairEntry, type PairFirstValueKind } from "@/lib/pair-math"

/** نافذة البحث عن الإدخال المعلق عند ختم أول قيمة — نفس نافذة سر الاقتران */
const PENDING_WINDOW_MS = 10 * 60_000

function rowToEntry(r: {
  id: number; deviceId: string; deviceName: string; reregister: boolean
  qrToPairMs: number; pairToFirstValueMs: number | null; totalMs: number | null
  firstValueKind: string | null; pass: boolean | null; at: Date
}): PairEntry {
  return {
    id: r.id,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    reregister: r.reregister,
    qrToPairMs: r.qrToPairMs,
    pairToFirstValueMs: r.pairToFirstValueMs,
    totalMs: r.totalMs,
    firstValueKind: (r.firstValueKind as PairFirstValueKind | null) ?? null,
    pass: r.pass,
    at: new Date(r.at).getTime(),
  }
}

/** t1 — يُستدعى من مسار pair بعد نجاح التحقق (جديد أو إعادة تسجيل) */
export async function recordPairMetric(d: {
  deviceId: string; deviceName: string; qrToPairMs: number; reregister: boolean
}): Promise<void> {
  try {
    const qrToPairMs = Math.max(0, Math.round(d.qrToPairMs))
    await db.pairMetric.create({
      data: {
        deviceId: d.deviceId.slice(0, 120),
        deviceName: d.deviceName.slice(0, 120),
        reregister: d.reregister,
        qrToPairMs,
        at: new Date(),
      },
    })
  } catch {
    // القياس لا يعطل الاقتران أبدًا — فشل الترسيخ صامت مقصود
  }
}

/** t2 — يُستدعى من الجسور عند أول قيمة (prod) أو أول جلسة تحكم مقبولة (control) —
 *  يكمل أحدث إدخال معلق لهذا الجهاز داخل نافذة سر الاقتران؛ بلا معلق = تجاهل. */
export async function markFirstValue(deviceId: string, kind: PairFirstValueKind): Promise<void> {
  try {
    const id = String(deviceId ?? "").trim().slice(0, 120)
    if (!id) return
    const pending = await db.pairMetric.findFirst({
      where: {
        deviceId: id,
        pairToFirstValueMs: null,
        at: { gte: new Date(Date.now() - PENDING_WINDOW_MS) },
      },
      orderBy: { at: "desc" },
    })
    if (!pending) return
    const now = Date.now()
    const pairToFirstValueMs = Math.max(0, now - new Date(pending.at).getTime())
    const totalMs = pending.qrToPairMs + pairToFirstValueMs
    await db.pairMetric.update({
      where: { id: pending.id },
      data: { pairToFirstValueMs, totalMs, firstValueKind: kind, pass: totalMs < PAIR_TARGET_MS },
    })
  } catch {
    // القياس لا يعطل تدفق القيم أبدًا
  }
}

/** قراءة السجل للوحة الحية — الأحدث أولًا */
export async function listPairMetrics(limit = 50): Promise<PairEntry[]> {
  const rows = await db.pairMetric.findMany({ orderBy: { at: "desc" }, take: Math.min(limit, 200) })
  return rows.map(rowToEntry)
}
