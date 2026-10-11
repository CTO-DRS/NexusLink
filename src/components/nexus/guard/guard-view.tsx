"use client"
// NexusLink — واجهة الحماية وإدارة الأجهزة (المرحلة 8)
// لوحة الجهاز · التطبيقات · أين هاتفي · وضع الفقدان · القرب التلقائي · المنبهات
import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { toast } from "sonner"
import {
  Gauge, PackageOpen, BellRing, ShieldAlert, RadioTower, SlidersHorizontal,
  CheckCircle2, Circle, QrCode, PartyPopper, ShieldCheck, LockKeyhole, Hand,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useGuard, type GuardTab } from "@/lib/guard-store"
import { DashboardTab } from "./dashboard-tab"
import { AppsTab } from "./apps-tab"
import { FindTab } from "./find-tab"
import { LostTab } from "./lost-tab"
import { ProximityTab } from "./proximity-tab"
import { ControlTab } from "./control-tab"
import { RemoteTouchTab } from "./remote-touch-tab"
import { PhoneMirror } from "./phone-mirror"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

const TABS: { id: GuardTab; label: string; icon: LucideIcon; num: string }[] = [
  { id: "dashboard", label: "لوحة الجهاز", icon: Gauge, num: "1" },
  { id: "apps", label: "التطبيقات", icon: PackageOpen, num: "2" },
  { id: "find", label: "أين هاتفي", icon: BellRing, num: "3" },
  { id: "lost", label: "وضع الفقدان", icon: ShieldAlert, num: "4" },
  { id: "proximity", label: "القرب التلقائي", icon: RadioTower, num: "5" },
  { id: "control", label: "المنبهات والإعدادات", icon: SlidersHorizontal, num: "6" },
  { id: "touch", label: "التحكم باللمس", icon: Hand, num: "7" },
]

const CHECKS: { key: string; label: string; star?: boolean }[] = [
  { key: "dashboard", label: "لوحة جهاز بمؤشرات حية (بطارية/تخزين/ذاكرة/معالج)" },
  { key: "apps", label: "إدارة تطبيق: نسخ احتياطي APK أو تثبيت أو إزالة" },
  { key: "ring", label: "رن قوي على الهاتف يتجاوز الوضع الصامت" },
  { key: "lost", label: "وضع الفقدان برسالة على شاشة الهاتف" },
  { key: "lock", label: "ابتعدت بهاتفك ← الكمبيوتر قفل نفسه تلقائياً", star: true },
  { key: "unlock", label: "عدت بالهاتف ← فُتح القفل تلقائياً", star: true },
  { key: "control", label: "منبه أو إعداد سريع عُدّل من الكمبيوتر" },
]

export function GuardView() {
  const { tab, setTab, bridgeOnline, phoneOnline, checks, celebrated, setCelebrated, ringing, lost } = useGuard()
  const [qrOpen, setQrOpen] = useState(false)
  const [qrUrl, setQrUrl] = useState("")

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
    setQrUrl(await QRCode.toDataURL(url, { width: 260, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } }))
    setQrOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-white grid place-items-center shadow-lg shadow-teal-600/25">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <h2 className="font-black text-[16px]">الحماية وإدارة الأجهزة</h2>
            <div className="text-[10.5px] text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className={cn("inline-flex items-center gap-1", bridgeOnline ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                <span className={cn("w-1.5 h-1.5 rounded-full", bridgeOnline ? "bg-emerald-500 nexus-live" : "bg-red-500")} />
                جسر الحماية {bridgeOnline ? "متصل" : "منقطع"}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span>{phoneOnline ? "هاتفك الحقيقي يبث منارة القرب" : "منارة المحاكاة تعمل"}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {(ringing || lost.active) && (
            <Badge className={cn("rounded-full text-[10px] gap-1 animate-pulse", ringing ? "bg-red-500 hover:bg-red-500" : "bg-amber-500 hover:bg-amber-500")}>
              {ringing ? "الهاتف يرن الآن" : "وضع الفقدان مفعّل"}
            </Badge>
          )}
          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={() => void openQr()}>
            <QrCode className="w-3.5 h-3.5" /> هاتفك الحقيقي
          </Button>
        </div>
      </div>

      {/* اختبار النجاح */}
      <div className={cn("rounded-2xl border bg-card p-4", allDone && "border-emerald-500/60 bg-emerald-500/5")}>
        <div className="flex items-center gap-2 mb-2.5">
          {allDone ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <LockKeyhole className="w-4 h-4 text-muted-foreground" />}
          <span className="text-[13px] font-bold">اختبار النجاح — إدارة كاملة وحماية تلقائية</span>
          <Badge variant={allDone ? "default" : "outline"} className={cn("rounded-full text-[10px] ms-auto", allDone && "bg-emerald-500 hover:bg-emerald-500")}>
            {done}/{CHECKS.length}
          </Badge>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CHECKS.map((c) => {
            const ok = !!checks[c.key]
            return (
              <div key={c.key} className={cn("flex items-center gap-2 text-[11.5px]", !ok && "text-muted-foreground")}>
                {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
                <span className={cn(ok && "font-medium")}>{c.label}</span>
                {c.star && <span className="text-[9px]">⭐</span>}
              </div>
            )
          })}
        </div>
        {allDone && (
          <p className="text-[11.5px] text-emerald-600 dark:text-emerald-400 mt-2 font-semibold">
            مكتمل! ابتعدت بهاتفك فقُفل الكمبيوتر تلقائياً، وعدت فانفتح — الحماية تعمل.
          </p>
        )}
      </div>

      {/* شريط التبويبات */}
      <div className="flex gap-1.5 overflow-x-auto rounded-2xl border bg-card/80 backdrop-blur p-1.5" role="tablist" aria-label="ميزات الحماية">
        {TABS.map((t) => {
          const active = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative flex items-center gap-1.5 rounded-xl px-3 sm:px-4 py-2 text-[12px] font-semibold whitespace-nowrap transition-all",
                active ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              <span className={cn("rounded-full px-1.5 text-[8.5px] font-bold", active ? "bg-white/20" : "bg-muted")}>{t.num}</span>
            </button>
          )
        })}
      </div>

      {/* المحتوى + مرآة الهاتف */}
      <div className="grid gap-4 xl:grid-cols-[1fr_290px] items-start">
        <div className="min-w-0 nexus-enter" key={tab}>
          {tab === "dashboard" && <DashboardTab />}
          {tab === "apps" && <AppsTab />}
          {tab === "find" && <FindTab />}
          {tab === "lost" && <LostTab />}
          {tab === "proximity" && <ProximityTab />}
          {tab === "control" && <ControlTab />}
          {tab === "touch" && <RemoteTouchTab />}
        </div>
        <aside className="xl:sticky xl:top-16 space-y-3">
          <PhoneMirror />
          <p className="text-[10px] text-muted-foreground text-center leading-relaxed px-2">
            مرآة حية للهاتف — كل أمر من الكمبيوتر يظهر هنا وعلى هاتفك الحقيقي عبر <span className="font-mono dir-ltr">/phone</span>
          </p>
        </aside>
      </div>

      {/* QR */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">افتح الحماية على هاتفك</DialogTitle>
            <DialogDescription className="text-center">
              امسح الرمز — سيصبح هاتفك منارة القرب ويستقبل الرن ووضع الفقدان
            </DialogDescription>
          </DialogHeader>
          {qrUrl && <img src={qrUrl} alt="رمز QR لصفحة الهاتف" className="rounded-2xl mx-auto" width={260} height={260} />}
          <p className="text-[10.5px] text-center text-muted-foreground dir-ltr font-mono">{typeof window !== "undefined" ? `${window.location.host}/phone` : ""}</p>
        </DialogContent>
      </Dialog>

      {/* احتفال الاكتمال */}
      <Dialog open={celebrated && allDone} onOpenChange={(o) => !o && setCelebrated(false)}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2 text-[16px]">
              <PartyPopper className="w-5 h-5 text-amber-500" /> اختبار النجاح مكتمل 7/7
            </DialogTitle>
            <DialogDescription className="text-center text-[12px] leading-relaxed">
              ابتعدت بهاتفك فقُفل الكمبيوتر تلقائياً، وعادت فانفتح —
              مع إدارة كاملة للتطبيقات والمنبهات والرن ووضع الفقدان، كل ذلك عبر Nexus Protocol محلياً.
            </DialogDescription>
          </DialogHeader>
          <div className="text-5xl pb-2">🔒📱✨</div>
          <Button className="rounded-2xl" onClick={() => setCelebrated(false)}>رائع!</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
