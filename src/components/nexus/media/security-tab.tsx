"use client"
// وضع المراقبة (كاميرا أمنية) — بث من كاميرا أي جهاز إلى أي شاشة
// + تنبيه عند حركة عبر معالجة إطارات بسيطة (فروق لمعان — بدون AI)
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Shield, Play, Square, Radar, Camera, Tv, Monitor, AlertTriangle, Gauge,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { useMedia } from "@/lib/media-store"
import { MotionDetector } from "@/lib/media-engine"
import { secMotion, camCmd } from "@/lib/media-socket"
import { PcWindow, TvFrame, LiveVideo, NoStream, LiveBadge, LevelBar } from "./media-bits"
import { cn } from "@/lib/utils"

const SOURCES = [
  { id: "galaxy-s24", label: "Galaxy-S24 (خلفية)" },
  { id: "redmi-note13", label: "Redmi-Note13" },
  { id: "pc-office", label: "كاميرا PC" },
] as const

export function SecurityTab() {
  const sec = useMedia((s) => s.sec)
  const secStream = useMedia((s) => s.secStream)
  const allAlerts = useMedia((s) => s.alerts)
  const phoneOnline = useMedia((s) => s.phoneOnline)
  const realCam = useMedia((s) => s.realCam)
  const alerts = useMemo(() => allAlerts.filter((a) => a.kind === "motion").slice(0, 6), [allAlerts])
  const startSecurity = useMedia((s) => s.startSecurity)
  const stopSecurity = useMedia((s) => s.stopSecurity)
  const setSecSource = useMedia((s) => s.setSecSource)
  const setSecViewer = useMedia((s) => s.setSecViewer)
  const setSensitivity = useMedia((s) => s.setSensitivity)

  // عنصر معالجة مخفي + كاشف الحركة
  const procRef = useRef<HTMLVideoElement>(null)
  const [uptime, setUptime] = useState(0)

  useEffect(() => {
    const el = procRef.current
    if (!sec.enabled || !secStream || !el) return
    el.srcObject = secStream
    void el.play().catch(() => { /* ignore */ })
    let detector: MotionDetector | null = null
    try {
      detector = new MotionDetector()
      detector.start(el, sec.sensitivity, (level, pct) => {
        useMedia.getState().bumpMotion(level, pct)
        if (level >= 15) secMotion(useMedia.getState().sec.source, level)
      })
    } catch { /* ignore */ }
    return () => {
      detector?.stop()
      el.srcObject = null
    }
  }, [sec.enabled, secStream, sec.sensitivity])

  // مؤقت مدة الحرس
  useEffect(() => {
    if (!sec.enabled) {
      const t = window.setTimeout(() => setUptime(0), 0)
      return () => window.clearTimeout(t)
    }
    const start = Date.now()
    const iv = window.setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(iv)
  }, [sec.enabled])

  const motionTone = sec.level >= 30 ? "red" : sec.level >= 12 ? "amber" : "teal"

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* ===== منطقة العرض ===== */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="me-auto">
            <h3 className="text-[15px] font-bold flex items-center gap-2">
              <Shield className="w-4.5 h-4.5 text-primary" /> وضع المراقبة — كاميرا أمنية
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              بث مستمر من كاميرا أي جهاز + كشف حركة بمعالجة إطارات بسيطة (فروق لمعان — بدون AI)
            </p>
          </div>
          {sec.enabled
            ? <Button variant="destructive" size="sm" className="h-8 rounded-lg text-[11px]" onClick={stopSecurity}><Square className="w-3.5 h-3.5" /> إيقاف الحرس</Button>
            : <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => void startSecurity()}><Play className="w-3.5 h-3.5" /> بدء الحرس</Button>}
          {sec.enabled && (
            <Badge className="rounded-full bg-red-500 hover:bg-red-500 text-white gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> حرس فعال
              <span className="tabular-nums opacity-90">· {Math.floor(uptime / 60)}:{String(uptime % 60).padStart(2, "0")}</span>
            </Badge>
          )}
        </div>

        {/* مصادر + شاشة العرض */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">المصدر:</span>
          {SOURCES.map((s) => (
            <Button
              key={s.id}
              variant={sec.source === s.id ? "default" : "outline"}
              size="sm"
              className="h-7 rounded-lg text-[11px]"
              onClick={() => void setSecSource(s.id)}
            >
              <Camera className="w-3 h-3" /> {s.label}
            </Button>
          ))}
          <span className="text-[11px] text-muted-foreground ms-2">الشاشة:</span>
          <Button variant={sec.viewer === "pc" ? "default" : "outline"} size="sm" className="h-7 rounded-lg text-[11px]" onClick={() => setSecViewer("pc")}>
            <Monitor className="w-3 h-3" /> الكمبيوتر
          </Button>
          <Button variant={sec.viewer === "tv" ? "default" : "outline"} size="sm" className="h-7 rounded-lg text-[11px]" onClick={() => setSecViewer("tv")}>
            <Tv className="w-3 h-3" /> Nexus-TV
          </Button>
        </div>

        {sec.viewer === "tv" ? (
          <TvFrame>
            <div className="relative w-full h-full">
              {sec.enabled && secStream ? (
                <LiveVideo stream={secStream} />
              ) : (
                <NoStream text="بدء الحرس لعرض البث الأمني على التلفاز" />
              )}
              {sec.enabled && (
                <div className="absolute top-2 start-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" /> SEC-CAM · {SOURCES.find((s) => s.id === sec.source)?.label}
                </div>
              )}
            </div>
          </TvFrame>
        ) : (
          <PcWindow
            title="Nexus Guard — مركز المراقبة"
            headerExtra={sec.enabled ? <LiveBadge mode="SEC" /> : <Badge variant="outline" className="rounded-full text-[10px]">خارج الخدمة</Badge>}
          >
            <div className="relative aspect-video bg-zinc-950">
              {sec.enabled && secStream ? (
                <>
                  <LiveVideo stream={secStream} />
                  {/* شبكة الكشف: تراكب بصري خفيف */}
                  <div
                    className="absolute inset-0 pointer-events-none opacity-25"
                    style={{
                      backgroundImage: "linear-gradient(rgba(255,255,255,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.12) 1px, transparent 1px)",
                      backgroundSize: "12.5% 25%",
                    }}
                  />
                  {sec.level >= 15 && (
                    <div className="absolute inset-0 border-4 border-red-500 animate-pulse pointer-events-none" />
                  )}
                </>
              ) : (
                <NoStream text="بدء الحرس لعرض البث الأمني على الكمبيوتر" />
              )}
            </div>
          </PcWindow>
        )}

        {/* فيديو المعالجة المخفي (يغذي كاشف الحركة) */}
        <video ref={procRef} playsInline muted className="pointer-events-none fixed opacity-0 w-px h-px -z-10" aria-hidden />
      </div>

      {/* ===== لوحة الكشف ===== */}
      <div className="space-y-4">
        {/* FA-8: مراقبة الهاتف الحقيقي */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2.5">
          <h4 className="text-[13px] font-bold flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", phoneOnline ? "bg-emerald-500 animate-pulse" : "bg-zinc-400")} />
            هاتفك الحقيقي — وضع المراقبة
            {realCam?.watch && <Badge className="rounded-full bg-red-500 text-white text-[9px]">يراقب الآن</Badge>}
          </h4>
          {phoneOnline ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" className="h-8 rounded-lg text-[11px]" disabled={realCam?.watch === true} onClick={() => camCmd("watch-start", { sensitivity: 0.5 })}>
                  <Radar className="w-3.5 h-3.5" /> بدء المراقبة
                </Button>
                <Button variant="destructive" size="sm" className="h-8 rounded-lg text-[11px]" disabled={realCam?.watch !== true} onClick={() => camCmd("watch-stop")}>
                  <Square className="w-3.5 h-3.5" /> إيقاف
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                يبث الهاتف كاميراته باستمرار عبر WebRTC (شاهدها في تبويب «ويب كام»)، وكشف الحركة يجري على الهاتف نفسه بفروق الإطارات —
                كل حركة تصل هنا كتنبيه فوري في السجل أدناه.
              </p>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">افتح تطبيق NexusLink على الهاتف لتفعيل مراقبة حقيقية بكاميراته.</p>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h4 className="text-[13px] font-bold flex items-center gap-2">
            <Radar className="w-4 h-4 text-primary" /> كاشف الحركة
            <Badge variant="outline" className="rounded-full text-[9px] ms-auto">قواعدي · بدون AI</Badge>
          </h4>
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-muted-foreground">مستوى النشاط الحالي</span>
              <span className={cn("font-bold tabular-nums", sec.level >= 35 ? "text-red-500" : sec.level >= 15 ? "text-amber-500" : "text-emerald-500")}>
                {sec.level}%
              </span>
            </div>
            <LevelBar level={sec.level} peak={Math.max(sec.level, sec.pct)} tone={motionTone} />
            <p className="text-[9.5px] text-muted-foreground mt-1">
              تغيّر {sec.pct.toFixed(1)}% من إطار المعاينة (شبكة 80×45، 5 إطارات/ث)
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground flex items-center gap-1"><Gauge className="w-3 h-3" /> الحساسية</span>
              <span className="font-bold">{sec.sensitivity}/10</span>
            </div>
            <Slider value={[sec.sensitivity]} min={1} max={10} step={1} onValueChange={(v) => setSensitivity(v[0])} />
            <p className="text-[9.5px] text-muted-foreground">حساسية أعلى = رصد حركة أدق (عتبة فرق لمعان أقل)</p>
          </div>
        </div>

        {/* سجل تنبيهات الحركة */}
        <div className="rounded-xl border bg-card p-4">
          <h4 className="text-[13px] font-bold flex items-center gap-2 mb-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> تنبيهات الحركة
            {alerts.length > 0 && <Badge className="rounded-full bg-amber-500 text-white text-[10px]">{alerts.length}</Badge>}
          </h4>
          {alerts.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-3 text-center">
              {sec.enabled ? "لا حركة بعد — المراقبة جارية…" : "شغّل الحرس لبدء الرصد"}
            </p>
          ) : (
            <ul className="space-y-2 max-h-52 overflow-y-auto pe-1">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-snug">{a.text}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5 tabular-nums">
                      {new Date(a.at).toLocaleTimeString("ar")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
