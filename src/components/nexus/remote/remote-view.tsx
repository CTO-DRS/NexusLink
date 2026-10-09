"use client"
// واجهة التحكم عن بُعد — شاشة الكمبيوتر الافتراضية + اختبار النجاح + سجل الأوامر + جهاز التحكم
import { useState } from "react"
import QRCode from "qrcode"
import Link from "next/link"
import {
  MousePointer2, CheckCircle2, Circle, ScrollText, Smartphone, QrCode, ExternalLink,
  Zap, PartyPopper, Signal, Link2,
} from "lucide-react"
import { useDesktop } from "@/lib/remote-store"
import { VirtualDesktop } from "./desktop/virtual-desktop"
import { ControllerShell } from "./controller/controller-shell"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import type { LucideIcon } from "lucide-react"

const CHECKS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "move", label: "تحريك مؤشر الكمبيوتر بالهاتف (لوحة اللمس)", icon: MousePointer2 },
  { id: "click", label: "النقر الأيسر/الأيمن والتمرير والقرص", icon: MousePointer2 },
  { id: "presenter", label: "تقليب شرائح العرض التقديمي بالهاتف", icon: MousePointer2 },
  { id: "key", label: "الكتابة بلوحة مفاتيح الهاتف في المفكرة", icon: MousePointer2 },
  { id: "air", label: "الماوس الهوائي بحركة الهاتف والجيروسكوب", icon: MousePointer2 },
  { id: "game", label: "يد الألعاب: عصا + جيروسكوب + أزرار مخصصة", icon: MousePointer2 },
  { id: "media", label: "التحكم بالمشغلات: تشغيل/تخطي/صوت", icon: MousePointer2 },
  { id: "power", label: "أوامر النظام: إيقاف/إسبات/إيقاظ Wake-on-LAN", icon: MousePointer2 },
  { id: "clipboard", label: "الحافظة المشتركة بين الهاتف والكمبيوتر", icon: MousePointer2 },
]

function LogIcon({ kind }: { kind: string }) {
  if (kind === "in") return <Signal className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />
  if (kind === "ok") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
  return <Zap className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
}

export function RemoteView() {
  const { rcOnline, phoneConnected, latency, checklist, rcLogs } = useDesktop()
  const [qrOpen, setQrOpen] = useState(false)
  const [qrUrl, setQrUrl] = useState("")
  const [qrData, setQrData] = useState("")
  const done = CHECKS.filter((c) => checklist[c.id]).length
  const allDone = done === CHECKS.length

  function openQr() {
    const url = `${window.location.origin}/controller`
    setQrUrl(url)
    setQrOpen(true)
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .then(setQrData)
      .catch(() => setQrData(""))
  }

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="me-auto">
          <h2 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
            <MousePointer2 className="w-5 h-5 text-primary" />
            التحكم عن بُعد — الهاتف يدير الكمبيوتر
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            لوحة لمس · كيبورد · ماوس هوائي · يد ألعاب · عروض · وسائط · أوامر نظام · حافظة مشتركة
          </p>
        </div>
        <Badge variant={rcOnline ? "default" : "destructive"} className="rounded-full gap-1">
          <Link2 className="w-3 h-3" /> {rcOnline ? "الجسر متصل" : "الجسر منقطع"}
        </Badge>
        <Badge variant={phoneConnected ? "default" : "secondary"} className="rounded-full gap-1">
          <Smartphone className="w-3 h-3" /> {phoneConnected ?? "لا هاتف بعد"}
        </Badge>
        {latency != null && (
          <Badge variant="secondary" className="rounded-full gap-1">
            <Signal className="w-3 h-3" /> <span dir="ltr">{latency}ms</span>
          </Badge>
        )}
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <Button size="sm" className="rounded-xl h-8 gap-1.5" onClick={openQr}>
            <QrCode className="w-3.5 h-3.5" /> افتح التحكم على هاتفك
          </Button>
          <DialogContent className="max-w-[320px] rounded-3xl">
            <DialogHeader>
              <DialogTitle className="text-[15px]">جهاز التحكم على هاتفك الحقيقي</DialogTitle>
              <DialogDescription className="text-[11.5px] leading-relaxed">
                امسح الرمز أو افتح الرابط من هاتفك (نفس الشبكة) — سيصبح هاتفك لوحة لمس وكيبورد ويد ألعاب
                حقيقية لهذه الشاشة، بجيروسكوب فعلي للماوس الهوائي.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-2.5 py-1">
              {qrData ? (
                <img src={qrData} alt="رمز QR لصفحة التحكم" className="rounded-2xl border-4 border-background shadow" width={200} height={200} />
              ) : (
                <div className="w-[200px] h-[200px] rounded-2xl bg-muted grid place-items-center text-[11px] text-muted-foreground">جارٍ توليد الرمز…</div>
              )}
              <code className="text-[11px] bg-muted rounded-lg px-2.5 py-1.5" dir="ltr">{qrUrl}</code>
              <Button variant="outline" size="sm" className="rounded-xl gap-1.5" asChild>
                <Link href="/controller" target="_blank">
                  <ExternalLink className="w-3.5 h-3.5" /> فتح الصفحة هنا للتجربة
                </Link>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_312px] gap-5 items-start">
        {/* العمود الأيمن: الشاشة + الاختبار + السجل */}
        <div className="space-y-4 min-w-0">
          <VirtualDesktop />

          {/* اختبار النجاح */}
          <div className="rounded-2xl border bg-card p-4" data-testid="success-checklist">
            <div className="flex items-center gap-2 mb-2.5">
              <Zap className="w-4 h-4 text-amber-500" />
              <span className="text-[13px] font-bold">اختبار النجاح — تحريك ماوس الكمبيوتر بهاتفك + تقليب العرض</span>
              <Badge className="ms-auto rounded-full text-[10px]" variant={allDone ? "default" : "secondary"} dir="ltr">
                {done}/{CHECKS.length}
              </Badge>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all duration-500 ${allDone ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${(done / CHECKS.length) * 100}%` }}
              />
            </div>
            {allDone && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 mb-3 flex items-center gap-2 text-[12px] font-bold text-emerald-600">
                <PartyPopper className="w-4 h-4" />
                اختبار النجاح مكتمل — هاتفك يتحكم بالكمبيوتر بالكامل عبر Nexus Protocol!
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
              {CHECKS.map((c) => (
                <div key={c.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] transition-colors ${checklist[c.id] ? "text-foreground" : "text-muted-foreground/70"}`}>
                  {checklist[c.id] ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                  )}
                  <span className={checklist[c.id] ? "font-semibold" : ""}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* سجل الأوامر */}
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-2 text-[13px] font-bold mb-2">
              <ScrollText className="w-4 h-4 text-primary" /> سجل الأوامر الواردة عبر Nexus Protocol
              <Badge variant="secondary" className="text-[10px]">{rcLogs.length}</Badge>
            </div>
            <ScrollArea className="h-52 nexus-scroll">
              <div className="space-y-1 pe-2">
                {rcLogs.length === 0 ? (
                  <p className="text-center text-[12px] text-muted-foreground py-8 leading-relaxed">
                    لا أوامر بعد — استخدم جهاز التحكم (الإطار جانباً أو هاتفك الحقيقي)<br />
                    وحرّك المؤشر أو بدّل الشرائح، وسيظهر كل شيء هنا فوراً
                  </p>
                ) : (
                  rcLogs.map((l) => (
                    <div key={l.id} className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-accent/50 text-[12px]">
                      <LogIcon kind={l.kind} />
                      <span className="flex-1 leading-relaxed">{l.text}</span>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* جهاز التحكم */}
        <div className="hidden xl:block">
          <div className="sticky top-20 mx-auto w-[300px]">
            <div className="rounded-[2.4rem] border-4 border-foreground/80 bg-foreground/5 p-2 shadow-2xl">
              <div className="rounded-[1.9rem] bg-background overflow-hidden h-[620px] flex flex-col">
                {/* شريط حالة الهاتف */}
                <div className="flex justify-center py-1.5 shrink-0">
                  <div className="w-20 h-4 rounded-full bg-foreground/80" />
                </div>
                <div className="flex-1 min-h-0">
                  <ControllerShell />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
              <Smartphone className="w-3 h-3" />
              جهاز تحكم Nexus — استخدمه بالفأرة هنا أو على هاتفك الحقيقي
            </div>
          </div>
        </div>
      </div>

      {/* على الشاشات الصغيرة: زر الانتقال لصفحة التحكم */}
      <div className="xl:hidden rounded-2xl border bg-card p-3.5 flex items-center gap-3">
        <Smartphone className="w-5 h-5 text-primary shrink-0" />
        <p className="text-[12px] flex-1 leading-relaxed">
          على هذا الحجم جهاز التحكم مخفي — افتح <b>/controller</b> في تبويب أو هاتف آخر ليتحكم بهذه الشاشة فعلياً.
        </p>
        <Button size="sm" className="rounded-xl gap-1.5 shrink-0" asChild>
          <Link href="/controller" target="_blank">
            <ExternalLink className="w-3.5 h-3.5" /> فتح
          </Link>
        </Button>
      </div>
    </div>
  )
}
