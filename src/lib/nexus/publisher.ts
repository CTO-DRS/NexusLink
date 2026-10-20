import crypto from "node:crypto"
import { db, dbReady } from "@/lib/db"
import { canonicalize } from "./marketplace"

// قناة الناشر المركزية (عقد §35.أ — إغلاق حد §34.هـ.1)
// ============================================================
// حد §34.هـ.1 الموثق: «قناة موقعة ذاتيًا — توقيع ناشر مركزي بند ما بعد M3».
// هذا البند هو إغلاقه: سجل ناشرين محلي (صفر-مخطط في DesktopSetting) يسمح
// بتعدد الناشرين الموثوقين، كل ناشر بمفاتيحه المدارة بإصدارات (kv) —
// التدوير يحفظ المفاتيح القديمة للتحقق من المثبت سابقًا، والإبطال يوقف
// الناشر لحظيًا: أي تثبيت جديد يرفض، وأي تكامل مثبت بتوقيعه يخرج عن
// «الحياة» (isPluginLive — يربطه الفرض اللحظي §35.ب).
// المفتاح لا يغادر الذاكرة أبدًا — ما يُعلن هو البصمة sha256[:16] لكل إصدار.

export const PUBLISHERS_SETTING = "market.publishers"

export interface PublisherEntry {
  name: string
  /** مفاتيح الناشر بإصداراتها — kv (رقم) → hex؛ التدوير يضيف إصدارًا لا يمسح القديم */
  keys: Record<string, string>
  currentKv: number
  revoked: boolean
}

export interface PublisherPublic {
  id: string
  name: string
  currentKv: number
  revoked: boolean
  /** بصمة المفتاح الحالي sha256[:16] — ما يُعلن وحده (لا المفتاح) */
  fp: string
  fingerprints: Record<string, string>
}

/** غلاف توقيع الناشر — الشكل المتداول في القناة والتثبيت:
 *  { manifest, sig(القناة المحلية), pub: { id, kv, sig } } — توقيع الناشر
 *  HMAC-SHA256 على canonicalize(manifest) بنفس الشكل المتعارف حرفيًا. */
export interface PublisherEnvelope {
  id: string
  kv: number
  sig: string
}

const PUB_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/

function fpOf(keyHex: string): string {
  return crypto.createHash("sha256").update(keyHex).digest("hex").slice(0, 16)
}

// ---------- السجل (DesktopSetting — صفر-مخطط) ----------

/** بذرة الناشر المالك: nexuslink-labs بإصدارين (1 و2) — التدوير واقعي في القناة
 *  نفسها: تكاملات القناة العشرة موقعة بالإصدار الحالي (2) والسابق محفوظ للتحقق. */
const PUBLISHER_SEED: Record<string, PublisherEntry> = {
  "nexuslink-labs": { name: "NexusLink Labs", keys: { "1": "", "2": "" }, currentKv: 2, revoked: false },
}

let registryCache: Promise<Record<string, PublisherEntry>> | null = null

async function loadRegistryUncached(): Promise<Record<string, PublisherEntry>> {
  await dbReady
  const row = await db.desktopSetting.findUnique({ where: { key: PUBLISHERS_SETTING } })
  if (!row?.value) {
    // أول استخدام: بذرة الناشر المالك بمفاتيح مولدة محليًا (randomBytes)
    for (const kv of Object.keys(PUBLISHER_SEED["nexuslink-labs"].keys)) {
      PUBLISHER_SEED["nexuslink-labs"].keys[kv] = crypto.randomBytes(32).toString("hex")
    }
    await db.desktopSetting.upsert({
      where: { key: PUBLISHERS_SETTING },
      create: { key: PUBLISHERS_SETTING, value: JSON.stringify(PUBLISHER_SEED) },
      update: { value: JSON.stringify(PUBLISHER_SEED) },
    })
    return PUBLISHER_SEED
  }
  try {
    const parsed = JSON.parse(row.value) as Record<string, PublisherEntry>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

/** قراءة السجل — تضمن بذرة الناشر المالك مرة واحدة بلا سباق (نداءات متزامنة
 *  تشارك وعدًا واحدًا)، وكل كتابة (تدوير/إبطال) تبطل الكاش فتعود للحقيقة. */
export async function loadRegistry(): Promise<Record<string, PublisherEntry>> {
  if (!registryCache) {
    registryCache = loadRegistryUncached().catch((e) => { registryCache = null; throw e })
  }
  return registryCache
}

async function saveRegistry(reg: Record<string, PublisherEntry>): Promise<void> {
  await db.desktopSetting.upsert({
    where: { key: PUBLISHERS_SETTING },
    create: { key: PUBLISHERS_SETTING, value: JSON.stringify(reg) },
    update: { value: JSON.stringify(reg) },
  })
  registryCache = null // إبطال الكاش — الكتابة هي الحقيقة الجديدة
}

/** قائمة الناشرين للعرض العام — بصمات حصرًا، لا مفاتيح أبدًا */
export async function listPublishers(): Promise<PublisherPublic[]> {
  const reg = await loadRegistry()
  return Object.entries(reg).map(([id, p]) => ({
    id,
    name: p.name,
    currentKv: p.currentKv,
    revoked: p.revoked,
    fp: fpOf(p.keys[String(p.currentKv)] ?? ""),
    fingerprints: Object.fromEntries(Object.keys(p.keys).map((kv) => [kv, fpOf(p.keys[kv])])),
  }))
}

// ---------- التوقيع والتحقق ----------

export function signWithPublisherKey(manifest: unknown, keyHex: string): string {
  return crypto.createHmac("sha256", keyHex).update(canonicalize(manifest)).digest("hex")
}

export type PublisherVerifyResult =
  | { ok: true; pubId: string; kv: number }
  | { ok: false; reason: "ناشر غير معروف" | "إصدار مفتاح غير معروف" | "الناشر موقوف" | "توقيع الناشر لا يطابق" }

/** التحقق من غلاف ناشر: سجل معروف → غير موقوف → إصدار مفتاح معروف → HMAC
 *  على الشكل المتعارف نفسه بـtimingSafeEqual — بلا أي تسريب توقيت. */
export async function verifyPublisherEnvelope(env: unknown, manifest: unknown): Promise<PublisherVerifyResult> {
  const e = env as Partial<PublisherEnvelope> | null
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !PUB_ID_RE.test(e.id)) {
    return { ok: false, reason: "ناشر غير معروف" }
  }
  const reg = await loadRegistry()
  const entry = reg[e.id]
  if (!entry) return { ok: false, reason: "ناشر غير معروف" }
  if (entry.revoked) return { ok: false, reason: "الناشر موقوف" }
  const kv = Math.round(Number(e.kv ?? -1))
  const keyHex = entry.keys[String(kv)]
  if (!keyHex || !/^[0-9a-f]{64}$/.test(keyHex)) return { ok: false, reason: "إصدار مفتاح غير معروف" }
  if (typeof e.sig !== "string" || !/^[0-9a-f]{64}$/.test(e.sig)) {
    return { ok: false, reason: "توقيع الناشر لا يطابق" }
  }
  const expect = signWithPublisherKey(manifest, keyHex)
  const a = Buffer.from(e.sig, "hex")
  const b = Buffer.from(expect, "hex")
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b)
  return ok ? { ok: true, pubId: e.id, kv } : { ok: false, reason: "توقيع الناشر لا يطابق" }
}

// ---------- الإدارة (تدوير/إبطال — محلي حصرًا) ----------

export type PubAdminResult =
  | { ok: true; currentKv?: number; fp?: string }
  | { ok: false; error: string }

/** تدوير مفتاح ناشر: إصدار جديد = currentKv+1 بمفتاح randomBytes — القديم
 *  يبقى للتحقق من التثبيتات السابقة (التدوير لا يُسقط شيئًا فجأة). */
export async function rotatePublisherKey(pubId: string): Promise<PubAdminResult> {
  if (!PUB_ID_RE.test(pubId)) return { ok: false, error: "معرف ناشر غير صالح" }
  const reg = await loadRegistry()
  const entry = reg[pubId]
  if (!entry) return { ok: false, error: "ناشر غير معروف" }
  const nextKv = entry.currentKv + 1
  entry.keys[String(nextKv)] = crypto.randomBytes(32).toString("hex")
  entry.currentKv = nextKv
  await saveRegistry(reg)
  return { ok: true, currentKv: nextKv, fp: fpOf(entry.keys[String(nextKv)]) }
}

export async function setPublisherRevoked(pubId: string, revoked: boolean): Promise<PubAdminResult> {
  if (!PUB_ID_RE.test(pubId)) return { ok: false, error: "معرف ناشر غير صالح" }
  const reg = await loadRegistry()
  const entry = reg[pubId]
  if (!entry) return { ok: false, error: "ناشر غير معروف" }
  entry.revoked = revoked
  await saveRegistry(reg)
  return { ok: true }
}
