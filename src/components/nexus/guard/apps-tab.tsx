"use client"
// NexusLink — إدارة التطبيقات: تثبيت · حذف · فتح · نسخ احتياطي APK (ملف حقيقي)
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  PackageOpen, Search, Upload, FolderDown, Trash2, Play, Loader2,
  ShieldCheck, CheckCircle2, Smartphone,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useGuard, type AppEntry } from "@/lib/guard-store"
import { cmdApp } from "@/lib/guard-socket"
import { GuardCard } from "./guard-bits"
import { fmtDate } from "@/lib/store"
import { cn } from "@/lib/utils"

type SortBy = "name" | "size" | "date"

export function AppsTab() {
  const { apps, backup, install, startBackup, tickBackup, finishBackup, cancelBackup, startInstall, tickInstall, finishInstall, uninstallApp } = useGuard()
  const [query, setQuery] = useState("")
  const [sortBy, setSortBy] = useState<SortBy>("size")
  const [confirmPkg, setConfirmPkg] = useState<AppEntry | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const shown = apps
    .filter((a) => !query || a.name.includes(query) || a.pkg.toLowerCase().includes(query.toLowerCase()))
    .slice()
    .sort((a, b) =>
      sortBy === "name" ? a.name.localeCompare(b.name, "ar")
      : sortBy === "size" ? b.sizeMB - a.sizeMB
      : b.installedAt - a.installedAt
    )
  const totalMB = apps.reduce((acc, a) => acc + a.sizeMB, 0)

  // ==== تقدم النسخ الاحتياطي (محرك محلي + ملف حقيقي في النهاية) ====
  useEffect(() => {
    if (!backup) return
    const iv = setInterval(() => useGuard.getState().tickBackup(), 260)
    return () => clearInterval(iv)
  }, [backup])

  useEffect(() => {
    if (!backup || backup.progress < 100) return
    cancelBackup()
    const app = useGuard.getState().apps.find((a) => a.pkg === backup.pkg)
    if (!app) return
    toast.message(`جارٍ حفظ APK «${app.name}» على الكمبيوتر…`, { id: `bk-${app.pkg}` })
    void (async () => {
      try {
        const r = await fetch("/api/guard/backup-apk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pkg: app.pkg, app: app.name, version: app.version, sizeMB: app.sizeMB }),
        })
        const j = await r.json()
        if (j.ok) {
          finishBackup(j.fileName, j.path, j.bytes)
          cmdApp("open", app.pkg, app.name)
          toast.success(`حُفظت النسخة الاحتياطية: ${j.fileName} (${(j.bytes / 1024).toFixed(0)}KB)`, {
            description: "في مجلد Downloads/Backups بجهاز الكمبيوتر — تجدها في متصفح الملفات",
          })
        } else {
          toast.error(j.error ?? "فشل إنشاء النسخة الاحتياطية")
        }
      } catch {
        toast.error("فشل الاتصال بخادم النسخ الاحتياطي")
      }
    })()
  }, [backup, cancelBackup, finishBackup])

  // ==== تقدم التثبيت ====
  useEffect(() => {
    if (!install) return
    const iv = setInterval(() => useGuard.getState().tickInstall(), 300)
    return () => clearInterval(iv)
  }, [install])

  useEffect(() => {
    if (!install || install.progress < 100) return
    finishInstall()
    toast.success(`تم تثبيت «${install.name}» على الهاتف`)
  }, [install, finishInstall])

  // ==== تثبيت من ملف حقيقي ====
  const installFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith(".apk")) {
      toast.error("الملف يجب أن يكون بحزمة .apk")
      return
    }
    const name = f.name.replace(/\.apk$/i, "").replace(/[._-]+/g, " ").trim() || "تطبيق جديد"
    const sizeMB = Math.max(1, Math.round(f.size / (1024 * 1024) * 10) / 10)
    setInstallOpen(false)
    startInstall(name, sizeMB)
    cmdApp("install", name, name)
  }

  const demoInstalls: { name: string; sizeMB: number }[] = [
    { name: "دواء تذكير Pro", sizeMB: 18 },
    { name: "مصحف إلكتروني", sizeMB: 42 },
    { name: "عداء الصحة", sizeMB: 27 },
  ]

  return (
    <div className="space-y-4">
      <GuardCard
        title={`تطبيقات الهاتف (${apps.length})`}
        icon={PackageOpen}
        extra={
          <Button size="sm" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={() => setInstallOpen(true)}>
            <Upload className="w-3.5 h-3.5" /> تثبيت APK
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-44">
            <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الحزمة…" className="h-9 rounded-xl ps-8 text-[12px]" />
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-9 rounded-xl text-[11.5px] w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="size">الأكبر حجماً</SelectItem>
              <SelectItem value="name">الاسم</SelectItem>
              <SelectItem value="date">الأحدث تثبيتاً</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="rounded-full text-[10px] gap-1">
            <Smartphone className="w-3 h-3" /> {(totalMB / 1024).toFixed(1)} GB
          </Badge>
        </div>

        <div className="divide-y divide-border/50 -mx-1">
          {shown.map((a) => (
            <AppRow
              key={a.pkg}
              app={a}
              backingUp={backup?.pkg === a.pkg}
              backupProgress={backup?.pkg === a.pkg ? backup.progress : 0}
              onBackup={() => { startBackup(a); toast.message(`بدأ نسخ ${a.name} احتياطياً…`, { id: `bk-${a.pkg}` }) }}
              onOpen={() => { cmdApp("open", a.pkg, a.name); toast.success(`فُتح «${a.name}» على الهاتف`) }}
              onAskDelete={() => setConfirmPkg(a)}
            />
          ))}
          {shown.length === 0 && <p className="text-center text-[11.5px] text-muted-foreground py-8">لا نتائج للبحث</p>}
        </div>
      </GuardCard>

      {/* نافذة التثبيت */}
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> تثبيت تطبيق APK على الهاتف</DialogTitle>
            <DialogDescription>اسحب ملف APK أو اختره من الكمبيوتر — أو جرّب نموذجاً جاهزاً</DialogDescription>
          </DialogHeader>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) installFile(f)
            }}
            className={cn(
              "rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            )}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="اختر ملف APK"
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-[12px] font-semibold">اسحب ملف .apk هنا أو اضغط للاختيار</p>
            <p className="text-[10px] text-muted-foreground mt-1">سيُثبَّت على Galaxy-S24 عبر Nexus Protocol</p>
            <input
              ref={fileRef}
              type="file"
              accept=".apk"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) installFile(f) }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {demoInstalls.map((d) => (
              <Button key={d.name} variant="secondary" className="h-14 rounded-2xl flex-col gap-0.5 text-[10px]" onClick={() => { setInstallOpen(false); startInstall(d.name, d.sizeMB); cmdApp("install", d.name, d.name) }}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                {d.name}
                <span className="text-[8.5px] text-muted-foreground">{d.sizeMB}MB</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={!!confirmPkg} onOpenChange={(o) => !o && setConfirmPkg(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إزالة «{confirmPkg?.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف التطبيق وبياناته ({confirmPkg?.sizeMB}MB) من الهاتف نهائياً عبر Nexus Protocol. يمكنك استعادة النسخة لاحقاً من متجر Play.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                if (!confirmPkg) return
                uninstallApp(confirmPkg.pkg)
                cmdApp("uninstall", confirmPkg.pkg, confirmPkg.name)
                toast.success(`أُزيل «${confirmPkg.name}» من الهاتف`)
                setConfirmPkg(null)
              }}
            >
              إزالة نهائية
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function AppRow({ app, backingUp, backupProgress, onBackup, onOpen, onAskDelete }: {
  app: AppEntry
  backingUp: boolean
  backupProgress: number
  onBackup: () => void
  onOpen: () => void
  onAskDelete: () => void
}) {
  const done = backingUp && backupProgress >= 100
  return (
    <div className="flex items-center gap-3 py-2.5 px-1">
      <div
        className="w-10 h-10 rounded-2xl grid place-items-center text-white font-black text-[15px] shrink-0 shadow-sm"
        style={{ background: `hsl(${app.hue} 55% 42%)` }}
      >
        {app.name.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-bold truncate">{app.name}</span>
          {app.system && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[8px] rounded-full px-1.5 py-0 gap-0.5 shrink-0">
                  <ShieldCheck className="w-2.5 h-2.5" /> نظام
                </Badge>
              </TooltipTrigger>
              <TooltipContent>تطبيق نظام — لا يمكن إزالته</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="text-[9.5px] text-muted-foreground truncate dir-ltr text-start">{app.pkg} · v{app.version} · {app.sizeMB}MB</div>
        {backingUp && (
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={backupProgress} className="h-1.5 flex-1" />
            <span className={cn("text-[9px] font-bold w-9", done ? "text-emerald-500" : "text-primary")} dir="ltr">
              {done ? "حُفظ" : `${Math.round(backupProgress)}%`}
            </span>
          </div>
        )}
        {!backingUp && <div className="text-[9px] text-muted-foreground/70">ثُبّت {fmtDate(app.installedAt)}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={onOpen} aria-label={`فتح ${app.name}`}>
              <Play className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>فتح على الهاتف</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-teal-600 dark:text-teal-400" onClick={onBackup} disabled={backingUp} aria-label={`نسخ احتياطي ${app.name}`}>
              {backingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderDown className="w-3.5 h-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>نسخ احتياطي APK → الكمبيوتر</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-red-500"
              onClick={onAskDelete} disabled={app.system}
              aria-label={`إزالة ${app.name}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{app.system ? "غير قابل للإزالة" : "إزالة من الهاتف"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
