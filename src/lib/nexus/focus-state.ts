// عقد §52 — وضع التركيز الموحد — طبقة الحالة (ملف خارج المخطط + استعادة DND)
// ============================================================
// مصدر الحقيقة: .zstate/focus.json (أو NEXUSLINK_FOCUS_FILE) بنمط §37/§48/§49 —
// قراءة لكل نداء بلا كاش، والانقضاء يستعيد حالة «عدم الإزعاج» السابقة لحظة
// أول قراءة بعده (لا مؤقتات ولا مهام خلفية — الاستعادة كسولة حتمية).
import fs from "node:fs"
import path from "node:path"
import { db } from "@/lib/db"
import { writeServerAudit } from "@/lib/nexus/desktop-hardening"
import {
  normalizeFocusState, focusActive, focusNeedsRestore,
  type FocusState,
} from "@/lib/nexus/focus-core"

export const FOCUS_FILE =
  process.env.NEXUSLINK_FOCUS_FILE || path.join(process.cwd(), ".zstate", "focus.json")

export function readFocusState(): FocusState | null {
  try {
    return normalizeFocusState(JSON.parse(fs.readFileSync(FOCUS_FILE, "utf8")))
  } catch {
    return null
  }
}

export function writeFocusState(s: FocusState): void {
  fs.mkdirSync(path.dirname(FOCUS_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${FOCUS_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FOCUS_FILE)
  try { fs.chmodSync(FOCUS_FILE, 0o600) } catch { /* أنظمة بلا أذونات بوزيكس */ }
}

async function currentPhoneDnd(): Promise<boolean> {
  try {
    const p = await db.nexusPhone.upsert({ where: { id: "main" }, update: {}, create: { id: "main" } })
    return p.dnd
  } catch {
    return false
  }
}

async function setPhoneDnd(dnd: boolean, source: string | null): Promise<void> {
  try {
    await db.nexusPhone.upsert({
      where: { id: "main" },
      update: { dnd, dndSource: dnd ? source : null },
      create: { id: "main", dnd, dndSource: dnd ? source : null },
    })
  } catch { /* بلا هلع — الاستعادة عند القراءة التالية */ }
}

/**
 * الاستعادة الكسولة: إن انقضى التركيز يُستعاد DND السابق ويُحذف الملف.
 * تُستدعى من كل قراءة/كتابة ذات معنى — حتمية بلا مؤقتات.
 */
export async function ensureFocusRestored(): Promise<{ restored: boolean; state: FocusState | null }> {
  const s = readFocusState()
  if (!s) return { restored: false, state: null }
  if (focusNeedsRestore(s, Date.now())) {
    await setPhoneDnd(s.prevDnd, s.prevDnd ? "pc" : null)
    try { fs.rmSync(FOCUS_FILE, { force: true }) } catch { /* غائب أصلًا */ }
    void writeServerAudit({ action: "settings", detail: "انقضى وضع التركيز واستُعيدت حالة عدم الإزعاج السابقة", actor: "focus-engine" }).catch(() => null)
    return { restored: true, state: null }
  }
  return { restored: false, state: s }
}

/** بدء التركيز: يذكر DND السابق ويكتم إن طُلب — الملف هو الحقيقة الواحدة */
export async function startFocus(opts: {
  minutes: number
  suppressMirroring: boolean
  autoReplyText: string | null
}): Promise<FocusState> {
  const prevDnd = await currentPhoneDnd()
  const s: FocusState = {
    until: Date.now() + opts.minutes * 60_000,
    suppressMirroring: opts.suppressMirroring,
    autoReplyText: opts.autoReplyText,
    prevDnd,
    suppressed: 0,
    createdAt: Date.now(),
  }
  writeFocusState(s)
  if (opts.suppressMirroring) await setPhoneDnd(true, "focus")
  void writeServerAudit({ action: "settings", detail: `بدأ وضع التركيز ${opts.minutes} دقيقة${opts.suppressMirroring ? " مع كتم التعكيس" : ""}`, actor: "focus-engine" }).catch(() => null)
  return s
}

/** إيقاف صريح: استعادة فورية وحذف الملف */
export async function stopFocus(): Promise<{ ok: boolean; wasActive: boolean }> {
  const s = readFocusState()
  if (!s) return { ok: true, wasActive: false }
  await setPhoneDnd(s.prevDnd, s.prevDnd ? "pc" : null)
  try { fs.rmSync(FOCUS_FILE, { force: true }) } catch { /* غائب أصلًا */ }
  void writeServerAudit({ action: "settings", detail: `أُوقف وضع التركيز (كُتم ${s.suppressed} إشعارًا أثناءه)`, actor: "focus-engine" }).catch(() => null)
  return { ok: true, wasActive: focusActive(s, Date.now()) }
}

/** زيادة عدّاد المكبوت أثناء التركيز — كتابة ذرية بنمط tmp+rename */
export async function bumpFocusSuppressed(): Promise<number> {
  const s = readFocusState()
  if (!s) return 0
  const n = s.suppressed + 1
  writeFocusState({ ...s, suppressed: n })
  return n
}
