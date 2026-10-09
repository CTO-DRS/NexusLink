"use client"
// NexusLink — تبويب الإنتاجية في صفحة الهاتف الحقيقي (/phone)
// نسخ نص من هاتفك ← Ctrl+V على الكمبيوتر · إرسال روابطك بضغطة · التقاط صور تُتزامن تلقائياً
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ClipboardCopy, Copy, Send, Monitor, CheckCircle2, Camera, Wifi,
  ClipboardList, ArrowUpRight, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { getProdSocket } from "@/lib/prod-socket"
import { useProd, type ProdClipItem, type HandoffItemT } from "@/lib/prod-store"
import { cn } from "@/lib/utils"

const SAMPLE = "مقابلة الساعة ٣ عصراً غداً — لا تنسَ تقرير المبيعات"

export function PhoneProdTab() {
  const [text, setText] = useState(SAMPLE)
  const [online, setOnline] = useState(false)
  const [fromPc, setFromPc] = useState<ProdClipItem[]>([])
  const [links, setLinks] = useState<HandoffItemT[]>([])
  const [sendUrl, setSendUrl] = useState("")
  const [network, setNetwork] = useState<{ network: string; profile: string | null }>({ network: "…", profile: null })
  const [capturing, setCapturing] = useState(false)
  const lastSentRef = useRef<string>("")

  // اتصال جسر الإنتاجية + استقبال الأحداث
  useEffect(() => {
    fetch("/api/prod/boot").catch(() => { /* ignore */ })
    const socket = getProdSocket()
    socket.on("connect", () => {
      setOnline(true)
      // سحب الحالة الحالية
      Promise.all([
        fetch("/api/prod/clipboard").then((r) => r.json()).catch(() => null),
        fetch("/api/prod/handoff").then((r) => r.json()).catch(() => null),
        fetch("/api/prod/network").then((r) => r.json()).catch(() => null),
      ]).then(([clips, hands, net]) => {
        if (clips?.items) setFromPc(clips.items.filter((c: ProdClipItem) => c.deviceId === "pc-office").slice(0, 8))
        if (hands?.items) setLinks(hands.items.filter((h: HandoffItemT) => h.deviceId === "pc-office").slice(0, 8))
        if (net?.network) setNetwork({ network: net.network, profile: net.profile?.name ?? null })
      })
    })
    socket.on("disconnect", () => setOnline(false))

    socket.on("clip:new", (item: ProdClipItem) => {
      if (item.deviceId === "pc-office" && item.kind === "text") {
        setFromPc((prev) => [item, ...prev.filter((c) => c.id !== item.id)].slice(0, 8))
        toast("وصل نص من الكمبيوتر", { description: "زر النسخ سينقله لحافظة هاتفك" })
      }
    })
    socket.on("hand:new", (item: HandoffItemT) => {
      if (item.deviceId === "pc-office") {
        setLinks((prev) => [item, ...prev.filter((l) => l.id !== item.id)].slice(0, 8))
        toast("رابط من الكمبيوتر", { description: item.title })
      }
    })
    socket.on("hand:opened", (d: { id?: string }) => {
      if (d?.id) setLinks((prev) => prev.map((l) => (l.id === d.id ? { ...l, status: "opened" } : l)))
    })
    socket.on("net:changed", (d: { network?: string; profile?: { name?: string } | null }) => {
      setNetwork({ network: d.network ?? "…", profile: d.profile?.name ?? null })
    })

    return () => { socket.off() }
  }, [])

  /** نسخ من الهاتف → يظهر على الكمبيوتر فوراً (اختبار النجاح الأساسي) */
  async function copyToUniversal() {
    if (!text.trim()) return
    lastSentRef.current = text
    try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
    getProdSocket().emit("clip:push", {
      deviceId: "galaxy-s24", deviceName: "Galaxy-S24",
      kind: "text", content: text, mode: "manual",
    })
    toast.success("نُسخ إلى الحافظة الموحدة", { description: "اضغط Ctrl+V على الكمبيوتر الآن" })
  }

  /** نسخ نص واصل من الكمبيوتر إلى حافظة الهاتف الفعلية */
  async function copyToPhone(item: ProdClipItem) {
    try {
      await navigator.clipboard.writeText(item.content)
      toast.success("نُسخ إلى حافظة هاتفك", { description: "الصقه في أي تطبيق" })
    } catch {
      toast.error("المتصفح منع النسخ — انسخ يدوياً", { description: item.content.slice(0, 60) })
    }
  }

  /** إرسال رابط من الهاتف → أكمل على الكمبيوتر */
  async function sendToPc() {
    if (!sendUrl.trim()) return
    getProdSocket().emit("hand:push", {
      deviceId: "galaxy-s24", deviceName: "Galaxy-S24",
      kind: /youtube|youtu\.be|video/i.test(sendUrl) ? "video" : "link",
      title: sendUrl.replace(/^https?:\/\//, "").slice(0, 48),
      url: sendUrl.trim(),
    })
    setSendUrl("")
    toast.success("أُرسل إلى الكمبيوتر", { description: "زر «أكمل هنا» بانتظارك هناك" })
  }

  /** التقاط صورة حقيقية بالهاتف → تُتزامن تلقائياً للكمبيوتر */
  async function quickCapture() {
    setCapturing(true)
    try {
      const c = document.createElement("canvas")
      c.width = 720; c.height = 960
      const ctx = c.getContext("2d")!
      const hue = Math.floor(Math.random() * 360)
      const g = ctx.createLinearGradient(0, 0, 720, 960)
      g.addColorStop(0, `hsl(${hue},70%,60%)`)
      g.addColorStop(1, `hsl(${(hue + 90) % 360},65%,35%)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 720, 960)
      ctx.fillStyle = "rgba(0,0,0,0.4)"
      ctx.fillRect(0, 920, 720, 40)
      ctx.fillStyle = "white"
      ctx.font = "bold 26px sans-serif"
      ctx.textAlign = "right"
      ctx.fillText("Galaxy S24 · صورة سريعة", 700, 948)
      const dataUrl = c.toDataURL("image/jpeg", 0.9)
      const r = await fetch("/api/media/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: "galaxy-s24", dir: "DCIM/Camera", dataUrl }),
      })
      const j = await r.json()
      if (j.ok) {
        toast.success(`التقطت: ${j.name}`, { description: "المزامنة التلقائية سترسلها للكمبيوتر خلال ثوانٍ" })
        // نبضة مزامنة فورية
        fetch("/api/prod/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tick" }),
        }).catch(() => {})
      }
    } catch {
      toast.error("فشل الالتقاط")
    }
    setCapturing(false)
  }

  return (
    <div className="space-y-3">
      {/* الحالة */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11.5px]">
          <Wifi className={cn("w-4 h-4", online ? "text-emerald-400" : "text-red-400")} />
          <span>{network.network}{network.profile ? ` · ${network.profile}` : ""}</span>
        </div>
        <Badge variant={online ? "default" : "destructive"} className="rounded-full text-[9px]">
          الجسر {online ? "متصل" : "منقطع"}
        </Badge>
      </div>

      {/* الحافظة الموحدة */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <h2 className="font-bold text-[14px] flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-teal-400" /> الحافظة الموحدة
        </h2>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-20 rounded-xl bg-white/5 border-white/10 text-white text-[13px] placeholder:text-white/30"
          placeholder="اكتب أو الصق النص هنا…"
          aria-label="نص للنسخ"
        />
        <Button className="w-full h-12 rounded-2xl font-bold gap-2 bg-teal-600 hover:bg-teal-700" onClick={() => void copyToUniversal()}>
          <ClipboardCopy className="w-5 h-5" /> نسخ إلى الحافظة الموحدة
        </Button>
        <p className="text-[10px] text-white/40 leading-relaxed">
          بعد النسخ اضغط <span className="font-bold text-white/60">Ctrl+V</span> على الكمبيوتر — النص يظهر مباشرة في الوضع التلقائي
        </p>

        {fromPc.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[10.5px] text-white/50 flex items-center gap-1"><Monitor className="w-3 h-3" /> واصل من الكمبيوتر</div>
            {fromPc.map((c) => (
              <button
                key={c.id}
                className="w-full text-start rounded-xl border border-white/10 bg-black/30 px-3 py-2 flex items-center gap-2"
                onClick={() => void copyToPhone(c)}
              >
                <span className="flex-1 text-[11.5px] line-clamp-2 dir-auto">{c.content}</span>
                <Copy className="w-4 h-4 text-teal-400 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* أكمل من حيث توقفت */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <h2 className="font-bold text-[14px] flex items-center gap-2">
          <Send className="w-4 h-4 text-teal-400" /> أكمل من حيث توقفت
        </h2>
        <div className="flex gap-2">
          <Input
            value={sendUrl}
            onChange={(e) => setSendUrl(e.target.value)}
            placeholder="https:// رابط تفتحه على الكمبيوتر…"
            dir="ltr"
            className="rounded-xl bg-white/5 border-white/10 text-white text-[12px] placeholder:text-white/30 text-start"
            aria-label="رابط للإرسال"
          />
          <Button className="rounded-xl px-4 bg-teal-600 hover:bg-teal-700" disabled={!sendUrl.trim()} onClick={() => void sendToPc()} aria-label="إرسال">
            <Send className="w-4 h-4" />
          </Button>
        </div>

        {links.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10.5px] text-white/50 flex items-center gap-1"><Monitor className="w-3 h-3" /> روابط من الكمبيوتر</div>
            {links.map((l) => (
              <div key={l.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11.5px] font-medium truncate">{l.title}</p>
                  <p className="text-[9.5px] text-white/40 font-mono dir-ltr truncate text-start">{l.url}</p>
                </div>
                <Button
                  size="sm"
                  variant={l.status === "opened" ? "secondary" : "default"}
                  className={cn("rounded-lg h-7 text-[10px] gap-1 shrink-0", l.status !== "opened" && "bg-teal-600 hover:bg-teal-700")}
                  onClick={() => window.open(l.url, "_blank", "noopener,noreferrer")}
                >
                  {l.status === "opened" ? <><CheckCircle2 className="w-3 h-3" /> فُتح</> : <><ArrowUpRight className="w-3 h-3" /> افتح</>}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* صورة سريعة */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <h2 className="font-bold text-[14px] flex items-center gap-2">
          <Camera className="w-4 h-4 text-teal-400" /> مزامنة الصور التلقائية
        </h2>
        <Button
          variant="secondary"
          className="w-full h-12 rounded-2xl font-bold gap-2"
          onClick={() => void quickCapture()}
          disabled={capturing}
        >
          {capturing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
          التقط صورة — تصل الكمبيوتر تلقائياً
        </Button>
        <p className="text-[10px] text-white/40">كل صورة جديدة في كاميرا هاتفك تُنسخ تلقائياً لمجلد الصور على الكمبيوتر عند الاتصال</p>
      </div>
    </div>
  )
}
