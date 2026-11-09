// عقد §61 — اشتقاق صفحة الماسح عند الختم (رمادي محسّن / أبيض وأسود بعتبة)
// ============================================================
// إغلاق الحد المعلن من §55 «بلا معالجة صور» بحد جديد صادق: المعالجة
// اختيارية لكل صفحة وتُطبَّق عند الختم حصرًا في الذاكرة — ملف الصفحة
// الأصلي على القرص لا يُمس بايتيًا، ومرور §55 النقي يبقى المسار الافتراضي
// (filter="none"). sharp اعتمادية قائمة (thumb · sync-engine) — صفر
// اعتماديات جديدة، والاستيراد ديناميكي (نمط sync-engine).
// الفاشل يُصطاد قبل أي sharp (التحقق النقي أولًا — نمط §60) والناتج JPEG
// سليم السحر والأبعاد حصرًا وضمن سقف الصفحة نفسه (12MB) وإلا رفض صادق.
import {
  isScanFilter, isValidThreshold, jpegDimensions,
  SCAN_PAGE_MAX_BYTES, SCAN_THR_DEFAULT,
  type ScanFilter,
} from "./scan-core"

export type DeriveFilter = Exclude<ScanFilter, "none">

export interface DerivedPage {
  bytes: Buffer
  w: number
  h: number
}

/** تحقق مبكر نقي — يُستدعى قبل أي sharp (اصطياد الفاسد قبل العمل الثقيل) */
export function validateDeriveArgs(
  filter: unknown, thr?: unknown,
): { ok: true; f: DeriveFilter } | { ok: false; error: string } {
  if (!isScanFilter(filter) || filter === "none") return { ok: false, error: "bad-filter" }
  if (thr !== undefined && !isValidThreshold(thr)) return { ok: false, error: "bad-threshold" }
  return { ok: true, f: filter as DeriveFilter }
}

/**
 * اشتقاق بايتات JPEG معالَجة من صفحة أصلية — الأصل لا يُمس والناتج يُفحص
 * بالسحر والأبعاد قبل العودة (الثقة بالترويسة كذب شائع يرفضه العقد).
 * gray: رمادي + تمدد تباين كامل (normalise) — bw: رمادي + عتبة صريحة.
 */
export async function deriveScanPage(
  bytes: Buffer, filter: unknown, thr?: unknown,
): Promise<{ ok: true; page: DerivedPage } | { ok: false; error: string }> {
  const v = validateDeriveArgs(filter, thr)
  if (!v.ok) return v
  if (!jpegDimensions(bytes)) return { ok: false, error: "bad-dimensions" }
  try {
    const sharp = (await import("sharp")).default
    let img = sharp(bytes).grayscale().normalise()
    if (v.f === "bw") img = img.threshold(thr === undefined ? SCAN_THR_DEFAULT : (thr as number))
    const out: Buffer = await img.jpeg({ quality: 88 }).toBuffer()
    if (out.length > SCAN_PAGE_MAX_BYTES) return { ok: false, error: "derived-too-large" }
    const d = jpegDimensions(out)
    if (!d) return { ok: false, error: "derive-failed" }
    return { ok: true, page: { bytes: out, w: d.w, h: d.h } }
  } catch {
    return { ok: false, error: "derive-failed" }
  }
}
