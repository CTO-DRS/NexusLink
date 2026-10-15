"use client"
// NexusLink — صفحة التلفاز (المرحلة 0-وسائط — عقد §22)
// ============================================================
// «هاتف→TV» بالوضع المدعوم فعليًا: أي شاشة بمتصفح على الشبكة المحلية
// (تلفاز ذكي/جهاز استقبال/لابتوب) تفتح http://<ip-الكمبيوتر>:3000/tv
// فتصبح مستقبل بث حقيقيًا — نفس تيار /api/preview (HTTP Range بلا نسخ).
// Chromecast الأصلي (mDNS/cast protocol) غير مدعوم — موثق بصدق في العقد.
// المحرك: cast:state من مرسل الكمبيوتر/الهاتف عبر جسر 3005 + أوامر cast:cmd.
import { useEffect, useRef, useState } from "react"
import {
  Tv, Play, Pause, Volume2, VolumeX, Maximize, Wifi, Music, Film, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getMediaSocket, mediaRole } from "@/lib/media-socket"
import { cn } from "@/lib/utils"

interface CastStateMsg {
  active?: boolean
  media?: { device?: string; path?: string; name?: string; kind?: string }
  target?: string
  sender?: string
  playing?: boolean
  position?: number
  volume?: number
  muted?: boolean
  at?: number
}

export default function TvPage() {
  const vidRef = useRef<HTMLVideoElement>(null)
  const [st, setSt] = useState<CastStateMsg | null>(null)
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(false)
  const lastPosRef = useRef(0)

  // تسجيل الدور + الاشتراك في حالة البث والأوامر
  useEffect(() => {
    const sock = getMediaSocket()
    mediaRole("tv", "Nexus-TV")
    sock.on("connect", () => setOnline(true))
    sock.on("disconnect", () => setOnline(false))
    const onState = (d: CastStateMsg) => {
      setSt(d)
      const el = vidRef.current
      if (!el) return
      const url = d?.active && d?.media?.device && d?.media?.path && d?.target === "tv"
        ? `/api/preview?device=${encodeURIComponent(d.media.device)}&path=${encodeURIComponent(d.media.path)}`
        : null
      if (url && el.src !== new URL(url, window.location.origin).href) {
        setLoading(true)
        el.src = url
        el.load()
      }
      if (!d?.active) {
        el.pause()
        el.removeAttribute("src")
        el.load()
      }
      if (typeof d?.volume === "number") el.volume = Math.min(1, Math.max(0, d.volume / 100))
      el.muted = d?.muted === true
      if (typeof d?.position === "number" && Math.abs(d.position - lastPosRef.current) > 1.2) {
        lastPosRef.current = d.position
        el.currentTime = d.position
      }
      if (d?.playing === true) void el.play().catch(() => { /* ينتظر تفاعلًا في بعض المتصفحات */ })
      else if (d?.playing === false) el.pause()
    }
    const onCmd = (d: { action?: string; value?: number; target?: string }) => {
      if (d?.target && d.target !== "tv") return
      const el = vidRef.current
      if (!el || !el.src) return
      if (d?.action === "toggle") { if (el.paused) void el.play().catch(() => {}); else el.pause() }
      else if (d?.action === "seek" && typeof d.value === "number") { lastPosRef.current = d.value; el.currentTime = d.value }
      else if (d?.action === "volume" && typeof d.value === "number") { el.volume = Math.min(1, Math.max(0, d.value / 100)); el.muted = false }
      else if (d?.action === "mute") el.muted = !el.muted
      else if (d?.action === "stop") { el.pause(); el.removeAttribute("src"); el.load() }
    }
    sock.on("cast:state", onState)
    sock.on("cast:cmd", onCmd)
    return () => {
      sock.off("cast:state", onState)
      sock.off("cast:cmd", onCmd)
    }
  }, [])

  const active = st?.active === true && st?.target === "tv" && !!st?.media?.path
  const isAudio = st?.media?.kind === "audio"

  return (
    <div className="fixed inset-0 bg-black text-white select-none">
      {/* الفيديو */}
      <video
        ref={vidRef}
        playsInline
        className={cn("h-full w-full object-contain bg-black", !active && "hidden")}
        onPlaying={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onTimeUpdate={(e) => { lastPosRef.current = e.currentTarget.currentTime }}
      />

      {/* غلاف الصوت */}
      {active && isAudio && (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-teal-950">
          <div className="text-center">
            <div className="w-28 h-28 rounded-3xl bg-teal-500/20 grid place-items-center mx-auto mb-5">
              <Music className="w-14 h-14 text-teal-400" />
            </div>
            <p className="text-2xl font-bold">{st?.media?.name}</p>
            <p className="text-sm text-white/50 mt-2">{st?.sender ?? ""} · NexusLink Cast</p>
          </div>
        </div>
      )}

      {/* جارٍ التحميل */}
      {active && loading && !isAudio && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <Loader2 className="w-14 h-14 animate-spin text-white/60" />
        </div>
      )}

      {/* شاشة الانتظار */}
      {!active && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center px-6">
            <div className="w-24 h-24 rounded-3xl bg-white/5 border border-white/10 grid place-items-center mx-auto mb-5">
              <Tv className="w-12 h-12 text-white/40" />
            </div>
            <h1 className="text-2xl font-bold">NexusLink Cast — شاشة الاستقبال</h1>
            <p className="text-sm text-white/50 mt-3 leading-relaxed max-w-md mx-auto">
              افتح تطبيق NexusLink على الكمبيوتر ← الوسائط ← بث الوسائط، اختر مقطعًا من هاتفك ووجهة
              «Nexus-TV» — سيبدأ العرض هنا فورًا.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-white/40">
              {online ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <Wifi className="w-3.5 h-3.5 animate-pulse text-red-400" />}
              {online ? "متصل بجسر الوسائط (3005)" : "جارٍ الاتصال…"}
            </div>
          </div>
        </div>
      )}

      {/* شريط الحالة العلوي */}
      {active && (
        <div className="absolute top-4 start-4 flex items-center gap-2">
          <Badge className="rounded-full bg-red-600 hover:bg-red-600 text-white text-[10px] gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> بث وارد
          </Badge>
          <span className="rounded-full bg-black/60 backdrop-blur px-3 py-1 text-[11px] text-white/80 flex items-center gap-1.5">
            {isAudio ? <Music className="w-3 h-3" /> : <Film className="w-3 h-3" />}
            {st?.media?.name} · {st?.sender ?? ""}
          </span>
        </div>
      )}

      {/* تحكم مختصر */}
      {active && (
        <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-3 opacity-70 hover:opacity-100 transition-opacity">
          <Button
            variant="secondary" size="icon" className="h-12 w-12 rounded-full bg-white/15 hover:bg-white/25 border-0 text-white"
            onClick={() => { const el = vidRef.current; if (!el) return; if (el.paused) void el.play().catch(() => {}); else el.pause() }}
            aria-label="تشغيل/إيقاف"
          >
            {st?.playing === false ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
          </Button>
          <Button
            variant="secondary" size="icon" className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/25 border-0 text-white"
            onClick={() => { const el = vidRef.current; if (el) el.muted = !el.muted }}
            aria-label="كتم"
          >
            {st?.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Button
            variant="secondary" size="icon" className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/25 border-0 text-white"
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            aria-label="ملء الشاشة"
          >
            <Maximize className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
