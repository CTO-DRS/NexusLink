import { NextRequest, NextResponse } from "next/server"
import { io } from "socket.io-client"
import { loadPersistedFires } from "@/lib/nexus/automation-persist"
import { ensureAutomationBridge, automationBridgeStatus } from "@/lib/nexus/automation-bridge"

export const dynamic = "force-dynamic"

// API عام 2.0 — واجهة REST للأتمتة (عقد §34.أ — M3.1)
// ============================================================
// واجهة عامة فوق محرك الروتينات القائم: كل عمليات الكتابة تمر عبر مقبس
// الجسر (3008) — **نفس تعقيم sanitizeRule حرفيًا، صفر ازدواج تحقق** —
// والقراءة لحظة الاتصال من auto:state. هذا هو المسار نفسه الذي تستخدمه
// الواجهة، فما يرفضه المحرر يرفضه الـAPI والـSDK والـCLI بالسبب نفسه.

function withBridge<T>(fn: (socket: ReturnType<typeof io>) => Promise<T>, timeoutMs = 6000): Promise<T> {
  const boot = ensureAutomationBridge()
  if (!boot?.booted && !automationBridgeStatus()?.booted) {
    return Promise.reject(new Error("جسر الروتينات غير جاهز"))
  }
  return new Promise<T>((resolve, reject) => {
    const socket = io("http://127.0.0.1:3008", { transports: ["websocket"], timeout: 3000 })
    const done = (fn2: () => void) => {
      clearTimeout(timer)
      try { socket.close() } catch { /* ignore */ }
      fn2()
    }
    const timer = setTimeout(() => done(() => reject(new Error("انتهت مهلة جسر الروتينات"))), timeoutMs)
    socket.on("connect_error", () => done(() => reject(new Error("فشل الاتصال بجسر الروتينات"))))
    socket.on("connect", () => { fn(socket).then((v) => done(() => resolve(v))).catch((e) => done(() => reject(e))) })
  })
}

/** انتظار auto:state التالي (أو الأول عند الاتصال) */
function waitState(socket: ReturnType<typeof io>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.once("auto:state", (s: Record<string, unknown>) => resolve(s))
  })
}

/** انتظار auto:state الذي يحوي (أو لا يحوي) معرفًا — أو auto:rejected مسببًا */
function waitSettled(socket: ReturnType<typeof io>, id: string, want: boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => { socket.off("auto:state", onState); socket.off("auto:rejected", onRej); fn() }
    const onState = (s: Record<string, unknown>) => {
      const has = ((s.rules as { id: string }[] | undefined) ?? []).some((r) => r.id === id)
      if (has === want) finish(() => resolve(s))
    }
    const onRej = (d: { error?: string }) => finish(() => reject(new Error(String(d.error ?? "مرفوض"))))
    socket.on("auto:state", onState)
    socket.on("auto:rejected", onRej)
  })
}

/** انتظار auto:state الذي يحوي (أو لا يحوي) اسمًا — للقواعد الجديدة بلا معرف */
function waitNamed(socket: ReturnType<typeof io>, name: string, want: boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => { socket.off("auto:state", onState); socket.off("auto:rejected", onRej); fn() }
    const onState = (s: Record<string, unknown>) => {
      const has = ((s.rules as { name?: string }[] | undefined) ?? []).some((r) => r.name === name)
      if (has === want) finish(() => resolve(s))
    }
    const onRej = (d: { error?: string }) => finish(() => reject(new Error(String(d.error ?? "مرفوض"))))
    socket.on("auto:state", onState)
    socket.on("auto:rejected", onRej)
  })
}

export async function GET() {
  try {
    const state = await withBridge<Record<string, unknown>>(async (socket) => waitState(socket))
    return NextResponse.json({
      rules: state.rules ?? [],
      stats: state.stats ?? null,
      alerts: { unseen: (state.alerts as { unseen?: number } | undefined)?.unseen ?? 0 },
      bootedAt: state.bootedAt ?? null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? "")
  try {
    if (action === "fires") {
      // الإطلاقات المرسوخة من SQLite (مصدر الحقيقة الدائم — عقد §26.ح)
      const fires = (await loadPersistedFires()) ?? []
      return NextResponse.json({ fires })
    }
    if (action === "upsert") {
      const rule = body.rule && typeof body.rule === "object" ? body.rule : null
      if (!rule) return NextResponse.json({ error: "قاعدة مفقودة أو غير صالحة" }, { status: 400 })
      const wantId = typeof (rule as { id?: string }).id === "string" ? (rule as { id?: string }).id?.trim() : ""
      const name = String((rule as { name?: string }).name ?? "")
      const out = await withBridge<Record<string, unknown>>(async (socket) => {
        if (wantId) {
          socket.emit("rule:upsert", { rule })
          return await waitSettled(socket, String(wantId), true)
        }
        // قاعدة جديدة بلا معرف: انتظر state تحوي الاسم (حالة الاتصال الأولى لا تكفي)
        socket.emit("rule:upsert", { rule })
        return await waitNamed(socket, name, true)
      }) as Record<string, unknown>
      const created = ((out.rules as { name?: string; id?: string }[] | undefined) ?? [])
        .find((r) => r.name === name)
      return NextResponse.json({ ok: true, rule: created ?? null })
    }
    if (action === "delete") {
      const id = String(body.id ?? "").trim()
      if (!id) return NextResponse.json({ error: "معرف مفقود" }, { status: 400 })
      await withBridge(async (socket) => {
        socket.emit("rule:delete", { id })
        return await waitSettled(socket, id, false)
      })
      return NextResponse.json({ ok: true })
    }
    if (action === "toggle") {
      const id = String(body.id ?? "").trim()
      if (!id) return NextResponse.json({ error: "معرف مفقود" }, { status: 400 })
      await withBridge(async (socket) => {
        socket.emit("rule:toggle", { id, enabled: Boolean(body.enabled) })
        // لا تأكيد لاحق مطلوب — الحالة التالية تكفي (بث عام)
        await waitState(socket)
        return true
      })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: `إجراء غير معروف: ${action}` }, { status: 400 })
  } catch (e) {
    // رفض الجسر (تعقيم/قواعد §26.ي/§33.ج) يعود 400 مسببًا — نفس سبب الواجهة
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
