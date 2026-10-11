"use client"
// تبويب الويب كام — كاميرا الهاتف كويب كام للكمبيوتر + التحكم عن بُعد
// (تبديل أمامية/خلفية، فلاش، مؤقت تصوير عن بُعد مع معاينة حية)
// + تعريف الكاميرا الافتراضية + تطبيق مكالمة فيديو يستخدم كاميرا الهاتف
import { useEffect, useState } from "react"
import {
  RefreshCcw, Flashlight, Camera, Play, Square, Timer, Monitor, Link2, Unlink,
  PhoneCall, PhoneOff, Mic, MicOff, Video, Cpu, CheckCircle2, Layers,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useMedia } from "@/lib/media-store"
import { getCamSource } from "@/lib/media-engine"
import { shutterRequest, camCmd } from "@/lib/media-socket"
import { PhoneFrame, PcWindow, LiveVideo, NoStream, LiveBadge, StreamChip } from "./media-bits"
import { cn } from "@/lib/utils"

const CAMS = [
  { id: "galaxy-s24", label: "Galaxy-S24" },
  { id: "redmi-note13", label: "Redmi-Note13" },
  { id: "pc-office", label: "كاميرا PC" },
] as const

export function WebcamTab() {
  const cams = useMedia((s) => s.cams)
  const webcam = useMedia((s) => s.webcam)
  const webcamStream = useMedia((s) => s.webcamStream)
  const call = useMedia((s) => s.call)
  const shutter = useMedia((s) => s.shutter)
  const phoneOnline = useMedia((s) => s.phoneOnline)
  const realCam = useMedia((s) => s.realCam)
  const startCam = useMedia((s) => s.startCam)
  const stopCam = useMedia((s) => s.stopCam)
  const switchFacing = useMedia((s) => s.switchFacing)
  const toggleTorch = useMedia((s) => s.toggleTorch)
  const linkWebcam = useMedia((s) => s.linkWebcam)
  const unlinkWebcam = useMedia((s) => s.unlinkWebcam)
  const setWebcamAuto = useMedia((s) => s.setWebcamAuto)
  const startCall = useMedia((s) => s.startCall)
  const endCall = useMedia((s) => s.endCall)
  const toggleCallMute = useMedia((s) => s.toggleCallMute)
  const triggerShutter = useMedia((s) => s.triggerShutter)
  const [realFlash, setRealFlash] = useState(false)

  // مصدر الكاميرا الحي (من الهاب) — مزامنة غير متزامنة لتفادي cascading renders
  const [srcStream, setSrcStream] = useState<MediaStream | null>(null)
  const cam = cams["galaxy-s24"]
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSrcStream(cam.active ? getCamSource("galaxy-s24")?.stream ?? null : null)
    }, 0)
    return () => window.clearTimeout(t)
  }, [cam.active, cam.facing, cam.real])

  // مؤقت المكالمة
  const [callSecs, setCallSecs] = useState(0)
  useEffect(() => {
    if (!call.inCall) {
      const t = window.setTimeout(() => setCallSecs(0), 0)
      return () => window.clearTimeout(t)
    }
    const iv = window.setInterval(() => {
      setCallSecs(Math.floor((Date.now() - (call.startedAt ?? Date.now())) / 1000))
    }, 1000)
    return () => window.clearInterval(iv)
  }, [call.inCall, call.startedAt])

  // وميض الالتقاط
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!shutter.lastCapture) return
    if (Date.now() - shutter.lastCapture.at < 900) {
      const t = window.setTimeout(() => setFlash(true), 0)
      const to = window.setTimeout(() => setFlash(false), 500)
      return () => { window.clearTimeout(t); window.clearTimeout(to) }
    }
  }, [shutter.lastCapture])

  const live = webcam.status === "live"
  const linking = webcam.status === "linking"

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* ============ عمود الهاتف المصدر ============ */}
      <div className="space-y-3">
        <PhoneFrame
          name="Galaxy-S24 · الكاميرا"
          sub={cam.active ? cam.label : "الكاميرا متوقفة"}
          active={cam.active}
          hud={
            <>
              {flash && <div className="absolute inset-0 z-30 bg-white/90 transition-opacity" />}
              {shutter.counting !== null && (
                <div className="absolute inset-0 z-30 grid place-items-center bg-black/40">
                  <div className="text-center text-white">
                    <Timer className="w-6 h-6 mx-auto mb-1 animate-pulse" />
                    <div className="text-4xl font-black tabular-nums">{shutter.counting}</div>
                    <div className="text-[10px] opacity-80">تصوير عن بُعد من الكمبيوتر</div>
                  </div>
                </div>
              )}
              {cam.active && (
                <div className="absolute bottom-14 inset-x-0 z-20 flex items-center justify-center gap-2 pointer-events-none">
                  <span className="rounded-full bg-black/50 px-2 py-0.5 text-[9px] text-white backdrop-blur">
                    {cam.facing === "front" ? "أمامية" : "خلفية"} · {cam.real ? "عتاد حقيقي" : "محاكاة"}
                  </span>
                </div>
              )}
            </>
          }
          screenClassName={cn(!cam.active && "grid place-items-center")}
        >
          {cam.active ? (
            <LiveVideo stream={srcStream} mirror={cam.facing === "front"} />
          ) : (
            <div className="text-center px-4">
              <Camera className="w-8 h-8 mx-auto text-zinc-600 mb-2" />
              <p className="text-[10px] text-zinc-500">شغّل الكاميرا لبدء المعاينة الحية</p>
            </div>
          )}
        </PhoneFrame>

        {/* تحكم كاميرا الهاتف */}
        <div className="rounded-xl border bg-card p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            {cam.active ? (
              <Button variant="destructive" size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => void stopCam("galaxy-s24")}>
                <Square className="w-3.5 h-3.5" /> إيقاف
              </Button>
            ) : (
              <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => void startCam("galaxy-s24")}>
                <Play className="w-3.5 h-3.5" /> تشغيل
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8 rounded-lg text-[11px]" disabled={!cam.active} onClick={() => void switchFacing("galaxy-s24")}>
              <RefreshCcw className="w-3.5 h-3.5" /> {cam.facing === "front" ? "أمامية" : "خلفية"}
            </Button>
            <Button
              variant={cam.torch ? "default" : "outline"}
              size="sm"
              className="h-8 rounded-lg text-[11px]"
              disabled={!cam.active}
              onClick={() => void toggleTorch("galaxy-s24")}
              title={cam.real && !cam.torchSupported ? "الكشاف غير مدعوم في العتاد — تم تطبيق وميض بديل" : undefined}
            >
              <Flashlight className="w-3.5 h-3.5" /> فلاش
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-lg text-[11px]" disabled={!cam.active} onClick={() => void triggerShutter(0)}>
              <Camera className="w-3.5 h-3.5" /> التقاط
            </Button>
          </div>
          {/* مؤقت عن بُعد */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground shrink-0">مؤقت عن بُعد:</span>
            {[0, 3, 5, 10].map((t) => (
              <Button
                key={t}
                variant="outline"
                size="sm"
                className="h-7 flex-1 rounded-lg px-1 text-[10px]"
                disabled={!cam.active}
                onClick={() => {
                  void triggerShutter(t)
                  shutterRequest(t, false, "back") // يصل لهاتف حقيقي إن كان متصلاً
                }}
              >
                {t === 0 ? "الآن" : `${t}ث`}
              </Button>
            ))}
          </div>
          {shutter.lastCapture && (
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> آخر التقاط: {shutter.lastCapture.name} — حُفظ في DCIM/Camera
            </p>
          )}
        </div>

        {/* ===== FA-8: التحكم بالهاتف الحقيقي (WebRTC عبر جسر الوسائط) ===== */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", phoneOnline ? "bg-emerald-500 animate-pulse" : "bg-zinc-400")} />
            <p className="text-[11px] font-bold">هاتفك الحقيقي — بث WebRTC</p>
            {realCam?.active && (
              <Badge variant="default" className="rounded-full text-[9px] ms-auto">
                يبث {realCam.facing === "front" ? "أمامية" : "خلفية"}{realCam.watch ? " · مراقبة" : ""}
              </Badge>
            )}
          </div>
          {phoneOnline ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => camCmd("cam-start", { camera: "back" })}>
                <Play className="w-3.5 h-3.5" /> بث خلفية
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => camCmd("cam-start", { camera: "front" })}>
                <Play className="w-3.5 h-3.5" /> بث أمامية
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-lg text-[11px]" disabled={!realCam?.active} onClick={() => camCmd("switch")}>
                <RefreshCcw className="w-3.5 h-3.5" /> تبديل
              </Button>
              <Button
                variant={realCam?.torch ? "default" : "outline"}
                size="sm"
                className="h-8 rounded-lg text-[11px]"
                disabled={!realCam?.active}
                onClick={() => camCmd("torch", { on: !realCam?.torch })}
              >
                <Flashlight className="w-3.5 h-3.5" /> فلاش
              </Button>
              <Button variant="destructive" size="sm" className="h-8 rounded-lg text-[11px]" disabled={!realCam?.active} onClick={() => camCmd("cam-stop")}>
                <Square className="w-3.5 h-3.5" /> إيقاف البث
              </Button>
              <div className="flex items-center justify-center gap-1.5 rounded-lg border px-2">
                <Switch id="real-flash" checked={realFlash} onCheckedChange={setRealFlash} className="scale-90" />
                <Label htmlFor="real-flash" className="text-[10px] cursor-pointer">مصراع بفلاش</Label>
              </div>
              <Button
                size="sm"
                className="h-8 rounded-lg text-[11px] col-span-2"
                onClick={() => shutterRequest(0, realFlash, (realCam?.facing === "front" ? "front" : "back"))}
              >
                <Camera className="w-3.5 h-3.5" /> التقاط صورة من الهاتف {realFlash ? "(فلاش + كشاف)" : ""} — تصل كملف
              </Button>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              افتح تطبيق NexusLink على هاتفك واتصل بالخادم — ستظهر هنا أزرار البث المباشر، والبث نفسه يظهر في نافذة الكويب كام أعلاه.
            </p>
          )}
        </div>
      </div>

      {/* ============ عمود الكمبيوتر ============ */}
      <div className="space-y-4">
        {/* نافذة كويب كام */}
        <PcWindow
          title="Nexus Virtual Camera — كويب كام"
          headerExtra={
            live ? <LiveBadge mode={webcam.mode === "webrtc" ? "WebRTC" : "مباشر"} />
              : linking ? <Badge variant="secondary" className="rounded-full animate-pulse">جارٍ الربط…</Badge>
                : <Badge variant="outline" className="rounded-full">متوقف</Badge>
          }
        >
          <div className="relative aspect-video bg-zinc-950">
            {live && webcamStream ? (
              <LiveVideo stream={webcamStream} />
            ) : (
              <NoStream text={linking ? "جارٍ إنشاء قناة WebRTC…" : "شغّل كاميرا الهاتف ثم اضغط «ربط كويب كام»"} />
            )}
            {live && (
              <div className="absolute bottom-2 start-2 flex items-center gap-1.5">
                <StreamChip label={webcam.quality ?? ""} on />
                <StreamChip label={`${webcam.fps} fps`} on />
                {webcam.auto && <StreamChip label="اتصال تلقائي" on />}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-3 py-2.5">
            {live ? (
              <Button variant="destructive" size="sm" className="h-8 rounded-lg text-[11px]" onClick={unlinkWebcam}>
                <Unlink className="w-3.5 h-3.5" /> فصل الكويب كام
              </Button>
            ) : (
              <Button size="sm" className="h-8 rounded-lg text-[11px]" disabled={linking} onClick={() => void linkWebcam()}>
                <Link2 className="w-3.5 h-3.5" /> ربط كويب كام
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Switch id="auto-cam" checked={webcam.auto} onCheckedChange={setWebcamAuto} />
              <Label htmlFor="auto-cam" className="text-[11px] cursor-pointer">
                اتصال تلقائي — يعمل كبديل دائم عند توفر الكاميرا
              </Label>
            </div>
          </div>
        </PcWindow>

        <div className="grid gap-4 md:grid-cols-2">
          {/* تعريف الكاميرا الافتراضية */}
          <div className="rounded-xl border bg-card p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-[13px] font-bold">تعريف الكاميرا الافتراضية</h3>
                <p className="text-[10px] text-muted-foreground">Nexus Virtual Camera Driver v2.4</p>
              </div>
            </div>
            <div className="text-[11px] space-y-1.5 text-muted-foreground">
              <p className="flex justify-between"><span>الحالة</span>
                <Badge variant="outline" className={cn("rounded-full h-5 text-[10px]", live ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" : "")}>
                  {live ? "نشط — بث كامل" : "مسجل — بلا بث"}
                </Badge>
              </p>
              <p className="flex justify-between"><span>المصدر</span><span className="font-medium text-foreground">{live ? "Galaxy-S24 (كاميرا الهاتف)" : "—"}</span></p>
              <p className="flex justify-between"><span>النقل</span><span className="font-medium text-foreground">{live ? (webcam.mode === "webrtc" ? "WebRTC / DTLS" : "قناة محلية") : "—"}</span></p>
              <p className="text-[10px] leading-relaxed pt-1 border-t">
                في النسخة المكتبية (Tauri): v4l2loopback على لينكس و DirectShow على ويندوز —
                تظهر كاميرا الهاتف كويب كام نظامية لكل التطبيقات، وتُختار تلقائياً كبديل دائم.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[10px] text-muted-foreground w-full">التطبيقات المستهلكة:</span>
              <Badge variant={call.inCall ? "default" : "outline"} className="rounded-full text-[10px] gap-1">
                <Video className="w-3 h-3" /> تطبيق المكالمات
              </Badge>
              <Badge variant="outline" className="rounded-full text-[10px] gap-1"><Layers className="w-3 h-3" /> OBS</Badge>
              <Badge variant="outline" className="rounded-full text-[10px] gap-1"><Monitor className="w-3 h-3" /> المتصفح</Badge>
            </div>
          </div>

          {/* تطبيق مكالمة الفيديو — اختبار النجاح */}
          <PcWindow
            title="NexusMeet — مكالمة فيديو"
            headerExtra={call.inCall ? (
              <Badge className="rounded-full bg-emerald-500 hover:bg-emerald-500 text-white text-[10px]">
                {String(Math.floor(callSecs / 60)).padStart(2, "0")}:{String(callSecs % 60).padStart(2, "0")}
              </Badge>
            ) : undefined}
          >
            <div className="relative aspect-video bg-gradient-to-br from-zinc-900 to-zinc-800">
              {call.inCall && webcamStream ? (
                <>
                  <LiveVideo stream={webcamStream} />
                  <div className="absolute top-2 start-2 rounded-lg bg-black/55 backdrop-blur px-2.5 py-1.5 text-white">
                    <p className="text-[11px] font-bold">{call.contact}</p>
                    <p className="text-[9px] opacity-80 flex items-center gap-1">
                      <Video className="w-3 h-3" /> الكاميرا: كاميرا هاتفك عبر Nexus Virtual Camera
                    </p>
                  </div>
                  {call.micMuted && (
                    <div className="absolute top-2 end-2 rounded-full bg-red-500/90 px-2 py-1 text-[9px] text-white font-bold">
                      الميكروفون مكتوم
                    </div>
                  )}
                </>
              ) : (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center text-zinc-500 space-y-2">
                    <div className="w-16 h-16 rounded-full bg-zinc-700/60 grid place-items-center mx-auto text-2xl">📞</div>
                    <p className="text-[11px]">{webcam.status === "live" ? "جاهز — الكاميرا الافتراضية متاحة" : "شغّل الكويب كام أولاً لاستخدام كاميرا الهاتف في المكالمة"}</p>
                  </div>
                </div>
              )}
              {call.inCall && (
                <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-2">
                  <Button variant="secondary" size="icon" className="h-9 w-9 rounded-full" onClick={toggleCallMute} aria-label="كتم الميكروفون">
                    {call.micMuted ? <MicOff className="w-4 h-4 text-red-400" /> : <Mic className="w-4 h-4" />}
                  </Button>
                  <Button variant="destructive" size="sm" className="h-9 rounded-full px-4 text-[11px]" onClick={endCall}>
                    <PhoneOff className="w-3.5 h-3.5" /> إنهاء
                  </Button>
                </div>
              )}
            </div>
            <div className="border-t bg-muted/30 px-3 py-2.5 flex items-center gap-2">
              {!call.inCall ? (
                <Button size="sm" className="h-8 rounded-lg text-[11px]" disabled={webcam.status !== "live"} onClick={startCall}>
                  <PhoneCall className="w-3.5 h-3.5" /> بدء مكالمة بكاميرا الهاتف
                </Button>
              ) : (
                <p className="text-[10px] text-muted-foreground">المكالمة تجري الآن — البث من كاميرا Galaxy-S24 مباشرة</p>
              )}
            </div>
          </PcWindow>
        </div>

        {/* كاميرات الأجهزة الأخرى (تُستخدم في وضع المراقبة) */}
        <div className="rounded-xl border bg-card p-3">
          <p className="text-[11px] font-semibold mb-2 flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-primary" /> كاميرات أخرى على الشبكة (لمصادر المراقبة)
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CAMS.map((c) => {
              const st = cams[c.id]
              return (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
                  <span className={cn("h-2 w-2 rounded-full", st.active ? "bg-emerald-500" : "bg-zinc-400")} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium truncate">{c.label}</p>
                    <p className="text-[9px] text-muted-foreground truncate">{st.active ? (st.real ? "عتاد حقيقي" : "محاكاة") : "متوقفة"}</p>
                  </div>
                  {c.id !== "galaxy-s24" && (
                    st.active ? (
                      <Button variant="ghost" size="sm" className="h-6 ms-auto px-1.5 text-[10px] text-red-500" onClick={() => void stopCam(c.id)}>
                        إيقاف
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-6 ms-auto px-1.5 text-[10px] text-primary" onClick={() => void startCam(c.id)}>
                        تشغيل
                      </Button>
                    )
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
