"use client"
// تبويب قفل التطبيق — حالة قفل الهاتف + قفل عن بُعد + قفل الكمبيوتر
import { useState } from "react"
import { toast } from "sonner"
import {
  LockKeyhole, Smartphone, MonitorSmartphone, Fingerprint, Timer, ShieldCheck, Info,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useSec } from "@/lib/sec-store"
import { sendSecureCmd, clientAudit } from "@/hooks/use-sec-bridge"
import { proxManualLock } from "@/lib/guard-socket"

export function ApplockTab() {
  const { phoneLock, kexDone, setCheck } = useSec()
  const [locking, setLocking] = useState(false)

  const methodsOn = phoneLock ? ([phoneLock.hasPin && "PIN", phoneLock.hasPattern && "نمط", phoneLock.hasBiometric && "بصمة/وجه"].filter((x): x is string => !!x)) : []

  async function lockPhoneNow() {
    setLocking(true)
    try {
      const ok = await sendSecureCmd("lock-phone", "remote_input")
      if (ok) {
        toast.success("أُرسل أمر القفل مشفراً — الهاتف سيقفل فوراً")
        clientAudit({ actor: "الكمبيوتر", action: "lock", detail: "قفل تطبيق الهاتف عن بُعد بأمر مشفر", severity: "warn" })
        setTimeout(() => setCheck("applock", true), 1500)
      }
    } finally { setLocking(false) }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* حالة قفل الهاتف */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><Smartphone className="w-4 h-4 text-teal-600" /> قفل التطبيق على الهاتف</div>
        {phoneLock ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
              <span className="text-[12px]">الحالة الآن</span>
              <Badge variant={phoneLock.locked ? "default" : "outline"} className={phoneLock.locked ? "bg-red-600" : "bg-emerald-600"}>
                {phoneLock.locked ? "مقفول" : "مفتوح"}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
              <span className="text-[12px]">طرق القفل المضبوطة</span>
              <div className="flex gap-1">
                {methodsOn.length ? methodsOn.map((m) => <Badge key={m} variant="outline" className="text-teal-600 border-teal-500/40">{m}</Badge>)
                  : <span className="text-[11px] text-muted-foreground">لم تُضبط بعد — اضبطها من صفحة الهاتف</span>}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
              <span className="text-[12px] flex items-center gap-1"><Timer className="w-3.5 h-3.5" /> قفل تلقائي عند الخمول</span>
              <b className="text-[12px]">{phoneLock.autoLockSec > 0 ? `${phoneLock.autoLockSec} ثانية` : "معطّل"}</b>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-muted/50 p-4 text-center text-[12px] text-muted-foreground">
            الهاتف غير متصل بالقناة — افتح صفحة الهاتف لضبط PIN/النمط/البصمة
          </div>
        )}
        <Button className="w-full rounded-xl gap-1.5 bg-red-600 hover:bg-red-700" disabled={!kexDone || locking} onClick={() => void lockPhoneNow()}>
          <LockKeyhole className="w-4 h-4" /> اقفل تطبيق الهاتف الآن (أمر مشفر)
        </Button>
        <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          الإعداد الفعلي للـ PIN والنمط والبصمة يتم على صفحة الهاتف (تبويب «الأمان») — والبصمة/الوجه تستخدم WebAuthn
          الحقيقي لجهازك (بصمة الإصبع/Face) عبر HTTPS.
        </div>
      </div>

      {/* قفل الكمبيوتر */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><MonitorSmartphone className="w-4 h-4 text-teal-600" /> قفل التطبيق على الكمبيوتر</div>
        <p className="text-[12px] text-muted-foreground">
          شاشة قفل الكمبيوتر هي نفسها شاشة القرب (المرحلة 8) — تعمل بـ PIN محلي وتُفتح أيضاً
          تلقائياً عند عودة هاتفك. اضغط لتجربتها الآن، أو اتركها لقفل القرب التلقائي.
        </p>
        <Button variant="outline" className="w-full rounded-xl gap-1.5" onClick={() => { proxManualLock(); toast.info("قُفل شاشة الكمبيوتر — أدخل PIN للفتح") }}>
          <LockKeyhole className="w-4 h-4" /> اقفل شاشة الكمبيوتر الآن
        </Button>
        <div className="rounded-xl border border-dashed p-3 space-y-1.5">
          <div className="text-[12px] font-bold flex items-center gap-1.5"><Fingerprint className="w-4 h-4 text-teal-600" /> طبقات حماية التطبيق مجتمعة</div>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc ps-4">
            <li>قفل الهاتف: PIN/نمط مبنيان بـ PBKDF2-SHA256 (150 ألف تكرار + ملح عشوائي)</li>
            <li>البصمة/الوجه: مصادقة بيومترية نظامية عبر WebAuthn (لا تُخزن أي بيانات حيوية)</li>
            <li>قفل تلقائي عند الخمول (قابل للضبط من الهاتف)</li>
            <li>قفل القرب: ابتعاد الهاتف يقفل الكمبيوتر (المرحلة 8)</li>
            <li>قفل عن بُعد: أمر مشفر E2E من الكمبيوتر إلى الهاتف</li>
          </ul>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-bold">
          <ShieldCheck className="w-4 h-4" /> يكتمل الاختبار عند قفل الهاتف (أو نقر «اقفل الآن» بنجاح) وأرشفة ذلك في السجل
        </div>
      </div>
    </div>
  )
}
