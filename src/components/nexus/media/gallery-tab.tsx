"use client"
// المعرض — تصفح صور أي جهاز على الشبكة + إطلاق عرض شرائح على الشاشة الكبيرة
import { useEffect, useMemo } from "react"
import {
  Images, Tv, Monitor, Play, Image as ImageIcon, Smartphone, RefreshCcw, Loader2, Shuffle, Timer,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useMedia } from "@/lib/media-store"
import { useNexus, fmtSize } from "@/lib/store"
import { TvFrame, PcWindow } from "./media-bits"
import { cn } from "@/lib/utils"
import type { FsEntry } from "@/lib/nexus/types"

const DEVICES = [
  { id: "all", label: "كل الأجهزة" },
  { id: "galaxy-s24", label: "Galaxy-S24" },
  { id: "pc-office", label: "PC-OFFICE" },
  { id: "ipad-pro", label: "iPad-Pro" },
] as const

const DEVICE_NAMES: Record<string, string> = {
  "galaxy-s24": "Galaxy-S24",
  "pc-office": "PC-OFFICE",
  "ipad-pro": "iPad-Pro",
}

export function GalleryTab() {
  const gallery = useMedia((s) => s.gallery)
  const loadGallery = useMedia((s) => s.loadGallery)
  const setGalleryDevice = useMedia((s) => s.setGalleryDevice)
  const startSlideshow = useMedia((s) => s.startSlideshow)
  const setPreviewEntry = useNexus((s) => s.setPreviewEntry)

  useEffect(() => {
    if (!gallery.loadedOnce) void loadGallery()
  }, [gallery.loadedOnce, loadGallery])

  const photos = gallery.photos
  const current = useMemo(() => {
    const ss = gallery.slideshow
    if (!ss) return null
    return photos[ss.index] ?? null
  }, [gallery.slideshow, photos])

  function openPreview(device: string, path: string, name: string, size: number, mtime: number) {
    const entry: FsEntry = {
      name, path, type: "file", size, mtime,
      category: "image", mime: "image/jpeg", ext: name.split('.').pop() || 'jpg',
    }
    setPreviewEntry(entry)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="me-auto">
          <h3 className="text-[15px] font-bold flex items-center gap-2">
            <Images className="w-4.5 h-4.5 text-primary" /> معرض الصور المشترك
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            تصفح صور أي جهاز من هنا — وأطلق عرض شرائح على الشاشة الكبيرة
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => void loadGallery()} disabled={gallery.loading}>
          {gallery.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} تحديث
        </Button>
      </div>

      {/* اختيار الجهاز + بدء العرض */}
      <div className="flex flex-wrap items-center gap-2">
        {DEVICES.map((d) => (
          <Button
            key={d.id}
            variant={gallery.device === d.id ? "default" : "outline"}
            size="sm"
            className="h-7 rounded-lg text-[11px]"
            onClick={() => setGalleryDevice(d.id as any)}
          >
            {d.id === "all" ? <Images className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />} {d.label}
          </Button>
        ))}
        <span className="text-[11px] text-muted-foreground ms-auto">{photos.length} صورة</span>
        <Badge variant="outline" className="rounded-full text-[10px] gap-1">
          <Timer className="w-3 h-3" /> {gallery.slideshow?.interval ?? 5}ث/صورة
        </Badge>
        <Button size="sm" className="h-8 rounded-lg text-[11px] bg-teal-600 hover:bg-teal-700" disabled={!photos.length} onClick={() => startSlideshow("tv")}>
          <Tv className="w-3.5 h-3.5" /> عرض على Nexus-TV
        </Button>
        <Button size="sm" variant="outline" className="h-8 rounded-lg text-[11px]" disabled={!photos.length} onClick={() => startSlideshow("pc")}>
          <Monitor className="w-3.5 h-3.5" /> على شاشة الكمبيوتر
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* شبكة الصور */}
        <div className="rounded-xl border bg-card p-3">
          {gallery.loading ? (
            <div className="grid place-items-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-[11px] text-muted-foreground mt-2">يقرأ صور الأجهزة من الشبكة…</p>
            </div>
          ) : photos.length === 0 ? (
            <div className="grid place-items-center py-16 text-muted-foreground">
              <ImageIcon className="w-8 h-8 opacity-50 mb-2" />
              <p className="text-[11px]">لا صور لهذا الجهاز</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2 max-h-[520px] overflow-y-auto pe-1">
              {photos.map((p, i) => {
                const inShow = gallery.slideshow?.index === i
                return (
                  <button
                    key={p.id}
                    onClick={() => openPreview(p.device, p.path, p.name, p.size, p.mtime)}
                    className={cn(
                      "group relative aspect-square rounded-lg overflow-hidden border-2 bg-zinc-900 transition-all",
                      inShow ? "border-primary" : "border-transparent hover:border-primary/40"
                    )}
                    title={`${p.name} — ${DEVICE_NAMES[p.device] ?? p.device}`}
                  >
                    { }
                    <img
                      src={`/api/thumb?device=${p.device}&path=${encodeURIComponent(p.path)}`}
                      alt={p.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    {inShow && (
                      <span className="absolute top-1 end-1 rounded-full bg-primary px-1.5 py-0.5 text-[8px] font-bold text-white">
                        معروضة
                      </span>
                    )}
                    <span className="absolute bottom-0 inset-x-0 bg-black/55 px-1.5 py-0.5 text-[8px] text-white truncate text-start opacity-0 group-hover:opacity-100 transition-opacity">
                      {p.name} · {fmtSize(p.size)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* شاشة العرض الحالية */}
        <div className="space-y-3">
          {gallery.slideshow?.target === "tv" ? (
            <TvFrame>
              <div className="relative w-full h-full bg-zinc-950">
                {current ? (
                  <>
                    { }
                    <img src={`/api/preview?device=${current.device}&path=${encodeURIComponent(current.path)}`} alt={current.name} className="h-full w-full object-contain nexus-kenburns" />
                    <span className="absolute bottom-2 start-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">
                      عرض شرائح · {current.name}
                    </span>
                  </>
                ) : (
                  <div className="grid place-items-center h-full text-zinc-600 text-[11px]">لا صورة</div>
                )}
              </div>
            </TvFrame>
          ) : gallery.slideshow?.target === "pc" ? (
            <PcWindow title="عرض الشرائح — شاشة الكمبيوتر">
              <div className="relative aspect-video bg-zinc-950">
                {current ? (
                  <>
                    { }
                    <img src={`/api/preview?device=${current.device}&path=${encodeURIComponent(current.path)}`} alt={current.name} className="h-full w-full object-contain nexus-kenburns" />
                    <span className="absolute bottom-2 start-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">
                      {(gallery.slideshow?.index ?? 0) + 1} / {photos.length} · {current.name}
                    </span>
                  </>
                ) : (
                  <div className="grid place-items-center h-full text-zinc-600 text-[11px]">لا صورة</div>
                )}
              </div>
            </PcWindow>
          ) : (
            <div className="rounded-xl border-2 border-dashed bg-card/50 p-8 text-center">
              <Play className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-[12px] font-semibold">لا عرض جارٍ</p>
              <p className="text-[10.5px] text-muted-foreground mt-1 leading-relaxed">
                اختر «عرض على Nexus-TV» أو «على شاشة الكمبيوتر» لبدء عرض شرائح كامل الشاشة
                مع تحكم كامل وتبديل تلقائي وخلط
              </p>
              {gallery.slideshow?.shuffle && (
                <Badge variant="outline" className="rounded-full text-[10px] gap-1 mt-3"><Shuffle className="w-3 h-3" /> خلط مفعل</Badge>
              )}
            </div>
          )}

          {/* أوامر سريعة للعرض الجاري */}
          {gallery.slideshow && (
            <div className="rounded-xl border bg-card p-3 flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-primary text-[10px] gap-1">
                <Play className="w-3 h-3" /> عرض جارٍ على {gallery.slideshow.target === "tv" ? "Nexus-TV" : "الكمبيوتر"}
              </Badge>
              <span className="text-[10px] text-muted-foreground tabular-nums ms-auto">
                {(gallery.slideshow.index ?? 0) + 1} / {photos.length}
              </span>
              <Button variant="outline" size="sm" className="h-7 rounded-lg text-[10px]" onClick={() => useMedia.getState().toggleSlideshowShuffle()}>
                <Shuffle className="w-3 h-3" /> {gallery.slideshow.shuffle ? "بدون خلط" : "خلط"}
              </Button>
              {[3, 5, 10].map((sec) => (
                <Button
                  key={sec}
                  variant={gallery.slideshow?.interval === sec ? "default" : "outline"}
                  size="sm"
                  className="h-7 rounded-lg text-[10px]"
                  onClick={() => useMedia.getState().setSlideshowInterval(sec)}
                >
                  {sec}ث
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
