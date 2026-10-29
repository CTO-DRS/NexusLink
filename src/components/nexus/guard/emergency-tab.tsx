"use client"
// NexusLink — تبويب الطوارئ الذكي (عقد §48 — القفل النهائي)
// ============================================================
// البطاقة الثامنة في الحماية: تسليح التصعيد الذاتي (48.د) + القتل النهائي
// (48.ب) بكلمة حرفية «اقتل» + قائمة المقتولين الدائمة + الحدود الصادقة
// الست معلنة على المالك قبل أي ضغطة. لا زر إلغاء قتل في أي مكان — أحادي
// الاتجاه بنيويًا (الحد 48.و.3).
import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import {
  OctagonAlert, ShieldCheck, Fingerprint, Ban, Radio, Cpu, KeyRound, Loader2,
  AlertTriangle, CheckCircle2, ListX, RotateCw,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface KillEntryUI { deviceId: string; fingerprint: string; at: string; pairRotated: boolean }
interface EmergencyStatus {
  ok: boolean
  armed: boolean
  armedAt: string | null
  rules: { unlockFailLimit: number; simChangeAction: string } | null
  killWord: string
  kills: KillEntryUI[]
}

const SIM_ACTIONS: { value: string; label: string }[] = [
  { value: "warn", label: "تحذير فقط" },
  { value: "kill", label: "إغلاق نهائي" },
  { value: "off", label: "معطّل" },
]

export function EmergencyTab() {
  const [status, setStatus] = useState<EmergencyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [arming, setArming] = useState(false)
  const [killing, setKilling] = useState(false)

  // نموذج التسليح
  const [pin, setPin] = useState("")
  const [failLimit, setFailLimit] = useState(5)
  const [simAction, setSimAction] = useState("warn")

  // نموذج القتل
  const [killPin, setKillPin] = useState("")
  const [killWord, setKillWord] = useState("")
  const [killDeviceId, setKillDeviceId] = useState("")

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/security/emergency", { cache: "no-store" })
      const j = (await r.json()) as EmergencyStatus
      setStatus(j)
      if (j.rules) {
        setFailLimit(j.rules.unlockFailLimit)
        setSimAction(j.rules.simChangeAction)
      }
    } catch {
      toast.error("تعذّر قراءة حالة الطوارئ — الجسر محلي حصرًا")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const arm = async () => {
    if (pin.length < 4) {
      toast.error("الرمز قصير — أربعة محارف على الأقل (يُخزَّن هاشًا حصرًا)")
      return
    }
    setArming(true)
    try {
      const r = await fetch("/api/security/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "arm", pin, rules: { unlockFailLimit: failLimit, simChangeAction: simAction } }),
      })
      const j = await r.json()
      if (j.ok) {
        toast.success(
          status?.armed ? "تحديث التسليح (يُدفع للهاتف فورًا)" : "تسليح الآن",
          { description: j.notes?.length ? `تطبيع: ${j.notes.join(" · ")}` : "القواعد قبلت كما هي" },
        )
        setPin("")
        await refresh()
      } else {
        toast.error(`رفض التسليح: ${j.error}`)
      }
    } catch {
      toast.error("تعذّر الوصول للمسار — الإدارة من الجهاز حصرًا")
    } finally {
      setArming(false)
    }
  }

  const kill = async () => {
    if (!killDeviceId.trim()) {
      toast.error("معرّف الجهاز مطلوب حرفيًا — القتل موجَّه لا عشوائي")
      return
    }
    if (killWord.trim() !== status?.killWord) {
      toast.error(`كلمة التأكيد حرفية — اكتب «${status?.killWord ?? "اقتل"}» كما هي`)
      return
    }
    setKilling(true)
    try {
      const r = await fetch("/api/security/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", pin: killPin, confirm: killWord.trim(), deviceId: killDeviceId.trim() }),
      })
      const j = await r.json()
      if (j.ok) {
        toast[j.refired ? "info" : "success"](
          j.refired
            ? "الجهاز مقتول أصلًا — الإعادة خاملة بلا أثر جديد (refired)"
            : "قُتل الجهاز نهائيًا",
          {
            description: `بصمة ${j.fingerprint} — ${j.pairRotated ? "دُوِّر رمز §37 فورًا" : "لا رمز §37 مُمكَّنًا فلا تدوير"}`,
          },
        )
        setKillPin("")
        setKillWord("")
        await refresh()
      } else {
        toast.error(`رفض القتل: ${j.error}${j.reason ? ` (${j.reason})` : ""}`)
      }
    } catch {
      toast.error("تعذّر الوصول للمسار — الإدارة من الجهاز حصرًا")
    } finally {
      setKilling(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border bg-card p-8 flex items-center justify-center gap-2 text-muted-foreground text-[12px]">
        <Loader2 className="w-4 h-4 animate-spin" /> جارٍ قراءة حالة الطوارئ…
      </div>
    )
  }

  const armed = !!status?.armed
  const kills = status?.kills ?? []

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className={cn(
        "rounded-2xl border p-4 flex items-start gap-3",
        armed ? "border-red-500/50 bg-red-500/5" : "border bg-card",
      )}>
        <div className={cn(
          "w-10 h-10 rounded-2xl grid place-items-center text-white shrink-0",
          armed ? "bg-gradient-to-br from-red-500 to-red-700 shadow-lg shadow-red-600/25" : "bg-muted text-muted-foreground",
        )}>
          <OctagonAlert className="w-5 h-5" />
        </div>
        <div className="flex-1 leading-tight">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-black text-[15px]">الطوارئ الذكي — القفل النهائي</h3>
            <Badge variant={armed ? "default" : "outline"} className={cn("rounded-full text-[9.5px]", armed && "bg-red-500 hover:bg-red-500")}>
              {armed ? "مُسلَّح" : "غير مُسلَّح"}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            وضع الفقدان قابل للإلغاء — هذا لا. القتل النهائي أحادي الاتجاه بنيويًا: يبطل الاقتران ورمز الوصول
            ويواجه أي إعادة اتصال بالقتل الفوري، مع سجل أدلة مقاوم للتلاعب.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* التسليح */}
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <h4 className="font-bold text-[13px]">تسليح التصعيد الذاتي (يعمل بلا شبكة)</h4>
          </div>
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            تُدفع القواعد للهاتف عند التسليح وكل تعديل — الفرض على الهاتف نفسه: محاولات فتح فاشلة أو
            تغيير شريحة تُغلقه نهائيًا حتى بلا اتصال بالشبكة.
          </p>
          <div className="space-y-2.5">
            <div>
              <label className="text-[10.5px] font-semibold text-muted-foreground flex items-center gap-1 mb-1">
                <KeyRound className="w-3 h-3" /> رمز الطوارئ (4+ محارف — يُخزَّن هاش SHA-256 حصرًا)
              </label>
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••"
                className="h-9 rounded-xl text-[12px] dir-ltr"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-[10.5px] font-semibold text-muted-foreground flex items-center gap-1 mb-1">
                <Ban className="w-3 h-3" /> حد محاولات الفتح الفاشلة (3–10 بتطبيع صاخب)
              </label>
              <Input
                type="number"
                min={3}
                max={10}
                value={failLimit}
                onChange={(e) => setFailLimit(Number(e.target.value) || 5)}
                className="h-9 rounded-xl text-[12px] dir-ltr"
              />
            </div>
            <div>
              <label className="text-[10.5px] font-semibold text-muted-foreground flex items-center gap-1 mb-1">
                <Cpu className="w-3 h-3" /> عند تغيير شريحة SIM
              </label>
              <div className="flex gap-1.5">
                {SIM_ACTIONS.map((a) => (
                  <button
                    key={a.value}
                    onClick={() => setSimAction(a.value)}
                    className={cn(
                      "flex-1 rounded-xl px-2 py-2 text-[10.5px] font-semibold border transition-all",
                      simAction === a.value
                        ? a.value === "kill"
                          ? "bg-red-500 text-white border-red-500"
                          : "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Button
            className="w-full rounded-xl gap-1.5 font-bold"
            disabled={arming || pin.length < 4}
            onClick={() => void arm()}
          >
            {arming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
            {armed ? "تحديث التسليح (يُدفع للهاتف فورًا)" : "تسليح الآن"}
          </Button>
        </div>

        {/* القتل */}
        <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <OctagonAlert className="w-4 h-4 text-red-500" />
            <h4 className="font-bold text-[13px]">القتل النهائي (لا رجعة — لا يُلغى أبدًا)</h4>
          </div>
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-2.5 text-[10.5px] leading-relaxed text-red-600 dark:text-red-400 flex gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            كل حقول التأكيد الثلاثة إلزامية: الرمز + كلمة «اقتل» حرفيًا + معرّف الجهاز. لا يوجد زر إلغاء
            بعد الضغطة — هذا قرار واحد الاتجاه بنيويًا (الحد 48.و.3).
          </div>
          <div className="space-y-2.5">
            <Input
              type="text"
              value={killDeviceId}
              onChange={(e) => setKillDeviceId(e.target.value)}
              placeholder="معرّف الجهاز المستهدف (كما في سجل الأجهزة)"
              className="h-9 rounded-xl text-[12px] dir-ltr"
            />
            <Input
              type="password"
              value={killPin}
              onChange={(e) => setKillPin(e.target.value)}
              placeholder="رمز الطوارئ"
              className="h-9 rounded-xl text-[12px] dir-ltr"
              autoComplete="off"
            />
            <Input
              type="text"
              value={killWord}
              onChange={(e) => setKillWord(e.target.value)}
              placeholder={`اكتب حرفيًا: ${status?.killWord ?? "اقتل"}`}
              className="h-9 rounded-xl text-[12px]"
              autoComplete="off"
            />
          </div>
          <Button
            variant="destructive"
            className="w-full rounded-xl gap-1.5 font-black"
            disabled={killing || !armed || !killDeviceId.trim() || killWord.trim() !== status?.killWord}
            onClick={() => void kill()}
          >
            {killing ? <Loader2 className="w-4 h-4 animate-spin" /> : <OctagonAlert className="w-4 h-4" />}
            اقتل الجهاز نهائيًا
          </Button>
          {!armed && (
            <p className="text-[10px] text-muted-foreground text-center">سلِّح أولًا — القتل بلا تسليح مرفوض 409 صادقًا</p>
          )}
        </div>
      </div>

      {/* قائمة المقتولين */}
      <div className="rounded-2xl border bg-card p-4 space-y-2.5">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-4 h-4 text-muted-foreground" />
          <h4 className="font-bold text-[13px]">قائمة المقتولين — دائمة بلا إزالة</h4>
          <Badge variant="outline" className="rounded-full text-[9.5px] ms-auto">{kills.length}</Badge>
        </div>
        {kills.length === 0 ? (
          <div className="rounded-xl border border-dashed p-3 text-[11px] text-muted-foreground flex items-center gap-2">
            <ListX className="w-3.5 h-3.5" /> لا أجهزة مقتولة — الجريمة لم تقع بعد، والحمد لله
          </div>
        ) : (
          <div className="space-y-1.5">
            {kills.map((k) => (
              <div key={k.deviceId} className="rounded-xl border bg-muted/40 px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] font-bold dir-ltr">{k.deviceId}</span>
                <span className="font-mono text-[9.5px] text-muted-foreground dir-ltr">{k.fingerprint}</span>
                <span className="text-[9.5px] text-muted-foreground dir-ltr">{new Date(k.at).toLocaleString()}</span>
                {k.pairRotated ? (
                  <Badge className="rounded-full text-[9px] gap-1 bg-amber-500 hover:bg-amber-500">
                    <RotateCw className="w-2.5 h-2.5" /> دُوِّر رمز §37
                  </Badge>
                ) : (
                  <Badge variant="outline" className="rounded-full text-[9px]">بلا رمز مُمكَّن</Badge>
                )}
                <CheckCircle2 className="w-3.5 h-3.5 text-red-500 ms-auto" />
              </div>
            ))}
          </div>
        )}
        <p className="text-[9.5px] text-muted-foreground leading-relaxed">
          أي جهاز في هذه القائمة يحاول الاقتران أو إعادة الاتصال → يُقابَل بالقتل فورًا قبل أي مصافحة (48.ج) —
          القائمة لا تُفرَّغ من الواجهة أبدًا؛ مالك القرص وحده يدير ملفها بيده.
        </p>
      </div>

      {/* الحدود الصادقة الست */}
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h4 className="font-bold text-[13px]">الحدود الصادقة — تعرفها قبل الضغطة (48.و)</h4>
        </div>
        <ol className="text-[10.5px] text-muted-foreground leading-relaxed space-y-1.5 list-decimal list-inside">
          <li>لا «حزمة تثبّت نفسها خفيةً» — الوكيل يُثبَّت مسبقًا بيدك أنت حصرًا (نمط Find My)؛ ما ينشره السراق يبقى نادرًا بلا وكيل.</li>
          <li>سياسة وتطبيق لا عتاد — فلاش الجهاز يمحو الوكيل؛ يبقى سجل الأدلة عندك وليس قفل عتاد على مستوى Apple Activation Lock.</li>
          <li>القتل أحادي الاتجاه بنيويًا — لا API إلغاء في أي مكان؛ القائمة الدائمة تواجه أي إعادة اتصال بالقتل الفوري.</li>
          <li>التوصيل عبر قنوات موثوقة حصرًا (الشبكة المحلية/إعادة اتصال معروفة/تصعيد محلي) — لا سحابة وسيطة ولا إنترنت عام أبدًا.</li>
          <li>الإدارة من الجهاز (loopback) + الرمز يمنع الطلقة العرضية لا المدير — من يملك القرص يملك الحسم.</li>
          <li>تدوير الرمز يعالج الأثر (فتحة المسروق على سطح المكتب) لا الهاتف — الهاتف يعالجه وكيله بنفسه.</li>
        </ol>
      </div>
    </div>
  )
}
