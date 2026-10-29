// NexusLink — طبقة خادم الطوارئ (عقد §48 — مصدر الحقيقة الواحد)
// ============================================================
// ملف واحد خارج المخطط وصفر db (نمط §37): .zstate/emergency-kill.json أو
// NEXUSLINK_EMERGENCY_FILE — قراءة ديناميكية بلا كاش (حذف الملف = فورًا
// «غير مسلَّح» بلا إعادة تشغيل) وكتابة ذرّية 0600 (tmp+rename).
// أحادي الاتجاه بنيويًا: لا دوال إلغاء قتل هنا ولا في أي مكان — الوحيد
// الذي «يفتح» هو مالك القرص بحذف الملف بيده في جهازه (وهذا إعادة تسليح
// جديدة لا «إلغاء»): القائمة فارغة والرمز §37 يُدار من بابه.
// القتل يولد من الخادم حصرًا بعد PIN — لا حقن عبر المقبس (dev:kill خارج
// قائمة ترحيل CMDS في الجسر).
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { appendAudit } from "../enterprise-audit"
import { KILL_WORD, killFingerprint, normalizeArmRules, type ArmRules } from "./emergency-core"

export { KILL_WORD, killFingerprint, normalizeArmRules }
export type { ArmRules }

const EMERGENCY_FILE =
  process.env.NEXUSLINK_EMERGENCY_FILE || path.join(process.cwd(), ".zstate", "emergency-kill.json")

/** ملف رمز §37 — نفس مسار بابه (remote-access) حرفيًا للتدوير لحظة القتل. */
const PAIR_FILE =
  process.env.NEXUSLINK_PAIR_FILE || path.join(process.cwd(), ".zstate", "pair-token.json")

export interface KillEntry {
  deviceId: string
  fingerprint: string
  at: string
  /** هل دُوِّر رمز §37 مع هذا القتل (فتحة المسروق على واجهات سطح المكتب تُغلق). */
  pairRotated: boolean
}

export interface EmergencyState {
  /** هاش PIN المُسلَّح (SHA-256) — خام أبدًا لا يُخزَّن ولا يعود. */
  pinSha256: string | null
  rules: ArmRules | null
  armedAt: string | null
  kills: KillEntry[]
}

const EMPTY: EmergencyState = { pinSha256: null, rules: null, armedAt: null, kills: [] }

/** قراءة ديناميكية — كل نداء من القرص (لا كاش: الحسم لحظي كملف §37). */
export function readEmergencyState(): EmergencyState {
  try {
    const j = JSON.parse(fs.readFileSync(EMERGENCY_FILE, "utf8")) as Partial<EmergencyState>
    if (!j || typeof j !== "object") return { ...EMPTY }
    const kills = Array.isArray(j.kills)
      ? j.kills.filter(
          (k): k is KillEntry =>
            !!k && typeof k.deviceId === "string" && typeof k.fingerprint === "string" && typeof k.at === "string",
        )
      : []
    return {
      pinSha256: typeof j.pinSha256 === "string" && /^[0-9a-f]{64}$/.test(j.pinSha256) ? j.pinSha256 : null,
      rules:
        j.rules && typeof j.rules.unlockFailLimit === "number" && typeof j.rules.simChangeAction === "string"
          ? (j.rules as ArmRules)
          : null,
      armedAt: typeof j.armedAt === "string" ? j.armedAt : null,
      kills,
    }
  } catch {
    return { ...EMPTY }
  }
}

/** كتابة ذرّية 0600 — tmp ثم rename (نمط §37 حرفيًا). */
function writeEmergencyState(st: EmergencyState): void {
  fs.mkdirSync(path.dirname(EMERGENCY_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${EMERGENCY_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, EMERGENCY_FILE)
  try { fs.chmodSync(EMERGENCY_FILE, 0o600) } catch { /* أنظمة بلا أذونات بوزيكس */ }
}

/** مقارنة زمن-ثابتة لهاش PIN — لا تسرّب طولًا ولا توقيتًا (نمط §37). */
function pinMatches(pin: string, hash: string): boolean {
  const a = crypto.createHash("sha256").update(String(pin), "utf8").digest()
  const b = Buffer.from(hash, "hex")
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export interface ArmOutcome {
  ok: boolean
  status: number
  error?: string
  rules?: ArmRules
  notes?: string[]
  armedAt?: string
}

/** التسليح (48.د): PIN يُخزَّن هاشًا حصرًا + قواعد مطبَّقة بتطبيع صاخب. */
export async function armEmergency(pin: unknown, rulesRaw: unknown): Promise<ArmOutcome> {
  const pinS = String(pin ?? "")
  if (pinS.length < 4) {
    await appendAudit("emergency.kill.denied", false, "local", { phase: "arm", reason: "pin-too-short" })
    return { ok: false, status: 400, error: "pin-too-short" }
  }
  const { rules, notes } = normalizeArmRules(rulesRaw)
  if (!rules) {
    await appendAudit("emergency.kill.denied", false, "local", { phase: "arm", reason: "rules-unfixable" })
    return { ok: false, status: 400, error: "rules-unfixable" }
  }
  const st = readEmergencyState()
  st.pinSha256 = crypto.createHash("sha256").update(pinS, "utf8").digest("hex")
  st.rules = rules
  st.armedAt = new Date().toISOString()
  writeEmergencyState(st)
  // §39 — دليل التسليح: القواعد النهائية وملاحظات التطبيع (لا الـPIN ولا هاشه)
  await appendAudit("emergency.arm", true, "local", { rules, notes })
  return { ok: true, status: 200, rules, notes, armedAt: st.armedAt }
}

export interface KillOutcome {
  ok: boolean
  status: number
  error?: string
  reason?: string
  entry?: KillEntry
  refired?: boolean
}

/**
 * القتل النهائي (48.ب) — أحادي الاتجاه: إلحاق القائمة + تدوير رمز §37 فورًا
 * + سجل §39. الإعادة على مقتول: خاملة صادقة (refired) — لا تكديس ولا فشل.
 * إبطال الرمز هنا يعالج الأثر (فتحة المسروق على سطح المكتب) لا الهاتف —
 * الهاتف يعالجه الوكيل بنفسه عند التوصيل (48.ج) أو مسبقًا (48.د).
 */
export async function killDevice(pin: unknown, confirm: unknown, deviceId: unknown): Promise<KillOutcome> {
  const st = readEmergencyState()
  const devId = String(deviceId ?? "").trim()

  // ترتيب الحرس صادق ومعلن: التسليح ثم الكلمة ثم الجهاز ثم الـPIN
  if (!st.pinSha256 || !st.rules) {
    await appendAudit("emergency.kill.denied", false, "local", { reason: "not-armed" })
    return { ok: false, status: 409, error: "not-armed", reason: "not-armed" }
  }
  if (String(confirm ?? "") !== KILL_WORD) {
    await appendAudit("emergency.kill.denied", false, "local", { reason: "confirm-word", deviceId: devId.slice(0, 24) || null })
    return { ok: false, status: 400, error: "confirm-word-required", reason: "confirm-word" }
  }
  if (!devId) {
    await appendAudit("emergency.kill.denied", false, "local", { reason: "device-id-missing" })
    return { ok: false, status: 400, error: "device-id-required", reason: "device-id-missing" }
  }
  if (!pinMatches(String(pin ?? ""), st.pinSha256)) {
    await appendAudit("emergency.kill.denied", false, "local", { reason: "pin", deviceId: devId.slice(0, 24) })
    return { ok: false, status: 403, error: "pin-denied", reason: "pin" }
  }

  const existing = st.kills.find((k) => k.deviceId === devId)
  if (existing) {
    // إعادة خاملة: القتل واحد لا يتكرر — دليل refired ثم نجاح بلا أثر جديد
    await appendAudit("emergency.kill.refired", true, "local", { deviceId: devId.slice(0, 24), fingerprint: existing.fingerprint })
    return { ok: true, status: 200, refired: true, entry: existing }
  }

  // تدوير رمز §37 لحظة القتل — فتحة المسروق على واجهات سطح المكتب تُغلق
  const rot = rotatePairTokenNow()
  const pairRotated = !!rot
  const entry: KillEntry = {
    deviceId: devId,
    fingerprint: killFingerprint(`${devId}|${st.armedAt ?? ""}|${Date.now()}`),
    at: new Date().toISOString(),
    pairRotated,
  }
  st.kills.push(entry)
  writeEmergencyState(st)
  // §39 — دليل القتل: البصمة والتدوير من-إلى (لا PIN ولا رمز خام أبدًا)
  await appendAudit("emergency.kill", true, "local", {
    deviceId: devId.slice(0, 24),
    fingerprint: entry.fingerprint,
    pairRotated,
    pairFrom: rot?.from ?? null,
    pairTo: rot?.to ?? null,
  })
  return { ok: true, status: 200, entry }
}

/**
 * تدوير رمز §37 من هنا (لحظة القتل) — نفس مسار بابه حرفيًا. غياب ملف
 * الرمز = لا وصول خارجي أصلًا فلا شيء يُدوَّر (null صادق — ليس فشلًا).
 */
function rotatePairTokenNow(): { from: string; to: string } | null {
  let from: string | null = null
  try {
    const j = JSON.parse(fs.readFileSync(PAIR_FILE, "utf8"))
    if (j && typeof j.token === "string" && j.token.length >= 16) from = crypto.createHash("sha256").update(j.token).digest("hex").slice(0, 16)
  } catch { /* لا رمز مُمكَّن — لا تدوير */ }
  if (!from) return null
  const token = crypto.randomBytes(32).toString("base64url")
  const to = crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)
  const createdAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(PAIR_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${PAIR_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ token, fingerprint: to, createdAt }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, PAIR_FILE)
  try { fs.chmodSync(PAIR_FILE, 0o600) } catch { /* بوزيكس غائب */ }
  // دليل التدوير يمر بقناة §39 نفسها (pair.rotate من فاعل local)
  void appendAudit("pair.rotate", true, "local", { from, to, via: "emergency-kill" })
  return { from, to }
}

/** فحص قائمة القتل — من الجسر قبل أي مصافحة (48.ج). */
export function isDeviceKilled(deviceId: string): boolean {
  if (!deviceId) return false
  return readEmergencyState().kills.some((k) => k.deviceId === deviceId)
}

/** دليل إعادة إطلاق القتل عند عودة المقتول (48.ج) — من الجسر حصرًا. */
export async function noteRefired(deviceId: string): Promise<void> {
  const k = readEmergencyState().kills.find((x) => x.deviceId === deviceId)
  await appendAudit("emergency.kill.refired", true, "remote", {
    deviceId: deviceId.slice(0, 24),
    fingerprint: k?.fingerprint ?? null,
    via: "reconnect",
  })
}

/** مسار ملف الحالة — للبوابة والفحوص (لا يحمل حساسية بذاته). */
export function emergencyFilePath(): string {
  return EMERGENCY_FILE
}
