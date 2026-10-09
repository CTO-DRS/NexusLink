"use client"
// واجهة طبقة الوسائط والكاميرا — تجمع كل ميزات المرحلة السابعة
import {
  Video, Shield, Baby, Mic, Cast, Images, CheckCircle2, Circle, ScrollText,
  Zap, Link2, QrCode, BellRing, Camera, Baby as BabyIcon, Footprints, Signal,
} from "lucide-react"
import { useState } from "react"
import QRCode from "qrcode"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useMedia, type MediaTab } from "@/lib/media-store"
import { WebcamTab } from "./webcam-tab"
import { SecurityTab } from "./security-tab"
import { BabyTab } from "./baby-tab"
import { MicTab } from "./mic-tab"
import { CastTab } from "./cast-tab"
import { GalleryTab } from "./gallery-tab"
import { SlideshowOverlay } from "./slideshow-overlay"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

const TABS: { id: MediaTab; label: string; icon: LucideIcon; num: string }[] = [
  { id: "webcam", label: "ويب كام", icon: Video, num: "1-2" },
  { id: "security", label: "المراقبة", icon: Shield, num: "3" },
  { id: "baby", label: "مراقبة الطفل", icon: Baby, num: "4" },
  { id: "mic", label: "ميكروفون", icon: Mic, num: "5" },
  { id: "cast", label: "البث", icon: Cast, num: "6" },
  { id: "gallery", label: "المعرض", icon: Images, num: "7" },
]

const CHECKS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "webcam", label: "كاميرا الهاتف تعمل كويب كام للكمبيوتر (WebRTC)", icon: Video },
  { key: "call", label: "مكالمة فيديو على الكمبيوتر تستخدم كاميرا هاتفك", icon: Video },
  { key: "controls", label: "تبديل أمامية/خلفية + فلاش + مؤقت تصوير عن بُعد", icon: Camera },
  { key: "security", label: "وضع المراقبة: بث + تنبيه عند حركة (بدون AI)", icon: Footprints },
  { key: "baby", label: "مراقبة الأطفال: بث صوت دائم من هاتف إلى آخر", icon: BabyIcon },
  { key: "mic", label: "الهاتف كميكروفون لاسلكي للكمبيوتر", icon: Mic },
  { key: "cast", label: "بث موسيقى/فيديو إلى TV أو الكمبيوتر بدون نسخ", icon: Cast },
  { key: "gallery", label: "تصفح المعرض + عرض شرائح على الشاشة الكبيرة", icon: Images },
]

function AlertIcon({ kind }: { kind: string }) {
  if (kind === "motion") return <Footprints className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
  if (kind === "cry") return <BabyIcon className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
  if (kind === "capture") return <Camera className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />
  return <BellRing className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
}

export function MediaView() {
  const { tab, setTab, bridgeOnline, phoneOnline, latency, checks, alerts, logs } = useMedia()
  const [qrOpen, setQrOpen] = useState(false)
  const [qrUrl, setQrUrl] = useState("")
  const [qrData, setQrData] = useState("")
  const [alertsOpen, setAlertsOpen] = useState(false)

  const done = CHECKS.filter((c) => checks[c.key as keyof typeof checks]).length
  const allDone = done === CHECKS.length

  function openQr() {
    const url = `${window.location.origin}/phone`
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
            <Video className="w-5 h-5 text-primary" />
            الوسائط والكاميرا — الهاتف عين وأذن الشبكة
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            ويب كام · مراقبة بالحركة · مراقبة الأطفال · ميكروفون لاسلكي · بث بدون نسخ · معرض وشرائح
          </p>
        </div>
        <Badge variant={bridgeOnline ? "default" : "destructive"} className="rounded-full gap-1">
          <Link2 className="w-3 h-3" /> {bridgeOnline ? "جسر الوسائط متصل" : "الجسر منقطع"}
        </Badge>
        {latency !== null && (
          <Badge variant="outline" className="rounded-full gap-1 text-[10px]">
            <Signal className="w-3 h-3" /> {latency}ms
          </Badge>
        )}
        <Badge variant={phoneOnline ? "default" : "secondary"} className="rounded-full gap-1">
          <Video className="w-3 h-3" /> {phoneOnline ? `${phoneOnline} متصل` : "لا هاتف وسائط"}
        </Badge>
        <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={() => setAlertsOpen(true)}>
          <BellRing className="w-3.5 h-3.5" /> التنبيهات
          {alerts.length > 0 && (
            <span className="min-w-4 h-4 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white grid place-items-center">{alerts.length}</span>
          )}
        </Button>
        <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={openQr}>
          <QrCode className="w-3.5 h-3.5" /> هاتف حقيقي
        </Button>
      </div>

      {/* شريط التبويبات */}
      <div className="flex gap-1.5 overflow-x-auto rounded-2xl border bg-card/80 backdrop-blur p-1.5" role="tablist" aria-label="ميزات الوسائط">
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

      {/* المحتوى */}
      <div className="grid gap-4 xl:grid-cols-[1fr_300px] items-start">
        <div className="min-w-0 nexus-enter" key={tab}>
          {tab === "webcam" && <WebcamTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "baby" && <BabyTab />}
          {tab === "mic" && <MicTab />}
          {tab === "cast" && <CastTab />}
          {tab === "gallery" && <GalleryTab />}
        </div>

        {/* العمود الجانبي: اختبار النجاح + السجل */}
        <aside className="space-y-4 xl:sticky xl:top-20">
          <div className={cn("rounded-xl border bg-card p-4", allDone && "border-emerald-500/60 bg-emerald-500/5")}>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-[13px] font-bold flex items-center gap-1.5">
                {allDone ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                اختبار النجاح
              </h3>
              <Badge variant={allDone ? "default" : "outline"} className={cn("rounded-full text-[10px] ms-auto", allDone && "bg-emerald-500 hover:bg-emerald-500")}>
                {done}/{CHECKS.length}
              </Badge>
            </div>
            <ul className="space-y-2">
              {CHECKS.map((c) => {
                const ok = checks[c.key as keyof typeof checks]
                const Icon = c.icon
                return (
                  <li key={c.key} className={cn("flex items-start gap-2 text-[11px] leading-snug", ok ? "text-foreground" : "text-muted-foreground")}>
                    {ok
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      : <Circle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />}
                    <Icon className="w-3 h-3 opacity-60 shrink-0 mt-1" />
                    <span className={cn(ok && "font-medium")}>{c.label}</span>
                  </li>
                )
              })}
            </ul>
            {allDone && (
              <p className="mt-3 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold px-3 py-2 text-center">
                المرحلة السابعة مكتملة — كاميرا هاتفك الآن كويب كام للكمبيوتر ✓
              </p>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h3 className="text-[13px] font-bold flex items-center gap-1.5 mb-2">
              <ScrollText className="w-4 h-4 text-primary" /> سجل Nexus Media
            </h3>
            <ScrollArea className="h-64">
              <ul className="space-y-1.5 pe-2">
                {logs.length === 0 && <li className="text-[11px] text-muted-foreground py-2">لا أحداث بعد</li>}
                {logs.map((l) => (
                  <li key={l.id} className="flex items-start gap-1.5 text-[10.5px] leading-snug">
                    {l.kind === "in" && <Zap className="w-3 h-3 text-teal-500 shrink-0 mt-0.5" />}
                    {l.kind === "ok" && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />}
                    {l.kind === "warn" && <BellRing className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />}
                    {l.kind === "info" && <Signal className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />}
                    <span className="text-muted-foreground">{l.text}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        </aside>
      </div>

      {/* عرض الشرائح بملء الشاشة */}
      <SlideshowOverlay />

      {/* نافذة QR للهاتف الحقيقي */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="w-4 h-4 text-primary" /> صل هاتفك الحقيقي
            </DialogTitle>
            <DialogDescription>
              امسح الرمز بهاتفك — ستتحول كاميرا الهاتف وميكروفونه إلى قنوات بث حقيقية على الشبكة،
              ويصبح بإمكانه التصوير عن بُعد والتحكم بالعرض والبث.
            </DialogDescription>
          </DialogHeader>
          <div className="grid place-items-center gap-3 py-2">
            {qrData ? (
               
              <img src={qrData} alt="رمز QR لصفحة هاتف الوسائط" className="rounded-xl border bg-white p-2 w-52 h-52" />
            ) : (
              <div className="w-52 h-52 rounded-xl bg-muted animate-pulse" />
            )}
            <p className="text-[11px] text-muted-foreground text-center break-all" dir="ltr">{qrUrl}</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* نافذة كل التنبيهات */}
      <Dialog open={alertsOpen} onOpenChange={setAlertsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-primary" /> تنبيهات الوسائط
            </DialogTitle>
            <DialogDescription>حركة، بكاء، ولقطات جديدة — فورياً من كل الأجهزة</DialogDescription>
          </DialogHeader>
          {alerts.length === 0 ? (
            <p className="text-[12px] text-muted-foreground text-center py-6">لا تنبيهات بعد — فعّل المراقبة أو مراقبة الأطفال</p>
          ) : (
            <ul className="space-y-2 max-h-80 overflow-y-auto pe-1">
              {alerts.map((a) => (
                <li key={a.id} className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2.5",
                  a.kind === "motion" && "bg-amber-500/10 border-amber-500/30",
                  a.kind === "cry" && "bg-red-500/10 border-red-500/30",
                  a.kind === "capture" && "bg-teal-500/10 border-teal-500/30",
                )}>
                  <AlertIcon kind={a.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-snug">{a.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                      {new Date(a.at).toLocaleTimeString("ar")} {a.level !== undefined ? `· الشدة ${a.level}%` : ""}
                    </p>
                  </div>
                  {a.kind === "capture" && a.snapshot && (
                     
                    <img
                      src={`/api/thumb?device=galaxy-s24&path=${encodeURIComponent(a.snapshot)}`}
                      alt="لقطة"
                      className="w-12 h-12 rounded-lg object-cover border shrink-0"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
