"use client"
// NexusLink — وضع الفقدان: قفل الجهاز + رسالة + مسح عن بُعد (محمي بكلمة مرور)
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  ShieldAlert, MessageSquareLock, Eraser, LockKeyhole, TriangleAlert, Undo2, Phone,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useGuard } from "@/lib/guard-store"
import { cmdLost, cmdWipe } from "@/lib/guard-socket"
import { GuardCard, InfoRow } from "./guard-bits"
import { fmtDate } from "@/lib/store"

export function LostTab() {
  const { lost, setLost, setCheck, wipe, setWipe, pin, pushLog } = useGuard()
  const [message, setMessage] = useState(lost.message)
  const [callback, setCallback] = useState(lost.callback)
  const [pinOpen, setPinOpen] = useState(false)
  const [pinEntry, setPinEntry] = useState("")
  const [wipeConfirm, setWipeConfirm] = useState("")
  const [wipePinOpen, setWipePinOpen] = useState(false)

  // محرك تقدم المسح
  useEffect(() => {
    if (wipe.stage !== "wiping") return
    const iv = setInterval(() => {
      const s = useGuard.getState()
      const next = Math.min(100, s.wipe.progress + 4 + Math.random() * 7)
      s.setWipe({ progress: next })
      if (next >= 100) {
        clearInterval(iv)
        s.setWipe({ stage: "wiped", progress: 100 })
        s.setLost(false)
        s.pushLog("اكتمل المسح عن بُعد — كل بيانات الهاتف أُزيلت", "warn")
        toast.error("اكتمل المسح عن بُعد للهاتف", { description: "سيطلب الهاتف إعادة تنشيط عند أول تشغيل" })
      }
    }, 240)
    return () => clearInterval(iv)
  }, [wipe.stage])

  const activate = () => {
    if (!message.trim()) { toast.error("اكتب رسالة تظهر على شاشة الهاتف"); return }
    setLost(true, message.trim(), callback.trim())
    cmdLost(true, message.trim(), callback.trim())
    setCheck("lost")
    setPinOpen(false)
    setPinEntry("")
    toast.success("وضع الفقدان مفعّل — الهاتف مقفل الآن", { description: "ستظهر رسالتك على شاشة الهاتف فوراً" })
  }

  const deactivate = () => {
    setLost(false)
    cmdLost(false)
    pushLog("أُلغي وضع الفقدان — الهاتف عاد لطبيعته", "ok")
    toast.success("أُلغي وضع الفقدان")
  }

  const startWipe = () => {
    setWipe({ stage: "wiping", progress: 0 })
    cmdWipe()
    setWipePinOpen(false)
    setWipeConfirm("")
    pushLog("بدأ المسح عن بُعد — حذف كل البيانات", "warn")
  }

  return (
    <div className="space-y-4">
      {/* حالة وضع الفقدان */}
      {lost.active ? (
        <GuardCard title="وضع الفقدان مفعّل" icon={ShieldAlert} tone="warn"
          extra={<Badge className="bg-amber-500 hover:bg-amber-500 rounded-full text-[10px]">الهاتف مقفل</Badge>}>
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-center space-y-2">
            <LockKeyhole className="w-8 h-8 mx-auto text-amber-500" />
            <p className="text-[13px] font-bold">«{lost.message}»</p>
            {lost.callback && <p className="text-[11px] text-muted-foreground font-mono dir-ltr">{lost.callback}</p>}
            <p className="text-[9.5px] text-muted-foreground">مفعّل منذ {fmtDate(lost.at)}</p>
          </div>
          <div>
            <InfoRow label="شاشة الهاتف" value="مقفلة بالكامل — لا وصول" />
            <InfoRow label="الإشعارات" value="مخفية حتى الإلغاء" />
            <InfoRow label="التتبع المحلي" value="نبض الشبكة مستمر" />
          </div>
          <Button variant="outline" className="w-full rounded-2xl gap-2" onClick={deactivate}>
            <Undo2 className="w-4 h-4" /> ألغِ وضع الفقدان — أعِد الهاتف
          </Button>
        </GuardCard>
      ) : (
        <GuardCard title="تفعيل وضع الفقدان" icon={ShieldAlert}>
          <p className="text-[11.5px] text-muted-foreground leading-relaxed">
            عند فقدان الهاتف داخل المنزل أو المكتب: يُقفل الجهاز فوراً وتظهر رسالتك على شاشته — يستطيع من يجده التواصل معك دون فتح أي شيء.
          </p>
          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold flex items-center gap-1.5"><MessageSquareLock className="w-3.5 h-3.5" /> رسالة شاشة القفل</label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className="rounded-xl text-[12px]" placeholder="هذا الهاتف مفقود. يرجى التواصل معي…" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> رقم للتواصل</label>
              <Input value={callback} onChange={(e) => setCallback(e.target.value)} className="rounded-xl h-9 text-[12px] dir-ltr text-start" placeholder="+966 5X XXX XXXX" />
            </div>
            <Button className="w-full h-11 rounded-2xl gap-2 font-bold" onClick={() => { setPinEntry(""); setPinOpen(true) }}>
              <ShieldAlert className="w-4 h-4" /> تفعيل وضع الفقدان
            </Button>
          </div>
        </GuardCard>
      )}

      {/* المسح عن بُعد */}
      <GuardCard title="مسح عن بُعد" icon={Eraser} tone={wipe.stage === "wiped" ? "ok" : "danger"}>
        {wipe.stage === "wiped" ? (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-center">
            <p className="text-[12.5px] font-bold text-emerald-600 dark:text-emerald-400">تم مسح الجهاز بالكامل</p>
            <p className="text-[10.5px] text-muted-foreground mt-1">أُزيلت كل الحسابات والصور والتطبيقات — سيبدأ الهاتف كجهاز جديد عند إعادة تنشيطه</p>
            <Button variant="outline" size="sm" className="mt-3 rounded-xl text-[11px]" onClick={() => useGuard.getState().setWipe({ stage: "idle", progress: 0 })}>
              إعادة تعيين الحالة (تجربة أخرى)
            </Button>
          </div>
        ) : wipe.stage === "wiping" ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4 text-center">
            <TriangleAlert className="w-7 h-7 mx-auto text-red-500 animate-pulse mb-1.5" />
            <p className="text-[12.5px] font-bold">جارٍ مسح كل البيانات… {Math.round(wipe.progress)}%</p>
            <p className="text-[10.5px] text-muted-foreground mt-1">الحسابات · الصور · التطبيقات · إعدادات المصنع</p>
          </div>
        ) : (
          <>
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              الملاذ الأخير إذا كان الهاتف في أيدي شخص آخر: حذف نهائي لكل البيانات عن بُعد. يتطلب تأكيداً مزدوجاً.
            </p>
            <div className="space-y-2">
              <Input
                value={wipeConfirm}
                onChange={(e) => setWipeConfirm(e.target.value)}
                placeholder="اكتب كلمة «مسح» للتنبيه على الخطر"
                className="rounded-xl h-9 text-[12px] border-red-500/40 focus-visible:ring-red-500/30"
              />
              <Button
                variant="destructive"
                className="w-full h-11 rounded-2xl gap-2 font-bold"
                disabled={wipeConfirm !== "مسح"}
                onClick={() => { setPinEntry(""); setWipePinOpen(true) }}
              >
                <Eraser className="w-4 h-4" /> امسح الهاتف عن بُعد
              </Button>
            </div>
          </>
        )}
      </GuardCard>

      {/* نافذة PIN — تفعيل الفقدان */}
      <PinDialog
        open={pinOpen}
        entry={pinEntry}
        onEntry={setPinEntry}
        onClose={() => setPinOpen(false)}
        title="تأكيد بكلمة المرور"
        desc="أدخل كلمة مرور الحماية لتفعيل وضع الفقدان"
        onSuccess={activate}
      />

      {/* نافذة PIN — المسح */}
      <PinDialog
        open={wipePinOpen}
        entry={pinEntry}
        onEntry={setPinEntry}
        onClose={() => setWipePinOpen(false)}
        title="تأكيد أخير — مسح كل البيانات"
        desc="لا يمكن التراجع بعد بدء المسح. أدخل كلمة المرور"
        onSuccess={startWipe}
        danger
      />
    </div>
  )
}

export function PinDialog({ open, entry, onEntry, onClose, title, desc, onSuccess, danger }: {
  open: boolean
  entry: string
  onEntry: (v: string) => void
  onClose: () => void
  title: string
  desc: string
  onSuccess: () => void
  danger?: boolean
}) {
  const { pin } = useGuard()
  const press = (d: string) => {
    if (entry.length >= 4) return
    const next = entry + d
    onEntry(next)
    if (next.length === 4) {
      if (next === pin) setTimeout(onSuccess, 150)
      else setTimeout(() => onEntry(""), 500)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[320px]">
        <DialogHeader>
          <DialogTitle className="text-center text-[14px]">{title}</DialogTitle>
          <DialogDescription className="text-center text-[11px]">{desc}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 pb-1">
          <div className="flex gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cnPinDot(entry.length > i, danger)} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} onClick={() => press(d)} className="w-13 h-13 rounded-2xl bg-muted hover:bg-accent text-[16px] font-bold transition-all active:scale-95" style={{ width: 52, height: 52 }}>{d}</button>
            ))}
            <div />
            <button onClick={() => press("0")} className="rounded-2xl bg-muted hover:bg-accent text-[16px] font-bold active:scale-95" style={{ width: 52, height: 52 }}>0</button>
            <div />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function cnPinDot(filled: boolean, danger?: boolean) {
  return `w-3 h-3 rounded-full border-2 transition-all ${filled ? (danger ? "border-red-500 bg-red-500" : "border-primary bg-primary") : "border-muted-foreground/30"}`
}
