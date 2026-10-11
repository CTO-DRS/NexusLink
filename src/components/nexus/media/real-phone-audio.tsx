"use client"
// FA-8 — لوحة بث الصوت من الهاتف الحقيقي (مراقبة الأطفال / ميكروفون)
// طلب بدء/إيقاف عبر cam:cmd + عنصر صوت يستقبل الـ MediaStream عبر WebRTC
import { useEffect, useRef, useState } from "react"
import { Play, Square, Volume2, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useMedia } from "@/lib/media-store"
import { camCmd } from "@/lib/media-socket"
import { cn } from "@/lib/utils"

export function RealPhoneAudio({ kind }: { kind: "baby" | "mic" }) {
  const phoneOnline = useMedia((s) => s.phoneOnline)
  const stream = useMedia((s) => (kind === "baby" ? s.remoteBabyStream : s.remoteMicStream))
  const [playing, setPlaying] = useState(false)
  const [requested, setRequested] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (stream && playing) void el.play().catch(() => setPlaying(false))
  }, [stream, playing])

  if (!phoneOnline && !stream) return null

  const title = kind === "baby" ? "بث حقيقي من هاتفك (صوت الطفل)" : "بث حقيقي من ميكروفون هاتفك"
  const note =
    kind === "baby"
      ? "يطلب الكمبيوتر من الهاتف بث الميكروفون باستمرار — يعمل والشاشة مطفأة، والتنبيهات (baby:alert) تظهر تلقائياً"
      : "يطلب الكمبيوتر من الهاتف تشغيل ميكروفونه — اضغط «تشغيل» لتسمعه على سماعات الكمبيوتر"

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Smartphone className="w-3.5 h-3.5 text-primary" />
        <p className="text-[11px] font-bold">{title}</p>
        {stream && (
          <Badge className="rounded-full bg-emerald-500 hover:bg-emerald-500 text-white text-[9px] ms-auto">
            قناة WebRTC حية
          </Badge>
        )}
      </div>
      {stream ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={playing ? "destructive" : "default"}
            className="h-8 rounded-lg text-[11px]"
            onClick={() => setPlaying((p) => !p)}
          >
            <Volume2 className="w-3.5 h-3.5" /> {playing ? "كتم السماع هنا" : "تشغيل على الكمبيوتر"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-[11px]"
            onClick={() => {
              camCmd(kind === "baby" ? "baby-stop" : "mic-stop")
              setRequested(false)
            }}
          >
            <Square className="w-3.5 h-3.5" /> إيقاف البث من الهاتف
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          className="h-8 rounded-lg text-[11px]"
          disabled={requested}
          onClick={() => {
            camCmd(kind === "baby" ? "baby-start" : "mic-start")
            setRequested(true)
          }}
        >
          <Play className="w-3.5 h-3.5" /> {requested ? "بانتظار الهاتف…" : "طلب البث من الهاتف"}
        </Button>
      )}
      <p className={cn("text-[10px] text-muted-foreground leading-relaxed")}>{note}</p>
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </div>
  )
}
