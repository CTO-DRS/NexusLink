"use client"
// وضع مراقبة الأطفال — بث صوت دائم من هاتف (غرفة الطفل) إلى هاتف آخر
// (أو سماعات الكمبيوتر) + تنبيه عند بكاء بصوت مرتفع (عتبة شدة — بدون AI)
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Baby, Play, Square, Volume2, Moon, AlertTriangle, AudioLines, Ear,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useMedia } from "@/lib/media-store"
import { AudioMeter, getMicSource, getSynthLevel } from "@/lib/media-engine"
import { babyAlert } from "@/lib/media-socket"
import { PhoneFrame, PcWindow, LiveBadge, LevelBar, NoStream } from "./media-bits"
import { RealPhoneAudio } from "./real-phone-audio"
import { cn } from "@/lib/utils"

export function BabyTab() {
  const baby = useMedia((s) => s.baby)
  const babyStream = useMedia((s) => s.babyStream)
  const allAlerts = useMedia((s) => s.alerts)
  const alerts = useMemo(() => allAlerts.filter((a) => a.kind === "cry").slice(0, 6), [allAlerts])
  const startBaby = useMedia((s) => s.startBaby)
  const stopBaby = useMedia((s) => s.stopBaby)
  const setBabyReceiver = useMedia((s) => s.setBabyReceiver)
  const setBabyGain = useMedia((s) => s.setBabyGain)

  // عنصر الصوت في المستقبل (هاتف الوالدين أو الكمبيوتر)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (el.srcObject !== babyStream) el.srcObject = babyStream
    el.volume = baby.gain / 100
    if (babyStream) void el.play().catch(() => { /* ignore */ })
  }, [babyStream, baby.gain])

  // مقياس الصوت من بث غرفة الطفل (المصدر) — مع إعادة محاولة حتى جهوزية المصدر
  const meterRef = useRef<AudioMeter | null>(null)
  const [srcLabel, setSrcLabel] = useState("")
  useEffect(() => {
    if (!baby.enabled) return
    let cancelled = false
    let meter: AudioMeter | null = null
    let cryHold = 0
    const tryAttach = (attempt = 0) => {
      if (cancelled) return
      const src = getMicSource(baby.sender)
      if (!src) {
        if (attempt < 24) window.setTimeout(() => tryAttach(attempt + 1), 250)
        return
      }
      setSrcLabel(src.label)
      try {
        meter = new AudioMeter(() => getSynthLevel(baby.sender) ?? { rms: 0, peak: 0 })
        meterRef.current = meter
        meter.attach(src.stream)
        meter.start((rms, peak) => {
          const st = useMedia.getState()
          st.bumpBabyLevel(rms, peak)
          // إبقاء الشدة فوق العتبة لمدة قصيرة قبل إطلاق التنبيه عبر الجسر
          if (rms >= 55) {
            cryHold++
            if (cryHold === 4) babyAlert(baby.sender, rms)
          } else cryHold = 0
        })
      } catch { /* ignore */ }
    }
    tryAttach()
    return () => {
      cancelled = true
      meter?.detach()
      meterRef.current = null
    }
  }, [baby.enabled, baby.sender])

  const [since, setSince] = useState(0)
  useEffect(() => {
    if (!baby.enabled) return
    const start = baby.listeningSince ?? Date.now()
    const iv = window.setInterval(() => setSince(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(iv)
  }, [baby.enabled, baby.listeningSince])

  const crying = baby.level >= 55

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="me-auto">
          <h3 className="text-[15px] font-bold flex items-center gap-2">
            <Baby className="w-4.5 h-4.5 text-primary" /> وضع مراقبة الأطفال
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            بث صوت دائم من هاتف غرفة الطفل إلى هاتف الوالدين — بتنبيه فوري عند البكاء
          </p>
        </div>
        {baby.enabled
          ? <Button variant="destructive" size="sm" className="h-8 rounded-lg text-[11px]" onClick={stopBaby}><Square className="w-3.5 h-3.5" /> إنهاء المراقبة</Button>
          : <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => void startBaby()}><Play className="w-3.5 h-3.5" /> بدء البث الدائم</Button>}
        {baby.enabled && (
          <Badge className={cn("rounded-full text-white gap-1", crying ? "bg-red-500 hover:bg-red-500 animate-pulse" : "bg-emerald-500 hover:bg-emerald-500")}>
            <Ear className="w-3 h-3" /> {crying ? "بكاء!" : `يستمع · ${Math.floor(since / 60)}:${String(since % 60).padStart(2, "0")}`}
          </Badge>
        )}
      </div>

      {/* FA-8: بث حقيقي من الهاتف (غرفة الطفل) */}
      <RealPhoneAudio kind="baby" />

      <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] items-start">
        {/* هاتف غرفة الطفل (المرسل) */}
        <div className="space-y-3">
          <PhoneFrame
            name="Redmi-Note13 · غرفة الطفل"
            sub={baby.enabled ? srcLabel || "يبث…" : "الميكروفون متوقف"}
            active={baby.enabled}
            screenClassName="grid place-items-center"
          >
            <div className="text-center px-4">
              <div className={cn("w-20 h-20 rounded-full mx-auto grid place-items-center mb-3 transition-all", baby.enabled ? "bg-teal-500/20" : "bg-zinc-800")}>
                <AudioLines className={cn("w-9 h-9", baby.enabled ? "text-teal-400 animate-pulse" : "text-zinc-600")} />
              </div>
              <p className="text-[11px] text-white/80 font-bold">مراقبة الطفل</p>
              <p className="text-[9px] text-white/50 mt-1">
                {baby.enabled ? "بث صوت دائم عبر WebRTC" : "اضغط «بدء البث الدائم»"}
              </p>
              {baby.enabled && (
                <div className="mt-3 px-4">
                  <LevelBar level={baby.level} peak={baby.peak} tone={crying ? "red" : "teal"} />
                  <p className="text-[9px] text-white/60 mt-1 tabular-nums">مستوى الصوت في الغرفة: {baby.level}%</p>
                </div>
              )}
            </div>
          </PhoneFrame>

          <div className="rounded-xl border bg-card p-3 space-y-2">
            <p className="text-[11px] font-semibold">خيارات المرسل</p>
            <p className="text-[10px] text-muted-foreground">
              {!baby.enabled ? "التشغيل سيفتح ميكروفون الهاتف (عتاد حقيقي عند توفره وإلا محاكاة بنوبات بكاء للاختبار)"
                : baby.level >= 55 ? "عتبة التنبيه: 55% — تجاوزتها الشدة حالياً"
                  : "التنبيه يُطلق عند تجاوز شدة الصوت 55% لمدة نصف ثانية"}
            </p>
          </div>
        </div>

        {/* القناة */}
        <div className="hidden lg:flex flex-col items-center gap-1 pt-24 text-muted-foreground">
          <div className="h-px w-16 bg-border" />
          <Badge variant="outline" className="rounded-full text-[9px]">WebRTC · Opus</Badge>
          <div className="h-px w-16 bg-border" />
        </div>

        {/* المستقبل */}
        <div className="space-y-3">
          {baby.receiver === "galaxy-s24" ? (
            <PhoneFrame
              name="Galaxy-S24 · هاتف الوالدين"
              sub={baby.enabled ? `يستمع بمستوى ${baby.gain}%` : "بلا بث"}
              active={baby.enabled}
              screenClassName="grid place-items-center"
            >
              <div className="text-center px-4 w-full">
                <div className={cn("w-20 h-20 rounded-full mx-auto grid place-items-center mb-3", baby.enabled ? (crying ? "bg-red-500/25 animate-pulse" : "bg-emerald-500/20") : "bg-zinc-800")}>
                  <Baby className={cn("w-9 h-9", baby.enabled ? (crying ? "text-red-400" : "text-emerald-400") : "text-zinc-600")} />
                </div>
                {crying && (
                  <div className="mx-3 rounded-lg bg-red-500/90 text-white text-[10px] font-bold px-2 py-1.5 mb-2 animate-pulse">
                    تنبيه: الطفل يبكي! ({baby.level}%)
                  </div>
                )}
                <p className="text-[10px] text-white/60">بث مباشر من غرفة الطفل</p>
              </div>
            </PhoneFrame>
          ) : (
            <PcWindow
              title="سماعات الكمبيوتر — مراقبة الطفل"
              headerExtra={baby.enabled ? <LiveBadge mode="AUDIO" /> : undefined}
            >
              <div className="aspect-[16/7] bg-zinc-950 grid place-items-center">
                {baby.enabled ? (
                  <div className="text-center w-full px-6">
                    <Moon className={cn("w-10 h-10 mx-auto mb-2", crying ? "text-red-400 animate-pulse" : "text-teal-400")} />
                    <LevelBar level={baby.level} peak={baby.peak} tone={crying ? "red" : "teal"} className="max-w-xs mx-auto" />
                    <p className="text-[10px] text-zinc-400 mt-2 tabular-nums">{crying ? "صوت مرتفع — تنبيه فعال" : "الغرفة هادئة"} · {baby.level}%</p>
                  </div>
                ) : (
                  <NoStream text="بدء البث للاستماع عبر الكمبيوتر" />
                )}
              </div>
            </PcWindow>
          )}

          {/* عنصر الصوت الفعلي */}
          <audio ref={audioRef} playsInline className="hidden" />

          {/* تحكم المستقبل */}
          <div className="rounded-xl border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold flex items-center gap-1.5"><Volume2 className="w-3.5 h-3.5 text-primary" /> وجهة الاستماع</span>
              <div className="flex items-center gap-1.5">
                <Button variant={baby.receiver === "galaxy-s24" ? "default" : "outline"} size="sm" className="h-7 rounded-lg text-[10px]" onClick={() => void setBabyReceiver("galaxy-s24")}>
                  هاتف الوالدين
                </Button>
                <Button variant={baby.receiver === "pc-office" ? "default" : "outline"} size="sm" className="h-7 rounded-lg text-[10px]" onClick={() => void setBabyReceiver("pc-office")}>
                  الكمبيوتر
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <Slider value={[baby.gain]} min={0} max={100} step={5} onValueChange={(v) => setBabyGain(v[0])} className="flex-1" />
              <span className="text-[11px] tabular-nums w-9 text-end font-bold">{baby.gain}%</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="baby-persist" checked disabled />
              <Label htmlFor="baby-persist" className="text-[10px] text-muted-foreground cursor-default">
                بث دائم — يستمر حتى إيقافه يدوياً (Nexus Keep-Alive)
              </Label>
            </div>
          </div>
        </div>
      </div>

      {/* تنبيهات البكاء */}
      <div className="rounded-xl border bg-card p-4">
        <h4 className="text-[13px] font-bold flex items-center gap-2 mb-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500" /> سجل تنبيهات البكاء
        </h4>
        {alerts.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-2 text-center">
            {baby.enabled ? "المراقبة جارية — لا تنبيهات بعد (نوبة بكاء تجريبية كل ~15ث في وضع المحاكاة)" : "لا تنبيهات"}
          </p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-2.5 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-medium">{a.text}</p>
                  <p className="text-[9px] text-muted-foreground tabular-nums mt-0.5">{new Date(a.at).toLocaleTimeString("ar")}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
