// عقد §55 — مولد PDF بالصور — صفر-اعتماد ومكتفٍ ذاتيًا (نمط §47: بايتات مكتوبة يدويًا)
// ============================================================
// PDF 1.4: كتالوج + صفحات + XObject صورة DCTDecode لكل صفحة — مرور JPEG
// نقيًا (بلا فك ضغط ولا إعادة ترميز) مع دوران بتحويل الإحداثيات (بلا فقد).
// مكتفٍ ذاتيًا حصرًا (درس المستودع: استيراد بلا امتداد يعمل في مجمّع Next
// ويكسر node الخام في الطور النقي للبوابات) — الأبعاد تُمرَّر من المنادي
// (الخادم يقرؤها من scan-core.jpegDimensions) والسحر يُفحص محليًا.
// التحويلات محسوبة هنا ومفحوصة نقية (وحدة الصورة [0,1]²):
//   r=0   : [w 0 0 h 0 0]          صندوق [0 0 w h]
//   r=90  : [0 w -h 0 h 0]         صندوق [0 0 h w]
//   r=180 : [-w 0 0 -h w h]        صندوق [0 0 w h]
//   r=270 : [0 -w h 0 0 w]         صندوق [0 0 h w]

export type PdfRotation = 0 | 90 | 180 | 270

export interface ScanPdfItem {
  bytes: Buffer
  rotate: PdfRotation
  w: number
  h: number
}

/** سحر JPEG محلي (FFD8FF) — الثقة بالترويسة كذب شائع يرفضه العقد */
function magicJpeg(b: Buffer): boolean {
  return Buffer.isBuffer(b) && b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
}

/** مصفوفة الوضع وصندوق الصفحة — نقية قابلة للفحص المباشر */
export function placeMatrix(rotate: PdfRotation, w: number, h: number): { m: [number, number, number, number, number, number]; pw: number; ph: number } {
  if (rotate === 90) return { m: [0, w, -h, 0, h, 0], pw: h, ph: w }
  if (rotate === 180) return { m: [-w, 0, 0, -h, w, h], pw: w, ph: h }
  if (rotate === 270) return { m: [0, -w, h, 0, 0, w], pw: h, ph: w }
  return { m: [w, 0, 0, h, 0, 0], pw: w, ph: h }
}

function pad10(n: number): string {
  return String(n).padStart(10, "0")
}

/**
 * بناء PDF من صفحات JPEG — الغريب (سحر سيئ أو أبعاد مبتورة) يُرفض بصدق
 * قبل الكتابة. يعيد بايتات PDF 1.4 كاملة بجدول xref وstartxref دقيقين.
 */
export function buildScanPdf(items: ScanPdfItem[]): { ok: true; pdf: Buffer } | { ok: false; error: string } {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "no-pages" }
  for (const it of items) {
    if (!magicJpeg(it.bytes)) return { ok: false, error: "not-jpeg" }
    if (!Number.isInteger(it.w) || !Number.isInteger(it.h) || it.w < 1 || it.h < 1) return { ok: false, error: "bad-dimensions" }
  }

  const chunks: Buffer[] = []
  const offsets: number[] = []
  let pos = 0
  const push = (s: string | Buffer) => {
    const buf = Buffer.isBuffer(s) ? s : Buffer.from(s, "binary")
    chunks.push(buf)
    pos += buf.length
  }
  const objStart = () => { offsets.push(pos) }

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")

  const N = items.length
  // الترقيم: 1 كتالوج · 2 صفحات · لكل صفحة i: (3+3i) صفحة، (4+3i) محتوى، (5+3i) صورة
  const pageObj = (i: number) => 3 + i * 3

  objStart()
  push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  objStart()
  const kids = Array.from({ length: N }, (_, i) => `${pageObj(i)} 0 R`).join(" ")
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${N} >>\nendobj\n`)

  for (let i = 0; i < N; i++) {
    const { bytes, rotate, w, h } = items[i]
    const { m, pw, ph } = placeMatrix(rotate, w, h)
    const imgObj = pageObj(i) + 2
    const contentObj = pageObj(i) + 1

    objStart()
    push(`${pageObj(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imgObj} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentObj} 0 R >>\nendobj\n`)
    const stream = `q ${m.join(" ")} cm /Im0 Do Q`
    objStart()
    push(`${contentObj} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`)
    objStart()
    push(`${imgObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`)
    push(bytes)
    push(`\nendstream\nendobj\n`)
  }

  const xrefAt = pos
  const count = 2 + N * 3 + 1
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${pad10(off)} 00000 n \n`
  xref += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  push(xref)

  return { ok: true, pdf: Buffer.concat(chunks) }
}
