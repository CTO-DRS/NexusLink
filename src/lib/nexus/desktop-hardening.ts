// FA-harden (عقد §16) — إعدادات التقوية المشتركة + التدقيق الأصلي
// ============================================================
// المخزن المصدر: db.DesktopSetting (نفس SQLite — بند 6 من «صلّب الإصدار»):
// نسخة الويب (متصفح) ونسخة التطبيق (نافذة Tauri) يقرآن ويكتبان الكائن نفسه
// عبر /api/desktop/settings. كل مفتاح صف واحد يحمل JSON مُنقّى.
// · appLock: قفل التطبيق — enabled + idleLockMin (0=تعطيل، 1..120) + biometric
//   + hasPin (مرآة عرض فقط — يجريها Rust من config.json المحلي؛ الهاش لا يغادر
//   الجهاز أبدًا).
// · idle: تحسين الخمول — optMinutes (1..120) قبل دخول وضع الخمول + reducePolling.
// · updater: المحدّث الموقّع — autoCheck عند الإقلاع.
// التدقيق الأصلي: كل عملية من الطبقة الأصلية (نقل/تحكم/حافظة/طاقة/وسائط) تُكتب
// في db.AuditEvent نفسها ببادئة native-* — فشلها محمي ولا يُسقط المسار الأصلي.
import { db } from "@/lib/db"

// ---------- الأنواع والافتراضيات ----------

export type DesktopAppLockCfg = {
  enabled: boolean
  idleLockMin: number // 0 = تعطيل قفل الخمول
  biometric: boolean
  hasPin: boolean // مرآة عرض فقط (يتحكم بها Rust عند ضبط/مسح PIN)
}
export const DESKTOP_APPLOCK_DEFAULTS: DesktopAppLockCfg = {
  enabled: false,
  idleLockMin: 0,
  biometric: false,
  hasPin: false,
}

export type DesktopIdleCfg = {
  optMinutes: number // سنت الخمول قبل تقليل النشاط
  reducePolling: boolean // تخفيف استطلاعات الواجهة أثناء الخمول
}
export const DESKTOP_IDLE_DEFAULTS: DesktopIdleCfg = { optMinutes: 5, reducePolling: true }

export type DesktopUpdaterCfg = {
  autoCheck: boolean // فحص التحديث عند الإقلاع
}
export const DESKTOP_UPDATER_DEFAULTS: DesktopUpdaterCfg = { autoCheck: true }

export type DesktopHardeningCfg = {
  appLock: DesktopAppLockCfg
  idle: DesktopIdleCfg
  updater: DesktopUpdaterCfg
}
export const DESKTOP_HARDENING_DEFAULTS: DesktopHardeningCfg = {
  appLock: { ...DESKTOP_APPLOCK_DEFAULTS },
  idle: { ...DESKTOP_IDLE_DEFAULTS },
  updater: { ...DESKTOP_UPDATER_DEFAULTS },
}

// ---------- التنقية (صارمة — فاسد ⇒ افتراضي) ----------

function sanitizeAppLock(raw: unknown): DesktopAppLockCfg {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const min =
    typeof o.idleLockMin === "number" && o.idleLockMin >= 0 && o.idleLockMin <= 120
      ? Math.floor(o.idleLockMin)
      : DESKTOP_APPLOCK_DEFAULTS.idleLockMin
  return {
    enabled: o.enabled === true,
    idleLockMin: min,
    biometric: o.biometric === true,
    hasPin: o.hasPin === true,
  }
}

function sanitizeIdle(raw: unknown): DesktopIdleCfg {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const min =
    typeof o.optMinutes === "number" && o.optMinutes >= 1 && o.optMinutes <= 120
      ? Math.floor(o.optMinutes)
      : DESKTOP_IDLE_DEFAULTS.optMinutes
  return {
    optMinutes: min,
    reducePolling: o.reducePolling !== false, // الافتراضي مفعّل
  }
}

function sanitizeUpdater(raw: unknown): DesktopUpdaterCfg {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return { autoCheck: o.autoCheck !== false } // الافتراضي مفعّل
}

// ---------- القراءة/الكتابة (نفس SQLite — الصف واحد = المفتاح الواحد) ----------

async function readKey<T>(key: string, sanitize: (raw: unknown) => T, dflt: T): Promise<T> {
  try {
    const row = await db.desktopSetting.findUnique({ where: { key } })
    if (!row) return { ...dflt }
    try {
      return sanitize(JSON.parse(row.value))
    } catch {
      return { ...dflt } // قيمة تالفة — افتراضي
    }
  } catch {
    // قاعدة قديمة بلا جدول DesktopSetting (ترقية من حزمة سابقة) — افتراضي بلا انكسار
    return { ...dflt }
  }
}

async function writeKey<T>(key: string, value: T): Promise<void> {
  await db.desktopSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  })
}

export async function readDesktopHardening(): Promise<DesktopHardeningCfg> {
  const [appLock, idle, updater] = await Promise.all([
    readKey("appLock", sanitizeAppLock, DESKTOP_APPLOCK_DEFAULTS),
    readKey("idle", sanitizeIdle, DESKTOP_IDLE_DEFAULTS),
    readKey("updater", sanitizeUpdater, DESKTOP_UPDATER_DEFAULTS),
  ])
  return { appLock, idle, updater }
}

export async function writeDesktopHardening(patch: {
  appLock?: unknown
  idle?: unknown
  updater?: unknown
}): Promise<DesktopHardeningCfg> {
  const cur = await readDesktopHardening()
  if (patch.appLock !== undefined) {
    const next = sanitizeAppLock(patch.appLock)
    await writeKey("appLock", next)
    cur.appLock = next
  }
  if (patch.idle !== undefined) {
    const next = sanitizeIdle(patch.idle)
    await writeKey("idle", next)
    cur.idle = next
  }
  if (patch.updater !== undefined) {
    const next = sanitizeUpdater(patch.updater)
    await writeKey("updater", next)
    cur.updater = next
  }
  return cur
}

// ---------- التدقيق الأصلي (نفس AuditEvent — بادئة native-*) ----------

export const NATIVE_AUDIT_ACTIONS = [
  "native-transfer",
  "native-clipboard",
  "native-power",
  "native-input",
  "native-screen",
  "native-vcam",
  "native-files",
  "native-sync",
  "native-lock",
  "native-updater",
  "native-diag",
] as const

const SEVERITY_SET = new Set(["info", "warn", "critical"])

/** كتابة حدث تدقيق أصلي — محمية تمامًا (فشلها لا يُسقط المسار الأصلي أبدًا) */
export async function writeNativeAudit(input: {
  action: string
  detail: string
  severity?: string
  actor?: string
  deviceId?: string
}): Promise<boolean> {
  try {
    const action = String(input.action ?? "").trim()
    if (!action.startsWith("native-") || action.length > 48) return false
    const detail = String(input.detail ?? "").trim().slice(0, 400)
    if (!detail) return false
    const severity = SEVERITY_SET.has(String(input.severity ?? "")) ? String(input.severity) : "info"
    const actor = String(input.actor ?? "").trim().slice(0, 40) || "الكمبيوتر"
    const deviceId =
      typeof input.deviceId === "string" && input.deviceId.trim()
        ? input.deviceId.trim().slice(0, 60)
        : null
    await db.auditEvent.create({ data: { actor, deviceId, action, detail, severity } })
    return true
  } catch {
    return false // قاعدة غير جاهزة/جدول غائب — بلا انكسار
  }
}

/**
 * كتابة حدث تدقيق من مسار سيرفري (أصل ويب/هاتف) — نفس SQLite.
 * البادئة native-* محجوزة حصريًا للطبقة الأصلية في Rust (تعاقد §16)؛
 * هنا مسموح: transfer | clipboard | settings | screen (مفردات FA-10 القائمة).
 */
export async function writeServerAudit(input: {
  action: string
  detail: string
  severity?: string
  actor?: string
  deviceId?: string
}): Promise<boolean> {
  try {
    const action = String(input.action ?? "").trim().replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48)
    if (!action) return false
    const detail = String(input.detail ?? "").trim().slice(0, 400)
    if (!detail) return false
    const severity = SEVERITY_SET.has(String(input.severity ?? "")) ? String(input.severity) : "info"
    const actor = String(input.actor ?? "").trim().slice(0, 40) || "الكمبيوتر"
    const deviceId =
      typeof input.deviceId === "string" && input.deviceId.trim()
        ? input.deviceId.trim().slice(0, 60)
        : null
    await db.auditEvent.create({ data: { actor, deviceId, action, detail, severity } })
    return true
  } catch {
    return false // بلا انكسار — التدقيق لا يُسقط العملية
  }
}
