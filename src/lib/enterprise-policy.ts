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

export const BRIDGES = [3003, 3004, 3005, 3006, 3007, 3008, 3009] as const

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

/** تحقق مخطط v1 — يرمي Error عند أي مخالفة (المستدعي يحوّلها إلى invalid) */
function validateV1(j: unknown): {
  organization: string | null
  remoteAccess: RemoteAccessPolicy
  blockedBridges: number[]
} {
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("root")
  const o = j as Record<string, unknown>
  if (o.schemaVersion !== 1) throw new Error("schemaVersion")
  let organization: string | null = null
  if (o.organization !== undefined && o.organization !== null) {
    if (typeof o.organization !== "string" || o.organization.length > 120) throw new Error("organization")
    organization = o.organization
  }
  let remoteAccess: RemoteAccessPolicy = null
  let blockedBridges: number[] = []
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
  }
  return { organization, remoteAccess, blockedBridges }
}

const UNMANAGED: EnterprisePolicy = {
  state: "unmanaged",
  path: null,
  hash: null,
  schemaVersion: null,
  organization: null,
  remoteAccess: null,
  blockedBridges: [],
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
    const v = validateV1(j)
    policy = {
      state: "managed",
      path: p,
      hash,
      schemaVersion: 1,
      organization: v.organization,
      remoteAccess: v.remoteAccess,
      blockedBridges: v.blockedBridges,
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
