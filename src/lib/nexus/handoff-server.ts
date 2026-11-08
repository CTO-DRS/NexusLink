// عقد §53 — التسليم اليدوي الذكي — طبقة الخادم (ثبات صفر-مخطط + تدقيق §39 + حقائق §26)
// عقد §57 — قفل التسليم الساكن: الحمولات على القرص مغلّفة AES-256-GCM بمفتاح
// محلي مرسوخ DesktopSetting (نمط §34.ب/§54) — النص العاري القديم يُختم تلقائيًا
// عند أول كتابة، والمفتاح لا يعود في أي API، والتدوير يعيد الختم كاملًا.
// ============================================================
// مصدر الحقيقة: ملف JSON خارج المخطط (NEXUSLINK_HANDOFF_FILE أو
// .zstate/handoff.json) — حذفه = قائمة فارغة فورًا (نمط §37/§48/§49/§51).
// الكتابة ذرّية 0600 (tmp ثم rename — نمط §51) — لا نصف حالة أبدًا.
// كل فعل يُدوَّن في سلسلة §39: أسماء وأطوال وبصمات حصرًا — محتوى الحمولة
// لا يسافر إلى الدليل أبدًا (حرس F6 متوافق).

import fs from "node:fs"
import path from "node:path"
import { db } from "@/lib/db"
import { appendAudit } from "@/lib/enterprise-audit"
import { emitAutomationFact } from "./automation-facts"
import { createRateLimiter } from "./guest-core"
import { classifyClip, maskClip } from "./clip-vault-core"
import {
  validateHandoff, pushHandoffPure, pruneHandoff, publicHandoffItem,
  handoffPreviewWith, handoffFingerprint, handoffDedupeKey, actDirective,
  HANDOFF_TTL_MS, HANDOFF_RATE_PER_MIN, HANDOFF_CAP,
  type HandoffItem, type HandoffKind,
} from "./handoff-core"
import {
  inspectPayload, sealItemsPure, openPayload, isValidLocalKey,
  newLocalKey,
} from "./handoff-crypto"

const HANDOFF_FILE =
  process.env.NEXUSLINK_HANDOFF_FILE || path.join(process.cwd(), ".zstate", "handoff.json")
/** مفتاح القفل الساكن — صفر مخطط (نمط §34.ب/§54): لا يعود في GET أبدًا */
const AT_REST_KEY_SETTING = "handoff.at-rest-key"

// ---------- مفتاح §57 (DesktopSetting — صفر مخطط) ----------

async function loadRestKey(): Promise<string | null> {
  try {
    const row = await db.desktopSetting.findUnique({ where: { key: AT_REST_KEY_SETTING } })
    const v = row?.value ?? null
    return isValidLocalKey(v) ? v : null
  } catch {
    return null // قاعدة غائبة — سقوط صادق إلى وضع النص القديم
  }
}

/** توليد المفتاح عند أول كتابة قادرة — يرسخ ولا يُعرض أبدًا */
async function ensureRestKey(): Promise<string | null> {
  const existing = await loadRestKey()
  if (existing) return existing
  try {
    const key = newLocalKey()
    await db.desktopSetting.upsert({
      where: { key: AT_REST_KEY_SETTING },
      update: { value: key },
      create: { key: AT_REST_KEY_SETTING, value: key },
    })
    await appendAudit("handoff.crypto.init", true, "local", {})
    return key
  } catch {
    return null // تعذر الرسوخ — كتابة نصية صادقة لا فقدان وظيفة
  }
}

// حارس حساسية §50 — النواة نقية بلا دورة استيراد
function classifyOf(s: string): { sensitive: unknown } {
  try { return classifyClip(s) } catch { return { sensitive: null } }
}

function maskFor(payload: string, sensitive: unknown): string {
  if (!sensitive) return payload
  try { return maskClip(payload, sensitive as never) } catch {
    return "••••••"
  }
}

/** حالة القائمة من القرص — الفساد = قائمة فارغة صادقة (لا انهيار).
 *  §57: المختوم يُفك بالمفتاح، وغير القابل للفك يُسقط بصدق مع عدّه،
 *  والنص العاري القديم يبقى مقروءًا (ترحيل عند أول كتابة). */
async function readItems(key: string | null): Promise<{ items: HandoffItem[]; dropped: number }> {
  try {
    const j = JSON.parse(fs.readFileSync(HANDOFF_FILE, "utf8")) as { items?: unknown }
    if (!j || !Array.isArray(j.items)) return { items: [], dropped: 0 }
    const out: HandoffItem[] = []
    let dropped = 0
    for (const raw of j.items) {
      if (!raw || typeof raw !== "object") continue
      const o = raw as Record<string, unknown>
      if (typeof o.id !== "string" || typeof o.payload !== "string") continue
      if (typeof o.kind !== "string") continue
      if (typeof o.at !== "number" || typeof o.expiresAt !== "number") continue
      let payload = o.payload
      if (inspectPayload(payload) === "sealed") {
        const opened = openPayload(payload, key)
        if (!opened.ok) { dropped++; continue } // فساد أو مفتاح ضائع — إسقاط صادق فردي
        payload = opened.payload
      }
      out.push({
        id: o.id,
        kind: o.kind as HandoffKind,
        payload,
        sourceDevice: String(o.sourceDevice ?? "هاتف").slice(0, 60),
        note: typeof o.note === "string" ? o.note.slice(0, 140) : "",
        at: o.at,
        hits: typeof o.hits === "number" && Number.isInteger(o.hits) ? o.hits : 1,
        expiresAt: o.expiresAt,
      })
    }
    return { items: out, dropped }
  } catch {
    return { items: [], dropped: 0 }
  }
}

/** كتابة ذرّية — §57: كل نص عاري يُختم قبل ملامسة القرص (إن وُجد مفتاح) */
function writeItems(items: HandoffItem[], key: string | null): void {
  const sealedItems = items.map((it) => ({ ...it }))
  sealItemsPure(sealedItems, key)
  fs.mkdirSync(path.dirname(HANDOFF_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${HANDOFF_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ items: sealedItems }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, HANDOFF_FILE)
  try { fs.chmodSync(HANDOFF_FILE, 0o600) } catch { /* أنظمة بلا أذونات بوزيكس */ }
}

/** معاينة عامة مقنّعة لكل عنصر (حارس §50 محقون) */
export function previewsFor(items: HandoffItem[]) {
  return items.map((it) => publicHandoffItem(it, handoffPreviewWith(it.kind, it.payload, classifyOf, maskFor)))
}

const pushLimiter = createRateLimiter({ max: HANDOFF_RATE_PER_MIN, windowMs: 60_000 })

let counter = 0
export function newHandoffId(): string {
  counter = (counter + 1) % 0xffff
  return `h${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface PushResult {
  ok: boolean
  error?: string
  deduped?: boolean
  item?: ReturnType<typeof publicHandoffItem>
}

/** الدفع: تدقيق ← معدل ← تكرار ذكي ← رسوخ ← حقيقة §26 ← تدقيق §39 */
export async function pushHandoff(body: {
  kind?: unknown
  payload?: unknown
  sourceDevice?: unknown
  note?: unknown
  rateKey?: string
}): Promise<PushResult> {
  const v = validateHandoff({
    kind: String(body.kind ?? ""),
    payload: typeof body.payload === "string" ? body.payload : "",
    sourceDevice: typeof body.sourceDevice === "string" ? body.sourceDevice : undefined,
    note: typeof body.note === "string" ? body.note : undefined,
  })
  if (!v.ok) {
    await appendAudit("handoff.denied", false, "remote", { reason: v.error.slice(0, 24) })
    return { ok: false, error: v.error }
  }
  if (!pushLimiter.hit(body.rateKey ?? "push", Date.now())) {
    await appendAudit("handoff.denied", false, "remote", { reason: "rate-limited" })
    return { ok: false, error: "rate-limited" }
  }
  const now = Date.now()
  const item: HandoffItem = {
    id: newHandoffId(),
    kind: v.kind,
    payload: v.payload,
    sourceDevice: v.sourceDevice,
    note: v.note,
    at: now,
    hits: 1,
    expiresAt: now + HANDOFF_TTL_MS,
  }
  const key = await ensureRestKey()
  const { items: before, dropped } = await readItems(key)
  if (dropped > 0) await appendAudit("handoff.crypto.drop", true, "local", { dropped })
  const { items, deduped } = pushHandoffPure(before, item, now)
  writeItems(items, key)
  // عند التكرار الذكي: المُرجَع هو العنصر المرسوخ المُحدّث (hits مرفوع) لا الزائف
  const stored = items.find(
    (x) => handoffDedupeKey(x.kind, x.payload) === handoffDedupeKey(v.kind, v.payload),
  ) ?? item
  emitAutomationFact({ kind: "handoff.arrived", handoffKind: v.kind, sourceDevice: v.sourceDevice, at: now })
  await appendAudit(deduped ? "handoff.dedupe" : "handoff.arrive", true, "remote", {
    kind: v.kind, size: v.payload.length, source: v.sourceDevice,
    fp: handoffFingerprint(v.payload),
  })
  return { ok: true, deduped, item: publicHandoffItem(stored, handoffPreviewWith(v.kind, v.payload, classifyOf, maskFor)) }
}

/** العرض الحي: تقليم ثم معاينات مقنّعة — الأحدث أولًا. §57: الحالة atRest معلنة بصدق */
export async function listHandoff() {
  const now = Date.now()
  const key = await loadRestKey()
  const { items: before, dropped } = await readItems(key)
  if (dropped > 0) await appendAudit("handoff.crypto.drop", true, "local", { dropped, via: "list" })
  const live = pruneHandoff(before, now)
  if (live.length !== before.length) {
    writeItems(live, key)
    await appendAudit("handoff.prune", true, "local", { removed: before.length - live.length, kept: live.length })
  }
  live.sort((a, b) => b.at - a.at)
  return { ok: true, count: live.length, cap: HANDOFF_CAP, atRest: { active: key !== null }, items: previewsFor(live) }
}

/** الفعل على عنصر: open/copy تعيد التوجيه الإرشادي وتزيل العنصر (استُهلك) —
 *  dismiss يزيل دون فعل. الغائب 404 صادق. */
export async function actHandoff(id: string, action: "open" | "copy" | "dismiss") {
  const now = Date.now()
  const key = await loadRestKey()
  const { items: raw, dropped } = await readItems(key)
  if (dropped > 0) await appendAudit("handoff.crypto.drop", true, "local", { dropped, via: "act" })
  const items = pruneHandoff(raw, now)
  const idx = items.findIndex((it) => it.id === id)
  if (idx < 0) {
    await appendAudit("handoff.denied", false, "local", { reason: "not-found", action: action.slice(0, 12) })
    return { ok: false, error: "not-found" as const }
  }
  const it = items[idx]
  const rest = items.filter((x) => x.id !== id)
  writeItems(rest, key)
  const directive = actDirective(it.kind, it.payload)
  await appendAudit(
    action === "dismiss" ? "handoff.dismiss" : "handoff.open",
    true,
    "local",
    { kind: it.kind, size: it.payload.length, fp: handoffFingerprint(it.payload), via: action },
  )
  return { ok: true as const, directive }
}

/** تفريغ كامل — يد محلية حصرًا (الحارس في المسار) */
export async function clearHandoff() {
  const key = await loadRestKey()
  const n = (await readItems(key)).items.length
  writeItems([], key)
  await appendAudit("handoff.clear", true, "local", { removed: n })
  return { ok: true, removed: n }
}

/** §57 — تدوير القفل: مفتاح جديد يُرسخ فورًا والقائمة الحية تُختم به كاملًا.
 *  الصدق: ما لا يُفك بالمفتاح القديم يُسقط (تدقيق) — والمفتاح لا يُعرض أبدًا
 *  (خلاف §54 الذي يعرضه مرة لأنه عبارة استرجاع خارجية؛ هنا القفل داخلي حصرًا). */
export async function rotateRestKey(): Promise<{ ok: boolean; error?: string; resealed?: number; dropped?: number }> {
  const oldKey = await loadRestKey()
  const { items, dropped } = await readItems(oldKey)
  if (dropped > 0) await appendAudit("handoff.crypto.drop", true, "local", { dropped, via: "rotate" })
  const key = newLocalKey()
  try {
    await db.desktopSetting.upsert({
      where: { key: AT_REST_KEY_SETTING },
      update: { value: key },
      create: { key: AT_REST_KEY_SETTING, value: key },
    })
  } catch {
    return { ok: false, error: "key-store-unavailable" }
  }
  // كتابة مباشرة بمغلفات المفتاح الجديد (العناصر نص صريح في الذاكرة)
  const sealedItems = items.map((it) => ({ ...it }))
  sealItemsPure(sealedItems, key)
  fs.mkdirSync(path.dirname(HANDOFF_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${HANDOFF_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ items: sealedItems }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, HANDOFF_FILE)
  try { fs.chmodSync(HANDOFF_FILE, 0o600) } catch { /* بوزيكس */ }
  await appendAudit("handoff.crypto.rotate", true, "local", { resealed: sealedItems.length, dropped })
  return { ok: true, resealed: sealedItems.length, dropped }
}
