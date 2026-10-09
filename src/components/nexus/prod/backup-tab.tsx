"use client"
// النسخ الاحتياطي والاستعادة الشاملة — الإعدادات والأجهزة الموثوقة والملفات والأزواج
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  DatabaseBackup, Download, Upload, ShieldCheck, Save, RotateCcw,
  FileJson, Smartphone, Network, FolderSync, Settings2, Loader2, Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useProd } from "@/lib/prod-store"
import { fmtSize, fmtDate } from "@/lib/store"
import { cn } from "@/lib/utils"

interface RestorePreview {
  devices: number
  profiles: number
  pairs: number
  settings: { clipMode?: string; photoSync?: boolean; network?: string }
}

export function BackupTab() {
  const { snapshots, setSnapshots, setCheck } = useProd()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ data: Record<string, unknown>; info: RestorePreview } | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const j = await fetch("/api/prod/backup").then((r) => r.json()).catch(() => null)
    if (j?.snapshots) setSnapshots(j.snapshots)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function snapshot() {
    setBusy(true)
    const r = await fetch("/api/prod/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "snapshot" }),
    })
    const j = await r.json()
    setBusy(false)
    if (j.ok) {
      await refresh()
      toast.success("أُنشئت نقطة استعادة داخلية")
    } else toast.error("فشل الإنشاء")
  }

  function download() {
    window.open("/api/prod/backup?download=1", "_blank")
    toast("جارٍ تنزيل النسخة الاحتياطية", { description: "ملف JSON شامل — احفظه في مكان آمن" })
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (data.type !== "nexuslink-backup") throw new Error("bad type")
        const info: RestorePreview = {
          devices: Array.isArray(data.devices) ? data.devices.length : 0,
          profiles: Array.isArray(data.profiles) ? data.profiles.length : 0,
          pairs: Array.isArray(data.pairs) ? data.pairs.length : 0,
          settings: data.settings ?? {},
        }
        setPreview({ data, info })
      } catch {
        toast.error("ملف غير صالح", { description: "توقعت نسخة NexusLink Backup بصيغة JSON" })
      }
    }
    reader.readAsText(f)
    e.target.value = ""
  }

  async function restore(mode: "merge" | "replace", data?: Record<string, unknown>, snapshotId?: string) {
    setBusy(true)
    const r = await fetch("/api/prod/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", mode, data, snapshotId }),
    })
    const j = await r.json()
    setBusy(false)
    if (j.ok) {
      setPreview(null)
      setCheck("backup")
      toast.success(`اكتملت الاستعادة (${mode === "replace" ? "استبدال" : "دمج"})`, {
        description: `${j.devices} جهاز موثوق · ${j.profiles} ملف تعريف · ${j.pairs} زوج مزامنة`,
      })
      await refresh()
    } else {
      toast.error(j.error || "فشلت الاستعادة")
    }
  }

  async function deleteSnapshot(id: string) {
    await fetch("/api/prod/backup", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    await refresh()
  }

  return (
    <div className="space-y-4">
      {/* ماذا يشمل */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span className="text-[13px] font-bold">ماذا تشمل النسخة الاحتياطية الشاملة؟</span>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2 text-[11.5px]">
          {[
            { icon: Settings2, t: "الإعدادات: وضع الحافظة، مزامنة الصور، مجلد الوجهة، الشبكة الحالية" },
            { icon: Smartphone, t: "الأجهزة الموثوقة: كل الأجهزة المقترنة وحالة الثقة وتاريخ الاقتران" },
            { icon: Network, t: "ملفات تعريف الشبكات: الأسماء والشبكات المرتبطة والميزات المفعّلة" },
            { icon: FolderSync, t: "أزواج مزامنة المجلدات: الأطراف والمجلدات وحالة التفعيل" },
          ].map((x) => (
            <div key={x.t} className="flex items-center gap-2 text-muted-foreground">
              <x.icon className="w-3.5 h-3.5 text-violet-500 shrink-0" /> {x.t}
            </div>
          ))}
        </div>
      </div>

      {/* أدوات النسخ */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-violet-500" />
            <span className="text-[13px] font-bold">تصدير إلى ملف</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            ملف JSON كامل تحفظه خارجياً — استعيده على أي جهاز NexusLink آخر أو بعد تثبيت نظيف.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1 rounded-xl h-9 gap-1.5 text-[12px]" onClick={download}>
              <FileJson className="w-4 h-4" /> تنزيل النسخة
            </Button>
            <Button variant="outline" className="rounded-xl h-9 gap-1.5 text-[12px]" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" /> استيراد
            </Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} aria-label="استيراد ملف نسخة احتياطية" />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <Save className="w-4 h-4 text-emerald-500" />
            <span className="text-[13px] font-bold">نقاط الاستعادة الداخلية</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            لقطات سريعة محفوظة داخل التطبيق — ارجع لأي لحظة بضغطة واحدة.
          </p>
          <Button variant="outline" className="w-full rounded-xl h-9 gap-1.5 text-[12px] border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10" onClick={() => void snapshot()} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <DatabaseBackup className="w-4 h-4" />} إنشاء نقطة استعادة الآن
          </Button>
        </div>
      </div>

      {/* قائمة النقاط */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <RotateCcw className="w-4 h-4 text-muted-foreground" />
          <span className="text-[13px] font-bold">النقاط المحفوظة</span>
          <Badge variant="secondary" className="rounded-full text-[9.5px]">{snapshots.length}</Badge>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-[12px] text-muted-foreground text-center py-6">لا نقاط بعد — أنشئ أول نقطة استعادة</p>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="space-y-2 pe-2">
              {snapshots.map((s) => (
                <div key={s.id} className="rounded-xl border bg-background/50 p-2.5 flex items-center gap-2.5 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold truncate">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.devicesCount} جهاز · {s.profilesCount} ملف تعريف · {s.pairsCount} زوج · {fmtSize(s.sizeBytes)} · {fmtDate(s.createdAt)}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="rounded-lg h-7 gap-1 text-[10.5px]" onClick={() => void restore("merge", undefined, s.id)} disabled={busy}>
                    <RotateCcw className="w-3 h-3" /> استعادة
                  </Button>
                  <Button size="sm" variant="ghost" className="w-7 h-7 rounded-lg text-red-500 p-0" aria-label="حذف النقطة" onClick={() => void deleteSnapshot(s.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* حوار معاينة الاستعادة من ملف */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>معاينة الاستعادة</DialogTitle>
            <DialogDescription>
              يحتوي الملف: {preview?.info.devices} جهاز موثوق · {preview?.info.profiles} ملف تعريف · {preview?.info.pairs} زوج مزامنة
              {preview?.info.settings.network && <> · الشبكة: {preview.info.settings.network}</>}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button className="flex-1 rounded-xl" disabled={busy} onClick={() => void restore("merge", preview?.data)}>
              دمج مع الحالي
            </Button>
            <Button
              variant="destructive"
              className="flex-1 rounded-xl"
              disabled={busy}
              onClick={() => void restore("replace", preview?.data)}
            >
              استبدال كامل
            </Button>
          </div>
          <p className={cn("text-[10.5px] text-muted-foreground", "leading-relaxed")}>
            الدمج يضيف ما هو مفقود ويحدّث الموجود دون حذف. الاستبدال يمسح ملفات التعريف والأزواج الحالية ويطبق الملف المستورد.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
