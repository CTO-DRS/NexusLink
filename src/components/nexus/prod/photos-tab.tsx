"use client"
// مزامنة الصور التلقائية — صور جديدة على الهاتف تنسخ نفسها للكمبيوتر عند الاتصال
import { useState } from "react"
import { toast } from "sonner"
import {
  Images, Camera, RefreshCcw, FolderInput, Sparkles, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useProd } from "@/lib/prod-store"
import { photoNewRequest } from "@/lib/prod-socket"
import { fmtSize, fmtDate } from "@/lib/store"
import { cn } from "@/lib/utils"

export function PhotosTab() {
  const { state, setState, photos, setPhotos, profile, setCheck } = useProd()
  const [busy, setBusy] = useState(false)

  const profileBlocks = profile ? !profile.photoSync : false

  async function patch(d: Record<string, unknown>) {
    setState(d)
    await fetch("/api/prod/photos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    })
  }

  async function newPhoto() {
    setBusy(true)
    photoNewRequest()
    // توقع وصول المزامنة لتحديث المعرض
    setTimeout(async () => {
      const j = await fetch("/api/prod/photos").then((r) => r.json()).catch(() => null)
      if (j?.photos) {
        setPhotos(j.photos)
        if (j.photos.length > 0) setCheck("photo")
      }
      setBusy(false)
    }, 4500)
  }

  async function syncNow() {
    setBusy(true)
    const r = await fetch("/api/prod/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "tick" }),
    })
    const j = await r.json()
    if (j.ok && j.copied > 0) {
      toast.success(`نُسخت ${j.copied} صورة (${fmtSize(j.bytes)})`)
      setCheck("photo")
    } else if (j.paused) {
      toast.info(j.paused)
    } else {
      toast("لا صور جديدة على الهاتف")
    }
    const ph = await fetch("/api/prod/photos").then((r) => r.json()).catch(() => null)
    if (ph?.photos) setPhotos(ph.photos)
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      {/* التحكم */}
      <div className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-9 h-9 rounded-xl grid place-items-center", state.photoSync ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : "bg-muted text-muted-foreground")}>
            <Images className="w-4.5 h-4.5" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-bold">النسخ التلقائي للصور الجديدة عند الاتصال</div>
            <div className="text-[10.5px] text-muted-foreground flex items-center gap-1 flex-wrap">
              <FolderInput className="w-3 h-3" />
              كل صورة جديدة في كاميرا الهاتف تُنسخ إلى <span className="font-mono dir-ltr">{state.photoTarget}</span> على الكمبيوتر
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={() => void syncNow()} disabled={busy}>
            <RefreshCcw className={cn("w-3.5 h-3.5", busy && "animate-spin")} /> مزامنة الآن
          </Button>
          <Switch
            checked={state.photoSync}
            onCheckedChange={(v) => void patch({ photoSync: v })}
            aria-label="تفعيل مزامنة الصور"
          />
        </div>
      </div>

      {profileBlocks && state.photoSync && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11.5px] text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <Sparkles className="w-4 h-4 shrink-0" />
          الملف الشخصي «{profile?.name}» يوقف مزامنة الصور تلقائياً على هذه الشبكة — بدّل الشبكة من تبويب ملفات الشبكات.
        </div>
      )}

      {/* التقاط صورة جديدة على الهاتف */}
      <div className="rounded-2xl border border-dashed border-violet-500/40 bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11.5px] text-muted-foreground leading-relaxed max-w-md">
          حاكِ التقاط صورة على هاتفك: تُنشأ صورة JPEG حقيقية في <span className="font-mono dir-ltr">DCIM/Camera</span>
          ثم تُنسخ تلقائياً خلال ثوانٍ — أو التقط من هاتفك الفعلي عبر <span className="font-mono dir-ltr">/phone</span> وسيتتبعها المحرك نفسه.
        </div>
        <Button className="rounded-xl h-9 gap-1.5 text-[12px]" onClick={() => void newPhoto()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          صورة جديدة على الهاتف
        </Button>
      </div>

      {/* معرض المستلمة */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Images className="w-4 h-4 text-muted-foreground" />
            <span className="text-[13px] font-bold">الصور المستلمة على الكمبيوتر</span>
            <Badge variant="secondary" className="rounded-full text-[9.5px]">{photos.length}</Badge>
          </div>
          <span className="text-[10px] font-mono dir-ltr text-muted-foreground">pc-office:{state.photoTarget}</span>
        </div>

        {photos.length === 0 ? (
          <p className="text-[12px] text-muted-foreground text-center py-8">
            لا صور مستلمة بعد — التقط صورة على الهاتف وستظهر هنا تلقائياً
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {photos.map((p) => (
                <figure key={p.path} className="group relative rounded-xl overflow-hidden border bg-muted">
                  <img
                    src={`/api/thumb?device=pc-office&path=${encodeURIComponent(p.path)}`}
                    alt={`صورة ${p.name}`}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-black/55 backdrop-blur-sm text-white text-[8.5px] px-1.5 py-1 truncate dir-ltr text-start">
                    {p.name}
                  </figcaption>
                  <span className="absolute top-1 start-1 rounded-full bg-emerald-500 text-white text-[8px] px-1.5 py-0.5 font-bold">
                    متزامنة
                  </span>
                </figure>
              ))}
            </div>
          </ScrollArea>
        )}
        {photos[0] && (
          <p className="text-[10px] text-muted-foreground mt-2">
            آخر صورة وصلت: {photos[0].name} ({fmtSize(photos[0].size)}) — {fmtDate(photos[0].mtime)}
          </p>
        )}
      </div>
    </div>
  )
}
