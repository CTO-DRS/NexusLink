"use client"
// الهاتف كميكروفون لاسلكي للكمبيوتر — بث صوت حي عبر WebRTC
// مع مقياس VU وموجة صوتية وكسب ومراقبة صوتية
import { useEffect, useRef, useState } from "react"
import {
  Mic, MicOff, Play, Square, Volume2, Headphones, Activity, MonitorSpeaker,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useMedia } from "@/lib/media-store"
import { AudioMeter, getMicSource, getSynthLevel } from "@/lib/media-engine"
import { PhoneFrame, PcWindow, LiveBadge, LevelBar, NoStream } from "./media-bits"
import { RealPhoneAudio } from "./real-phone-audio"
import { cn } from "@/lib/utils"

export function MicTab() {
  const mic = useMedia((s) => s.mic)
  const micState = useMedia((s) => s.mics["galaxy-s24"])
  const micStream = useMedia((s) => s.micStream)
  const latency = useMedia((s) => s.latency)
  const startMic = useMedia((s) => s.startMic)
  const stopMic = useMedia((s) => s.stopMic)
  const setMicGain = useMedia((s) => s.setMicGain)
  const toggleMonitor = useMedia((s) => s.toggleMonitor)

  // عنصر مراقبة الصوت على الكمبيوتر
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (el.srcObject !== micStream) el.srcObject = micStream
    el.volume = mic.gain / 100
    el.muted = !mic.monitor
    if (micStream && mic.monitor) void el.play().catch(() => { /* ignore */ })
  }, [micStream, mic.gain, mic.monitor])

  // مقياس المرسل (ما يلتقطه الميكروفون في الهاتف)
  const meterRef = useRef<AudioMeter | null>(null)
  useEffect(() => {
    if (!micState.active) return
    const src = getMicSource("galaxy-s24")
    if (!src) return
    try {
      const meter = new AudioMeter(() => getSynthLevel("galaxy-s24") ?? { rms: 0, peak: 0 })
      meterRef.current = meter
      meter.attach(src.stream)
      meter.start((rms, peak) => useMedia.getState().bumpMicLevel(rms, peak))
      return () => {
        meter.detach()
        meterRef.current = null
      }
    } catch { /* ignore */ }
  }, [micState.active])

  // شريط موجي حي (تاريخ المستويات) — يُفرغ بالاشتقاق عند التوقف
  const [wave, setWave] = useState<number[]>([])
  useEffect(() => {
    if (!micState.active) return
    const iv = window.setInterval(() => {
      setWave((w) => [...w.slice(-47), useMedia.getState().mic.level])
    }, 130)
    return () => window.clearInterval(iv)
  }, [micState.active])
  const shownWave = micState.active ? wave : Array<number>(48).fill(0)

  // مدة الجلسة
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!micState.active) return
    const t0 = window.setTimeout(() => setSecs(0), 0)
    const iv = window.setInterval(() => {
      setSecs(Math.floor((Date.now() - (mic.startedAt ?? Date.now())) / 1000))
    }, 1000)
    return () => { window.clearTimeout(t0); window.clearInterval(iv) }
  }, [micState.active, mic.startedAt])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="me-auto">
          <h3 className="text-[15px] font-bold flex items-center gap-2">
            <Mic className="w-4.5 h-4.5 text-primary" /> الهاتف كميكروفون لاسلكي
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            بث صوت Galaxy-S24 إلى الكمبيوتر مباشرة — استوديو تسجيل محمول بلا أسلاك
          </p>
        </div>
        {micState.active
          ? <Button variant="destructive" size="sm" className="h-8 rounded-lg text-[11px]" onClick={stopMic}><Square className="w-3.5 h-3.5" /> قطع البث</Button>
          : <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => void startMic()}><Play className="w-3.5 h-3.5" /> بدء البث</Button>}
        {micState.active && <LiveBadge mode="MIC" />}
      </div>

      {/* FA-8: بث حقيقي من ميكروفون هاتفك */}
      <RealPhoneAudio kind="mic" />

      <div className="grid gap-6 lg:grid-cols-[auto_1fr] items-start">
        {/* الهاتف المرسل */}
        <PhoneFrame
          name="Galaxy-S24 · الميكروفون"
          sub={micState.active ? micState.label || "يبث الصوت…" : "الميكروفون متوقف"}
          active={micState.active}
          screenClassName="grid place-items-center"
        >
          <div className="text-center px-4 w-full">
            <div className={cn("w-20 h-20 rounded-full mx-auto grid place-items-center mb-3 transition-all", micState.active ? "bg-teal-500/20" : "bg-zinc-800")}>
              {micState.active ? <Mic className="w-9 h-9 text-teal-400 animate-pulse" /> : <MicOff className="w-9 h-9 text-zinc-600" />}
            </div>
            {micState.active ? (
              <>
                <LevelBar level={mic.level} peak={mic.peak} className="mx-4" />
                <p className="text-[9px] text-white/60 mt-2 tabular-nums">
                  يبث للكمبيوتر · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
                </p>
              </>
            ) : (
              <p className="text-[10px] text-white/50">اضغط «بدء البث» لتحويل الهاتف لميكروفون</p>
            )}
          </div>
        </PhoneFrame>

        {/* استوديو الكمبيوتر */}
        <div className="space-y-4 w-full">
          <PcWindow
            title="Nexus Studio — استقبال الميكروفون اللاسلكي"
            headerExtra={
              micState.active ? (
                <Badge variant="outline" className="rounded-full text-[10px] gap-1">
                  <Activity className="w-3 h-3" /> {latency !== null ? `${latency}ms` : "WebRTC"}
                </Badge>
              ) : undefined
            }
          >
            <div className="relative bg-zinc-950 px-5 py-6">
              {micState.active ? (
                <>
                  {/* موجة صوتية حية */}
                  <div className="flex items-end justify-center gap-[3px] h-24 mb-5" dir="ltr">
                    {shownWave.map((v, i) => {
                      return (
                        <div
                          key={i}
                          className={cn("w-1.5 rounded-full transition-all duration-100", v >= 55 ? "bg-red-400" : v > 8 ? "bg-teal-400" : "bg-zinc-700")}
                          style={{ height: `${Math.max(6, v)}%` }}
                        />
                      )
                    })}
                  </div>
                  <div className="grid grid-cols-3 gap-3 max-w-md mx-auto text-center">
                    <div className="rounded-lg bg-zinc-900 border border-zinc-800 py-2">
                      <p className="text-[9px] text-zinc-500">RMS</p>
                      <p className="text-lg font-black tabular-nums text-teal-400">{mic.level}%</p>
                    </div>
                    <div className="rounded-lg bg-zinc-900 border border-zinc-800 py-2">
                      <p className="text-[9px] text-zinc-500">الذروة</p>
                      <p className="text-lg font-black tabular-nums text-amber-400">{mic.peak}%</p>
                    </div>
                    <div className="rounded-lg bg-zinc-900 border border-zinc-800 py-2">
                      <p className="text-[9px] text-zinc-500">الحالة</p>
                      <p className={cn("text-lg font-black tabular-nums", mic.level >= 55 ? "text-red-400" : "text-emerald-400")}>
                        {mic.level >= 55 ? "مرتفع" : mic.level > 5 ? "نشط" : "صامت"}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <NoStream text="ابدأ البث من الهاتف لعرض الموجة الصوتية الحية" />
              )}
            </div>
            <div className="border-t bg-muted/30 px-4 py-3 space-y-3">
              <div className="flex items-center gap-3">
                <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <Slider value={[mic.gain]} min={0} max={100} step={5} onValueChange={(v) => setMicGain(v[0])} className="flex-1" />
                <span className="text-[11px] tabular-nums w-9 text-end font-bold">{mic.gain}%</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="mic-monitor" checked={mic.monitor} onCheckedChange={toggleMonitor} />
                <Label htmlFor="mic-monitor" className="text-[11px] cursor-pointer flex items-center gap-1.5">
                  <Headphones className="w-3.5 h-3.5" /> مراقبة صوتية مباشرة (سماع ما يلتقطه الهاتف)
                </Label>
              </div>
            </div>
          </PcWindow>

          <div className="rounded-xl border bg-card p-3.5 flex items-start gap-2.5">
            <MonitorSpeaker className="w-4.5 h-4.5 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-bold text-foreground">نصيحة:</span> استخدم الهاتف كميكروفون في الاجتماعات أو التسجيل أو البث —
              الصوت ينتقل عبر قناة WebRTC مشفرة على شبكتك المحلية بتأخير منخفض، ويظهر في النظام
              كجهاز إدخال افتراضي «Nexus Wireless Mic» في النسخة المكتبية.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
