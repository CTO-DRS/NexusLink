"use client"
// NexusLink — واجهة الإنتاجية (المرحلة 9)
// الحافظة الموحدة · مزامنة المجلدات · مزامنة الصور · أكمل من حيث توقفت
// · ملفات تعريف الشبكة · النسخ الاحتياطي والاستعادة
import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { toast } from "sonner"
import {
  ClipboardCheck, FolderSync, Images, Send, Network, DatabaseBackup,
  CheckCircle2, Circle, QrCode, PartyPopper, Zap, Wifi,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useProd, type ProdTab } from "@/lib/prod-store"
import { ClipboardTab } from "./clipboard-tab"
import { FoldersTab } from "./folders-tab"
import { PhotosTab } from "./photos-tab"
import { HandoffTab } from "./handoff-tab"
import { ProfilesTab } from "./profiles-tab"
import { BackupTab } from "./backup-tab"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

const TABS: { id: ProdTab; label: string; icon: LucideIcon; num: string }[] = [
  { id: "clipboard", label: "الحافظة الموحدة", icon: ClipboardCheck, num: "1" },
  { id: "folders", label: "مزامنة المجلدات", icon: FolderSync, num: "2" },
  { id: "photos", label: "الصور التلقائية", icon: Images, num: "3" },
  { id: "handoff", label: "أكمل من حيث توقفت", icon: Send, num: "4" },
  { id: "profiles", label: "ملفات الشبكات", icon: Network, num: "5" },
  { id: "backup", label: "النسخ الاحتياطي", icon: DatabaseBackup, num: "6" },
]

const CHECKS: { key: string; label: string; star?: boolean }[] = [
  { key: "copy", label: "نسخت نصًا من هاتفك ← ظهر في الحافظة الموحدة على الكمبيوتر", star: true },
  { key: "paste", label: "ضغطت Ctrl+V على الكمبيوتر ← لُصق النص مباشرة", star: true },
  { key: "folders", label: "زوج مزامنة مجلدات نقل ملفات حقيقية في الاتجاهين" },
  { key: "photo", label: "صورة جديدة على الهاتف نُسخت تلقائياً إلى الكمبيوتر" },
  { key: "handoff", label: "رابط مفتوح على الهاتف أُكمل على الكمبيوتر بضغطة" },
  { key: "profile", label: "ملف تعريف الشبكة انطبق تلقائياً عند تغيير الشبكة" },
  { key: "backup", label: "نسخة احتياطية أُنشئت واستُعيدت بنجاح" },
]

export function ProdView() {
  const { tab, setTab, bridgeOnline, profile, state, checks, celebrated, setCelebrated, unseenClips, clearUnseen } = useProd()
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

  // كسر شارة غير المقروء عند فتح تبويب الحافظة
  useEffect(() => {
    if (tab === "clipboard" && unseenClips > 0) clearUnseen()
  }, [tab, unseenClips, clearUnseen])

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
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-white grid place-items-center shadow-lg shadow-violet-600/25">
            <Zap className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <h2 className="font-black text-[16px]">ميزات الإنتاجية</h2>
            <div className="text-[10.5px] text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className={cn("inline-flex items-center gap-1", bridgeOnline ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                <span className={cn("w-1.5 h-1.5 rounded-full", bridgeOnline ? "bg-emerald-500 nexus-live" : "bg-red-500")} />
                جسر الإنتاجية {bridgeOnline ? "متصل" : "منقطع"}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="inline-flex items-center gap-1">
                <Wifi className="w-3 h-3" />
                {state.network}
              </span>
              {profile && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="font-semibold text-violet-600 dark:text-violet-400">الملف: {profile.name}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="rounded-full text-[10px] gap-1">
            الحافظة: {state.clipMode === "auto" ? "تلقائية" : "يدوية"}
          </Badge>
          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={() => void openQr()}>
            <QrCode className="w-3.5 h-3.5" /> هاتفك الحقيقي
          </Button>
        </div>
      </div>

      {/* اختبار النجاح */}
      <div className={cn("rounded-2xl border bg-card p-4", allDone && "border-emerald-500/60 bg-emerald-500/5")}>
        <div className="flex items-center gap-2 mb-2.5">
          {allDone ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Zap className="w-4 h-4 text-violet-500" />}
          <span className="text-[13px] font-bold">اختبار النجاح — انسخ من هاتفك، الصق على الكمبيوتر</span>
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
            مكتمل! نسخت من هاتفك والصقت بـ Ctrl+V — والمزامنة والتسليم وملفات الشبكات كلها تعمل.
          </p>
        )}
      </div>

      {/* شريط التبويبات */}
      <div className="flex gap-1.5 overflow-x-auto rounded-2xl border bg-card/80 backdrop-blur p-1.5" role="tablist" aria-label="ميزات الإنتاجية">
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
              {t.id === "clipboard" && unseenClips > 0 && (
                <span className="absolute -top-1 -end-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white grid place-items-center">
                  {unseenClips}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* المحتوى */}
      <div className="min-w-0 nexus-enter" key={tab}>
        {tab === "clipboard" && <ClipboardTab />}
        {tab === "folders" && <FoldersTab />}
        {tab === "photos" && <PhotosTab />}
        {tab === "handoff" && <HandoffTab />}
        {tab === "profiles" && <ProfilesTab />}
        {tab === "backup" && <BackupTab />}
      </div>

      {/* QR */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">افتح الإنتاجية على هاتفك</DialogTitle>
            <DialogDescription className="text-center">
              امسح الرمز — انسخ من هاتفك والصق على الكمبيوتر، وأرسل روابطك بضغطة
            </DialogDescription>
          </DialogHeader>
          {qrUrl && <img src={qrUrl} alt="رمز QR لصفحة الهاتف" className="rounded-2xl mx-auto" width={260} height={260} />}
          <p className="text-[10.5px] text-center text-muted-foreground dir-ltr font-mono">{typeof window !== "undefined" ? `${window.location.host}/phone` : ""}</p>
        </DialogContent>
      </Dialog>

      {/* احتفال الاكتمال */}
      <Dialog open={celebrated && allDone && !dismissed} onOpenChange={(o) => { if (!o) { setDismissed(true); setCelebrated(false) } }}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2 text-[16px]">
              <PartyPopper className="w-5 h-5 text-amber-500" /> اختبار النجاح مكتمل 7/7
            </DialogTitle>
            <DialogDescription className="text-center text-[12px] leading-relaxed">
              نسخت نصًا من هاتفك ولصقته بـ Ctrl+V مباشرة — مع مزامنة مجلدات وصور حقيقية
              وتسليم روابط وملفات تعريف شبكات ونسخ احتياطي شامل، كل ذلك محلياً عبر Nexus Protocol.
            </DialogDescription>
          </DialogHeader>
          <div className="text-5xl pb-2">📋⚡✨</div>
          <Button className="rounded-2xl" onClick={() => setCelebrated(false)}>رائع!</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
