"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNexus, fmtSize, fmtDate } from "@/lib/store"
import { categoryColor, CATEGORY_ICON_MAP } from "./category-meta"
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  X, ChevronRight, ChevronLeft, ZoomIn, ZoomOut, RotateCw, Download,
  Play, Pause, Volume2, VolumeX, PackageOpen, FileText, Loader2, Send, Check,
} from "lucide-react"
import { toast } from "sonner"
import type { FsEntry } from "@/lib/nexus/types"
import { pickSendTarget } from "@/lib/nexus/pick-target"

export function PreviewModal() {
  const s = useNexus()
  const entry = s.previewEntry

  // navigation within current listing
  const list = useMemo(
    () => (s.searchResults ?? s.entries).filter((e) => e.type === "file"),
    [s.searchResults, s.entries]
  )
  const idx = entry ? list.findIndex((e) => e.path === entry.path) : -1

  const go = useCallback((dir: 1 | -1) => {
    if (idx < 0) return
    const next = list[(idx + dir + list.length) % list.length]
    s.setPreviewEntry(next)
  }, [idx, list, s])

  useEffect(() => {
    if (!entry) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") s.setPreviewEntry(null)
      if (ev.key === "ArrowLeft") go(1)
      if (ev.key === "ArrowRight") go(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [entry, go, s])

  if (!entry) return null
  return (
    <Dialog open onOpenChange={(v) => !v && s.setPreviewEntry(null)}>
      <DialogContent className="sm:max-w-4xl p-0 overflow-hidden gap-0">
        <ModalBody entry={entry} onPrev={() => go(-1)} onNext={() => go(1)} hasPrev={list.length > 1} hasNext={list.length > 1} />
      </DialogContent>
    </Dialog>
  )
}

function ModalBody({ entry, onPrev, onNext, hasPrev, hasNext }: {
  entry: FsEntry
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
}) {
  const s = useNexus()
  const src = `/api/preview?device=${encodeURIComponent(s.activeDeviceId)}&path=${encodeURIComponent(entry.path)}`
  const dl = `${src}&download=1`
  const Icon = CATEGORY_ICON_MAP[entry.category] ?? CATEGORY_ICON_MAP.other
  const color = categoryColor(entry.category)

  const sendNow = async () => {
    const direction = s.activeDeviceId === "pc-office" ? "out" : "in"
    const target = direction === "in"
      ? (s.devices.find((d) => d.id === "pc-office") ?? { id: "pc-office", name: "PC-OFFICE" })
      : (await pickSendTarget(s.activeDeviceId))
    if (!target) { toast.error("لا يوجد هاتف/جهاز متصل للإرسال إليه"); return }
    const res = await fetch("/api/devices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send-file", deviceId: target.id,
        deviceName: target.name, direction,
        srcDeviceId: s.activeDeviceId, srcPath: entry.path, fileName: entry.name,
      }),
    })
    const j = await res.json()
    if (j.ok) toast.success(`جارٍ نقل ${entry.name} ← ${target.name}`, {
      action: { label: "عرض", onClick: () => { s.setPreviewEntry(null); s.setView("transfers") } },
    })
    else toast.error(j.error || "فشل النقل")
  }

  return (
    <div>
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
        <Icon className={`w-6 h-6 shrink-0 ${color}`} strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-sm truncate" title={entry.name}>{entry.name}</DialogTitle>
          <DialogDescription className="text-[11px] mt-0.5">
            {fmtSize(entry.size)} · {fmtDate(entry.mtime)} · {entry.path}
          </DialogDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={sendNow} title="إرسال إلى الجهاز الآخر">
            <Send className="w-4 h-4" />
          </Button>
          <a href={dl} download>
            <Button size="icon" variant="ghost" title="تنزيل">
              <Download className="w-4 h-4" />
            </Button>
          </a>
          <Button size="icon" variant="ghost" onClick={() => s.setPreviewEntry(null)} title="إغلاق">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* body */}
      <div className="relative bg-zinc-950/95 dark:bg-black/60 min-h-[380px] max-h-[68vh] grid place-items-center overflow-hidden">
        {hasPrev && (
          <button onClick={onPrev} className="absolute start-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center backdrop-blur" aria-label="السابق">
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
        {hasNext && (
          <button onClick={onNext} className="absolute end-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center backdrop-blur" aria-label="التالي">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {entry.category === "image" && <ImagePreview src={src} />}
        {entry.category === "video" && <VideoPreview src={src} />}
        {entry.category === "audio" && <AudioPreview src={src} name={entry.name} />}
        {entry.category === "pdf" && <PdfPreview src={src} />}
        {entry.category === "text" && <TextPreview key={src} src={src} />}
        {entry.category === "apk" && <ApkPreview path={entry.path} name={entry.name} />}
        {entry.category === "zip" && <ZipFallback name={entry.name} />}
        {entry.category === "other" && <GenericFallback entry={entry} />}
      </div>
    </div>
  )
}

/* ---------- individual preview renderers ---------- */

function ImagePreview({ src }: { src: string }) {
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  return (
    <div className="relative w-full h-full max-h-[68vh] flex items-center justify-center p-6">
      <img
        src={src}
        alt="معاينة الصورة"
        className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-2xl transition-transform duration-200"
        style={{ transform: `scale(${zoom}) rotate(${rot}deg)` }}
      />
      <div className="absolute bottom-3 inset-x-0 flex justify-center gap-2">
        <div className="flex rounded-full bg-black/60 backdrop-blur px-1.5 py-1 gap-1">
          <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} className="w-8 h-8 rounded-full text-white hover:bg-white/20 grid place-items-center" aria-label="تصغير"><ZoomOut className="w-4 h-4" /></button>
          <span className="text-white text-xs w-10 grid place-items-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} className="w-8 h-8 rounded-full text-white hover:bg-white/20 grid place-items-center" aria-label="تكبير"><ZoomIn className="w-4 h-4" /></button>
          <button onClick={() => setRot((r) => r + 90)} className="w-8 h-8 rounded-full text-white hover:bg-white/20 grid place-items-center" aria-label="تدوير"><RotateCw className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  )
}

function VideoPreview({ src }: { src: string }) {
  return (
    <div className="w-full p-4">
      <video
        key={src}
        src={src}
        controls
        autoPlay
        playsInline
        className="w-full max-h-[56vh] rounded-xl bg-black shadow-2xl"
      />
      <div className="text-center text-[11px] text-white/60 mt-2">
        بث مباشر عبر Nexus Protocol — دعم كامل للتمرير داخل الفيديو (Range Streaming)
      </div>
    </div>
  )
}

function AudioPreview({ src, name }: { src: string; name: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [muted, setMuted] = useState(false)
  const [vol, setVol] = useState(0.9)

  useEffect(() => { if (ref.current) ref.current.volume = vol }, [vol])
  useEffect(() => { if (ref.current) ref.current.muted = muted }, [muted])

  const toggle = async () => {
    const a = ref.current
    if (!a) return
    if (playing) { a.pause() } else { await a.play().catch(() => {}) }
  }

  return (
    <div className="w-full max-w-md mx-auto p-8 text-center">
      <div className={`w-28 h-28 mx-auto rounded-full bg-gradient-to-br from-teal-500 to-emerald-400 grid place-items-center shadow-2xl shadow-teal-500/30 ${playing ? "nexus-live" : ""}`}>
        <FileText className="w-12 h-12 text-white" strokeWidth={1.5} />
      </div>
      <div className="text-white font-semibold mt-4 truncate">{name}</div>
      <audio
        ref={ref}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
      <div className="mt-5 space-y-3" dir="ltr">
        <input
          type="range" min={0} max={dur || 0} step={0.1} value={t}
          onChange={(e) => { const v = Number(e.target.value); setT(v); if (ref.current) ref.current.currentTime = v }}
          className="w-full accent-teal-400"
          aria-label="شريط التقدم"
        />
        <div className="flex justify-between text-[11px] text-white/60 tabular-nums">
          <span>{fmtTime(t)}</span>
          <span>{fmtTime(dur)}</span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button onClick={() => setMuted(!muted)} className="w-9 h-9 rounded-full text-white hover:bg-white/15 grid place-items-center" aria-label="كتم">
          {muted ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
        </button>
        <button
          onClick={toggle}
          className="w-14 h-14 rounded-full bg-teal-500 hover:bg-teal-400 text-white grid place-items-center shadow-xl shadow-teal-500/40 transition-transform active:scale-95"
          aria-label={playing ? "إيقاف" : "تشغيل"}
        >
          {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ms-0.5" />}
        </button>
        <input
          type="range" min={0} max={1} step={0.05} value={vol}
          onChange={(e) => setVol(Number(e.target.value))}
          className="w-20 accent-teal-400" aria-label="مستوى الصوت" dir="ltr"
        />
      </div>
    </div>
  )
}

function fmtTime(sec: number) {
  if (!isFinite(sec)) return "0:00"
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

function PdfPreview({ src }: { src: string }) {
  return (
    <div className="w-full h-full">
      <iframe src={src} title="معاينة PDF" className="w-full h-[62vh] bg-white rounded-lg" />
    </div>
  )
}

function TextPreview({ src }: { src: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    fetch(src).then((r) => r.text()).then(setText).catch(() => setText("تعذر قراءة الملف"))
  }, [src])
  if (text === null)
    return <div className="py-16 text-white/70"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
  return (
    <div className="w-full p-4">
      <pre dir="auto" className="max-h-[56vh] overflow-auto nexus-scroll rounded-xl bg-black/60 border border-white/10 p-4 text-[12.5px] leading-6 text-emerald-100/90 whitespace-pre-wrap font-mono">
        {text}
      </pre>
    </div>
  )
}

function ApkPreview({ path, name }: { path: string; name: string }) {
  const [info, setInfo] = useState<{
    entries: number
    hasManifest: boolean
    files: { name: string; size: string }[]
  } | null>(null)
  const s = useNexus()

  useEffect(() => {
    fetch("/api/apk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: s.activeDeviceId, path }),
    })
      .then((r) => r.json())
      .then((j) => setInfo(j.ok ? j : null))
      .catch(() => setInfo(null))
  }, [path])

  return (
    <div className="w-full max-w-lg p-6 text-white">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-lime-500 to-emerald-500 grid place-items-center shadow-xl">
          <PackageOpen className="w-8 h-8" />
        </div>
        <div>
          <div className="font-bold">{name}</div>
          <div className="text-xs text-white/60">حزمة تطبيق Android — جاهزة للتثبيت عن بُعد</div>
        </div>
      </div>
      {info ? (
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary" className="bg-white/10 text-white border-0">{info.entries} مدخل</Badge>
            {info.hasManifest && <Badge className="bg-emerald-500/20 text-emerald-300 border-0"><Check className="w-3 h-3 me-1" />AndroidManifest سليم</Badge>}
          </div>
          <div className="rounded-xl bg-black/40 border border-white/10 max-h-44 overflow-auto nexus-scroll p-2.5 font-mono text-[11px] text-white/75">
            {info.files.map((f) => (
              <div key={f.name} className="flex justify-between gap-4 py-0.5">
                <span className="truncate">{f.name}</span>
                <span className="tabular-nums shrink-0 text-white/45">{f.size} B</span>
              </div>
            ))}
          </div>
          <Button className="w-full bg-teal-600 hover:bg-teal-500">تثبيت على الجهاز</Button>
        </div>
      ) : (
        <div className="mt-6 text-white/60"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
      )}
    </div>
  )
}

function ZipFallback({ name }: { name: string }) {
  return (
    <div className="p-8 text-center text-white">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-orange-500/20 grid place-items-center">
        <PackageOpen className="w-8 h-8 text-orange-300" />
      </div>
      <div className="mt-3 font-semibold">{name}</div>
      <p className="text-xs text-white/60 mt-1">
        الأرشيفات لا تُعاين مباشرة — استخدم «فك الضغط هنا» من قائمة الزر الأيمن ثم استعرض المحتوى.
      </p>
    </div>
  )
}

function GenericFallback({ entry }: { entry: FsEntry }) {
  return (
    <div className="p-8 text-center text-white">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-white/10 grid place-items-center">
        <FileText className="w-8 h-8 text-white/70" />
      </div>
      <div className="mt-3 font-semibold">{entry.name}</div>
      <p className="text-xs text-white/60 mt-1">
        لا توجد معاينة مدمجة لهذا النوع ({entry.ext.toUpperCase() || "ملف"} · {fmtSize(entry.size)}).
      </p>
      <Progress value={100} className="h-1 w-40 mx-auto mt-4 bg-white/10" />
    </div>
  )
}
