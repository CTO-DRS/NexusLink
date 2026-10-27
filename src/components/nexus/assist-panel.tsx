"use client"

// عقد §46 — المساعدة عن بعد برمز قصير (سيناريو العائلة)
// ============================================================
//  · AssistCodeBlock — داخل نافذة الاقتران: عرض الرمز العددي الستّي المشتق
//    من سرّ آخر QR (يُقرأ هاتفيًا لمن تُساعده بدل مسح الرمز).
//  · AssistBanner — لافتة حية أعلى شاشة الأجهزة تستطلع /api/devices/assist:
//    طلب معلّق → بطاقة موافقة (قبول/رفض) · جلسة نشطة → لافتة حمراء بقطع بضغطة.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { LifeBuoy, PhoneCall, ShieldAlert, Check, X, Unplug } from "lucide-react"
import { toast } from "sonner"

interface AssistPending {
  id: string
  name: string
  model: string
  kind: string
  ip: string
  requestedAt: number
}
interface AssistSession {
  deviceId: string
  deviceName: string
  startedAt: number
  via: "short-code"
}
interface AssistSnapshot {
  ok: boolean
  active: boolean
  code: string | null
  expiresAt: number
  attemptsLeft: number
  pending: AssistPending | null
  session: AssistSession | null
}

/** عرض رمز المساعدة داخل نافذة الاقتران — من استجابة QR مباشرة (بلا استطلاع) */
export function AssistCodeBlock({ assistCode }: { assistCode: string | null }) {
  if (!assistCode) return null
  return (
    <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-primary">
        <PhoneCall className="w-3.5 h-3.5" />
        رمز المساعدة (بديل المسح للعائلة)
      </div>
      <div className="font-mono text-3xl font-bold tracking-[0.35em] text-primary mt-1.5" dir="ltr">
        {assistCode}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
        اقرأ الرمز هاتفيًا لمن تُساعده — يدخله تطبيق NexusLink على جهازه، والاقتران يكتمل بموافقتك هنا
      </div>
    </div>
  )
}

/** اللافتة الحية: موافقة على طلب معلّق + قطع بضغطة لجلسة نشطة (استطلاع 2.5ث) */
export function AssistBanner() {
  const [snap, setSnap] = useState<AssistSnapshot | null>(null)

  const poll = useCallback(() => {
    // نمط اللوحات الحية §29 — setState داخل ردّ وعد لا في جسم الأثر مباشرة
    fetch("/api/devices/assist", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: AssistSnapshot | null) => { if (j) setSnap(j) })
      .catch(() => null)
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 2500)
    return () => clearInterval(t)
  }, [poll])

  const act = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/devices/assist", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    if (body.action === "consent" && j.state === "accepted") toast.success("قُبل الاقتران — جلسة المساعدة نشطة واللافتة حمراء حتى قطعها")
    if (body.action === "consent" && j.state === "denied") toast("رُفض الطلب وطُوي")
    if (body.action === "cut") toast("قُطعت جلسة المساعدة وأُبطل الاقتران")
    await poll()
  }

  if (!snap || (!snap.pending && !snap.session)) return null

  return (
    <div className="space-y-3">
      {snap.pending && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-600 dark:text-amber-400">
            <LifeBuoy className="w-4.5 h-4.5" /> طلب اقتران مساعدة
          </div>
          <div className="text-sm">
            <span className="font-bold">{snap.pending.name}</span>
            {snap.pending.model ? <span className="text-muted-foreground"> · {snap.pending.model}</span> : null}
            <span className="text-muted-foreground"> ({snap.pending.ip})</span>{" "}
            يطلب الاقتران برمز المساعدة — لا يكتمل الاقتران إلا بموافقتك
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="gap-1.5" onClick={() => act({ action: "consent", pendingId: snap.pending!.id, accept: true })}>
              <Check className="w-4 h-4" /> قبول وفتح جلسة
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => act({ action: "consent", pendingId: snap.pending!.id, accept: false })}>
              <X className="w-4 h-4" /> رفض
            </Button>
          </div>
        </div>
      )}

      {snap.session && (
        <div className="rounded-2xl border border-red-500/50 bg-red-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
            <ShieldAlert className="w-4.5 h-4.5" />
            جلسة مساعدة نشطة مع <span className="font-mono">{snap.session.deviceName}</span>
          </div>
          <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => act({ action: "cut" })}>
            <Unplug className="w-4 h-4" /> قطع الجلسة
          </Button>
        </div>
      )}
    </div>
  )
}
