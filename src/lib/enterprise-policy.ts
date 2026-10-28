import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"

// §38 — السياسات المؤسسية المركزية (M4.1 «النشر المؤسسي» — النواة المحلية)
// ============================================================
// مصدر الحقيقة الواحد: ملف JSON صفر-مخطط خارج قاعدة البيانات (نمط §37 حرفيًا):
//   1. NEXUSLINK_POLICY_FILE (متغير بيئة — الأعلى أولوية)
//   2. مسار النشر القياسي للنظام (يكتبه MDM — docs/enterprise-deploy.md):
//      - win32 : C:\ProgramData\NexusLink\policy.json
//      - darwin: /Library/Application Support/NexusLink/policy.json
//      - غير ذلك: /etc/nexuslink/policy.json
// غياب الملف = غير مُدار (السلوك التاريخي حرفيًا — صفر تغيير).
// المخطط v1: { schemaVersion: 1, organization?, managed?: { remoteAccess?,
//   blockedBridges? } } — أي قيمة مخالفة = «invalid» (فشل-آمن نحو سلوك
// المستخدم بلا فرض) وتُعلن صاخبة في الامتثال لا صامتة (حد §38.هـ.3).
// الفرض في نقطتين حصرًا: البوابة (من يدخل ومن يُحجب من خارج الجهاز) و
// /api/remote-access (قفل الإجراءات المتعارضة) — الجهاز هي الحدود (عقد 2.0):
// loopback معفى دائمًا — الإدارة تحكم التعريض الخارجي حصرًا.
// هذا الملف مطابق منطقيًا لمنطق البوابة في mini-services/gateway/index.cjs
// (loadPolicy + externalClosedBy + effectiveBlockedBridges) — التعديل هنا
// يستوجب مراجعة هناك (نمط §37: نسختان مطابقتان).
//
// §40 — وضع OEM «خصوصية افتراضية» (M4.3 النواة المحلية):
// العلم البيئي NEXUSLINK_OEM_PRIVACY=1 تضعه صورة النظام فيُورثه كل العمليات —
// الجهاز «مولود خاص»: بلا سياسة صالحة يكون الخارج مرفوضًا (حتى برمز صحيح)
// وكل الجسور محجوبة عن الخارج (دفاع ثانٍ خلف الباب الأمامي المغلق — الخطأ
// المُلاحَظ للخارج هو رفض الباب حصرًا)، وملف غير صالح يبقى مغلقاً (فشل-مغلق —
// عكس اتجاه §38 المتعمد في وضع المستخدم) — وسياسة صالحة تفوز كاملة (مسار MDM).
// resolveEffectivePosture هي مرآة externalClosedBy/effectiveBlockedBridges.
//
// §47 — المخطط v2 (الإدارة الجماعية الموسّعة — ما بعد ختم M4): المفاتيح
// الجديدة lockedSettings/accessCodeRotationDays/disabledCapabilities/
// minimumVersion (تفصيلها في docs/enterprise-deploy.md §16) تُقبل في v2
// حصرًا — v1 يعمل كاملًا بلاها (توافق رجعي لأسطول مختلط). الفرض الجديد في
// نقاطه الأربع (settings PUT · remote-access rotation · market/assist/sync
// 403 · version stamp) — والبوابة (التوأم) تُحدِّث parsePolicy لتقبل v2
// بالرفض نفسه (نسختان مطابقتان — نمط §37).

export const BRIDGES = [3003, 3004, 3005, 3006, 3007, 3008, 3009] as const

// §47 — المخطط v2 (الإدارة الجماعية الموسّعة): الأسماء المعاقدة حصرًا —
// القيم خارجها تُرفض (invalid) لا تُهمل: مدير يخطئ إملاء مفتاح يريد نتيجة
// صارخة لا ملفًا يعمل نصفه (نفس مبدأ §38: لا فرض جزئي).
export const LOCKABLE_SETTINGS = ["appLock", "idle", "updater"] as const
export type LockableSetting = (typeof LOCKABLE_SETTINGS)[number]
export const POLICY_CAPABILITIES = ["market", "assist", "sync"] as const
export type PolicyCapability = (typeof POLICY_CAPABILITIES)[number]
export const ROTATION_DAYS_MIN = 1
export const ROTATION_DAYS_MAX = 365

/** تحكّم semver صارم للختم الأدنى: ثلاث خانات عددية X.Y.Z (بلا لواحق —
 * لواحق البناء خارج نطاق ختم الأرضية المؤسسية وترفض بصدق) */
export function isValidSemver(v: unknown): v is string {
  return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v)
}

/** مقارنة أرضية semver: a ≥ b خانة-بخانة (كلاهما مخكوم isValidSemver) */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return true
    if (pa[i]! < pb[i]!) return false
  }
  return true
}

/** §47 — هل استحق رمز الوصول التدوير؟ (عمر الرمز فوق أجلة السياسة)
 * createdAt بصمة زمنة ISO لملف الرمز (تدوير جديد = ملف جديد = عداد يصفّر) */
export function rotationDue(createdAt: string | null | undefined, rotationDays: number | null): boolean {
  if (!createdAt || !rotationDays) return false
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return false
  const ageDays = (Date.now() - t) / 86_400_000
  return ageDays > rotationDays
}

export type RemoteAccessPolicy = "force-on" | "force-off" | null
export type PolicyState = "managed" | "unmanaged" | "invalid"

export interface EnterprisePolicy {
  state: PolicyState
  /** المسار المحلول (الموجود فحُاول قراءته) أو null عند غياب كل المسارات */
  path: string | null
  /** بصمة sha256:16 من محتوى الملف الخام — تثبت للامتثال أن الفرض من ملف معين */
  hash: string | null
  schemaVersion: number | null
  organization: string | null
  remoteAccess: RemoteAccessPolicy
  blockedBridges: number[]
  // §47 — المخطط v2 (غياب الملف أو v1 = القيم المحايدة حرفيًا — توافق رجعي)
  lockedSettings: string[]
  accessCodeRotationDays: number | null
  disabledCapabilities: string[]
  minimumVersion: string | null
}

/** مسارات النشر القياسية بالترتيب — الأول الموجود يُقرأ (bied المالك كتابته) */
export function policyPaths(): string[] {
  const list: string[] = []
  if (process.env.NEXUSLINK_POLICY_FILE) list.push(process.env.NEXUSLINK_POLICY_FILE)
  if (process.platform === "win32") {
    list.push(path.join(process.env.ProgramData || "C:\\ProgramData", "NexusLink", "policy.json"))
  } else if (process.platform === "darwin") {
    list.push("/Library/Application Support/NexusLink/policy.json")
  } else {
    list.push("/etc/nexuslink/policy.json")
  }
  return list
}

function resolvePolicyPath(): string | null {
  for (const p of policyPaths()) {
    try {
      if (fs.statSync(p).isFile()) return p
    } catch {
      /* غائب — التالي */
    }
  }
  return null
}

/** حل مسار ملف السياسة الخام (بلا قراءة) — تستخدمه طبقة السجل التدقيقي §39
 * لوضع audit.jsonl بجانب السياسة المُدارة (مجلد يكتبه MDM = قابل للجمع) */
export function resolvePolicyPathForAudit(): string | null {
  return resolvePolicyPath()
}

/** تحقق مخطط v1|v2 (§47 — مشترك واحد) — يرمي Error عند أي مخالفة
 * (المستدعي يحوّلها إلى invalid). v1 يعمل كاملًا بلا المفاتيح الجديدة
 * (توافق رجعي: أسطول مختلط يُدار بملفات v1 وv2 معًا). */
function validate(j: unknown): {
  organization: string | null
  remoteAccess: RemoteAccessPolicy
  blockedBridges: number[]
  lockedSettings: string[]
  accessCodeRotationDays: number | null
  disabledCapabilities: string[]
  minimumVersion: string | null
} {
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("root")
  const o = j as Record<string, unknown>
  if (o.schemaVersion !== 1 && o.schemaVersion !== 2) throw new Error("schemaVersion")
  const v2 = o.schemaVersion === 2
  let organization: string | null = null
  if (o.organization !== undefined && o.organization !== null) {
    if (typeof o.organization !== "string" || o.organization.length > 120) throw new Error("organization")
    organization = o.organization
  }
  let remoteAccess: RemoteAccessPolicy = null
  let blockedBridges: number[] = []
  let lockedSettings: string[] = []
  let accessCodeRotationDays: number | null = null
  let disabledCapabilities: string[] = []
  let minimumVersion: string | null = null
  if (o.managed !== undefined && o.managed !== null) {
    if (typeof o.managed !== "object" || Array.isArray(o.managed)) throw new Error("managed")
    const m = o.managed as Record<string, unknown>
    if (m.remoteAccess !== undefined && m.remoteAccess !== null) {
      if (m.remoteAccess !== "force-on" && m.remoteAccess !== "force-off") throw new Error("managed.remoteAccess")
      remoteAccess = m.remoteAccess
    }
    if (m.blockedBridges !== undefined && m.blockedBridges !== null) {
      if (!Array.isArray(m.blockedBridges) || m.blockedBridges.length > BRIDGES.length) throw new Error("managed.blockedBridges")
      const seen = new Set<number>()
      for (const v of m.blockedBridges) {
        if (!Number.isInteger(v) || !(BRIDGES as readonly number[]).includes(v)) throw new Error("managed.blockedBridges")
        seen.add(v)
      }
      blockedBridges = [...seen].sort((a, b) => a - b)
    }
    // §47 — مفاتيح v2: تُقبل في v2 حصرًا (ملف v1 يحملها = غير صالح: لا
    // مزج إصدارات في ملف واحد — المدير يكتب schemaVersion الصحيح لمفاتيحه)
    if (m.lockedSettings !== undefined && m.lockedSettings !== null) {
      if (!v2) throw new Error("managed.lockedSettings:v1")
      if (!Array.isArray(m.lockedSettings) || m.lockedSettings.length > LOCKABLE_SETTINGS.length) throw new Error("managed.lockedSettings")
      const seen = new Set<string>()
      for (const v of m.lockedSettings) {
        if (typeof v !== "string" || !(LOCKABLE_SETTINGS as readonly string[]).includes(v)) throw new Error("managed.lockedSettings")
        // المكررات تُرفض (توأم البوابة يرفضها) — ملف مهمل = صاخب لا صامت
        if (seen.has(v)) throw new Error("managed.lockedSettings:duplicate")
        seen.add(v)
      }
      lockedSettings = [...seen].sort()
    }
    if (m.accessCodeRotationDays !== undefined && m.accessCodeRotationDays !== null) {
      if (!v2) throw new Error("managed.accessCodeRotationDays:v1")
      const d: unknown = m.accessCodeRotationDays
      if (typeof d !== "number" || !Number.isInteger(d) || d < ROTATION_DAYS_MIN || d > ROTATION_DAYS_MAX) {
        throw new Error("managed.accessCodeRotationDays")
      }
      accessCodeRotationDays = d
    }
    if (m.disabledCapabilities !== undefined && m.disabledCapabilities !== null) {
      if (!v2) throw new Error("managed.disabledCapabilities:v1")
      if (!Array.isArray(m.disabledCapabilities) || m.disabledCapabilities.length > POLICY_CAPABILITIES.length) throw new Error("managed.disabledCapabilities")
      const seen = new Set<string>()
      for (const v of m.disabledCapabilities) {
        if (typeof v !== "string" || !(POLICY_CAPABILITIES as readonly string[]).includes(v)) throw new Error("managed.disabledCapabilities")
        // المكررات تُرفض (توأم البوابة يرفضها)
        if (seen.has(v)) throw new Error("managed.disabledCapabilities:duplicate")
        seen.add(v)
      }
      disabledCapabilities = [...seen].sort()
    }
    if (m.minimumVersion !== undefined && m.minimumVersion !== null) {
      if (!v2) throw new Error("managed.minimumVersion:v1")
      if (!isValidSemver(m.minimumVersion)) throw new Error("managed.minimumVersion")
      minimumVersion = m.minimumVersion
    }
  }
  return { organization, remoteAccess, blockedBridges, lockedSettings, accessCodeRotationDays, disabledCapabilities, minimumVersion }
}

const UNMANAGED: EnterprisePolicy = {
  state: "unmanaged",
  path: null,
  hash: null,
  schemaVersion: null,
  organization: null,
  remoteAccess: null,
  blockedBridges: [],
  lockedSettings: [],
  accessCodeRotationDays: null,
  disabledCapabilities: [],
  minimumVersion: null,
}

// كاش متغير-الوقت (نمط §37 loadPair): القراءة عند كل طلب، والتحليل حين يتغير
// mtime/حجم الملف حصرًا — تعديل الملف حي بلا إعادة تشغيل، والحذف = غير مُدار فورًا.
let cache: { mtimeMs: number; size: number; policy: EnterprisePolicy } | null = null

export function readEnterprisePolicy(): EnterprisePolicy {
  const p = resolvePolicyPath()
  if (!p) {
    cache = null
    return { ...UNMANAGED }
  }
  let st: fs.Stats
  try {
    st = fs.statSync(p)
  } catch {
    cache = null
    return { ...UNMANAGED }
  }
  if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.policy
  let policy: EnterprisePolicy
  try {
    const raw = fs.readFileSync(p, "utf8")
    const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16)
    const j: unknown = JSON.parse(raw)
    const v = validate(j)
    policy = {
      state: "managed",
      path: p,
      hash,
      schemaVersion: (j as { schemaVersion?: number }).schemaVersion === 2 ? 2 : 1,
      organization: v.organization,
      remoteAccess: v.remoteAccess,
      blockedBridges: v.blockedBridges,
      lockedSettings: v.lockedSettings,
      accessCodeRotationDays: v.accessCodeRotationDays,
      disabledCapabilities: v.disabledCapabilities,
      minimumVersion: v.minimumVersion,
    }
  } catch {
    // فشل-آمن صاخب: ملف غير صالح = لا فرض + حالة invalid معلنة في الامتثال (§38.هـ.3)
    policy = {
      state: "invalid",
      path: p,
      hash: null,
      schemaVersion: null,
      organization: null,
      remoteAccess: null,
      blockedBridges: [],
      lockedSettings: [],
      accessCodeRotationDays: null,
      disabledCapabilities: [],
      minimumVersion: null,
    }
  }
  cache = { mtimeMs: st.mtimeMs, size: st.size, policy }
  return policy
}

/** حالة الإدارة لسطر واحد (للصحة والسجلات): غير مُدار | مُدار | ملف غير صالح */
export function policyStateLabel(p: EnterprisePolicy, ar = true): string {
  if (p.state === "managed") return ar ? "مُدار" : "managed"
  if (p.state === "invalid") return ar ? "ملف سياسة غير صالح" : "invalid policy file"
  return ar ? "غير مُدار" : "unmanaged"
}

export const POLICY_CONTRACT = "§38"
export const OEM_PRIVACY_ENV = "NEXUSLINK_OEM_PRIVACY"

/** §40 — العلم البيئي لوضع OEM «خصوصية افتراضية» — تضعه صورة النظام
 * (وحدة systemd/launchd/خدمة ويندوز) فيُورثه خادم الويب والبوابة معًا */
export function oemPrivacyActive(): boolean {
  return process.env[OEM_PRIVACY_ENV] === "1"
}

export type PostureSource = "policy" | "oem-default" | "user-default"

export interface EffectivePosture {
  /** من يملك الفرض الفعلي: ملف سياسة صالح | مولود خاص بالعلم | سلوك المستخدم التاريخي */
  source: PostureSource
  remoteAccess: RemoteAccessPolicy
  blockedBridges: number[]
  /** الخارج مغلق كليًا (force-off فعلي) — حتى برمز اقتران صحيح */
  closed: boolean
}

/** §40 — الفرض الفعلي فوق أي حالة سياسة (مرآة منطق البوابة حرفيًا):
 * - مُدار: السياسة تفوز كاملة (تخفيف MDM أو تشديد).
 * - oem-default: بلا سياسة صالحة + العلم = مولود خاص: force-off + كل الجسور —
 *   ويشمل invalid (فشل-مغلق: الملف التالف لا يفتح جهازًا مولودًا خاصًا).
 * - user-default: بلا علم = السلوك التاريخي حرفيًا (صفر تغيير — حد §38). */
export function resolveEffectivePosture(pol: EnterprisePolicy): EffectivePosture {
  if (pol.state === "managed") {
    return {
      source: "policy",
      remoteAccess: pol.remoteAccess,
      blockedBridges: pol.blockedBridges,
      closed: pol.remoteAccess === "force-off",
    }
  }
  if (oemPrivacyActive()) {
    return { source: "oem-default", remoteAccess: "force-off", blockedBridges: [...BRIDGES], closed: true }
  }
  return { source: "user-default", remoteAccess: null, blockedBridges: [], closed: false }
}

export const POLICY_OS_HINT = `${os.type()} ${os.release()}`
