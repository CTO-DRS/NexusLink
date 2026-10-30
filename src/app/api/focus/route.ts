// عقد §52 — وضع التركيز الموحد — المسار العام (مستوى المستخدم)
// ============================================================
// GET  → { active, remainingMs, until, suppressMirroring, autoReplyText,
//          suppressed, dnd: {dnd, source}, quietOverlap }
// POST { action: "start" | "stop" | "extend", minutes?, suppressMirroring?, autoReplyText? }
//  - start: 5–240 دقيقة — يذكر حالة DND السابقة ويكتم إن طُلب.
//  - extend: تمديد فوق الباقي بسقف 240 دقيقة من الآن — لا تمديد لنشاط ميت.
//  - stop: استعادة فورية للحالة السابقة وحذف الملف.
// الوصول: مستوى المستخدم (من الأجهزة المقترنة عبر البوابة برمز §37 تلقائيًا) —
// وكل بدء/إيقاف يُدوَّن في سجل سطح المكتب §16 بلا محتوى حساس.
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { readFocusState, ensureFocusRestored, startFocus, stopFocus } from "@/lib/nexus/focus-state"
import {
  validateFocusMinutes, focusActive, focusRemainingMs, extendUntil, focusOverlapsQuiet,
} from "@/lib/nexus/focus-core"
import { getFilter } from "@/lib/nexus/comms-server"

export const dynamic = "force-dynamic"

async function view() {
  const { restored, state } = await ensureFocusRestored()
  const now = Date.now()
  const p = await db.nexusPhone.upsert({ where: { id: "main" }, update: {}, create: { id: "main" } })
  const quietUntil = await getFilter().then((f) => (f.quietUntil ? new Date(f.quietUntil).getTime() : null)).catch(() => null)
  return {
    ok: true,
    active: focusActive(state, now),
    remainingMs: focusRemainingMs(state, now),
    until: state?.until ?? null,
    suppressMirroring: state?.suppressMirroring ?? false,
    autoReplyText: state?.autoReplyText ?? null,
    suppressed: state?.suppressed ?? 0,
    restoredJustNow: restored,
    dnd: { dnd: p.dnd, source: p.dndSource ?? null },
    quietOverlap: focusOverlapsQuiet(state, quietUntil),
  }
}

export async function GET() {
  return NextResponse.json(await view())
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? "")

  if (action === "start") {
    const v = validateFocusMinutes(body.minutes)
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 })
    await ensureFocusRestored()
    if (focusActive(readFocusState(), Date.now())) {
      return NextResponse.json({ ok: false, error: "already-active", hint: "extend" }, { status: 409 })
    }
    const autoReplyText = typeof body.autoReplyText === "string" && body.autoReplyText.trim() ? body.autoReplyText.trim().slice(0, 200) : null
    await startFocus({ minutes: body.minutes, suppressMirroring: body.suppressMirroring !== false, autoReplyText })
    return NextResponse.json(await view())
  }

  if (action === "extend") {
    const { state } = await ensureFocusRestored()
    const next = extendUntil(state, Number(body.minutes ?? 0), Date.now())
    if (!state) return NextResponse.json({ ok: false, error: "not-active", hint: "start" }, { status: 409 })
    if (!next) return NextResponse.json({ ok: false, error: "invalid-minutes" }, { status: 400 })
    const { writeFocusState } = await import("@/lib/nexus/focus-state")
    writeFocusState({ ...state, until: next })
    return NextResponse.json(await view())
  }

  if (action === "stop") {
    await stopFocus()
    return NextResponse.json(await view())
  }

  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
