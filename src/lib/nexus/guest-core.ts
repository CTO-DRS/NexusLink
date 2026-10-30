// عقد §51 — المشاركة الضيوفة المباشرة (GUEST-SHARE) — النواة النقية (بلا إدخال/إخراج)
// ============================================================
// الخندق التنافسي: #1 الخصوصية المعمارية (بلا سحابة ولا حساب — الملف لا يغادر
// الشبكة المحلية أبدًا) + #4 التبنّي صفري الاحتكاك (الطرف المستقبل يحتاج متصفحًا
// حصرًا — لا تطبيق ولا تسجيل).
// مقابل المنافسين مباشرة:
//  - LocalSend/Snapdrop: يتطلب تطبيقًا على الطرفين أو وسيطًا إنترنت — هنا
//    رمز مؤقت صلاحيته دقائق واستقبال بمتصفح أي جهاز على الشبكة المحلية.
//  - AirDrop: عالم أبل المغلق — هنا أي متصفح على أي منصة.
//  - Pushbullet/رافعات السحابة: المحتوى يمر بوسيط يملكه غيرك — هنا صفر وسيط.
//
// حدود صادقة (§51.حدود):
//  - الشبكة المحلية حصرًا — لا نفق ولا عبور إنترنت (المرحّل §49 شيء آخر مقصود).
//  - الرمز مؤقت ويتعطل فور انتهائه أو حذفه؛ الحد الأدنى 5 دقائق والأقصى ساعتان.
//  - حجم ملف واحد ≤ 200MB ودفعة ≤ 512MB و20 ملفًا — حدود تقيّب الاستقبال.
//  - صفحة الاستقبال ثنائية اللغة ar/en مضمّنة — بلا أي مورد خارجي مفحوص.

export type GuestMode = "send" | "drop"

export const GUEST_TTL_MIN = 5
export const GUEST_TTL_MAX = 120
export const GUEST_MAX_FILES = 20
export const GUEST_MAX_FILE_BYTES = 200 * 1024 * 1024
export const GUEST_MAX_TOTAL_BYTES = 512 * 1024 * 1024
export const GUEST_RATE_PER_MIN = 30
export const GUEST_FAIL_LOCK_AFTER = 8
export const GUEST_FAIL_LOCK_MS = 60_000

/** رمز الضيف: 32 بايت عشوائية بحرف لكل بايت — 32 محرفًا بلا غموض طباعي */
export function newGuestToken(): string {
  const b = new Uint8Array(32)
  globalThis.crypto.getRandomValues(b)
  let s = ""
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  for (const x of b) s += CHARS[x % 64]
  return s
}

/** بصمة عرض حتمية (FNV-1a مزدوج) — للتعريف في الواجهة لا للسرّية */
export function guestFingerprint(token: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x01000193) >>> 0
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16)
}

/** مقارنة زمن-ثابت للرموز (نمط §37) — على بصمات بطول متساوٍ */
export function guestTokenEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function validateGuestConfig(cfg: {
  mode?: string
  ttlMinutes?: number
  fileCount?: number
}): { ok: boolean; error?: string } {
  if (cfg.mode !== "send" && cfg.mode !== "drop") return { ok: false, error: "invalid-mode" }
  const t = cfg.ttlMinutes
  if (typeof t !== "number" || !Number.isInteger(t) || t < GUEST_TTL_MIN || t > GUEST_TTL_MAX) {
    return { ok: false, error: "invalid-ttl" }
  }
  if ((cfg.fileCount ?? 0) > GUEST_MAX_FILES) return { ok: false, error: "too-many-files" }
  return { ok: true }
}

export interface GuestState {
  token: string
  fingerprint: string
  mode: GuestMode
  expiresAt: number
  label: string
  files: Array<{ name: string; size: number; absPath: string }>
  createdAt: number
}

/** الحالة حية: رمز سليم ولم تنتهِ صلاحيته — الحذف/الماضي = تعطيل فوري */
export function isGuestActive(s: GuestState | null, nowMs: number): boolean {
  return !!s && typeof s.token === "string" && s.token.length >= 16 && typeof s.expiresAt === "number" && s.expiresAt > nowMs
}

/** تنقية اسم ملف الضيف: بلا مسارات ولا خداع ولا محارف تحكم — بلا طول مبالغ */
export function sanitizeGuestName(name: string): string {
  let n = String(name ?? "")
  n = n.replace(/[\u0000-\u001f\u007f]/g, "")
  n = n.split(/[\\/]+/).pop() ?? ""
  n = n.replace(/\.{2,}/g, ".")
  n = n.trim()
  if (!n || n === "." || n.startsWith(".")) n = `ملف-${Date.now()}`
  return n.slice(0, 120)
}

/** محدد معدل نافذة منزلقة — قابل للحقن بالزمن للاختبار النقي */
export function createRateLimiter(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>()
  return {
    hit(key: string, nowMs: number): boolean {
      const arr = (hits.get(key) ?? []).filter((t) => nowMs - t < opts.windowMs)
      if (arr.length >= opts.max) {
        hits.set(key, arr)
        return false
      }
      arr.push(nowMs)
      hits.set(key, arr)
      return true
    },
    reset(key: string) {
      hits.delete(key)
    },
  }
}

/** حارس محاولات الرمز الخاطئ: قفل مؤقت بعد العتبة (نمط بوابة §37) */
export function createFailGuard(opts: { after: number; lockMs: number }) {
  const fails = new Map<string, { n: number; until: number }>()
  return {
    locked(key: string, nowMs: number): boolean {
      const f = fails.get(key)
      return !!f && f.until > nowMs
    },
    fail(key: string, nowMs: number): { locked: boolean; count: number } {
      const f = fails.get(key) ?? { n: 0, until: 0 }
      f.n += 1
      if (f.n >= opts.after) {
        f.until = nowMs + opts.lockMs
        f.n = 0
      }
      fails.set(key, f)
      return { locked: f.until > nowMs, count: f.n }
    },
    clear(key: string) {
      fails.delete(key)
    },
  }
}

const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", txt: "text/plain; charset=utf-8",
  zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", json: "application/json",
}

export function mimeFromName(name: string): string {
  const ext = String(name ?? "").split(".").pop()?.toLowerCase() ?? ""
  return MIME[ext] ?? "application/octet-stream"
}

/**
 * صفحة الاستقبال — HTML صفر-اعتماد ثنائي اللغة، بلا أي مورد خارجي.
 * actionPath يجلب الرمز ضمن الاستعلام (نفس عنوان الصفحة) — لا يُطبع الرمز في النص.
 */
export function guestPageHtml(opts: {
  mode: GuestMode
  lang: "ar" | "en"
  files: Array<{ name: string; size: number }>
  actionPath: string
  label: string
  expired?: boolean
}): string {
  const ar = opts.lang === "ar"
  const dir = ar ? 'dir="rtl" lang="ar"' : 'dir="ltr" lang="en"'
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
  if (opts.expired) {
    return `<!doctype html><html ${dir}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NexusLink</title></head><body style="font-family:system-ui;background:#0b1d1c;color:#e6f2f1;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:44px">⌛</div><h1>${ar ? "انتهت صلاحية المشاركة" : "Share expired"}</h1><p style="opacity:.7">${ar ? "اطلب رمزًا جديدًا من صاحب الجهاز" : "Ask the device owner for a new link"}</p></div></body></html>`
  }
  const title = opts.mode === "drop" ? (ar ? "استقبال ملفات — NexusLink" : "Receive files — NexusLink") : (ar ? "ملفات مشتركة — NexusLink" : "Shared files — NexusLink")
  const body =
    opts.mode === "drop"
      ? `<form method="POST" action="${esc(opts.actionPath)}" enctype="multipart/form-data" style="display:grid;gap:12px;justify-items:center">
          <input type="file" name="file" multiple required style="color:#e6f2f1">
          <button type="submit" style="background:#178c81;color:#fff;border:0;border-radius:12px;padding:12px 28px;font-size:16px;cursor:pointer">${ar ? "إرسال إلى الجهاز" : "Send to device"}</button>
         </form>
         <p style="opacity:.6;font-size:12px">${ar ? "الإرسال محلي حصرًا — لا يمر بأي خادم خارجي" : "Transfer stays local — no external server involved"}</p>`
      : (opts.files.length
          ? `<ul style="list-style:none;padding:0;width:100%;max-width:420px;display:grid;gap:8px">${opts.files
              .map((f, i) => `<li><a href="${esc(opts.actionPath)}&d=${i}" style="display:flex;justify-content:space-between;background:#12302e;color:#e6f2f1;border-radius:12px;padding:12px 16px;text-decoration:none"><span>📄 ${esc(f.name)}</span><span style="opacity:.6">${fmtSize(f.size)}</span></a></li>`)
              .join("")}</ul>`
          : `<p style="opacity:.7">${ar ? "لا ملفات مشتركة حاليًا" : "No files shared right now"}</p>`)
  return `<!doctype html><html ${dir}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="font-family:system-ui;background:#0b1d1c;color:#e6f2f1;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;width:min(92vw,480px);padding:24px">
<div style="font-size:34px;font-weight:800;margin-bottom:4px;color:#3ecfbb">NexusLink</div>
<p style="opacity:.75;margin:0 0 18px">${esc(opts.label || (ar ? "جهاز قريب يشاركك ملفات" : "A nearby device is sharing with you"))}</p>
${body}
</div></body></html>`
}
