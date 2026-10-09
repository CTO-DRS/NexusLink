"use client"
// NexusLink — المرحلة 10: واجهة تقوية الأمان الشامل
// تشفير E2E · قفل التطبيق · صلاحيات لكل ميزة · سجل تدقيق
// · حذف آمن · تنبيه الأجهزة غير الموثوقة · وضع التخفي · اختبار Wireshark
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  KeyRound, Wifi, LockKeyhole, ToggleLeft, ScrollText, Flame, EyeOff,
  CheckCircle2, Circle, PartyPopper, QrCode, ShieldCheck, ScanSearch, ShieldAlert,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useSec, type SecTab } from "@/lib/sec-store"
import { useSecBridge } from "@/hooks/use-sec-bridge"
import { getSecSocket } from "@/lib/sec-socket"
import { CryptoTab } from "./crypto-tab"
import { CaptureTab } from "./capture-tab"
import { ApplockTab } from "./applock-tab"
import { PermsTab } from "./perms-tab"
import { AuditTab } from "./audit-tab"
import { WipeTab } from "./wipe-tab"
import { StealthTab } from "./stealth-tab"
import { StrangerAlerts } from "./stranger-alerts"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

const TABS: { id: SecTab; label: string; icon: LucideIcon; num: string }[] = [
  { id: "crypto", label: "التشفير E2E", icon: KeyRound, num: "1" },
  { id: "capture", label: "اختبار Wireshark", icon: ScanSearch, num: "2" },
  { id: "applock", label: "قفل التطبيق", icon: LockKeyhole, num: "3" },
  { id: "perms", label: "الصلاحيات", icon: ToggleLeft, num: "4" },
  { id: "audit", label: "سجل التدقيق", icon: ScrollText, num: "5" },
  { id: "wipe", label: "الحذف الآمن", icon: Flame, num: "6" },
  { id: "stealth", label: "وضع التخفي", icon: EyeOff, num: "7" },
]

const CHECKS: { key: string; label: string; star?: boolean }[] = [
  { key: "kex", label: "تبادل مفاتيح X25519 تم — القناة مشفرة E2E بـ AES-256-GCM", star: true },
  { key: "transfer", label: "ملف حقيقي نُقل مشفراً وفُك تشفيره سليماً (SHA-256 مطابق)", star: true },
  { key: "wireshark", label: "التقاط بايتات القناة أثناء النقل ← لا محتوى مقروءاً + pcap حقيقي", star: true },
  { key: "applock", label: "قفل التطبيق على الهاتف (PIN/نمط/بصمة) + قفل عن بُعد يعمل" },
  { key: "perms", label: "إيقاف ميزة واحدة منع أمرها فعلاً (رفض مشفر ومسجل)" },
  { key: "audit", label: "سجل التدقيق يوثق كل عملية ويُراجَع ويُصدَّر" },
  { key: "wipe", label: "الحذف الآمن مسح ملفاً حقيقياً بتمريرات متعددة (بلا سلة محذوفات)" },
  { key: "alert", label: "جهاز غير موثوق حاول الاتصال ← تنبيه فوري + قرار حظر/توثيق" },
  { key: "stealth", label: "نقل في وضع التخفي بلا أي أثر في السجل أو التاريخ" },
]

export function SecView() {
  // جسر الأمان: مصافحة + إطارات + تنبيهات (دور الكمبيوتر)
  useSecBridge("desktop")
  const { tab, setTab, checks, celebrated, setCelebrated, bridgeOnline, kexDone, stealth } = useSec()
  const [qrOpen, setQrOpen] = useState(false)
  const [qrUrl, setQrUrl] = useState("")
  const [dismissed, setDismissed] = useState(false)
  const done = CHECKS.filter((c) => checks[c.key]).length
  const allDone = done === CHECKS.length

  useEffect(() => {
    if (allDone && !celebrated) {
      const t = setTimeout(() => setCelebrated(true), 800)
      return () => clearTimeout(t)
    }
  }, [allDone, celebrated, setCelebrated])

  const openQr = async () => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/phone` : "/phone"
    setQrUrl(url)
    setQrOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white grid place-items-center shadow-lg shadow-emerald-500/25">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">الأمان الشامل</h1>
            <p className="text-xs text-muted-foreground">تشفير E2E فعلي · قفل · صلاحيات · تدقيق · حذف آمن · تخفي</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={bridgeOnline ? "default" : "outline"} className={bridgeOnline ? "bg-emerald-600" : ""}>
            <Wifi className="w-3 h-3 me-1" /> جسر 3009 {bridgeOnline ? "متصل" : "منقطع"}
          </Badge>
          <Badge variant={kexDone ? "default" : "outline"} className={kexDone ? "bg-teal-600" : ""}>
            <KeyRound className="w-3 h-3 me-1" /> E2E {kexDone ? "نشط" : "بانتظار الطرف الآخر"}
          </Badge>
          {stealth && <Badge className="bg-slate-700"><EyeOff className="w-3 h-3 me-1" /> وضع التخفي مفعّل</Badge>}
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5 border-red-500/40 text-red-600 hover:bg-red-500/10" onClick={() => { getSecSocket().emit("sec:stranger-probe", {}); toast.info("جهاز غريب يحاول الاتصال الآن — راقب التنبيه") }}>
            <ShieldAlert className="w-4 h-4" /> محاكاة جهاز غريب
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={openQr}>
            <QrCode className="w-4 h-4" /> فتح الهاتف
          </Button>
        </div>
      </div>

      {/* اختبار النجاح */}
      {!dismissed && (
        <div className={cn(
          "rounded-2xl border p-4 space-y-2 transition-colors",
          allDone ? "border-emerald-500/40 bg-emerald-500/10" : "bg-card",
        )}>
          <div className="flex items-center justify-between">
            <div className="font-bold text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              اختبار النجاح: {done}/{CHECKS.length}
              {allDone && <PartyPopper className="w-4 h-4 text-amber-500" />}
            </div>
            <button onClick={() => setDismissed(true)} className="text-[11px] text-muted-foreground hover:text-foreground">إخفاء</button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {CHECKS.map((c) => (
              <div key={c.key} className={cn("flex items-start gap-2 text-[12px] rounded-lg px-2 py-1.5", checks[c.key] ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                {checks[c.key] ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Circle className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-40" />}
                <span>
                  {c.star && <span className="text-amber-500 me-1">★</span>}
                  {c.label}
                </span>
              </div>
            ))}
          </div>
          {allDone && (
            <div className="rounded-xl bg-emerald-600 text-white text-center text-sm font-bold py-2.5 animate-pulse">
              🎉 الأمان مثبّت بالكامل — Wireshark يرى بايتات مشفرة فقط!
            </div>
          )}
        </div>
      )}

      {/* التبويبات */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const active = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium whitespace-nowrap transition-all border",
                active ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="opacity-60">{t.num}</span> {t.label}
            </button>
          )
        })}
      </div>

      <div className="nexus-enter">
        {tab === "crypto" && <CryptoTab onOpenPhone={openQr} />}
        {tab === "capture" && <CaptureTab />}
        {tab === "applock" && <ApplockTab />}
        {tab === "perms" && <PermsTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "wipe" && <WipeTab />}
        {tab === "stealth" && <StealthTab />}
      </div>

      {/* تنبيهات الأجهزة غير الموثوقة (عام) */}
      <StrangerAlerts />

      {/* QR */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="w-4 h-4" /> افتح هاتفك</DialogTitle>
            <DialogDescription>
              امسح الرمز بهاتفك (أو افتح الرابط) — صفحة الهاتف تتصل بقناة الأمان نفسها،
              وهناك تُضبط البصمة/النمط/رمز القفل وتظهر الأوامر المشفرة.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl bg-white p-3 mx-auto w-fit">
            <QrCanvas url={qrUrl} />
          </div>
          <p className="text-center text-[11px] text-muted-foreground break-all">{qrUrl}</p>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// رسم QR عبر مكتبة qrcode (نفس أسلوب prod-view)
function QrCanvas({ url }: { url: string }) {
  const [data, setData] = useState("")
  useEffect(() => {
    if (!url) return
    void import("qrcode").then((QR) => QR.toDataURL(url, { width: 240, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })).then(setData).catch(() => {})
  }, [url])
  if (!data) return <div className="w-[240px] h-[240px] grid place-items-center text-xs text-slate-400">…</div>
  return <img src={data} alt="رمز فتح الهاتف" width={240} height={240} className="rounded-lg" />
}
