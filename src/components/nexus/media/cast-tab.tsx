"use client"
// بث الوسائط — تشغيل موسيقى/فيديو من الهاتف إلى الكمبيوتر أو TV
// بث فعلي عبر HTTP Range (نفس تقنية /api/preview) — بدون نسخ أي بايت
// + §22: «افتح في مشغل النظام» (m3u مؤقت) + الوضع المدعوم فعليًا للهاتف→TV (/tv)
import { useEffect, useRef, useState } from "react"
import {
  Cast, Tv, Monitor, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Square, Music, Film, HardDriveDownload, Smartphone, ListVideo,
  MonitorPlay, Info,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { useMedia } from "@/lib/media-store"
import { fmtSize, fmtDuration } from "@/lib/store"
import { getReceiver, registerReceiver } from "@/lib/media-engine"
import { castCmd } from "@/lib/media-socket"
import { PhoneFrame, TvFrame, PcWindow } from "./media-bits"
import { isTauri, tauriInvoke } from "@/lib/tauri"
import { cn } from "@/lib/utils"

export function CastTab() {
  const cast = useMedia((s) => s.cast)
  const library = useMedia((s) => s.castLibrary)
  const castLoading = useMedia((s) => s.castLoading)
  const loadCastLibrary = useMedia((s) => s.loadCastLibrary)
  const startCast = useMedia((s) => s.startCast)
  const stopCast = useMedia((s) => s.stopCast)
  const castToggle = useMedia((s) => s.castToggle)
  const castSeek = useMedia((s) => s.castSeek)
  const castVolume = useMedia((s) => s.castVolume)
  const castMute = useMedia((s) => s.castMute)

  const [target, setTarget] = useState<"tv" | "pc">("tv")

  // تحميل المكتبة
  useEffect(() => { void loadCastLibrary() }, [loadCastLibrary])

  // تسجيل عنصري المستقبل + تحميل المصدر الحالي
  const tvRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    registerReceiver("tv", tvRef.current)
    registerReceiver("pc", pcRef.current)
    return () => {
      registerReceiver("tv", null)
      registerReceiver("pc", null)
    }
  }, [])

  // عند تغيّر الوسائط/الوجهة: حمّل المصدر في عنصر المستقبل الصحيح
  useEffect(() => {
    const tv = tvRef.current
    const pc = pcRef.current
    if (!tv || !pc) return
    // أفرغ غير النشط دائماً
    if (cast?.target !== "tv" && tv.src !== window.location.href) { tv.removeAttribute("src"); tv.load() }
    if (cast?.target !== "pc" && pc.src !== window.location.href) { pc.removeAttribute("src"); pc.load() }
    if (!cast) return
    const el = getReceiver(cast.target)
    if (!el) return
    const url = `/api/preview?device=${cast.media.device}&path=${encodeURIComponent(cast.media.path)}`
    const cur = el.src
    const fresh = cur !== new URL(url, window.location.origin).href
    if (fresh) {
      el.src = url
      el.load()
    }
    el.volume = cast.volume / 100
    el.muted = cast.muted

    // تشغيل موثوق: محاولة مباشرة + عند جهوزية البيانات + تراجع لكتم عند رفض التشغيل التلقائي
    const tryPlay = () => {
      if (!useMedia.getState().cast?.playing) return
      el.play().catch((e: DOMException) => {
        if (e?.name === "NotAllowedError") {
          el.muted = true
          el.play().catch(() => { /* ignore */ })
        }
      })
    }
    if (cast.playing) {
      if (fresh) el.addEventListener("canplay", tryPlay, { once: true })
      tryPlay()
    }
  }, [cast?.media.id, cast?.target, cast?.playing, cast?.volume, cast?.muted])

  // مزامنة التقدم من عنصر المستقبل
  useEffect(() => {
    if (!cast) return
    const el = getReceiver(cast.target)
    if (!el) return
    let last = 0
    const onTime = () => {
      const now = Date.now()
      if (now - last > 700) {
        last = now
        useMedia.getState().updateCastPos(el.currentTime, el.duration || 0, !el.paused)
      }
    }
    const onEnd = () => useMedia.getState().stopCast()
    el.addEventListener("timeupdate", onTime)
    el.addEventListener("ended", onEnd)
    el.addEventListener("pause", onTime)
    return () => {
      el.removeEventListener("timeupdate", onTime)
      el.removeEventListener("ended", onEnd)
      el.removeEventListener("pause", onTime)
    }
  }, [cast?.media.id, cast?.target])

  const remote = (action: string, value?: number) => {
    castCmd({ action, value, target })
  }

  // §22 — «stream مؤقت» في مشغل سطح المكتب الافتراضي: m3u يحمل تيار /api/preview
  // ويُفتح بالمعالج النظامي (VLC/WMP/mpv) — بلا نسخ بايتات.
  const [playerMsg, setPlayerMsg] = useState("")
  const openInSystemPlayer = async () => {
    if (!cast) return
    const url = new URL(
      `/api/preview?device=${cast.media.device}&path=${encodeURIComponent(cast.media.path)}`,
      window.location.origin,
    ).href
    try {
      await tauriInvoke("media_open_player", { url, name: cast.media.name })
      setPlayerMsg("")
    } catch (e) {
      setPlayerMsg(String(e).slice(0, 180))
    }
  }

  const copyTvLink = async () => {
    try {
      await navigator.clipboard.writeText(`http://${window.location.hostname}:3000/tv`)
      setPlayerMsg("")
    } catch { /* الحافظة مرفوضة — النص معروض للنسخ اليدوي */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="me-auto">
          <h3 className="text-[15px] font-bold flex items-center gap-2">
            <Cast className="w-4.5 h-4.5 text-primary" /> بث الوسائط — بدون نسخ
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            شغّل محتوى هاتفك على شاشة كبيرة — بث تدفقي مباشر عبر الشبكة المحلية
          </p>
        </div>
        <Badge variant="outline" className="rounded-full gap-1.5 border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-400">
          <HardDriveDownload className="w-3 h-3" /> HTTP Range — لا يُنسخ أي بايت
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* ===== الهاتف المرسل ===== */}
        <div className="space-y-3">
          <PhoneFrame
            name="Galaxy-S24 · المرسل"
            sub={cast ? `يبث إلى ${cast.target === "tv" ? "Nexus-TV" : "الكمبيوتر"}` : "اختر مقطعاً للبث"}
            active={!!cast}
            screenClassName="grid place-items-center"
          >
            <div className="w-full px-3 pt-8 pb-3 text-center">
              {cast ? (
                <>
                  <div className="w-14 h-14 rounded-xl bg-teal-500/20 grid place-items-center mx-auto mb-2">
                    {cast.media.kind === "video" ? <Film className="w-7 h-7 text-teal-400" /> : <Music className="w-7 h-7 text-teal-400" />}
                  </div>
                  <p className="text-[11px] text-white font-bold truncate px-2">{cast.media.name}</p>
                  <p className="text-[9px] text-white/50 mt-0.5">
                    {fmtDuration(cast.position)} / {cast.duration ? fmtDuration(cast.duration) : "—"}
                  </p>
                  <div className="mt-2 px-1">
                    <Slider
                      value={[Math.min(cast.position, cast.duration || 1)]}
                      max={cast.duration || 1}
                      step={1}
                      onValueChange={(v) => { castSeek(v[0]); remote("seek", v[0]) }}
                      className="[&_[data-slot=slider-track]]:h-1"
                    />
                  </div>
                  {/* أزرار التحكم عن بُعد */}
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full" onClick={() => { castSeek(Math.max(0, cast.position - 10)); remote("seek", Math.max(0, cast.position - 10)) }} aria-label="للخلف 10 ثوان">
                      <SkipBack className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" className="h-10 w-10 rounded-full" onClick={() => { castToggle(); remote("toggle") }} aria-label="تشغيل/إيقاف">
                      {cast.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                    <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full" onClick={() => { castSeek(cast.position + 10); remote("seek", cast.position + 10) }} aria-label="للأمام 10 ثوان">
                      <SkipForward className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="mt-3 flex items-center gap-2 px-2">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-white/70 hover:text-white" onClick={() => { castMute(); remote("mute") }} aria-label="كتم">
                      {cast.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </Button>
                    <Slider value={[cast.volume]} max={100} step={5} onValueChange={(v) => { castVolume(v[0]); remote("volume", v[0]) }} className="flex-1 [&_[data-slot=slider-track]]:h-1" />
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => { stopCast(); remote("stop") }} aria-label="إيقاف البث">
                      <Square className="w-3 h-3" />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="py-8">
                  <ListVideo className="w-10 h-10 mx-auto text-zinc-600 mb-2" />
                  <p className="text-[10px] text-zinc-500 px-4">اختر من مكتبة الهاتف بالأسفل وحدد وجهة البث</p>
                </div>
              )}
            </div>
          </PhoneFrame>

          {/* وجهة البث */}
          <div className="rounded-xl border bg-card p-3">
            <p className="text-[11px] font-semibold mb-2">وجهة البث</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={target === "tv" ? "default" : "outline"} className="h-9 rounded-lg text-[11px]" onClick={() => setTarget("tv")}>
                <Tv className="w-3.5 h-3.5" /> Nexus-TV
              </Button>
              <Button variant={target === "pc" ? "default" : "outline"} className="h-9 rounded-lg text-[11px]" onClick={() => setTarget("pc")}>
                <Monitor className="w-3.5 h-3.5" /> الكمبيوتر
              </Button>
            </div>
          </div>
        </div>

        {/* ===== المستقبلات ===== */}
        <div className="space-y-4">
          <TvFrame>
            <div className="relative w-full h-full">
              {/* عنصر الفيديو للتلفاز */}
              <video ref={tvRef} playsInline className="h-full w-full object-contain bg-black" />
              {cast?.target === "tv" && cast.media.kind === "audio" && (
                <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-zinc-900 to-teal-950">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-teal-500/20 grid place-items-center mx-auto mb-3">
                      <Music className="w-8 h-8 text-teal-400" />
                    </div>
                    <p className="text-white text-[13px] font-bold">{cast.media.name}</p>
                    <div className="flex items-end justify-center gap-1 mt-3 h-6" dir="ltr">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span key={i} className="w-1.5 bg-teal-400 rounded-full animate-pulse" style={{ height: cast.playing ? `${30 + ((Date.now() / 300 + i * 7) % 70)}%` : "20%", animationDelay: `${i * 120}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {!cast || cast.target !== "tv" ? (
                <div className="absolute inset-0 grid place-items-center bg-zinc-950/97">
                  <div className="text-center text-zinc-600">
                    <Tv className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-[11px]">{cast ? "البث الحالي معروض على الكمبيوتر" : "Nexus-TV جاهز لاستقبال البث"}</p>
                  </div>
                </div>
              ) : (
                <div className="absolute top-2 start-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white flex items-center gap-1.5">
                  <Smartphone className="w-3 h-3" /> يُبث من Galaxy-S24 · {cast.playing ? "يعرض" : "موقوف مؤقتاً"}
                </div>
              )}
            </div>
          </TvFrame>

          <PcWindow
            title="مشغل وسائط NEXUS-PC"
            headerExtra={cast?.target === "pc" ? (
              <Badge className="rounded-full bg-red-500 hover:bg-red-500 text-white text-[9px] gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> بث وارد
              </Badge>
            ) : undefined}
          >
            <div className="relative aspect-video bg-zinc-950">
              {/* عنصر الفيديو للكمبيوتر */}
              <video ref={pcRef} playsInline className="h-full w-full object-contain bg-black" />
              {cast?.target === "pc" && cast.media.kind === "audio" && (
                <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-zinc-900 to-zinc-800">
                  <div className="text-center">
                    <Music className="w-10 h-10 text-teal-400 mx-auto mb-2" />
                    <p className="text-[12px] text-white font-bold">{cast.media.name}</p>
                  </div>
                </div>
              )}
              {(!cast || cast.target !== "pc") && (
                <div className="absolute inset-0 grid place-items-center bg-zinc-950/97">
                  <div className="text-center text-zinc-600">
                    <Monitor className="w-9 h-9 mx-auto mb-2 opacity-50" />
                    <p className="text-[11px]">{cast ? "البث الحالي معروض على التلفاز" : "لا بث وارد — ابدأ من الهاتف"}</p>
                  </div>
                </div>
              )}
            </div>
            {/* §22 — «stream مؤقت» في مشغل النظام الافتراضي (م3و مؤقت → VLC/WMP) */}
            <div className="border-t bg-muted/30 px-3 py-2 flex flex-wrap items-center gap-2">
              {isTauri() && (
                <Button
                  variant="outline" size="sm" className="h-7 rounded-lg text-[10.5px] gap-1.5"
                  disabled={!cast}
                  onClick={() => void openInSystemPlayer()}
                >
                  <MonitorPlay className="w-3.5 h-3.5" /> افتح في مشغل النظام (stream مؤقت)
                </Button>
              )}
              {playerMsg && <span className="text-[10px] text-red-500" data-no-i18n>{playerMsg}</span>}
            </div>
          </PcWindow>

          {/* §22 — سلسلة الهاتف→TV: الوضع المدعوم فعليًا (بصدق) */}
          <div className="rounded-xl border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              <p className="text-[12.5px] font-bold">العرض على شاشة كبيرة (هاتف ← TV) — الوضع المدعوم فعليًا</p>
            </div>
            <ul className="text-[11px] text-muted-foreground space-y-1 leading-relaxed list-disc ms-4">
              <li>
                نافذة «Nexus-TV» أعلاه: معاينة داخل التطبيق تعمل دائمًا.
              </li>
              <li>
                أي شاشة بمتصفح على الشبكة المحلية (تلفاز ذكي/جهاز استقبال): افتح
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5" data-no-i18n>http://&lt;ip-الكمبيوتر&gt;:3000/tv</code>
                <button className="mx-1 text-primary underline" onClick={() => void copyTvLink()}>(نسخ)</button>
                — تصبح مستقبل بث حقيقيًا بنفس التحكم.
              </li>
              <li>
                مشغل سطح المكتب الافتراضي (VLC/Windows Media Player) عبر زر «افتح في مشغل النظام».
              </li>
              <li className="text-amber-600 dark:text-amber-400">
                صادق: بروتوكول Chromecast الأصلي (mDNS) غير مدعوم — مسار /tv هو البديل المكافئ عمليًا.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* ===== مكتبة الهاتف ===== */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
          <ListVideo className="w-4 h-4 text-primary" />
          <h4 className="text-[13px] font-bold">مكتبة Galaxy-S24</h4>
          <Badge variant="outline" className="rounded-full text-[10px]">{library.length} مقطع</Badge>
          {castLoading && <span className="text-[10px] text-muted-foreground animate-pulse">جارٍ القراءة من /Movies و /Music…</span>}
        </div>
        <div className="p-3">
          {library.length === 0 && !castLoading ? (
            <p className="text-[11px] text-muted-foreground text-center py-4">لا توجد وسائط — أضف ملفات من متصفح الملفات</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 max-h-72 overflow-y-auto pe-1">
              {library.map((m) => {
                const activeItem = cast?.media.id === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => startCast(m, target)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-start transition-all hover:border-primary/50 hover:bg-accent",
                      activeItem && "border-primary bg-primary/5"
                    )}
                  >
                    <div className={cn("w-9 h-9 rounded-lg grid place-items-center shrink-0", m.kind === "video" ? "bg-amber-500/15 text-amber-500" : "bg-teal-500/15 text-teal-500")}>
                      {m.kind === "video" ? <Film className="w-4 h-4" /> : <Music className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] font-semibold truncate">{m.name}</p>
                      <p className="text-[9.5px] text-muted-foreground">{m.path} · {fmtSize(m.size)}</p>
                    </div>
                    {activeItem ? (
                      <Badge className="rounded-full bg-red-500 hover:bg-red-500 text-white text-[9px] shrink-0">يعرض</Badge>
                    ) : (
                      <Play className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
