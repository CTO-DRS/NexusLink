"use client"
// NexusLink — صفحة الهاتف الحقيقي (المرحلة 7)
// يصبح هاتفك فعلياً: كاميرا ويب للكمبيوتر + ميكروفون لاسلكي + غرفة مراقبة أطفال
// + جهاز تحكم بالبث وعرض الشرائح — عبر جسر الوسائط (Nexus Protocol)
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  Video, Mic, Baby, Gamepad2, Camera, Flashlight, RefreshCcw, ArrowLeft,
  Play, Pause, SkipForward, SkipBack, Images, Cast, Link2, Square, Loader2, ShieldCheck, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getMediaSocket, mediaRole, rtcSignal, slideshowCmd, castCmd } from "@/lib/media-socket"
import { blobToDataUrl } from "@/lib/media-engine"
import { usePhoneGuard, GuardPhoneTab, GuardOverlays } from "@/components/nexus/guard/phone-guard"
import { PhoneProdTab } from "@/components/nexus/prod/phone-prod"
import { cn } from "@/lib/utils"

type PhoneTab = "cam" | "mic" | "baby" | "remote" | "guard" | "prod"

export default function PhonePage() {
  const [tab, setTab] = useState<PhoneTab>("cam")
  // وحدة الحماية: منارة القرب + الرن + الفقدان + المسح (المرحلة 8)
  const guard = usePhoneGuard()
  const [online, setOnline] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [facing, setFacing] = useState<"back" | "front">("back")
  const [torch, setTorch] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [babyOn, setBabyOn] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [status, setStatus] = useState("جارٍ الاتصال بالجسر…")
  const [err, setErr] = useState("")

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)

  // ==== التقاط صورة (زر محلي أو أمر عن بُعد) ====
  async function remoteShutter(timer: number) {
    const capture = async () => {
      const v = videoRef.current
      if (!v || !camOn) { setStatus("الكاميرا غير مفتوحة — افتحها أولاً"); return }
      const c = document.createElement("canvas")
      c.width = Math.min(v.videoWidth || 1280, 1280)
      c.height = Math.round((v.videoHeight || 720) * (c.width / (v.videoWidth || 1280)))
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height)
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9))
      if (!blob) return
      try {
        const dataUrl = await blobToDataUrl(blob)
        const r = await fetch("/api/media/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device: "galaxy-s24", dir: "DCIM/Camera", dataUrl }),
        })
        const j = await r.json()
        if (j.ok) setStatus(`صورتك وصلت الكمبيوتر: ${j.name}`)
        else setErr("فشل رفع الصورة")
      } catch { setErr("فشل رفع الصورة") }
    }
    if (timer > 0) {
      let left = timer
      setCountdown(left)
      const iv = window.setInterval(() => {
        left -= 1
        if (left <= 0) {
          window.clearInterval(iv)
          setCountdown(null)
          void capture()
        } else setCountdown(left)
      }, 1000)
    } else void capture()
  }

  // ==== الاتصال بالجسر + استقبال مصراع عن بُعد ====
  useEffect(() => {
    fetch("/api/media/boot").catch(() => { /* ignore */ })
    const socket = getMediaSocket()
    socket.on("connect", () => {
      setOnline(true)
      setStatus("متصل بجسر الوسائط — جاهز للبث")
      mediaRole("phone", "هاتف Nexus")
    })
    socket.on("disconnect", () => { setOnline(false); setStatus("انقطع الاتصال — إعادة المحاولة…") })

    // مصراع عن بُعد من الكمبيوتر
    socket.on("cam:shutter", (d: { timer: number }) => remoteShutter(d?.timer ?? 0))
    socket.on("cam:captured", (d: { name?: string }) => {
      setStatus(`التقطت للتو: ${d?.name ?? "صورة"} — حُفظت في المعرض`)
    })

    // إجابات WebRTC من الكمبيوتر
    socket.on("rtc:answer", (d: { kind?: string; sdp?: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current
      if (pc && d?.sdp) void pc.setRemoteDescription(d.sdp).catch(() => { /* ignore */ })
    })
    socket.on("rtc:ice", (d: { candidate?: RTCIceCandidateInit }) => {
      const pc = pcRef.current
      if (pc && d?.candidate) void pc.addIceCandidate(d.candidate).catch(() => { /* ignore */ })
    })

    return () => { socket.off() }
  }, [])

  // ==== فتح الكاميرا ====
  async function openCam(f: "back" | "front" = facing) {
    setErr("")
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: f === "front" ? "user" : "environment", width: { ideal: 1280 } },
        audio: false,
      })
      streamRef.current = s
      if (videoRef.current) {
        videoRef.current.srcObject = s
        void videoRef.current.play().catch(() => { /* ignore */ })
      }
      setCamOn(true)
      setStatus(`الكاميرا تعمل (${f === "front" ? "أمامية" : "خلفية"}) — ${s.getVideoTracks()[0]?.label || "متصلة"}`)
    } catch (e) {
      setErr("تعذر فتح الكاميرا — تحقق من الإذن")
    }
  }

  function closeCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamOn(false)
    setTorch(false)
    setStatus("الكاميرا متوقفة")
  }

  async function switchFacing() {
    const f = facing === "back" ? "front" : "back"
    setFacing(f)
    if (camOn) await openCam(f)
  }

  async function toggleTorch() {
    const vt = streamRef.current?.getVideoTracks()[0]
    if (!vt) return
    const next = !torch
    try {
      await vt.applyConstraints({ advanced: [{ torch: next } as never] })
      setTorch(next)
      setStatus(next ? "الفلاش (كشاف) يعمل" : "أُطفئ الفلاش")
    } catch {
      setErr("هذا الجهاز لا يدعم الكشاف برمجياً")
    }
  }

  // ==== بث WebRTC إلى الكمبيوتر (كاميرا أو ميكروفون) ====
  async function startRtcStream(kind: "cam" | "mic" | "baby", stream: MediaStream) {
    try {
      const pc = new RTCPeerConnection()
      pcRef.current = pc
      pc.onicecandidate = (e) => {
        if (e.candidate) rtcSignal("rtc:ice", kind, { candidate: e.candidate.toJSON() })
      }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      rtcSignal("rtc:offer", kind, { sdp: pc.localDescription })
      setStreaming(true)
      setStatus(kind === "cam" ? "الكاميرا تُبث الآن للكمبيوتر كويب كام" : kind === "mic" ? "الميكروفون يبث للكمبيوتر" : "الصوت يبث لمراقبة الأطفال")
    } catch {
      setErr("فشل إنشاء قناة WebRTC")
    }
  }

  async function toggleStreamCam() {
    if (streaming) {
      pcRef.current?.close()
      pcRef.current = null
      setStreaming(false)
      setStatus("توقف البث")
      return
    }
    if (!camOn) await openCam()
    if (streamRef.current) await startRtcStream("cam", streamRef.current)
  }

  const micStreamRef = useRef<MediaStream | null>(null)
  async function toggleMic(kind: "mic" | "baby") {
    const isOn = kind === "mic" ? micOn : babyOn
    if (isOn) {
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
      pcRef.current?.close()
      pcRef.current = null
      if (kind === "mic") setMicOn(false); else setBabyOn(false)
      setStatus("توقف البث")
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      micStreamRef.current = s
      await startRtcStream(kind, s)
      if (kind === "mic") setMicOn(true); else setBabyOn(true)
    } catch {
      setErr("تعذر فتح الميكروفون — تحقق من الإذن")
    }
  }

  const TABS: { id: PhoneTab; label: string; icon: typeof Video }[] = [
    { id: "cam", label: "كاميرا", icon: Video },
    { id: "mic", label: "ميكروفون", icon: Mic },
    { id: "baby", label: "غرفة طفل", icon: Baby },
    { id: "remote", label: "ريموت", icon: Gamepad2 },
    { id: "guard", label: "حماية", icon: ShieldCheck },
    { id: "prod", label: "إنتاجية", icon: Zap },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 text-white pb-24">
      {/* الترويسة */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-black/70 border-b border-white/10">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-2.5">
          <Link href="/" className="w-9 h-9 rounded-xl bg-white/10 grid place-items-center" aria-label="عودة للتطبيق">
            <ArrowLeft className="w-4.5 h-4.5" />
          </Link>
          <div className="leading-tight me-auto">
            <div className="font-bold text-[15px]">NexusLink · هاتف الوسائط</div>
            <div className="text-[10px] text-white/50">{status}</div>
          </div>
          <Badge variant={online ? "default" : "destructive"} className="rounded-full gap-1 text-[10px]">
            <Link2 className="w-3 h-3" /> {online ? "متصل" : "منقطع"}
          </Badge>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-4 space-y-4">
        {err && (
          <div className="rounded-xl bg-red-500/15 border border-red-500/40 px-3 py-2.5 text-[12px] text-red-300">
            {err}
          </div>
        )}

        {/* ==== كاميرا ==== */}
        {tab === "cam" && (
          <div className="space-y-3">
            <div className="relative rounded-3xl overflow-hidden border-4 border-white/10 bg-black aspect-[3/4]">
              <video ref={videoRef} playsInline muted className="h-full w-full object-cover" style={{ transform: facing === "front" ? "scaleX(-1)" : undefined }} />
              {!camOn && (
                <div className="absolute inset-0 grid place-items-center text-white/50">
                  <div className="text-center">
                    <Camera className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-[12px]">اضغط «فتح الكاميرا» للبدء</p>
                  </div>
                </div>
              )}
              {countdown !== null && (
                <div className="absolute inset-0 grid place-items-center bg-black/50">
                  <div className="text-7xl font-black text-white animate-ping">{countdown}</div>
                </div>
              )}
              {streaming && camOn && (
                <div className="absolute top-3 start-3 flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-bold">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> تُبث كويب كام للكمبيوتر
                </div>
              )}
              {torch && (
                <div className="absolute top-3 end-3 rounded-full bg-amber-400 text-black px-2 py-1 text-[10px] font-bold">فلاش</div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Button variant="secondary" className="h-12 rounded-2xl flex-col gap-1 text-[10px]" onClick={() => (camOn ? closeCam() : void openCam())}>
                {camOn ? <Square className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                {camOn ? "إيقاف" : "فتح"}
              </Button>
              <Button variant="secondary" className="h-12 rounded-2xl flex-col gap-1 text-[10px]" onClick={() => void switchFacing()}>
                <RefreshCcw className="w-4 h-4" /> {facing === "back" ? "خلفية" : "أمامية"}
              </Button>
              <Button variant={torch ? "default" : "secondary"} className="h-12 rounded-2xl flex-col gap-1 text-[10px]" onClick={() => void toggleTorch()}>
                <Flashlight className="w-4 h-4" /> فلاش
              </Button>
              <Button variant={streaming ? "default" : "secondary"} className={cn("h-12 rounded-2xl flex-col gap-1 text-[10px]", streaming && "bg-teal-600 hover:bg-teal-700")} onClick={() => void toggleStreamCam()}>
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cast className="w-4 h-4" />}
                {streaming ? "يبث" : "بثّ"}
              </Button>
            </div>

            <Button className="w-full h-14 rounded-2xl text-[14px] font-bold gap-2" onClick={() => void remoteShutter(0)}>
              <Camera className="w-5 h-5" /> التقط الآن — تصل الصورة لمعرض الكمبيوتر
            </Button>
          </div>
        )}

        {/* ==== ميكروفون ==== */}
        {tab === "mic" && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center space-y-4">
            <div className={cn("w-24 h-24 rounded-full mx-auto grid place-items-center", micOn ? "bg-teal-500/25" : "bg-white/10")}>
              <Mic className={cn("w-11 h-11", micOn ? "text-teal-400 animate-pulse" : "text-white/60")} />
            </div>
            <div>
              <h2 className="font-bold text-[15px]">ميكروفون لاسلكي للكمبيوتر</h2>
              <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
                حوّل هاتفك إلى ميكروفون لاسلكي — يتحدث الكمبيوتر بصوتك عبر WebRTC فوراً
              </p>
            </div>
            <Button
              className={cn("w-full h-12 rounded-2xl font-bold", micOn ? "bg-red-500 hover:bg-red-600" : "bg-teal-600 hover:bg-teal-700")}
              onClick={() => void toggleMic("mic")}
            >
              {micOn ? "قطع البث" : "ابدأ البث للكمبيوتر"}
            </Button>
          </div>
        )}

        {/* ==== غرفة طفل ==== */}
        {tab === "baby" && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center space-y-4">
            <div className={cn("w-24 h-24 rounded-full mx-auto grid place-items-center", babyOn ? "bg-teal-500/25" : "bg-white/10")}>
              <Baby className={cn("w-11 h-11", babyOn ? "text-teal-400 animate-pulse" : "text-white/60")} />
            </div>
            <div>
              <h2 className="font-bold text-[15px]">وضع غرفة الطفل</h2>
              <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
                ضع الهاتف في غرفة الطفل — سيصل صوته باستمرار للجهاز المستقبِر مع تنبيه عند البكاء
              </p>
            </div>
            <Button
              className={cn("w-full h-12 rounded-2xl font-bold", babyOn ? "bg-red-500 hover:bg-red-600" : "bg-teal-600 hover:bg-teal-700")}
              onClick={() => void toggleMic("baby")}
            >
              {babyOn ? "إنهاء البث الدائم" : "ابدأ البث الدائم"}
            </Button>
          </div>
        )}

        {/* ==== ريموت ==== */}
        {tab === "remote" && (
          <div className="space-y-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
              <h2 className="font-bold text-[14px] flex items-center gap-2"><Images className="w-4 h-4 text-teal-400" /> عرض الشرائح على الشاشة الكبيرة</h2>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="secondary" className="h-12 rounded-2xl flex-col gap-1 text-[10px]" onClick={() => slideshowCmd({ action: "prev" })}>
                  <SkipBack className="w-4 h-4" /> السابقة
                </Button>
                <Button variant="secondary" className="h-12 rounded-2xl flex-col gap-1 text-[10px]" onClick={() => slideshowCmd({ action: "toggle" })}>
                  <Play className="w-4 h-4" /> تشغيل/وقف
                </Button>
                <Button variant="secondary" className="h-12 rounded-2xl flex-col gap-1 text-[10px]" onClick={() => slideshowCmd({ action: "next" })}>
                  <SkipForward className="w-4 h-4" /> التالية
                </Button>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
              <h2 className="font-bold text-[14px] flex items-center gap-2"><Cast className="w-4 h-4 text-teal-400" /> تحكم البث</h2>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="secondary" className="h-12 rounded-2xl flex-col gap-1 text-[10px]" onClick={() => castCmd({ action: "toggle" })}>
                  <Play className="w-4 h-4" /> تشغيل/وقف
                </Button>
                <Button variant="secondary" className="h-12 rounded-2xl flex-col gap-1 text-[10px]" onClick={() => castCmd({ action: "mute" })}>
                  <Mic className="w-4 h-4" /> كتم
                </Button>
                <Button variant="secondary" className="h-12 rounded-2xl flex-col gap-1 text-[10px] text-red-300" onClick={() => castCmd({ action: "stop" })}>
                  <Square className="w-4 h-4" /> إنهاء
                </Button>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
              <h2 className="font-bold text-[14px] flex items-center gap-2"><Camera className="w-4 h-4 text-teal-400" /> مصراع عن بُعد</h2>
              <div className="grid grid-cols-4 gap-2">
                {[0, 3, 5, 10].map((t) => (
                  <Button key={t} variant="secondary" className="h-12 rounded-2xl text-[11px] font-bold" onClick={() => void remoteShutter(t)}>
                    {t === 0 ? "الآن" : `${t}ث`}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-white/40">التقط من هنا أو دع الكمبيوتر يطلق المصّراع عليك</p>
            </div>
          </div>
        )}

        {/* ==== حماية ==== */}
        {tab === "guard" && <GuardPhoneTab guard={guard} />}

        {/* ==== إنتاجية ==== */}
        {tab === "prod" && <PhoneProdTab />}
      </main>

      {/* طبقات الحماية ملء الشاشة: رن / فقدان / مسح / إضاءة */}
      <GuardOverlays guard={guard} />

      {/* شريط تبويبات سفلي */}
      <nav className="fixed bottom-3 inset-x-0 z-50 flex justify-center px-2" aria-label="تبويبات الهاتف">
        <div className="flex items-center gap-1 rounded-3xl border border-white/10 bg-black/80 backdrop-blur-xl px-1.5 py-1.5 shadow-2xl">
          {TABS.map((t) => {
            const active = tab === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-2xl px-4 py-2 text-[10px] font-semibold transition-all",
                  active ? "bg-teal-600 text-white" : "text-white/50"
                )}
              >
                <Icon className="w-5 h-5" />
                {t.label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
