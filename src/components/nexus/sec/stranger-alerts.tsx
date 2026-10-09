"use client"
// تنبيه الأجهزة غير الموثوقة — حوار فوري بقرارات: حظر / مرة واحدة / توثيق
import { toast } from "sonner"
import { ShieldAlert, Ban, Clock, BadgeCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useSec } from "@/lib/sec-store"
import { getSecSocket } from "@/lib/sec-socket"
import { fmtDate } from "@/lib/store"

export function StrangerAlerts() {
  const alerts = useSec((s) => s.alerts)
  const pending = alerts.filter((a) => !a.resolved)
  const current = pending[0]

  function decide(decision: "block" | "once" | "trust") {
    if (!current) return
    getSecSocket().emit("sec:trust-decision", {
      alertId: current.id, deviceId: current.deviceId, name: current.name, decision,
    })
    useSec.getState().resolveAlert(current.id, decision)
    useSec.getState().setCheck("alert", true)
    if (decision === "block") toast.success(`حُظر «${current.name}» نهائياً — لن يقترب مرة أخرى`)
    if (decision === "trust") toast.success(`وُثّق «${current.name}» — أصبح جهازاً موثوقاً في السجل`)
    if (decision === "once") toast.info("رُفض الاتصال هذه المرة فقط")
  }

  return (
    <Dialog open={!!current}>
      <DialogContent className="sm:max-w-md border-red-500/50" aria-describedby="sec-alert-desc">
        <DialogHeader>
          <div className="w-14 h-14 rounded-2xl bg-red-500/15 text-red-600 grid place-items-center mx-auto animate-pulse">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <DialogTitle className="text-center text-red-600">محاولة اتصال جهاز غير موثوق!</DialogTitle>
          <DialogDescription id="sec-alert-desc" className="text-center">
            جهاز يحاول الانضمام إلى شبكة NexusLink وليس في سجل أجهزتك الموثوقة.
            لا يمكنه رؤية أو إرسال أي شيء قبل قرارك — القناة المشفرة مقفلة في وجهه.
          </DialogDescription>
        </DialogHeader>
        {current && (
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/60 p-3 text-[12px] space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">الاسم المعلن:</span><b>{current.name}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">المعرف:</span><span className="font-mono" dir="ltr">{current.deviceId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">النوع:</span><b>{current.kind === "blocked-device" ? "جهاز محظور سابقاً!" : "غير معروف"}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الوقت:</span><span>{fmtDate(current.at)}</span></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="destructive" className="rounded-xl gap-1 flex-col h-auto py-3" onClick={() => decide("block")}>
                <Ban className="w-4 h-4" /><span className="text-[11px]">حظر نهائي</span>
              </Button>
              <Button variant="outline" className="rounded-xl gap-1 flex-col h-auto py-3" onClick={() => decide("once")}>
                <Clock className="w-4 h-4" /><span className="text-[11px]">رفض مرة واحدة</span>
              </Button>
              <Button className="rounded-xl gap-1 flex-col h-auto py-3 bg-emerald-600 hover:bg-emerald-700" onClick={() => decide("trust")}>
                <BadgeCheck className="w-4 h-4" /><span className="text-[11px]">توثيق نهائي</span>
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              التوثيق النهائي يتطلب مطابقة بصمة المفتاح (SAS) على الجهازين — كل القرارات تُسجل في سجل التدقيق.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
