"use client"

// FA-files (عقد §14) — تصفح تخزين الهاتف الحقيقي وبث الفيديو إلى مشغل الكمبيوتر
// ============================================================
// · التصفية من خدمة وسائط الهاتف مباشرة (LAN): GET /list?token=&dir=
// · التشغيل: تنزيل تقدمي مؤقت في الطبقة الأصلية (Rust) ثم فتح بالمشغل الافتراضي
//   عند العتبة (2MB أو 1.5ث) — بدون تنزيل كامل قبل المشاهدة.
import { useCallback, useEffect, useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Smartphone, Film, Play, Loader2, FolderOpen, ChevronLeft, WifiOff } from "lucide-react"
import { toast } from "sonner"
import { fmtSize } from "@/lib/store"
import { fetchAgentMedia, streamPhoneVideo, type AgentMedia } from "@/lib/desktop-files"

interface PhoneEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  mtime?: number
  video: boolean
}

const ROOTS = [
  { path: "/storage/emulated/0/Movies", label: "الأفلام" },
  { path: "/storage/emulated/0/DCIM/Camera", label: "الكاميرا" },
  { path: "/storage/emulated/0/Download", label: "التنزيلات" },
  { path: "/storage/emulated/0/WhatsApp/Media/WhatsApp Video", label: "فيديو واتساب" },
]

export function PhoneStorageModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [media, setMedia] = useState<AgentMedia | null>(null)
  const [state, setState] = useState<"loading" | "offline" | "ready">("loading")
  const [dir, setDir] = useState(ROOTS[0].path)
  const [entries, setEntries] = useState<PhoneEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState<string | null>(null)

  // نقطة الوسائط من الحالة الموحدة (جاهزية الخدمة على الهاتف)
  useEffect(() => {
    if (!open) return
    setState("loading")
    void fetchAgentMedia().then((m) => {
      if (m) {
        setMedia(m)
        setState("ready")
      } else {
        setState("offline")
      }
    })
  }, [open])

  const load = useCallback(async () => {
    if (!media) return
    setBusy(true)
    try {
      const url = `http://${media.lanIp}:${media.port}/list?token=${encodeURIComponent(media.token)}&dir=${encodeURIComponent(dir)}`
      const r = await fetch(url)
      const j = (await r.json()) as { ok?: boolean; entries?: PhoneEntry[] }
      setEntries(j.entries ?? [])
    } catch {
      setEntries([])
      toast.error("تعذر الوصول لخدمة وسائط الهاتف على الشبكة")
    } finally {
      setBusy(false)
    }
  }, [media, dir])

  useEffect(() => {
    if (open && state === "ready") void load()
  }, [open, state, load])

  const play = async (e: PhoneEntry) => {
    if (!media) return
    setStreaming(e.path)
    const err = await streamPhoneVideo(media, e.path, e.name, e.size)
    setStreaming(null)
    if (err) toast.error(err)
    else toast.success(`يبدأ البث: ${e.name}`, { description: "يُفتح في المشغل الافتراضي بعد تجهيز أول 2MB" })
  }

  const crumbs = dir.split("/").filter(Boolean)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" /> تخزين الهاتف الحقيقي
          </DialogTitle>
          <DialogDescription>
            تصفح فيديوهات الهاتف وبثّها مباشرة إلى مشغل الكمبيوتر الافتراضي — بدون تنزيل كامل
          </DialogDescription>
        </DialogHeader>

        {state === "loading" && (
          <div className="py-14 text-center text-muted-foreground">
            <Loader2 className="w-7 h-7 animate-spin mx-auto mb-2 text-primary" />
            جارٍ البحث عن خدمة وسائط الهاتف…
          </div>
        )}

        {state === "offline" && (
          <div className="py-14 text-center text-muted-foreground">
            <WifiOff className="w-10 h-10 mx-auto mb-2 opacity-40" />
            خدمة الوسائط على الهاتف غير متاحة الآن
            <div className="text-xs mt-2 opacity-70">
              افتح تطبيق NexusLink على الهاتف وتأكد من اتصال نفس الشبكة، ثم أعد المحاولة
            </div>
          </div>
        )}

        {state === "ready" && media && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {media.lanIp}:{media.port}
              </Badge>
              {ROOTS.map((r) => (
                <button
                  key={r.path}
                  onClick={() => setDir(r.path)}
                  className={`rounded-full px-3 py-1.5 text-xs border transition-colors ${
                    dir === r.path ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
              <button onClick={() => setDir(ROOTS[0].path)} className="hover:text-foreground">الجذر</button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronLeft className="w-3 h-3" />
                  {c}
                </span>
              ))}
            </div>

            <div className="rounded-2xl border bg-card p-2 min-h-[260px] relative">
              {busy && (
                <div className="absolute inset-0 z-10 grid place-items-center bg-card/70 rounded-2xl">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              )}
              {entries.length === 0 && !busy && (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  <Film className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  لا فيديوهات هنا — جرّب موقعًا آخر
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-2">
                {entries.map((e) =>
                  e.isDir ? (
                    <button
                      key={e.path}
                      onClick={() => setDir(e.path)}
                      className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-accent text-start"
                    >
                      <FolderOpen className="w-4 h-4 opacity-70 shrink-0" />
                      <span className="truncate flex-1">{e.name}</span>
                    </button>
                  ) : (
                    <div
                      key={e.path}
                      className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-accent"
                    >
                      <Film className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate flex-1" title={e.name}>{e.name}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {fmtSize(e.size)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 shrink-0"
                        disabled={streaming === e.path}
                        onClick={() => void play(e)}
                      >
                        {streaming === e.path ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        بث
                      </Button>
                    </div>
                  )
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              البث تقدّمي: يُفتح المشغل الافتراضي بعد تجهيز أول 2MB (أو 1.5ث)، ويستكمل التنزيل
              إلى ملف مؤقت يُحذف عند الخروج. التقديم السريع للنهايات البعيدة يتوفر بعد وصول التنزيل إليها.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
