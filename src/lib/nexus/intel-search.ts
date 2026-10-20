// NexusLink — البحث الموحد (عقد §33.أ — M2.3)
// ============================================================
// بحث واحد عبر الهاتف والحاسوب من شريط واحد — فوق المخازن المحلية القائمة
// حصريًا: سجل الأجهزة (ذاكرة الجسر) · قواعد الروتينات (NexusAutomationRule)
// · الحافظة الموحدة (ProdClip) · الرسائل والمحادثات (NexusMessage/Conversation
// — مزامنة الهاتف القائمة) · جهات الاتصال (NexusContact) · سجل النداءات
// (NexusCallLog) · التسليم المتصل (HandoffItem) · أحداث المزامنة (SyncEvent
// مسارات الملفات). صفر بايت يغادر الجهاز — كل الاستعلامات SQLite/ذاكرة محلية.
//
// الدرجات: تطابق البادئة 3 > الاحتواء 2 > التسلسل الفرعي 1 — والترتيب داخل
// المجموعة بالدرجة ثم الجدة. لكل مجموعة سقف 8 ولهذا البحث كله سقف 40 نتيجة
// (استجابة فورية على بيانات حية بلا فهرسة ثقيلة).
import { db, dbReady } from "../db"
import { store } from "./devices"

export type SearchKind = "device" | "routine" | "clip" | "message" | "contact" | "call" | "handoff" | "file"

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  device: "الأجهزة",
  routine: "الروتينات",
  clip: "الحافظة",
  message: "الرسائل",
  contact: "جهات الاتصال",
  call: "النداءات",
  handoff: "التسليم المتصل",
  file: "الملفات المتزامنة",
}

export interface SearchItem {
  id: string
  title: string
  snippet?: string
  at?: number
  score: number
  /** العرض الذي يقفز إليه الاختيار في الواجهة (أفضل جهد). */
  view?: string
}

export interface SearchGroup {
  kind: SearchKind
  label: string
  items: SearchItem[]
}

export interface SearchResult {
  ok: boolean
  q: string
  total: number
  took: number
  groups: SearchGroup[]
}

const GROUP_CAP = 8
const TOTAL_CAP = 40

/** تطهير استعلام البحث: طول 1..80، وتسطيح المحارف الضابطة. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80)
  return q.length ? q : null
}

/** درجة تطابق نص واحد مع الاستعلام (بلا حساس حالة للألف اللاتيني). */
function scoreText(text: string | null | undefined, q: string, qLower: string): number {
  if (!text) return 0
  const t = String(text)
  const tl = t.toLowerCase()
  if (tl.startsWith(qLower)) return 3
  if (tl.includes(qLower)) return 2
  // تسلسل فرعي (حروف الاستعلام بالترتيب داخل النص) — يلتقط "gs24" في "Galaxy-S24"
  let i = 0
  for (const ch of tl) {
    if (ch === qLower[i]) i++
    if (i >= qLower.length) return 1
  }
  return 0
}

function pushHit(map: Map<SearchKind, SearchItem[]>, kind: SearchKind, item: SearchItem) {
  if (item.score <= 0) return
  const arr = map.get(kind) ?? []
  arr.push(item)
  map.set(kind, arr)
}

/** البحث الموحد الكامل — كل المصادر بالتوازي وأي فشل مصدر لا يُسقط البقية. */
export async function searchAll(qRaw: string): Promise<SearchResult> {
  const t0 = Date.now()
  const q = cleanQuery(qRaw) ?? ""
  const qLower = q.toLowerCase()
  const hits = new Map<SearchKind, SearchItem[]>()

  // 1) الأجهزة — من ذاكرة الجسر (متزامنة مع الحالة الحية)
  try {
    for (const d of store().devices) {
      pushHit(hits, "device", {
        id: d.id, score: Math.max(scoreText(d.name, q, qLower), scoreText(d.id, q, qLower)),
        title: d.name, snippet: `${d.kind} · ${d.state}${d.battery != null ? ` · ${d.battery}%` : ""}`, view: "devices",
      })
    }
  } catch { /* السجل غير جاهز */ }

  // 2) الروتينات — القواعد المرسوخة (قراءة محضة من نفس مصدر الجسر)
  try {
    await dbReady
    const rows = await db.nexusAutomationRule.findMany({ select: { id: true, name: true, enabled: true, payload: true } })
    for (const row of rows) {
      let trig = "?", act = "?"
      try {
        const p = JSON.parse(row.payload) as { trigger?: { kind?: string }; action?: { kind?: string } }
        trig = p?.trigger?.kind ?? "?"
        act = p?.action?.kind ?? "?"
      } catch { /* صف فاسد: الاسم يكفي للنتيجة */ }
      pushHit(hits, "routine", {
        id: row.id, score: scoreText(row.name, q, qLower),
        title: row.name, snippet: `${trig} → ${act}${row.enabled ? "" : " · معطلة"}`, view: "automation",
      })
    }
  } catch { /* ignore */ }

  // 3) الحافظة الموحدة — آخر 500 مقطع (جدول مرسوخ محلي)
  try {
    await dbReady
    const clips = await db.prodClip.findMany({ orderBy: { createdAt: "desc" }, take: 500, select: { id: true, content: true, fileName: true, filePath: true, kind: true, deviceName: true, createdAt: true } })
    for (const c of clips) {
      const s = Math.max(scoreText(c.fileName, q, qLower), scoreText(c.filePath, q, qLower), c.kind === "text" ? scoreText(c.content, q, qLower) : 0)
      const text = c.kind === "text" ? c.content : (c.fileName || c.filePath || c.kind)
      pushHit(hits, "clip", {
        id: c.id, score: s, title: (c.kind === "text" ? c.content.slice(0, 60) : text || "مقطع").slice(0, 60),
        snippet: `${c.deviceName} · ${c.kind}`, at: c.createdAt.getTime(), view: "prod",
      })
    }
  } catch { /* ignore */ }

  // 4) الرسائل — مزامنة الهاتف المحلية (آخر 500)
  try {
    await dbReady
    const msgs = await db.nexusMessage.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { conversation: { select: { address: true, contactName: true } } } })
    for (const m of msgs) {
      pushHit(hits, "message", {
        id: m.id, score: scoreText(m.body, q, qLower), title: m.body.slice(0, 60),
        snippet: `${m.conversation.contactName || m.conversation.address} · ${m.direction === "in" ? "واردة" : "صادرة"}`,
        at: m.createdAt.getTime(), view: "comms",
      })
    }
  } catch { /* ignore */ }

  // 5) جهات الاتصال · 6) النداءات · 7) التسليم المتصل · 8) مسارات الملفات المتزامنة
  try {
    await dbReady
    const [contacts, calls, handoff, syncEvents] = await Promise.all([
      db.nexusContact.findMany({ take: 300 }),
      db.nexusCallLog.findMany({ orderBy: { startedAt: "desc" }, take: 200 }),
      db.handoffItem.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.syncEvent.findMany({ orderBy: { at: "desc" }, take: 300, select: { id: true, relPath: true, action: true, at: true } }),
    ])
    for (const c of contacts) {
      pushHit(hits, "contact", { id: c.id, score: Math.max(scoreText(c.name, q, qLower), scoreText(c.phone, q, qLower)), title: c.name, snippet: c.phone, view: "comms" })
    }
    for (const c of calls) {
      pushHit(hits, "call", { id: c.id, score: Math.max(scoreText(c.contactName, q, qLower), scoreText(c.number, q, qLower)), title: c.contactName || c.number, snippet: `${c.direction} · ${c.durationSec}s`, at: c.startedAt.getTime(), view: "comms" })
    }
    for (const h of handoff) {
      pushHit(hits, "handoff", { id: h.id, score: Math.max(scoreText(h.title, q, qLower), scoreText(h.url, q, qLower)), title: h.title, snippet: `${h.kind} · ${h.status}`, at: h.createdAt.getTime(), view: "prod" })
    }
    for (const s of syncEvents) {
      pushHit(hits, "file", { id: s.id, score: scoreText(s.relPath, q, qLower), title: s.relPath, snippet: s.action, at: s.at.getTime(), view: "files" })
    }
  } catch { /* ignore */ }

  // التجميع: لكل مجموعة سقف 8، والترتيب بالدرجة ثم الجدة؛ وللبحث كله سقف 40.
  const groups: SearchGroup[] = []
  let total = 0
  for (const [kind, arr] of hits) {
    const top = arr
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score - ((b.at ?? 0) - (a.at ?? 0)) / 1e15)
      .slice(0, GROUP_CAP)
    if (!top.length) continue
    total += top.length
    groups.push({ kind, label: SEARCH_KIND_LABELS[kind], items: top })
  }
  // المجموعات ذات الأعلى تطابقًا أولًا
  groups.sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0))
  let acc = 0
  const capped: SearchGroup[] = []
  for (const g of groups) {
    if (acc >= TOTAL_CAP) break
    const take = g.items.slice(0, Math.max(0, TOTAL_CAP - acc))
    acc += take.length
    if (take.length) capped.push({ ...g, items: take })
  }

  return { ok: true, q, total: capped.reduce((a, g) => a + g.items.length, 0), took: Date.now() - t0, groups: capped }
}

/** عدّادات المصادر للتشخيص (بلا أي محتوى — بيانات وصفية حصرًا). */
export function searchSourcesStatus() {
  return { sources: Object.keys(SEARCH_KIND_LABELS).length }
}
