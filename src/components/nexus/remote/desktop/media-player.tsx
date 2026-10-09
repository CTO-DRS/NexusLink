"use client"
// نافذة مشغل الوسائط — تستجيب لأوامر التشغيل/التخطي/الصوت من الهاتف
import { Music4, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react"
import { useDesktop } from "@/lib/remote-store"

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

export function MediaPlayerWindow() {
  const { tracks, trackIndex, mediaPos, mediaPlaying, mediaVolume, mediaMuted, mediaTarget } = useDesktop()
  const track = tracks[trackIndex]
  const pct = Math.min(100, (mediaPos / track.len) * 100)

  return (
    <>
      <div className="flex items-center gap-2 px-3 h-9 border-b bg-card/60 shrink-0">
        <Music4 className="w-3.5 h-3.5 text-teal-500" />
        <span className="text-[12px] font-semibold">مشغل الوسائط — Nexus Music</span>
        <span className="flex-1" />
        <span className="text-[9.5px] rounded-full bg-primary/10 text-primary px-2 py-0.5 font-bold">{mediaTarget}</span>
      </div>

      <div className="flex-1 flex flex-col gap-3 p-4 overflow-hidden">
        {/* الغلاف والمعلومات */}
        <div className="flex items-center gap-4 min-h-0">
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-teal-500 via-cyan-600 to-indigo-700 grid place-items-center shrink-0 shadow-lg">
            <Music4 className="w-9 h-9 text-white/90" />
            {mediaPlaying && (
              <div className="absolute bottom-1.5 end-1.5 flex items-end gap-0.5 h-3.5">
                {[0, 1, 2].map((i) => (
                  <i key={i} className="nexus-eqbar w-1 rounded-sm bg-white/90" style={{ height: "100%", animationDelay: `${i * 0.18}s` }} />
                ))}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base sm:text-lg font-extrabold truncate">{track.title}</h3>
            <p className="text-[12px] text-muted-foreground truncate">{track.artist} · من ألبوم «الشبكة المحلية»</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] tabular-nums text-muted-foreground" dir="ltr">{fmt(mediaPos)}</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-1000 ease-linear" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground" dir="ltr">{fmt(track.len)}</span>
            </div>
          </div>
        </div>

        {/* شريط التقدم والصوت */}
        <div className="flex items-center gap-2">
          {mediaMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-muted-foreground" />}
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${mediaMuted ? "bg-red-400" : "bg-teal-500"}`}
              style={{ width: `${mediaMuted ? 0 : mediaVolume}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground w-8" dir="ltr">{mediaMuted ? 0 : mediaVolume}%</span>
        </div>

        {/* قائمة المقاطع */}
        <div className="flex gap-1.5 overflow-x-auto nexus-scroll pb-1 shrink-0">
          {tracks.map((t, i) => (
            <span
              key={t.title}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium border ${
                i === trackIndex ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-border"
              }`}
            >
              {i + 1}. {t.title}
            </span>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground mt-auto">
          {mediaPlaying ? "يعمل الآن — يتحكم به الهاتف من تبويب «الوسائط»" : "متوقف مؤقتاً — اضغط تشغيل من الهاتف"}
        </p>
      </div>
    </>
  )
}
