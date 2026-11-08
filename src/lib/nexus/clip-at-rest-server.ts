// عقد §58 — قفل الخزنة الساكن — طبقة الخادم (مفتاح صفر-مخطط + فك عند حدود القرص)
// ============================================================
// نمط §57 حرفيًا على قاعدة البيانات بدل الملف:
//  - المفتاح DesktopSetting ‹clip.at-rest-key› (نمط §34.ب/§54/§57) يولَّد عند
//    أول كتابة قادرة ولا يعود في أي API ولا يُعرض أبدًا.
//  - القراءة شفافة: النص العاري القديم يمر كما هو (ترحيل صامت) والمختوم يُفك
//    بالمفتاح — وغير القابل للفك يُسقط فرديًا من القاعدة مع تدقيق §39
//    والقائمة تبقى حية (نمط الصدق §57).
//  - الكتابة تختم قبل ملامسة القاعدة (إن وُجد مفتاح — وتعذر الرسوخ يعني
//    كتابة نصية صادقة لا فقدان وظيفة).
//  - كل التدقيق عدّادات حصرًا — المحتوى لا يدخل الدليل (حرس F6).

import { db } from "@/lib/db"
import { appendAudit } from "@/lib/enterprise-audit"
import { clipCage } from "./clip-crypto"
import { isValidLocalKey, newLocalKey } from "./at-rest-cage"

/** مفتاح قفل الخزنة — صفر مخطط (نمط §34.ب/§54/§57): لا يعود في GET أبدًا */
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

// ---------- فك عند حدود القرص (القراءة شفافة) ----------

/** ختم قبل الكتابة: النص يُغلف (إن وُجد مفتاح) — بلا مفتاح يبقى نصًّا صادقًا */
export function sealClipContent(content: string, key: string | null): string {
  if (typeof content !== "string" || content.length === 0) return content
  if (!isValidLocalKey(key)) return content
  if (clipCage.inspect(content) === "sealed") return content // مختوم سلفًا — لا ختم مزدوج
  try {
    return clipCage.seal(content, key)
  } catch {
    return content // تعذر الختم — كتابة نصية صادقة لا فقدان وظيفة
  }
}

export type ClipOpenResult =
  | { ok: true; content: string }
  | { ok: false; error: "bad-envelope" | "no-key" | "auth-failed" }

/** فك محتوى صف: النص العاري يمر كما هو (ترحيل صامت) والمختوم يُفك شفافًا */
export function openClipContent(content: string, key: string | null): ClipOpenResult {
  if (typeof content !== "string" || content.length === 0) return { ok: true, content }
  if (clipCage.inspect(content) !== "sealed") return { ok: true, content }
  const opened = clipCage.open(content, key)
  return opened.ok ? { ok: true, content: opened.payload } : { ok: false, error: opened.error }
}

/** فك دفعة صفوف: غير القابل للفك يُسقط فرديًا — العائد نظيف كله نص صريح */
export function openClipRows<T extends { id: string; content: string }>(
  rows: T[],
  key: string | null,
): { rows: T[]; dropped: string[] } {
  const out: T[] = []
  const dropped: string[] = []
  for (const r of rows) {
    const opened = openClipContent(r.content, key)
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
 */
export async function migratePlainClipRows(rows: Array<{ id: string; content: string }>, key: string | null): Promise<number> {
  if (!isValidLocalKey(key)) return 0
  let migrated = 0
  for (const r of rows) {
    if (typeof r.content !== "string" || r.content.length === 0) continue
    if (clipCage.inspect(r.content) !== "plain") continue
    try {
      const sealed = clipCage.seal(r.content, key)
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
 */
export async function sealAllClipRows(): Promise<{ ok: boolean; error?: string; sealed?: number; active: boolean }> {
  const key = await loadClipRestKey()
  if (!isValidLocalKey(key)) {
    const ensured = await ensureClipRestKey()
    if (!isValidLocalKey(ensured)) return { ok: false, error: "no-key-store", active: false }
    return sealAllClipRows() // رُسخ المفتاح الآن — أعد المحاولة به
  }
  let sealed = 0
  let cursor: string | undefined = undefined
  try {
    for (;;) {
      const batch = await db.prodClip.findMany({
        select: { id: true, content: true },
        orderBy: { createdAt: "desc" },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      })
      if (batch.length === 0) break
      cursor = batch[batch.length - 1]!.id
      for (const r of batch) {
        if (typeof r.content !== "string" || r.content.length === 0) continue
        if (clipCage.inspect(r.content) !== "plain") continue
        try {
          await db.prodClip.update({ where: { id: r.id }, data: { content: clipCage.seal(r.content, key) } })
          sealed++
        } catch { /* صف عنيد — يعلن في العدد لا في انهيار */ }
      }
      if (batch.length < 200) break
    }
  } catch {
    return { ok: false, error: "db-unavailable", active: true }
  }
  await appendAudit("clip.crypto.sealall", true, "local", { sealed })
  return { ok: true, sealed, active: true }
}

// ---------- §58 — تدوير القفل (نمط §57: بلا عرض مفتاح إطلاقًا) ----------

/** تدوير مفتاح قفل الخزنة: جديد يُرسخ فورًا وكل الصفوف تُختم به —
 *  العاري يُختم مباشرة والمختوم يُفك بالقديم ثم يُختم بالجديد، وغير
 *  القابل للفك يُسقط فرديًا (تدقيق) — القائمة تبقى حية. */
export async function rotateClipRestKey(): Promise<{ ok: boolean; error?: string; resealed?: number; dropped?: number }> {
  const oldKey = await loadClipRestKey()
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
  let resealed = 0
  let dropped = 0
  let cursor: string | undefined = undefined
  try {
    for (;;) {
      const batch = await db.prodClip.findMany({
        select: { id: true, content: true },
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
          const opened = openClipContent(r.content, oldKey)
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
          await db.prodClip.update({ where: { id: r.id }, data: { content: clipCage.seal(plain, key) } })
          resealed++
        } catch { /* يبقى بحالته — صادق */ }
      }
      if (batch.length < 200) break
    }
  } catch {
    return { ok: false, error: "db-unavailable" }
  }
  await appendAudit("clip.crypto.rotate", true, "local", { resealed, dropped })
  return { ok: true, resealed, dropped }
}
