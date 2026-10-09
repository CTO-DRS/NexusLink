"use client"
// جهاز تحكم الوسائط — تشغيل/إيقاف/تخطي/صوت لكل مشغل يعمل على الكمبيوتر
import { useState } from "react"
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music4, MonitorPlay } from "lucide-react"
import { rcMedia } from "@/lib/remote-socket"
import { useRcMirror } from "@/lib/remote-store"
import { Slider } from "@/components/ui/slider"

const TARGETS = ["المشغل الافتراضي", "VLC", "Spotify", "المتصفح"]

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

export function MediaRemoteMode() {
  const report = useRcMirror((s) => s.report)
  const media = report?.media
  const [target, setTarget] = useState("المشغل الافتراضي")

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      {/* الآن يعمل */}
      <div className="rounded-2xl border bg-card p-3 flex items-center gap-3">
        <div className="relative w-16 h-16 rounded-xl bg-gradient-to-br from-teal-500 via-cyan-600 to-indigo-700 grid place-items-center shrink-0 shadow-md">
          <Music4 className="w-7 h-7 text-white/90" />
          {media?.playing && (
            <div className="absolute bottom-1 end-1 flex items-end gap-0.5 h-3">
              {[0, 1, 2].map((i) => (
                <i key={i} className="nexus-eqbar w-0.5 rounded-sm bg-white/90" style={{ height: "100%", animationDelay: `${i * 0.18}s` }} />
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-extrabold truncate">{media?.trackTitle ?? "— لا مقطع —"}</p>
          <p className="text-[10px] text-muted-foreground truncate">{media?.trackArtist ?? "Nexus Music"}</p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[9px] tabular-nums text-muted-foreground" dir="ltr">{fmt(media?.position ?? 0)}</span>
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${media ? Math.min(100, (media.position / media.trackLen) * 100) : 0}%` }}
              />
            </div>
            <span className="text-[9px] tabular-nums text-muted-foreground" dir="ltr">{fmt(media?.trackLen ?? 0)}</span>
          </div>
        </div>
      </div>

      {/* اختيار المشغل */}
      <div className="flex gap-1.5 overflow-x-auto nexus-scroll pb-0.5">
        {TARGETS.map((t) => (
          <button
            key={t}
            onClick={() => { setTarget(t) }}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border transition-all ${
              target === t ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"
            }`}
          >
            <MonitorPlay className="w-3 h-3 inline ms-1 me-0.5 -mt-0.5" />
            {t}
          </button>
        ))}
      </div>

      {/* أزرار التشغيل */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => rcMedia({ action: "prev", target })}
          className="h-12 rounded-2xl border bg-card flex items-center justify-center gap-1.5 text-[11px] font-bold hover:bg-accent active:scale-95 transition-all"
        >
          <SkipBack className="w-4.5 h-4.5" /> السابق
        </button>
        <button
          onClick={() => rcMedia({ action: "next", target })}
          className="h-12 rounded-2xl border bg-card flex items-center justify-center gap-1.5 text-[11px] font-bold hover:bg-accent active:scale-95 transition-all"
        >
          التالي <SkipForward className="w-4.5 h-4.5" />
        </button>
      </div>

      <button
        onClick={() => rcMedia({ action: "toggle", target })}
        className="h-16 rounded-3xl bg-primary text-primary-foreground flex items-center justify-center gap-2.5 text-[15px] font-black shadow-lg shadow-primary/30 active:scale-95 transition-transform"
        data-testid="media-toggle"
      >
        {media?.playing ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
        {media?.playing ? "إيقاف مؤقت على الكمبيوتر" : "تشغيل على الكمبيوتر"}
      </button>

      {/* الصوت */}
      <div className="rounded-xl border bg-card px-3 py-2.5 space-y-2 mt-auto shrink-0">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10.5px] font-bold">
            {media?.muted || media?.volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-teal-500" />}
            مستوى الصوت على الكمبيوتر
          </span>
          <button
            onClick={() => rcMedia({ action: "mute", target })}
            className="text-[9.5px] font-bold text-muted-foreground hover:text-foreground rounded-full border px-2 py-0.5"
          >
            {media?.muted ? "إلغاء الكتم" : "كتم"}
          </button>
        </div>
        <Slider
          value={[media?.volume ?? 65]}
          min={0}
          max={100}
          step={1}
          onValueChange={([v]) => rcMedia({ action: "volume", value: v, target })}
        />
        <p className="text-[9px] text-muted-foreground">
          يعمل على: <b className="text-foreground">{target}</b> · التمرير بإصبعين فوق لوحة اللمس يضبط الصوت أيضاً عندما تكون نافذة الوسائط نشطة
        </p>
      </div>
    </div>
  )
}
