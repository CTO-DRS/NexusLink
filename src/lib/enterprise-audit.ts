import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { resolvePolicyPathForAudit, oemPrivacyActive, resolveEffectivePosture, type EnterprisePolicy } from "@/lib/enterprise-policy"

// §39 — السجل التدقيقي المؤسسي المحلي (M4.2 «شهادات الثقة» — النواة المحلية)
// ============================================================
// جوهر بند M4.2 (SOC 2 Type I) القابل للتنفيذ محليًا بنمط §36/§38 الصادق:
// مدقق SOC 2 الخارجي يطلب أدلة على الأفعال الإدارية وإدارة التغيير — هذا
// السجل هو مصدر تلك الأدلة على الجهاز، والقبول المؤسسي (المدقق نفسه والشهادة)
// يبقى خارجيًا بقرار المالك (§39.هـ.1).
// الشكل: JSONL إلحاقي بسلسلة بصمات — كل سطر يحمل prev (بصمة السطر السابق)
// وh (بصمة نفسه) فأي تعديل رجعي يكسر السلسلة ويُعلن في /api/enterprise/audit
// والامتثال — كشف تعديل لا منع تعديل (من يملك القرص يعيد البناء كاملة —
// نموذج الجهاز المحلي نفسه §38.هـ.2).
// الكاتب واحد حصرًا: خادم الويب (سلاسة السلسلة) — البوابة لا تكتب (حد §39.هـ.2)
// ورفضها للخارج معلن في health، والجمع المركزي للأدلة بند النشر الخارجي
// (حد §38.هـ.5 الموروث).
// حرس F6 متوافق: بصمات وبصمات ملفات وأسماء مؤسسات وحالات حصرًا — لا رموز
// خام ولا عناوين شبكة خام (وسم محلي/خارجي) ولا محتوى مستخدم.
// الرصد عند القراءات الإدارية حصرًا (remote-access/compliance) — لا خيط خلفية
// (نمط مسارات Next الحي).

export const AUDIT_CONTRACT = "§39"

/** أنواع الأحداث المغلقة — الغريب يرفض وقت الكتابة (لا أسطر مجهولة في الدليل) */
export type AuditKind =
  | "pair.enable"
  | "pair.rotate"
  | "pair.disable"
  | "pair.admin.denied"
  | "policy.observed"
  | "policy.changed"
  // §47 — أفعال الإدارة الجماعية الموسّعة (قفل/تدوير/قدرات — نفس السلسلة)
  | "settings.write.denied"
  | "pair.rotation.overdue"
  | "capability.denied"

const KINDS: ReadonlySet<string> = new Set<string>([
  "pair.enable",
  "pair.rotate",
  "pair.disable",
  "pair.admin.denied",
  "policy.observed",
  "policy.changed",
  "settings.write.denied",
  "pair.rotation.overdue",
  "capability.denied",
])

export interface AuditRecord {
  i: number
  t: string
  k: AuditKind
  ok: boolean
  actor: "local" | "remote"
  d: Record<string, unknown>
  prev: string
  h: string
}

/** مسار السجل بالترتيب: متغير البيئة → بجانب ملف السياسة المُدار → حالة التطبيق المحلية */
export function resolveAuditPath(): string {
  const env = process.env.NEXUSLINK_AUDIT_FILE
  if (env) return env
  const pol = resolvePolicyPathForAudit()
  if (pol) return path.join(path.dirname(pol), "audit.jsonl")
  return path.join(process.cwd(), ".zstate", "audit.jsonl")
}

function hashRecord(rec: Omit<AuditRecord, "h">): string {
  // الترتيب الثابت للحقول هو العقد — المدقق الخارجي يعيد البناء بهذا الترتيب حرفيًا
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ i: rec.i, t: rec.t, k: rec.k, ok: rec.ok, actor: rec.actor, d: rec.d, prev: rec.prev }))
    .digest("hex")
    .slice(0, 16)
}

/** الإلحاق الآمن الواحد: طابور داخلي + تحقق سلسلة قبل كل إلحاق + fsync — الدليل قبل السرعة */
let writeQueue: Promise<unknown> = Promise.resolve(null)

function enqueue(
  k: AuditKind,
  ok: boolean,
  actor: AuditRecord["actor"],
  d: Record<string, unknown>,
): Promise<AuditRecord | null> {
  const next = writeQueue.then(async (): Promise<AuditRecord | null> => {
    try {
      const file = resolveAuditPath()
      // §39.هـ.4 — لا إلحاق فوق دليل مكسور إطلاقًا: سلسلة غير صالحة = سجل متجمد
      // (تحقق كامل قبل كل إلحاق — ملفات الأدلة صغيرة بعمد، والتجميد صاخب بالتحذير)
      const v = verifyAuditChain()
      if (v.exists && !v.valid) {
        console.warn(`[audit:${AUDIT_CONTRACT}] chain broken at ${v.brokenAt} — log frozen (manual epoch rotation required)`)
        return null
      }
      let prev = ""
      let i = 0
      if (v.exists && v.head) {
        i = v.head.i
        prev = v.head.h
      }
      const rec: Omit<AuditRecord, "h"> = {
        i: i + 1,
        t: new Date().toISOString(),
        k,
        ok,
        actor,
        d,
        prev,
      }
      const full: AuditRecord = { ...rec, h: hashRecord(rec) }
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
      const line = JSON.stringify(full) + "\n"
      const fd = fs.openSync(file, "a", 0o600)
      try {
        fs.writeSync(fd, line)
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      return full
    } catch (e) {
      // التدقيق طبقة أدلة لا طبقة فرض — فشل الكتابة لا يكسر سلوك الإدارة أبدًا
      console.warn(`[audit:${AUDIT_CONTRACT}] append failed:`, e instanceof Error ? e.message : e)
      return null
    }
  })
  writeQueue = next.then(() => undefined, () => undefined)
  return next
}

/** تدقيق حدث واحد (الكاتب الوحيد — خادم الويب) — يرجع السجل المكتوب أو null */
export function appendAudit(
  k: AuditKind,
  ok: boolean,
  actor: AuditRecord["actor"],
  d: Record<string, unknown> = {},
): Promise<AuditRecord | null> {
  if (!KINDS.has(k)) return Promise.resolve(null)
  return enqueue(k, ok, actor, d)
}

// ---------- رصد انتقالات السياسة (إدارة التغيير — أدلة SOC 2) ----------

let lastObs: { state: string; hash: string | null } | null = null

/**
 * يُستدعى بعد كل readEnterprisePolicy في المسارات الإدارية — يسجل الرصد الأولي
 * لكل دورة ثم كل تغير (حالة أو بصمة). رصد لا فرض: لا يغير سلوك شيء.
 * ملف غائب = دورة جديدة: لا دليل سابق في هذه الدورة فيعاد الرصد الأولي (حتمي
 * للجولات المتتالية) — وتُنتظر الكتابة في المسارات (الدليل قبل السرعة).
 * فشل الكتابة لا يحدّث lastObs — التغير يبقى معلقًا حتى يُكتب (لا رصد ضائع).
 */
export function observePolicy(pol: EnterprisePolicy): Promise<void> {
  // الدورة الجديدة أولًا: ملف غائب = لا دليل سابق في هذه الدورة — الرصد الأولي يعاد
  // (قبل قصر تطابق الحالة، وإلا فالجولة الثانية على التطبيق الحي تفقد الرصد الأولي)
  if (!verifyAuditChain().exists) lastObs = null
  // §40 — مصدر الفرض الفعلي يرافق كل رصد (إغناء الدليل لا تغيير عقده:
  // d حرة الشكل وتُغشى بالبصمة، والسجلات القديمة تبقى صالحة كما هي)
  const posture40 = resolveEffectivePosture(pol)
  const sig = { state: pol.state, hash: pol.hash }
  if (lastObs && lastObs.state === sig.state && lastObs.hash === sig.hash) return Promise.resolve()
  const anchor = lastObs
  return appendAudit(
    anchor ? "policy.changed" : "policy.observed",
    true,
    "local",
    anchor
      ? { from: { ...anchor }, to: { state: pol.state, hash: pol.hash, org: pol.organization, ra: pol.remoteAccess }, oem: oemPrivacyActive(), source: posture40.source }
      : { state: pol.state, hash: pol.hash, org: pol.organization, ra: pol.remoteAccess, oem: oemPrivacyActive(), source: posture40.source },
  ).then((written) => {
    if (written) lastObs = sig
  })
}

// ---------- القراءة والتحقق (نقطة /api/enterprise/audit) ----------

export interface AuditVerify {
  exists: boolean
  count: number
  valid: boolean
  brokenAt: number | null
  head: { i: number; h: string } | null
}

/** تحقق السلسلة كاملة: إعادة بناء كل بصمة وربط كل prev — كشف أي تعديل رجعي */
export function verifyAuditChain(): AuditVerify {
  const file = resolveAuditPath()
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    return { exists: false, count: 0, valid: true, brokenAt: null, head: null }
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0)
  let prev = ""
  let expected = 1
  let head: { i: number; h: string } | null = null
  for (const line of lines) {
    let r: AuditRecord
    try {
      r = JSON.parse(line) as AuditRecord
    } catch {
      return { exists: true, count: expected - 1, valid: false, brokenAt: expected, head }
    }
    const rec: Omit<AuditRecord, "h"> = { i: r.i, t: r.t, k: r.k, ok: r.ok, actor: r.actor, d: r.d, prev: r.prev }
    if (
      r.i !== expected ||
      r.prev !== prev ||
      hashRecord(rec) !== r.h ||
      !KINDS.has(r.k) ||
      (r.actor !== "local" && r.actor !== "remote")
    ) {
      return { exists: true, count: expected - 1, valid: false, brokenAt: r.i ?? expected, head }
    }
    head = { i: r.i, h: r.h }
    prev = r.h
    expected++
  }
  return { exists: true, count: lines.length, valid: true, brokenAt: null, head }
}

/** آخر N حدث بالترتيب الزمني (الأقدم أولًا) — للعرض الحلقي حصرًا */
export function readAuditTail(limit: number): AuditRecord[] {
  try {
    const raw = fs.readFileSync(resolveAuditPath(), "utf8")
    const lines = raw.split("\n").filter((l) => l.trim().length > 0)
    return lines
      .slice(Math.max(0, lines.length - limit))
      .map((l) => {
        try {
          return JSON.parse(l) as AuditRecord
        } catch {
          return null
        }
      })
      .filter((r): r is AuditRecord => r !== null)
  } catch {
    return []
  }
}

/** ملخص السجل لتقرير الامتثال (حقول توصيفية حصرًا — §38.د متوافق) */
export function auditSummary(): { file: string; count: number; valid: boolean; brokenAt: number | null } {
  const v = verifyAuditChain()
  return { file: resolveAuditPath(), count: v.count, valid: v.valid, brokenAt: v.brokenAt }
}
