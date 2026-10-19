// NexusLink — سجل العمليات القابل للاستئناف (M1.2 offline-first — عقد §28)
// ============================================================
// كل طفرة إنتاجية (حافظة/تسليم) تُرسَّخ بتسلسل رتيب صاعد قبل بثّها الحي —
// فأي عميل انقطع ثم عاد يستأنف من مؤشره الأخير (prod:resume since) ويستلم
// ما فاته بالترتيب (prod:replay) ثم يقر (prod:ack) فيُقصَّ ما قُرئ.
// التخزين: جدول ProdOpLog بنمط الترقية الآمنة §23 (CREATE TABLE IF NOT EXISTS).
import { db, dbReady } from "@/lib/db"

export interface ProdOp {
  seq: number
  opId: string
  kind: string
  deviceId: string
  payload: Record<string, unknown>
  at: number
}

/** سقف الدفعة الواحدة عند الاستئناف — العميل يستأنف بالمؤشر الأخير إن قُطعت */
export const REPLAY_LIMIT = 200
/** أرضية الاحتفاظ: لا يُقصّ شيء أحدث من (الرأس − 400) حتى يستأنف الجديد */
export const KEEP_FLOOR = 400
/** سقف صلب للجدول: فوقه يُقصّ الأقدم (حماية نمو بلا نهاية عبر الجلسات) */
const HARD_CAP = 2000

/** رأس السجل: أكبر seq حي (0 = سجل فارغ) */
export async function headSeq(): Promise<number> {
  await dbReady
  try {
    const rows = await db.$queryRawUnsafe<{ m: number | bigint | null }[]>(
      `SELECT MAX("seq") AS m FROM "ProdOpLog"`,
    )
    return Number(rows?.[0]?.m ?? 0)
  } catch {
    return 0
  }
}

/** ترسيخ عملية جديدة — يعيد seq (أو 0 إن كان opId مكررًا: العملية idempotent حسب التصميم) */
export async function appendOp(
  kind: string,
  opId: string,
  deviceId: string,
  payload: Record<string, unknown>,
): Promise<number> {
  await dbReady
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "ProdOpLog" ("opId","kind","deviceId","payload","at") VALUES (?,?,?,?,?)`,
      opId,
      kind,
      deviceId,
      JSON.stringify(payload ?? {}),
      new Date(),
    )
    void capTotal()
    const rows = await db.$queryRawUnsafe<{ seq: number | bigint }[]>(
      `SELECT "seq" FROM "ProdOpLog" WHERE "opId" = ?`,
      opId,
    )
    return Number(rows?.[0]?.seq ?? 0)
  } catch {
    return 0 // تعارض UNIQUE (إعادة فتح رابط مثلًا) = لا عملية جديدة — إلغاء صامت مقصود
  }
}

/** العمليات بعد مؤشر معيّن بترتيب صاعد — دفعة واحدة بسقف REPLAY_LIMIT */
export async function opsSince(since: number, limit = REPLAY_LIMIT): Promise<ProdOp[]> {
  await dbReady
  try {
    const s = Math.max(0, Math.floor(Number(since) || 0))
    const rows = await db.$queryRawUnsafe<
      { seq: number | bigint; opId: string; kind: string; deviceId: string; payload: string; at: number | Date }[]
    >(
      `SELECT "seq","opId","kind","deviceId","payload","at" FROM "ProdOpLog"
       WHERE "seq" > ? ORDER BY "seq" ASC LIMIT ?`,
      s,
      Math.max(1, Math.min(1000, Math.floor(limit))),
    )
    return (rows ?? []).map((r) => {
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(String(r.payload)) as Record<string, unknown>
      } catch {
        payload = {}
      }
      const at = r.at instanceof Date ? r.at.getTime() : Number(r.at) || 0
      return { seq: Number(r.seq), opId: String(r.opId), kind: String(r.kind), deviceId: String(r.deviceId), payload, at }
    })
  } catch {
    return []
  }
}

/** قر العميل: قصّ ما قُرئ فوق أرضية الاحتفاظ حصرًا — يعيد عدد الصفوف المقصوصة */
export async function ackUpto(upto: number): Promise<number> {
  await dbReady
  try {
    const head = await headSeq()
    const eff = Math.min(Math.max(0, Math.floor(Number(upto) || 0)), head - KEEP_FLOOR)
    if (eff <= 0) return 0
    const res = await db.$executeRawUnsafe(`DELETE FROM "ProdOpLog" WHERE "seq" <= ?`, eff)
    return Number(res)
  } catch {
    return 0
  }
}

/** سقف صلب: قصّ الأقدم فوق HARD_CAP (يُستدعى بعد كل ترسيخ — إطفائي) */
async function capTotal(): Promise<void> {
  try {
    const head = await headSeq()
    const eff = head - HARD_CAP
    if (eff > 0) await db.$executeRawUnsafe(`DELETE FROM "ProdOpLog" WHERE "seq" <= ?`, eff)
  } catch {
    /* إطفائي حصرًا */
  }
}
