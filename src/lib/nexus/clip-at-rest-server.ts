// عقد §58 — قفل الخزنة الساكن — طبقة الخادم (مفتاح صفر-مخطط + فك عند حدود القرص)
// عقد §59 — خزنة الأجهزة المتعددة: حلقة مفاتيح (مفتاح لكل جهاز بدل المفتاح
// الواحد — إغلاق الحد المعلن حرفيًا) — الجديد فوق §58:
//  - حلقة الأقفال loadClipKeyRing: المفتاح الموحد القديم (ترحيل) + مفاتيح
//    الأجهزة المرسوخة (DesktopSetting ‹clip.at-rest-key:<deviceId› صفر-مخطط).
//  - الكتابة تُختم بمفتاح جهاز صاحبها (kid مشتق حتمي يُعلن بالمغلف) —
//    وتسريب مفتاح جهاز لا يفتح بايتًا من بقية الأجهزة (عزل مفاتيح).
//  - القراءة شفافة عبر حلال الحلقة (kid ← مفتاح، وv1 بلا kid ← القديم) —
//    وغير القابل للفك يُسقط فرديًا من القاعدة مع تدقيق §39 والقائمة حية.
//  - تدوير جديد: شامل (كل المفاتيح) أو جهاز مفرد rotate-key {deviceId} —
//    المفرد لا يلمس بايت صفوف الأجهزة الأخرى حرفيًا (برهان البوابة البايتي).
//  - كل التدقيق عدّادات حصرًا — المحتوى لا يدخل الدليل (حرس F6).

import { db } from "@/lib/db"
import { appendAudit } from "@/lib/enterprise-audit"
import { clipCage } from "./clip-crypto"
import { atRestKid, isValidLocalKey, newLocalKey, type AtRestKeySource } from "./at-rest-cage"
import {
  CLIP_DEV_KEY_PREFIX, deviceSettingKey, kidForKey, ringKeyCount, ringResolver,
  type ClipKeyEntry, type ClipKeyRing,
} from "./clip-multikey"

/** مفتاح قفل الخزنة الموحد (§58 — يبقى مفتاح ترحيل المغلفات بلا kid) */
const CLIP_AT_REST_KEY_SETTING = "clip.at-rest-key"

// ---------- مفتاح §58 (DesktopSetting — صفر مخطط) ----------

export async function loadClipRestKey(): Promise<string | null> {
  try {
    const row = await db.desktopSetting.findUnique({ where: { key: CLIP_AT_REST_KEY_SETTING } })
    const v = row?.value ?? null
    return isValidLocalKey(v) ? v : null
  } catch {
    return null // قاعدة غائبة — سقوط صادق إلى وضع النص القديم
  }
}

/** توليد المفتاح عند أول كتابة قادرة — يرسخ ولا يُعرض أبدًا */
export async function ensureClipRestKey(): Promise<string | null> {
  const existing = await loadClipRestKey()
  if (existing) return existing
  try {
    const key = newLocalKey()
    await db.desktopSetting.upsert({
      where: { key: CLIP_AT_REST_KEY_SETTING },
      update: { value: key },
      create: { key: CLIP_AT_REST_KEY_SETTING, value: key },
    })
    await appendAudit("clip.crypto.init", true, "local", {})
    return key
  } catch {
    return null // تعذر الرسوخ — كتابة نصية صادقة لا فقدان وظيفة
  }
}

// ---------- §59 — حلقة مفاتيح الأجهزة (الموحد + لكل جهاز مفتاحه) ----------

/** حلقة الأقفال: المفتاح الموحد + كل مفاتيح الأجهزة المرسوخة — تُقرأ مرة
 *  لكل طلب/دفعة ويحل بها كل المغلفات (kid ← مفتاحه، وv1 بلا kid ← القديم) */
export async function loadClipKeyRing(): Promise<ClipKeyRing> {
  let legacy: string | null = null
  try {
    const row = await db.desktopSetting.findUnique({ where: { key: CLIP_AT_REST_KEY_SETTING } })
    const v = row?.value ?? null
    if (isValidLocalKey(v)) legacy = v
  } catch { /* قاعدة غائبة — حلقة فارغة صادقة */ }
  const byKid = new Map<string, ClipKeyEntry>()
  const byDevice = new Map<string, ClipKeyEntry>()
  try {
    const rows = await db.desktopSetting.findMany({
      where: { key: { startsWith: CLIP_DEV_KEY_PREFIX } },
      select: { key: true, value: true },
    })
    for (const r of rows) {
      const dev = r.key.slice(CLIP_DEV_KEY_PREFIX.length)
      if (!isValidLocalKey(r.value)) continue
      if (deviceSettingKey(dev) !== r.key) continue // اسم شارد — يُتجاهل بصدق
      const e: ClipKeyEntry = { device: dev, kid: kidForKey(r.value), key: r.value }
      byKid.set(e.kid, e)
      byDevice.set(dev, e)
    }
  } catch { /* حلقة أجهزة فارغة — القديم يكفي (ترحيل) */ }
  const legacyKid = legacy ? kidForKey(legacy) : null
  return { legacy, legacyKid, byKid, byDevice, resolver: ringResolver(legacy, byKid) }
}

/** مفتاح جهاز صاحب الكتابة: المرسوخ إن وجد وإلا يُولد ويرسوخ —
 *  deviceId الشارد أو تعذر الرسوخ يرجع للمفتاح الموحد (سلوك §58 الصادق:
 *  كتابة نصية إن تعذر كل شيء) — والkid مشتق حتميًا لا يُخزن أصلًا */
export async function ensureClipKeyFor(deviceId: string): Promise<{ key: string | null; kid: string | null }> {
  const settingKey = deviceSettingKey(deviceId)
  if (settingKey) {
    try {
      const row = await db.desktopSetting.findUnique({ where: { key: settingKey } })
      if (isValidLocalKey(row?.value)) return { key: row.value, kid: kidForKey(row.value) }
      const key = newLocalKey()
      await db.desktopSetting.upsert({
        where: { key: settingKey },
        update: { value: key },
        create: { key: settingKey, value: key },
      })
      await appendAudit("clip.crypto.multi.init", true, "local", {})
      return { key, kid: kidForKey(key) }
    } catch { /* تعذر رسوخ جهازه — يرجع للموحد بصدق */ }
  }
  const legacy = await ensureClipRestKey()
  return { key: legacy, kid: legacy ? kidForKey(legacy) : null }
}

// ---------- فك عند حدود القرص (القراءة شفافة) ----------

/** ختم قبل الكتابة: النص يُغلف (إن وُجد مفتاح) — بلا مفتاح يبقى نصًّا صادقًا
 *  §59: kid جهاز الصاحب يُلحق بالمغلف إن قُدم (عنوان الحلقة المعلن) */
export function sealClipContent(content: string, key: string | null, kid?: string | null): string {
  if (typeof content !== "string" || content.length === 0) return content
  if (!isValidLocalKey(key)) return content
  if (clipCage.inspect(content) === "sealed") return content // مختوم سلفًا — لا ختم مزدوج
  try {
    return clipCage.seal(content, key, kid)
  } catch {
    return content // تعذر الختم — كتابة نصية صادقة لا فقدان وظيفة
  }
}

export type ClipOpenResult =
  | { ok: true; content: string }
  | { ok: false; error: "bad-envelope" | "no-key" | "auth-failed" }

/** فك محتوى صف: النص العاري يمر كما هو (ترحيل صامت) والمختوم يُفك شفافًا
 *  §59: المصدر مفتاح مفرد (توافق §58) أو حلال حلقة الأجهزة (kid ← مفتاحه) */
export function openClipContent(content: string, keys: AtRestKeySource): ClipOpenResult {
  if (typeof content !== "string" || content.length === 0) return { ok: true, content }
  if (clipCage.inspect(content) !== "sealed") return { ok: true, content }
  const opened = clipCage.open(content, keys)
  return opened.ok ? { ok: true, content: opened.payload } : { ok: false, error: opened.error }
}

/** فك دفعة صفوف: غير القابل للفك يُسقط فرديًا — العائد نظيف كله نص صريح */
export function openClipRows<T extends { id: string; content: string }>(
  rows: T[],
  keys: AtRestKeySource,
): { rows: T[]; dropped: string[] } {
  const out: T[] = []
  const dropped: string[] = []
  for (const r of rows) {
    const opened = openClipContent(r.content, keys)
    if (!opened.ok) {
      dropped.push(r.id)
      continue
    }
    r.content = opened.content // الفك عند حدود القرص: الصف يغادر بنصه الصريح
    out.push(r)
  }
  return { rows: out, dropped }
}

/** إسقاط صادق فردي من القاعدة للصفوف التي فشل فكها — القائمة تبقى حية */
export async function dropUnopenableClipRows(ids: string[], via: string): Promise<number> {
  let n = 0
  for (const id of ids) {
    try {
      await db.prodClip.delete({ where: { id } })
      n++
    } catch { /* حُذف بتوازٍ — لا شيء */ }
  }
  if (n > 0) await appendAudit("clip.crypto.drop", true, "local", { dropped: n, via: via.slice(0, 16) })
  return n
}

// ---------- الترحيل الصامت + ختم السجل ----------

/**
 * ختم النص العاري لصفوف قُرئت للتو (ترحيل صامت — نمط §57): التحديث في
 * القاعدة حصرًا، والذاكرة تبقى نصًّا صريحًا للعرض. الفارغ لا يُختم.
 * §59: كل صف يُختم بمفتاح جهازه من الحلقة (الغائب يرجع للموحد) —
 * بلا توليد مفاتيح على مسار القراءة أبدًا (التوليد كتابة فقط).
 */
export async function migratePlainClipRows(
  rows: Array<{ id: string; content: string; deviceId?: string }>,
  ring: ClipKeyRing,
): Promise<number> {
  if (!ring.legacy && ring.byKid.size === 0) return 0
  let migrated = 0
  for (const r of rows) {
    if (typeof r.content !== "string" || r.content.length === 0) continue
    if (clipCage.inspect(r.content) !== "plain") continue
    const devKey = r.deviceId ? ring.byDevice.get(r.deviceId) : undefined
    const key = devKey?.key ?? ring.legacy
    if (!isValidLocalKey(key)) continue
    try {
      const sealed = clipCage.seal(r.content, key, devKey?.kid)
      await db.prodClip.update({ where: { id: r.id }, data: { content: sealed } })
      // الذاكرة تبقى نصًّا صريحًا للعرض — الختم في القاعدة حصرًا (نمط §57)
      migrated++
    } catch { /* صف عنيد — يبقى نصًّا صادقًا حتى الكتابة التالية */ }
  }
  return migrated
}

/**
 * ختم السجل كاملًا بإرادة صريحة (فعل «ختم السجل»): كل النص العاري فوق
 * القاعدة يُختم — صفحة صفحة بأخذ مؤشري حتى لا تُبتلع جداول كبيرة.
 * §59: كل صف يُختم بمفتاح جهازه (التوليد عند أول ختم لجهاز — فعل صريح).
 */
export async function sealAllClipRows(): Promise<{ ok: boolean; error?: string; sealed?: number; keys?: number; active: boolean }> {
  let ring = await loadClipKeyRing()
  if (!ring.legacy && ring.byKid.size === 0) {
    const ensured = await ensureClipRestKey()
    if (!isValidLocalKey(ensured)) return { ok: false, error: "no-key-store", active: false }
    ring = await loadClipKeyRing()
  }
  const devKeys = new Map<string, { key: string | null; kid: string | null }>()
  let sealed = 0
  let cursor: string | undefined = undefined
  try {
    for (;;) {
      const batch = await db.prodClip.findMany({
        select: { id: true, content: true, deviceId: true },
        orderBy: { createdAt: "desc" },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      })
      if (batch.length === 0) break
      cursor = batch[batch.length - 1]!.id
      for (const r of batch) {
        if (typeof r.content !== "string" || r.content.length === 0) continue
        if (clipCage.inspect(r.content) !== "plain") continue
        let dev = r.deviceId ? devKeys.get(r.deviceId) : undefined
        if (!dev && r.deviceId) {
          dev = await ensureClipKeyFor(r.deviceId)
          devKeys.set(r.deviceId, dev)
        }
        const key = dev?.key ?? ring.legacy
        if (!isValidLocalKey(key)) continue
        try {
          await db.prodClip.update({
            where: { id: r.id },
            data: { content: clipCage.seal(r.content, key, dev?.kid ?? undefined) },
          })
          sealed++
        } catch { /* صف عنيد — يعلن في العدد لا في انهيار */ }
      }
      if (batch.length < 200) break
    }
  } catch {
    return { ok: false, error: "db-unavailable", active: true }
  }
  const final = await loadClipKeyRing()
  await appendAudit("clip.crypto.sealall", true, "local", { sealed })
  return { ok: true, sealed, keys: ringKeyCount(final), active: true }
}

// ---------- §58/§59 — تدوير الأقفال (نمط §57: بلا عرض مفتاح إطلاقًا) ----------

/**
 * §59 — مشي سجل العمليات (ProdOpLog ‹clip:new›) بإعادة ختم موجّهة —
 * إغلاق فجوة §58 الصادقة التي أمسكتها بوابة §59: تدوير المفاتيح كان يعيد
 * ختم صفوف القاعدة ويترك مغلفات السجل بمفتاحها القديم المُنسى — فتعود
 * الإعادة المحلية (prod:resume) بيانات وصفية فقط للعمليات السابقة للتدوير.
 * المشي: دفعة بمؤشر seq ← فك بالحلقة القديمة ← ختم بمفتاح الجهاز الجديد
 * (عبر فعل يقرر لكل عملية — يعيد النص الجديد أو null للترك) — غير القابل
 * للفك يُترك كما هو (يعود بيانات وصفية بصدق عند الإعادة — سلوك §58 المعلن).
 */
async function resealOplogClips(
  decide: (opDeviceId: string, envKid: string | null) => { key: string | null; kid: string | null } | null,
  oldRing: ClipKeyRing,
): Promise<number> {
  let resealed = 0
  let cursor = 0
  try {
    for (;;) {
      const batch = await db.$queryRawUnsafe<{ seq: number | bigint; opId: string; deviceId: string; payload: string }[]>(
        `SELECT "seq","opId","deviceId","payload" FROM "ProdOpLog" WHERE "kind" = 'clip:new' AND "seq" > ? ORDER BY "seq" ASC LIMIT 200`,
        cursor,
      )
      if (batch.length === 0) break
      cursor = Number(batch[batch.length - 1]!.seq)
      for (const op of batch) {
        let payload: Record<string, unknown>
        try { payload = JSON.parse(String(op.payload)) as Record<string, unknown> } catch { continue }
        const c = payload.content
        if (typeof c !== "string" || c.length === 0) continue
        const envKid = atRestKid(c)
        const isSealed = clipCage.inspect(c) === "sealed"
        const target = decide(String(op.deviceId), isSealed ? envKid : null)
        if (!target || !isValidLocalKey(target.key)) continue
        let plain: string | null = null
        if (isSealed) {
          const opened = openClipContent(c, oldRing.resolver)
          if (!opened.ok) continue // غير قابل للفك — يبقى بيانات وصفية بصدق عند الإعادة
          plain = opened.content
        } else {
          plain = c // عاري في السجل — يُختم الآن (ترحيل السجل)
        }
        try {
          const sealed = clipCage.seal(plain, target.key, target.kid)
          payload.content = sealed
          await db.$executeRawUnsafe(`UPDATE "ProdOpLog" SET "payload" = ? WHERE "opId" = ?`, JSON.stringify(payload), op.opId)
          resealed++
        } catch { /* عملية عنيدة — تبقى بحالها صادقة */ }
      }
      if (batch.length < 200) break
    }
  } catch { /* سجل غائب — لا تدوير للسجل (سقوط صادق) */ }
  return resealed
}

/** §59 — تدوير شامل: مفاتيح جديدة للموحد وكل الأجهزة المرسوخة، وكل الصفوف
 *  تُختم بمفتاح جهازها الجديد — العاري يُختم مباشرة والمختوم يُفك بالحلقة
 *  القديمة ثم يُختم بالجديد، وغير القابل للفك يُسقط فرديًا (تدقيق) —
 *  القائمة تبقى حية. العائد يعلن عدد الأقفال المدوّرة. */
export async function rotateClipRestKey(): Promise<{ ok: boolean; error?: string; resealed?: number; dropped?: number; keys?: number }> {
  const oldRing = await loadClipKeyRing()
  const key = newLocalKey()
  try {
    await db.desktopSetting.upsert({
      where: { key: CLIP_AT_REST_KEY_SETTING },
      update: { value: key },
      create: { key: CLIP_AT_REST_KEY_SETTING, value: key },
    })
  } catch {
    return { ok: false, error: "key-store-unavailable" }
  }
  // مفاتيح جديدة لكل جهاز مرسوخ سلفًا (والجديدة لاحقًا تتولد عند كتابتها)
  const newDev = new Map<string, { key: string; kid: string }>()
  for (const [dev, e] of oldRing.byDevice) {
    const nk = newLocalKey()
    const settingKey = deviceSettingKey(dev)
    if (!settingKey) continue
    try {
      await db.desktopSetting.upsert({
        where: { key: settingKey },
        update: { value: nk },
        create: { key: settingKey, value: nk },
      })
      newDev.set(dev, { key: nk, kid: kidForKey(nk) })
    } catch { /* جهاز عنيد — صفوفه تبقى بمغلفاتها حتى تدويره المفرد */ }
  }
  let resealed = 0
  let dropped = 0
  let cursor: string | undefined = undefined
  try {
    for (;;) {
      const batch = await db.prodClip.findMany({
        select: { id: true, content: true, deviceId: true },
        orderBy: { createdAt: "desc" },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      })
      if (batch.length === 0) break
      cursor = batch[batch.length - 1]!.id
      for (const r of batch) {
        if (typeof r.content !== "string" || r.content.length === 0) continue
        let plain: string
        if (clipCage.inspect(r.content) === "sealed") {
          const opened = openClipContent(r.content, oldRing.resolver)
          if (!opened.ok) {
            try {
              await db.prodClip.delete({ where: { id: r.id } })
              dropped++
            } catch { /* حُذف بتوازٍ */ }
            continue
          }
          plain = opened.content
        } else {
          plain = r.content
        }
        const nd = r.deviceId ? newDev.get(r.deviceId) : undefined
        const sealKey = nd?.key ?? key
        try {
          await db.prodClip.update({
            where: { id: r.id },
            data: { content: clipCage.seal(plain, sealKey, nd?.kid) },
          })
          resealed++
        } catch { /* يبقى بحالته — صادق */ }
      }
      if (batch.length < 200) break
    }
  } catch {
    return { ok: false, error: "db-unavailable" }
  }
  const final = await loadClipKeyRing()
  // §59 — إعادة ختم مغلفات السجل بالمفاتيح الجديدة — الإعادة المحلية تبقى شفافة بعد التدوير
  const oplog = await resealOplogClips((dev) => {
    const nd = newDev.get(dev)
    return { key: nd?.key ?? key, kid: nd?.kid ?? null }
  }, oldRing)
  await appendAudit("clip.crypto.rotate", true, "local", { resealed, dropped, oplog })
  return { ok: true, resealed, dropped, keys: ringKeyCount(final) }
}

/** §59 — تدوير جهاز مفرد: مفتاح جديد لجهازه وإعادة ختم صفوفه حصرًا —
 *  الصف يُنسب لمفتاح الجهاز بkid مغلفه (وبعمود deviceId للعاري/v1) —
 *  صفوف الأجهزة الأخرى لا تُمس بايتيًا حرفيًا (برهان البوابة)، وغير القابل
 *  للفك من صفوف هذا الجهاز يُسقط بصدق (قفلُه قُضي على). */
export async function rotateClipKeyFor(deviceId: string): Promise<
  { ok: boolean; error?: string; resealed?: number; dropped?: number; device?: string; kid?: string; oplog?: number } |
  { ok: false; error: "invalid-device" }
> {
  const settingKey = deviceSettingKey(deviceId)
  if (!settingKey) return { ok: false, error: "invalid-device" }
  const ring = await loadClipKeyRing()
  const oldEntry = ring.byDevice.get(deviceId) ?? null
  const nk = newLocalKey()
  try {
    await db.desktopSetting.upsert({
      where: { key: settingKey },
      update: { value: nk },
      create: { key: settingKey, value: nk },
    })
  } catch {
    return { ok: false, error: "key-store-unavailable" }
  }
  const newKid = kidForKey(nk)
  let resealed = 0
  let dropped = 0
  let cursor: string | undefined = undefined
  try {
    for (;;) {
      const batch = await db.prodClip.findMany({
        select: { id: true, content: true, deviceId: true },
        orderBy: { createdAt: "desc" },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      })
      if (batch.length === 0) break
      cursor = batch[batch.length - 1]!.id
      for (const r of batch) {
        if (typeof r.content !== "string" || r.content.length === 0) continue
        // النسب: kid المغلف (المرسوخ) أو عمود الصف (العاري وv1 بلا kid)
        const kid = atRestKid(r.content)
        const mine = kid !== null ? kid === oldEntry?.kid : r.deviceId === deviceId
        if (!mine) continue // صف جهاز آخر — لا يُمس بايتيًا
        let plain: string
        if (clipCage.inspect(r.content) === "sealed") {
          const opened = openClipContent(r.content, ring.resolver)
          if (!opened.ok) {
            try {
              await db.prodClip.delete({ where: { id: r.id } })
              dropped++
            } catch { /* حُذف بتوازٍ */ }
            continue
          }
          plain = opened.content
        } else {
          plain = r.content
        }
        try {
          await db.prodClip.update({
            where: { id: r.id },
            data: { content: clipCage.seal(plain, nk, newKid) },
          })
          resealed++
        } catch { /* يبقى بحالته — صادق */ }
      }
      if (batch.length < 200) break
    }
  } catch {
    return { ok: false, error: "db-unavailable" }
  }
  await appendAudit("clip.crypto.rotate.dev", true, "local", { resealed, dropped })
  // §59 — إعادة ختم عمليات هذا الجهاز في السجل (المختوم بkid القديم أو العاري ب deviceIdه)
  const oplog = await resealOplogClips((dev, kid) => {
    if (dev !== deviceId) return null
    if (kid !== null && kid !== oldEntry?.kid) return null
    return { key: nk, kid: newKid }
  }, ring)
  return { ok: true, resealed, dropped, device: deviceId, kid: newKid, oplog }
}
