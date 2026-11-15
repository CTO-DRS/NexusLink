// NexusLink — G7: رسائل أخطاء API العامة (لا تسريب مسارات داخلية ولا آثار مكدس)
// ------------------------------------------------------------------
// في الإنتاج لا تعبر رسالة استثناء إلى العميل إلا إن كانت قصيرة ونظيفة
// (رسائل تحقق كتبناها نحن مثل «مسار غير صالح»). أي رسالة تحمل مسار ملفات،
// أو رمز خطأ نظام (ENOENT…)، أو أثر مكدس، أو تفاصيل Prisma/SQLite،
// أو قيمة غير Error — تُستبدل بالرسالة العامة البديلة وتُسجَّل على الخادم فقط.
// في التطوير تبقى الرسالة كاملة لتسهيل التصحيح.

const INTERNAL_PATTERNS: RegExp[] = [
  /[A-Za-z]:\\/, // مسار ويندوز
  /(^|[\s'"(=:])\/(home|Users|usr|var|tmp|opt|root|etc|private|mnt|srv|app|workspace|proc|data|Volumes|Library|snap)(\/|\b)/,
  /node_modules/,
  /\.(ts|tsx|js|mjs|cjs|rs|node)(:\d+|\b)/,
  /\n\s*at\s/, // أثر مكدس
  /\bat\s+\S+\s+\(/,
  /\bE[A-Z]{3,}\b/, // ENOENT · EACCES · EPERM · EISDIR…
  /prisma/i,
  /sqlite/i,
  /\bstack\b/i,
]

export const GENERIC_ERROR = "خطأ داخلي"

export function isPublicSafeMessage(msg: string): boolean {
  if (!msg || msg.length > 200) return false
  return !INTERNAL_PATTERNS.some((re) => re.test(msg))
}

/**
 * الرسالة التي يجوز إعادتها للعميل. في الإنتاج: رسالة Error النظيفة أو البديل العام.
 */
export function publicErrorMessage(e: unknown, fallback: string = GENERIC_ERROR): string {
  const msg = e instanceof Error ? e.message : ""
  if (process.env.NODE_ENV !== "production") {
    return msg || (typeof e === "string" ? e : fallback)
  }
  if (msg && isPublicSafeMessage(msg)) return msg
  try {
    console.error("[api-error]", e)
  } catch { /* ignore */ }
  return fallback
}
