"use client"
// تبويب وضع التخفي — نقل ملفات بلا أي أثر: لا سجل، لا تاريخ، صفرنة ذاكرة
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { EyeOff, Ghost, FileQuestion, ScrollText, ShieldCheck, Eraser } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { useSec } from "@/lib/sec-store"
import { getSecSocket } from "@/lib/sec-socket"
import { sendEncryptedFile, clientAudit } from "@/hooks/use-sec-bridge"
import { fmtSize } from "@/lib/store"

export function StealthTab() {
  const { stealth, transfer, recvEphemeral, setTab, setCheck, kexDone } = useSec()
  const [busy, setBusy] = useState(false)

  // مزامنة المفتاح مع الجسر
  useEffect(() => {
    getSecSocket().emit("sec:stealth-set", { on: stealth })
  }, [stealth])

  async function sendStealthDemo() {
    setBusy(true)
    try {
      // مستند تجريبي 600KB — محتوى عربي فريد لفحص التسريب لاحقاً
      const secretLine = `بند سري رقم ${Math.floor(Math.random() * 10000)} — اتفاقية الشراكة الاستراتيجية`
      const line = secretLine + " · " + "نص تعبئة عربي لتوليد الحجم. ".repeat(8) + "\n"
      const bytes = new TextEncoder().encode(line.repeat(Math.ceil((600 * 1024) / line.length)).slice(0, 600 * 1024))
      const ok = await sendEncryptedFile(bytes, "مستند-سرّي.txt", true)
      if (ok) {
        setCheck("stealth", true)
        clientAudit({ actor: "النظام", action: "settings", detail: "نقل تخفي أُنجز — ومقاصده لا يُسجل (هذا السطر يثبت أن الإطار العام فقط يُوثق)", severity: "info" })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* المفتاح والشرح */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-bold text-sm flex items-center gap-2"><EyeOff className="w-4 h-4 text-slate-500" /> وضع التخفي</div>
          <div className="flex items-center gap-2">
            <Badge variant={stealth ? "default" : "outline"} className={stealth ? "bg-slate-700" : ""}>{stealth ? "مفعّل" : "معطّل"}</Badge>
            <Switch checked={stealth} onCheckedChange={(v) => useSec.setState({ stealth: v })} aria-label="وضع التخفي" />
          </div>
        </div>
        <div className="rounded-xl border p-3 space-y-1.5 text-[12px]">
          <div className="font-bold">ماذا يحدث عند تفعيله؟</div>
          <ul className="space-y-1 text-muted-foreground list-disc ps-4">
            <li>النقل يبقى <b className="text-foreground">مشفراً بالكامل</b> AES-256-GCM كأي نقل — الأمان لا ينقص</li>
            <li><b className="text-foreground">لا يُسجل في سجل التدقيق</b> إطلاقاً (لا صف ولا ذكر)</li>
            <li>لا يظهر في تاريخ النقل أو قوائم الملفات الأخيرة</li>
            <li>المخازن المؤقتة <b className="text-foreground">تُصفر من الذاكرة</b> فور الاستخدام (zeroize)</li>
            <li>بطاقة تقدم مؤقتة تختفي ذاتياً بعد ثوانٍ</li>
          </ul>
        </div>
        <div className="rounded-xl bg-muted/50 p-3 text-[11px] text-muted-foreground space-y-1">
          <div className="font-bold text-foreground flex items-center gap-1.5"><FileQuestion className="w-3.5 h-3.5" /> وماذا يرى Wireshark؟</div>
          نفس الشيء الذي يراه في النقل العادي: بايتات مشفرة لا معنى لها — التخفي يخفي <b className="text-foreground">الأثر في التطبيق</b>،
          والقناة أصلاً تخفي <b className="text-foreground">المحتوى عن الشبكة</b>. طبقتان مختلفتان متكاملتان.
        </div>
      </div>

      {/* التجربة الحية */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><Ghost className="w-4 h-4 text-slate-500" /> تجربة حية: نقل يترك صفر أثر</div>
        <ol className="text-[12px] space-y-1 text-muted-foreground list-decimal ps-4">
          <li>فعّل وضع التخفي أعلاه</li>
          <li>أرسل «مستند-سرّي.txt» (1.2MB) إلى الهاتف — راقب البطاقة الحية</li>
          <li>افتح سجل التدقيق وابحث: لن تجد ذكراً لهذا الملف</li>
        </ol>
        <Button className="w-full rounded-xl gap-1.5 bg-slate-700 hover:bg-slate-800" disabled={!kexDone || busy} onClick={() => void sendStealthDemo()}>
          <Ghost className="w-4 h-4" /> {busy ? "ينقل في الظلام…" : "أرسل مستنداً سرياً في وضع التخفي"}
        </Button>

        {/* بطاقة النقل الحية */}
        {transfer?.stealth && transfer.direction === "out" && (
          <div className="rounded-xl border border-slate-500/40 bg-slate-500/10 p-3 space-y-1.5">
            <div className="flex justify-between text-[11px] font-bold">
              <span className="flex items-center gap-1"><Ghost className="w-3.5 h-3.5" /> {transfer.name} (تخفي)</span>
              <span>{fmtSize(transfer.sent)} / {fmtSize(transfer.size)}</span>
            </div>
            <Progress value={(transfer.sent / Math.max(transfer.size, 1)) * 100} className="h-2" />
          </div>
        )}

        {/* استلام تخفي — مؤقت ذاتي التلاشي */}
        {recvEphemeral && (
          <div className="rounded-xl border border-slate-500/40 bg-slate-500/10 p-3 flex items-center gap-2 text-[12px] animate-pulse">
            <Eraser className="w-4 h-4 text-slate-500" />
            <div>
              <b>{recvEphemeral.name}</b> استُلم مشفراً — سيُمحى من الذاكرة بعد لحظات، لن يُحفظ ولن يُسجل
              <div className="text-[10px] text-muted-foreground">{fmtSize(recvEphemeral.size)} · بطاقة مؤقتة ذاتية التلاشي</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="rounded-lg gap-1 text-[11px]" onClick={() => setTab("audit")}>
            <ScrollText className="w-3 h-3" /> تحقق بنفسك في سجل التدقيق
          </Button>
          <Button size="sm" variant="outline" className="rounded-lg gap-1 text-[11px]" onClick={() => setTab("capture")}>
            <ShieldCheck className="w-3 h-3" /> افحص بايتات القناة (تبقى مشفرة)
          </Button>
        </div>
      </div>
    </div>
  )
}
