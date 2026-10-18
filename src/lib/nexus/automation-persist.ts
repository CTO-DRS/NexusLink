// NexusLink — ترسيخ قواعد الروتينات في SQLite (عقد §26.ز)
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
// سجل التشغيل يبقى في ذاكرة الجسر (آخر 80) — موثق في §26.ز.

import { db, dbReady } from "../db"
import {
  TRIGGER_KINDS, ACTION_KINDS,
  type AutoRule, type TriggerKind, type ActionKind,
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
