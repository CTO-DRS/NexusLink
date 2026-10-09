"use client"
// عرض الشرائح بملء الشاشة — على «الشاشة الكبيرة» (TV أو الكمبيوتر)
// انتقال Ken Burns + تحكم كامل + شريط صور مصغر + اختصارات لوحة المفاتيح
import { useEffect, useCallback } from "react"
import {
  X, Play, Pause, SkipForward, SkipBack, Shuffle, Tv, Monitor, Timer, Images,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useMedia } from "@/lib/media-store"
import { slideshowCmd } from "@/lib/media-socket"
import { cn } from "@/lib/utils"

export function SlideshowOverlay() {
  const ss = useMedia((s) => s.gallery.slideshow)
  const photos = useMedia((s) => s.gallery.photos)
  const stop = useMedia((s) => s.stopSlideshow)

  // التنقل التلقائي
  useEffect(() => {
    if (!ss?.playing) return
    const iv = window.setInterval(() => {
      useMedia.getState().slideshowNext(1)
    }, ss.interval * 1000)
    return () => window.clearInterval(iv)
  }, [ss?.playing, ss?.interval, ss?.index])

  // اختصارات لوحة المفاتيح
  const onKey = useCallback((e: KeyboardEvent) => {
    const s = useMedia.getState().gallery.slideshow
    if (!s) return
    if (e.key === "Escape") stop()
    else if (e.key === "ArrowLeft") { useMedia.getState().slideshowNext(1); slideshowCmd({ action: "next" }) }
    else if (e.key === "ArrowRight") { useMedia.getState().slideshowNext(-1); slideshowCmd({ action: "prev" }) }
    else if (e.key === " ") { e.preventDefault(); useMedia.getState().slideshowToggle() }
  }, [stop])
  useEffect(() => {
    if (!ss) return
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [ss, onKey])

  if (!ss) return null
  const photo = photos[ss.index] ?? photos[0]
  if (!photo) return null

  const total = ss.order.length
  const pos = ss.order.indexOf(ss.index) + 1

  return (
    <div className="fixed inset-0 z-[70] bg-black/98 backdrop-blur-sm flex flex-col" role="dialog" aria-label="عرض الشرائح">
      {/* الشريط العلوي */}
      <div className="flex items-center gap-2 px-4 py-3 text-white/90">
        <Badge className="rounded-full gap-1.5 bg-teal-600 hover:bg-teal-600 text-white text-[10px]">
          {ss.target === "tv" ? <Tv className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
          {ss.target === "tv" ? "Nexus-TV" : "شاشة الكمبيوتر"}
        </Badge>
        <span className="text-[11px] flex items-center gap-1"><Images className="w-3.5 h-3.5" /> {photo.name}</span>
        <span className="text-[11px] tabular-nums text-white/60 ms-auto">{pos} / {total}</span>
        {ss.shuffle && <Shuffle className="w-3.5 h-3.5 text-white/60" />}
        <span className="text-[11px] flex items-center gap-1 text-white/60"><Timer className="w-3.5 h-3.5" /> {ss.interval}ث</span>
        <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full" onClick={stop} aria-label="إغلاق العرض">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* الصورة */}
      <div className="flex-1 relative overflow-hidden">
        { }
        <img
          key={photo.id}
          src={`/api/preview?device=${photo.device}&path=${encodeURIComponent(photo.path)}`}
          alt={photo.name}
          className="absolute inset-0 h-full w-full object-contain nexus-kenburns"
        />
      </div>

      {/* أزرار التحكم */}
      <div className="flex items-center justify-center gap-3 py-4">
        <Button variant="secondary" size="icon" className="h-10 w-10 rounded-full" onClick={() => { useMedia.getState().slideshowNext(-1); slideshowCmd({ action: "prev" }) }} aria-label="السابقة">
          <SkipBack className="w-4 h-4" />
        </Button>
        <Button size="icon" className="h-12 w-12 rounded-full bg-teal-600 hover:bg-teal-700" onClick={() => { useMedia.getState().slideshowToggle(); slideshowCmd({ action: "toggle" }) }} aria-label={ss.playing ? "إيقاف مؤقت" : "تشغيل"}>
          {ss.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </Button>
        <Button variant="secondary" size="icon" className="h-10 w-10 rounded-full" onClick={() => { useMedia.getState().slideshowNext(1); slideshowCmd({ action: "next" }) }} aria-label="التالية">
          <SkipForward className="w-4 h-4" />
        </Button>
        <Button
          variant={ss.shuffle ? "default" : "secondary"}
          size="sm"
          className={cn("h-10 rounded-full px-3 text-[11px]", ss.shuffle && "bg-teal-600 hover:bg-teal-700")}
          onClick={() => useMedia.getState().toggleSlideshowShuffle()}
        >
          <Shuffle className="w-4 h-4" /> خلط
        </Button>
        {[3, 5, 10].map((sec) => (
          <Button
            key={sec}
            variant={ss.interval === sec ? "default" : "secondary"}
            size="sm"
            className={cn("h-10 rounded-full px-3 text-[11px]", ss.interval === sec && "bg-teal-600 hover:bg-teal-700")}
            onClick={() => { useMedia.getState().setSlideshowInterval(sec); slideshowCmd({ action: "interval", value: sec }) }}
          >
            {sec}ث
          </Button>
        ))}
      </div>

      {/* شريط مصغر */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-4" dir="ltr">
        {photos.map((p, i) => (
          <button
            key={p.id}
            onClick={() => {
              useMedia.setState((s) => ({
                gallery: { ...s.gallery, slideshow: s.gallery.slideshow ? { ...s.gallery.slideshow, index: i } : null },
              }))
            }}
            className={cn(
              "shrink-0 w-14 h-10 rounded-md overflow-hidden border-2 transition-all",
              i === ss.index ? "border-teal-400" : "border-transparent opacity-50 hover:opacity-90"
            )}
            aria-label={`صورة ${i + 1}`}
          >
            { }
            <img src={`/api/thumb?device=${p.device}&path=${encodeURIComponent(p.path)}`} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}
