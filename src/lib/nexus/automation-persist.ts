// NexusLink — ترسيخ قواعد الروتينات في SQLite (عقد §26.ز) + إطلاقاتها (عقد §26.ح)
// ============================================================
// القاعدة الذهبية: نفس قاعدة §27 الحية (db/custom.db عبر Prisma) بلا أي مخزن
// موازٍ — CREATE TABLE IF NOT EXISTS في db.ts (نمط الترقية الآمنة §23) يضمن
// الجدول على قواعد قديمة، والقاعدة الكاملة تُخزَّن JSON في payload لتتحمل
// حقول مشغلات/أفعال مستقبلية بلا ترقية مخطط.
//
// دلالات الاستعادة عند إقلاع الجسر (§26.ز):
//  - صفوف موجودة → تُستبدل بها قواعد الذاكرة حرفيًا (بما فيها البذور بنفس
//    المعرفات — فيصحاح إحصاء الإطلاق lastFiredAt/fireCount عبر إعادة التشغيل).
//  - جدول فارغ (أول إقلاع) → البذور الحالية تُرسَّخ في القاعدة مرة واحدة.
//  - حذف قاعدة (حتى بذرية) → يبقى حذفًا: لا تعود عند الإقلاع التالي.
// سجل التشغيل يبقى في ذاكرة الجسر (آخر 80) — أما الإطلاقات الفعلية فترسخ
// في NexusAutomationFire (آخر 200، §26.ح) وتبقى بعد إعادة التشغيل، والتنبيهات
// غير المرئية تُعرض عند عودة الواجهة (§26.ح).

import { db, dbReady } from "../db"
import {
  TRIGGER_KINDS, ACTION_KINDS,
  type AutoRule, type TriggerKind, type ActionKind, type AutoFireEntry,
} from "./automation-types"

/** إحياء قاعدة من JSON مخزّن — تحقق هيكلي خفيف: الصف التالف يُتخطى بتحذير
 *  (لا يُهلِك الإقلاع كله بصف واحد فاسد من تعديل يدوي خارجي). */
function reviveRule(raw: unknown): AutoRule | null {
  try {
    if (!raw || typeof raw !== "object") return null
    const r = raw as Record<string, unknown>
    const id = typeof r.id === "string" && r.id ? r.id : null
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 80) : null
    const tr = (r.trigger ?? {}) as Record<string, unknown>
    const ac = (r.action ?? {}) as Record<string, unknown>
    const tKind = String(tr.kind ?? "")
    const aKind = String(ac.kind ?? "")
    if (!id || !name) return null
    if (!TRIGGER_KINDS.includes(tKind as never)) return null
    if (!ACTION_KINDS.includes(aKind as never)) return null
    const createdAt = Number(r.createdAt)
    return {
      id,
      name,
      enabled: r.enabled !== false,
      trigger: { ...tr, kind: tKind as TriggerKind },
      action: { ...ac, kind: aKind as ActionKind },
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
      lastFiredAt: typeof r.lastFiredAt === "number" && r.lastFiredAt > 0 ? r.lastFiredAt : null,
      fireCount: Number.isFinite(Number(r.fireCount)) && Number(r.fireCount) > 0 ? Math.round(Number(r.fireCount)) : 0,
    }
  } catch {
    return null
  }
}

/** استعادة القواعد من القاعدة عند الإقلاع — null = لا صفوف (أول إقلاع: أرسِخ
 *  البذور) أو فشل وصول (تبقى قواعد الذاكرة كما هي بلا هلع). */
export async function loadPersistedRules(): Promise<AutoRule[] | null> {
  try {
    await dbReady
    const rows = await db.nexusAutomationRule.findMany({ orderBy: { createdAt: "asc" } })
    if (!rows.length) return null
    const revived = rows
      .map((row) => { try { return reviveRule(JSON.parse(row.payload)) } catch { return null } })
      .filter((r): r is AutoRule => r !== null)
    // صفوف فاسدة تُنقَّح من القاعدة نفسها — لا تتراكم أجسامًا لا تُحيى
    const validIds = new Set(revived.map((r) => r.id))
    const dead = rows.filter((row) => !validIds.has(row.id))
    for (const row of dead) {
      try { await db.nexusAutomationRule.delete({ where: { id: row.id } }) } catch { /* ignore */ }
    }
    return revived
  } catch (e) {
    console.error("[auto-persist] load failed:", e instanceof Error ? e.message : e)
    return null
  }
}

/** ترسيخ قاعدة واحدة (إنشاء/تحديث) — fire-and-forget من الجسر: فشل الترسيخ
 *  يُسجَّل ويظهر بصدق لكنه لا يمنع عمل القاعدة في الذاكرة. */
export async function persistRuleUpsert(rule: AutoRule): Promise<boolean> {
  try {
    await dbReady
    const payload = JSON.stringify(rule)
    await db.nexusAutomationRule.upsert({
      where: { id: rule.id },
      create: { id: rule.id, name: rule.name, enabled: rule.enabled, payload },
      update: { name: rule.name, enabled: rule.enabled, payload },
    })
    return true
  } catch (e) {
    console.error("[auto-persist] upsert failed:", e instanceof Error ? e.message : e)
    return false
  }
}

/** ترسيخ حذف قاعدة — غياب الصف مقبول (idempotent). */
export async function persistRuleDelete(id: string): Promise<boolean> {
  try {
    await dbReady
    await db.nexusAutomationRule.deleteMany({ where: { id } })
    return true
  } catch (e) {
    console.error("[auto-persist] delete failed:", e instanceof Error ? e.message : e)
    return false
  }
}

// ============================ الإطلاقات المرسوخة (§26.ح) ============================

/** سقف الاحتفاظ بإطلاقات الروتينات — آخر 200 إطلاق فحسب (تنقية بعد كل كتابة). */
export const MAX_PERSISTED_FIRES = 200

/** إحياء إطلاق من صف SQLite — تحقق هيكلي خفيف (الصف التالف يُتخطى). */
function reviveFire(row: { id: string; ruleId: string; ruleName: string; at: Date; ok: boolean; detail: string; manual: boolean; seenAt: Date | null }): AutoFireEntry | null {
  try {
    const at = row.at?.getTime?.() ?? 0
    if (!row.id || !row.ruleId || !row.ruleName || !Number.isFinite(at) || at <= 0) return null
    return {
      id: row.id,
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      at,
      ok: row.ok !== false,
      detail: typeof row.detail === "string" ? row.detail : "",
      manual: row.manual === true,
      seenAt: row.seenAt ? row.seenAt.getTime() : null,
    }
  } catch {
    return null
  }
}

/** ترسيخ إطلاق واحد + تنقية ما تجاوز السقف (fire-and-forget من الجسر — فشل
 *  الترسيخ يُسجَّل بصدق ولا يمنع عمل الإشعار الحي). */
export async function persistFire(entry: AutoFireEntry): Promise<boolean> {
  try {
    await dbReady
    await db.nexusAutomationFire.create({
      data: {
        id: entry.id,
        ruleId: entry.ruleId,
        ruleName: entry.ruleName,
        at: new Date(entry.at),
        ok: entry.ok,
        detail: entry.detail,
        manual: entry.manual,
        seenAt: entry.seenAt ? new Date(entry.seenAt) : null,
      },
    })
    // التنقية: أبقِ آخر MAX_PERSISTED_FIRES — احذف ما أقدم من نافذة السقف
    const cutoff = await db.nexusAutomationFire.findMany({
      orderBy: { at: "desc" },
      take: MAX_PERSISTED_FIRES,
      select: { at: true },
    })
    if (cutoff.length === MAX_PERSISTED_FIRES) {
      await db.nexusAutomationFire.deleteMany({ where: { at: { lt: cutoff[cutoff.length - 1].at } } })
    }
    return true
  } catch (e) {
    console.error("[auto-persist] fire persist failed:", e instanceof Error ? e.message : e)
    return false
  }
}

/** استعادة آخر الإطلاقات المرسوخة عند إقلاع الجسر — null = جدول فارغ أو فشل
 *  وصول (تبقى الذاكرة كما هي بلا هلع). الصفوف الفاسدة تُنقّى من القاعدة نفسها. */
export async function loadPersistedFires(): Promise<AutoFireEntry[] | null> {
  try {
    await dbReady
    const rows = await db.nexusAutomationFire.findMany({ orderBy: { at: "desc" }, take: MAX_PERSISTED_FIRES })
    const revived = rows.map(reviveFire).filter((f): f is AutoFireEntry => f !== null)
    // صفوف فاسدة تُنقّى — لا تتراكم أجسامًا لا تُحيى
    const validIds = new Set(revived.map((f) => f.id))
    const dead = rows.filter((row) => !validIds.has(row.id))
    for (const row of dead) {
      try { await db.nexusAutomationFire.delete({ where: { id: row.id } }) } catch { /* ignore */ }
    }
    return revived
  } catch (e) {
    console.error("[auto-persist] fires load failed:", e instanceof Error ? e.message : e)
    return null
  }
}

/** تعليم كل الإطلاقات غير المرئية كمقروءة (زر «تعليم الكل كمقروء») —
 *  رسوخًا: تعيش لحظة الرؤية عبر إعادة التشغيل. */
export async function markFiresSeenDb(now: number): Promise<boolean> {
  try {
    await dbReady
    await db.nexusAutomationFire.updateMany({
      where: { seenAt: null },
      data: { seenAt: new Date(now) },
    })
    return true
  } catch (e) {
    console.error("[auto-persist] mark-seen failed:", e instanceof Error ? e.message : e)
    return false
  }
}
