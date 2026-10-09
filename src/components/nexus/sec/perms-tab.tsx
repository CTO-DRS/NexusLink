"use client"
// تبويب الصلاحيات — مفتاح تشغيل/إيقاف لكل ميزة + اختبار الإنفاذ الفعلي
import { useEffect } from "react"
import { toast } from "sonner"
import { ToggleLeft, Send, ShieldBan, ShieldCheck, Info } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useSec } from "@/lib/sec-store"
import { getSecSocket } from "@/lib/sec-socket"
import { SEC_FEATURES, sendSecureCmd } from "@/hooks/use-sec-bridge"
import { fmtDate } from "@/lib/store"

export function PermsTab() {
  const { perms, kexDone, audit, setCheck } = useSec()
  useEffect(() => { getSecSocket().emit("sec:perm-get") }, [])

  const phonePerms = perms.filter((p) => p.deviceId === "galaxy-s24")
  const denials = audit.filter((a) => a.action === "perm-denied").slice(0, 5)

  function toggle(feature: string, enabled: boolean) {
    getSecSocket().emit("sec:perm-set", { feature, deviceId: "galaxy-s24", enabled })
    toast.info(enabled ? `سُمحت ميزة «${SEC_FEATURES.find((f) => f.id === feature)?.name}»` : `أُوقفت ميزة «${SEC_FEATURES.find((f) => f.id === feature)?.name}» — الهاتف سيرفض أوامرها فوراً`)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* مصفوفة الصلاحيات */}
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="font-bold text-sm flex items-center gap-2">
          <ToggleLeft className="w-4 h-4 text-teal-600" /> صلاحية كل ميزة — لكل جهاز على حدة
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> الإيقاف يُنفَّذ على مصدر الميزة نفسه (الهاتف يرفض الأمر المشفر قبل تنفيذه) — ليس مجرد إخفاء واجهة
        </div>
        <div className="space-y-1.5">
          {SEC_FEATURES.map((f) => {
            const rule = phonePerms.find((p) => p.feature === f.id)
            const enabled = rule?.enabled ?? false
            return (
              <div key={f.id} className="flex items-center justify-between rounded-xl border px-3 py-2.5">
                <div>
                  <div className="text-[12px] font-bold">{f.name}</div>
                  <div className="text-[10px] text-muted-foreground">{f.hint}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={enabled ? "text-emerald-600 border-emerald-500/40" : "text-red-500 border-red-500/40"}>
                    {enabled ? "مسموح" : "موقوف"}
                  </Badge>
                  <Switch checked={enabled} onCheckedChange={(v) => toggle(f.id, v)} aria-label={`صلاحية ${f.name}`} />
                </div>
              </div>
            )
          })}
        </div>
        <div className="text-[11px] text-muted-foreground">
          الأجهزة الجديدة غير الموثوقة: <b className="text-foreground">رفض افتراضي كامل</b> — لا شيء يعمل قبل توثيقها صراحةً من تنبيه الاتصال.
        </div>
      </div>

      {/* اختبار الإنفاذ */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-teal-600" /> اختبار الإنفاذ الحقيقي</div>
        <div className="rounded-xl border border-dashed p-3 space-y-2">
          <div className="text-[12px] font-bold">1) أوقف «التحكم عن بُعد» بمفتاحه أعلاه</div>
          <div className="text-[12px] font-bold">2) اضغط هنا — الهاتف سيرفض الأمر المشفر ويرد بالرفض:</div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="rounded-lg gap-1 text-[11px]" disabled={!kexDone} onClick={() => { void sendSecureCmd("ring", "remote_input"); toast.info("أُرسل الأمر — راقب الرد") }}>
              <Send className="w-3 h-3" /> أمر رن (عبر القناة المشفرة)
            </Button>
            <Button size="sm" variant="outline" className="rounded-lg gap-1 text-[11px]" disabled={!kexDone} onClick={() => { void sendSecureCmd("test-op", "system_commands"); toast.info("أُرسل أمر نظام تجريبي مشفر") }}>
              <Send className="w-3 h-3" /> أمر نظام تجريبي
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground">3) إذا كانت الميزة موقوفة: يظهر رفض فوري هنا + يُسجل في التدقيق كتحذير</div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[12px] font-bold flex items-center gap-1.5"><ShieldBan className="w-4 h-4 text-red-500" /> أحدث حالات الرفض</div>
          {denials.length === 0 ? (
            <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-xl p-3">لا رفض بعد — أوقف ميزة وأرسل أمرها لترى الإنفاذ</div>
          ) : denials.map((d) => (
            <div key={d.id} className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px]">
              <b>{d.actor}</b> رفض «{d.detail}» · {fmtDate(d.at)}
            </div>
          ))}
        </div>
        <Button size="sm" variant="outline" className="rounded-lg text-[11px]" onClick={() => setCheck("perms", true)}>
          علامة يدوية: تحققت من الإنفاذ
        </Button>
      </div>
    </div>
  )
}
