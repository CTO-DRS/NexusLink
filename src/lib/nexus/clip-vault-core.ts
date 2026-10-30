// عقد §50 — خزنة الحافظة الذكية (CLIP-VAULT) — النواة النقية (بلا إدخال/إخراج)
// ============================================================
// الخندق التنافسي: #1 الخصوصية المعمارية (التصنيف والإخفاء محلي حصرًا — لا بايت
// يغادر ليعرف إن كان المحتوى حساسًا) + #3 محرك التاريخ التراكمي.
// مقابل المنافسين مباشرة:
//  - Win+V: سجل نظام بلا تصنيف حساسية ولا انتهاء صلاحية ولا بحث مرتب.
//  - Pushbullet Universal Copy: سحابي بحساب — المحتوى يمر بوسيط لا يملكه المستخدم.
//  - KDE Connect: حافظة لحظية أخيرة فقط — بلا خزنة ولا حساسية ولا مؤقت.
// هنا: تصنيف حتمي (OTP/كلمة سر/بطاقة/آيبان/رمز وصول) + إخفاء تلقائي مع كشف
// مقصود مُدقَّق + انتهاء صلاحية (الحساس 15 دقيقة، العادي 7 أيام، المثبت لا ينتهي)
// + لصق مؤقت يختفي + بحث مرتب (بادئة > احتواء > تسلسل — دلالات §33.أ).
//
// حدود صادقة (§50.حدود):
//  - التصنيف حتمي بالأنماط — لا يوكّل ذكاءً عامًا، وقد يفوّت أنماطًا غير معيارية.
//  - الإخفاء على طبقة العرض والواجهة — من يملك الوصول للقاعدة الخام يرى كل شيء
//    (نفس حدود أي تطبيق سجل محلي؛ التشفير الكامل للخزنة عمل لاحق معلن).
//  - الفحص نصي حصرًا: الصور والملفات لا تُصنَّف حساسية.

export type ClipSensitivity = "otp" | "password" | "card" | "iban" | "token"

export const SENSITIVE_TTL_MS = 15 * 60_000 // الحساس: 15 دقيقة حصرًا
export const NORMAL_TTL_MS = 7 * 86_400_000 // العادي: 7 أيام
export const MAX_EPHEMERAL_MS = 24 * 3600_000 // سقف «اللصق المؤقت» اليدوي: 24 ساعة

/** Luhn — التحقق الحتمي من أرقام البطاقات (يمنع الإيجابيات الكاذبة لأي رقم طويل) */
export function luhnValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

const TOKEN_PATTERNS: RegExp[] = [
  /\bghp_[A-Za-z0-9]{20,}/, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/, // GitHub fine-grained
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI-like
  /\bAKIA[A-Z0-9]{12,}/, // AWS
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack
  /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/, // مفاتيح خاصة
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
]

/** تصنيف الحساسية حتمي — الأولوية: رمز > بطاقة > آيبان > كلمة سر > OTP */
export function classifyClip(text: string): { sensitive: ClipSensitivity | null; tags: string[] } {
  if (typeof text !== "string" || text.length === 0) return { sensitive: null, tags: [] }
  const tags: string[] = []
  for (const re of TOKEN_PATTERNS) {
    if (re.test(text)) {
      tags.push("sensitive", "token")
      return { sensitive: "token", tags }
    }
  }
  // بطاقة: مجموعات أرقام 13–19 مع فواصل اختيارية + Luhn
  const digitRuns = text.replace(/[\s-]/g, "")
  if (/^\d{13,19}$/.test(digitRuns) && luhnValid(digitRuns)) {
    tags.push("sensitive", "card")
    return { sensitive: "card", tags }
  }
  // آيبان: حرفان + رقمين + 10–30 محرفًا أبجدي-رقمي
  if (/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/.test(text)) {
    tags.push("sensitive", "iban")
    return { sensitive: "iban", tags }
  }
  // كلمة سر: تسمية صريحة بقيمة
  if (/(pass(word)?|pwd|pwd1|كلمة\s*(ال)?(مرور|سر))\s*[:=]\s*\S+/i.test(text)) {
    tags.push("sensitive", "password")
    return { sensitive: "password", tags }
  }
  // OTP: أرقام قائمة 4–8 في نص قصير بلا كلمات طويلة (يمنع الأرقام العادية)
  const trimmed = text.trim()
  if (trimmed.length <= 32 && /\b\d{4,8}\b/.test(trimmed) && !/[A-Za-z\u0600-\u06FF]{5,}/.test(trimmed)) {
    tags.push("sensitive", "otp")
    return { sensitive: "otp", tags }
  }
  return { sensitive: null, tags }
}

/** الإخفاء — يُستخدم في العرض والقوائم؛ الكشف الكامل عبر مسار مقصود مُدقَّق */
export function maskClip(text: string, sensitive: ClipSensitivity | null): string {
  if (!sensitive || typeof text !== "string") return text
  if (sensitive === "otp") {
    const m = text.match(/\b(\d{4,8})\b/)
    const n = m ? m[1].length : 6
    return "•".repeat(n)
  }
  if (sensitive === "card") {
    const digits = text.replace(/[\s-]/g, "")
    if (digits.length < 8) return "•".repeat(digits.length || 12)
    return `${digits.slice(0, 4)} •••• •••• ${digits.slice(-4)}`
  }
  if (sensitive === "iban") {
    const m = text.match(/\b([A-Z]{2}\d{2})[A-Z0-9]{10,30}\b/)
    if (!m) return "••••••••"
    return `${m[1]} •••• •••• ${text.replace(/\s/g, "").slice(-4)}`
  }
  // password/token — أول اثنين وآخر اثنين إن طال، وإلا نقاط حصرًا
  if (text.length > 8) return `${text.slice(0, 2)}••••••${text.slice(-2)}`
  return "•".repeat(Math.max(text.length, 6))
}

/**
 * سياسة الانتهاء (§50.و):
 *  - المثبت (pinned) → null (لا ينتهي أبدًا) — القرار يدوي صريح.
 *  - «اللصق المؤقت» (expiresAtFrom المُعطى من العميل) → يُثبَّت سقفه بـ
 *    MAX_EPHEMERAL_MS ويُحتكم في الماضي فورًا — لا يطيل أبدًا فوق السقف.
 *  - الحساس → createdAt + SENSITIVE_TTL_MS (15 دقيقة) — الأمان يفوق الرغبة.
 *  - العادي → createdAt + NORMAL_TTL_MS (7 أيام).
 * المُرجع: ms مطلق للانتهاء أو null لعدم الانتهاء.
 */
export function retentionAt(opts: {
  sensitive: ClipSensitivity | null
  pinned: boolean
  createdAtMs: number
  nowMs: number
  expiresAtFrom?: number | null
}): number | null {
  if (opts.pinned) return null
  if (typeof opts.expiresAtFrom === "number" && Number.isFinite(opts.expiresAtFrom)) {
    const ceiling = opts.createdAtMs + MAX_EPHEMERAL_MS
    return Math.max(opts.createdAtMs, Math.min(opts.expiresAtFrom, ceiling))
  }
  if (opts.sensitive) return opts.createdAtMs + SENSITIVE_TTL_MS
  return opts.createdAtMs + NORMAL_TTL_MS
}

/** بحث الخزنة — دلالات §33.أ: بادئة > احتواء > تسلسل، سقف النتائج 8 */
export function searchClips<T extends { content: string; fileName?: string | null }>(
  items: T[],
  q: string,
  limit = 8,
): Array<T & { score: number }> {
  const query = String(q ?? "").trim().toLowerCase()
  if (!query) return []
  const out: Array<T & { score: number }> = []
  for (const it of items) {
    const contentLower = String(it.content ?? "").toLowerCase()
    const fileLower = String(it.fileName ?? "").toLowerCase()
    let score = 0
    if (contentLower.startsWith(query) || fileLower.startsWith(query)) score = 3
    else if (contentLower.includes(query) || fileLower.includes(query)) score = 2
    else {
      // تسلسل محارف متتالية كسلسلة فرعية مرنة (حروف بكلمات مختلفة)
      const hay = fileLower ? `${fileLower}\n${contentLower}` : contentLower
      let qi = 0
      for (let i = 0; i < hay.length && qi < query.length; i++) {
        if (hay[i] === query[qi]) qi++
      }
      if (qi === query.length) score = 1
    }
    if (score > 0) out.push({ ...it, score })
  }
  out.sort((a, b) => b.score - a.score || String(b.content).length - String(a.content).length)
  return out.slice(0, limit)
}

/** إحصاء الخزنة للواجهة — أرقام حصرًا (حرس F6 متوافق) */
export function vaultStats(
  items: Array<{ sensitive?: string | null; pinned?: boolean; kind: string; expiresAt?: Date | number | null }>,
  nowMs: number,
): { total: number; pinned: number; sensitive: number; expiring24h: number; byKind: Record<string, number> } {
  let pinned = 0
  let sensitive = 0
  let expiring24h = 0
  const byKind: Record<string, number> = {}
  for (const it of items) {
    byKind[it.kind] = (byKind[it.kind] ?? 0) + 1
    if (it.pinned) pinned++
    if (it.sensitive) sensitive++
    if (it.expiresAt && !it.pinned) {
      const exp = it.expiresAt instanceof Date ? it.expiresAt.getTime() : it.expiresAt
      if (exp > nowMs && exp - nowMs <= 86_400_000) expiring24h++
    }
  }
  return { total: items.length, pinned, sensitive, expiring24h, byKind }
}
