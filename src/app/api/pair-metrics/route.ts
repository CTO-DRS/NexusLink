import { NextResponse } from "next/server"
import { listPairMetrics } from "@/lib/nexus/pair-metrics"
import { pairStats, PAIR_TARGET_MS } from "@/lib/pair-math"

export const dynamic = "force-dynamic"

/** قياس الاقتران الفوري (عقد §30 — M1.1): بيانات وصفية حصرًا
 *  (أرقام وأزمنة وأسماء — لا محتوى أبدًا، حرس F6 متوافق) بمستوى
 *  كشف مساوٍ لواجهة الأجهزة القائمة (REST عبر 3000). */
export async function GET() {
  try {
    const entries = await listPairMetrics(50)
    return NextResponse.json({
      ok: true,
      targetMs: PAIR_TARGET_MS,
      stats: pairStats(entries),
      entries,
    })
  } catch {
    return NextResponse.json(
      { ok: false, targetMs: PAIR_TARGET_MS, stats: pairStats([]), entries: [] },
      { status: 200 },
    )
  }
}
