"use client"
// أكمل من حيث توقفت — انقل الرابط/المقطع المفتوح إلى جهاز آخر بضغطة
// + فتح أي رابط محدد على جهاز آخر
import { useState } from "react"
import { toast } from "sonner"
import {
  Send, ExternalLink, Monitor, Smartphone, Tablet, Tv, Youtube,
  Newspaper, Link2, CheckCircle2, ArrowUpRight, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useProd } from "@/lib/prod-store"
import { handPush, handOpened } from "@/lib/prod-socket"
import { fmtDuration, useNexus } from "@/lib/store"
import { cn } from "@/lib/utils"

function DeviceIcon({ id, className }: { id: string; className?: string }) {
  if (id === "pc-office") return <Monitor className={className} />
  if (id === "ipad-pro") return <Tablet className={className} />
  if (id === "nexus-tv") return <Tv className={className} />
  return <Smartphone className={className} />
}

const KIND: Record<string, { label: string; icon: typeof Link2 }> = {
  video: { label: "مقطع", icon: Youtube },
  article: { label: "مقال", icon: Newspaper },
  link: { label: "رابط", icon: Link2 },
}

export function HandoffTab() {
  const { handoff, setHandoff, patchHandoff, setCheck } = useProd()
  const devices = useNexus((s) => s.devices)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [target, setTarget] = useState("galaxy-s24")
  const [busy, setBusy] = useState(false)

  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? id

  /** أكمل هنا — يفتح الرابط فعلياً على الكمبيوتر ويعلم الهاتف */
  function continueHere(id: string, kind: string, link: string, position: number) {
    const finalUrl = kind === "video" && position > 0 && link.includes("youtube.com")
      ? `${link}${link.includes("?") ? "&" : "?"}t=${position}`
      : link
    try {
      window.open(finalUrl, "_blank", "noopener,noreferrer")
    } catch { /* popup محجوب */ }
    handOpened(id, "PC-OFFICE")
    patchHandoff(id, { status: "opened", openedOn: "PC-OFFICE" })
    setCheck("handoff")
    toast.success("أُكمل على الكمبيوتر", { description: kind === "video" ? `بدأ المقطع من الدقيقة ${Math.floor(position / 60)}:${String(position % 60).padStart(2, "0")}` : "فُتح الرابط في تبويب جديد" })
  }

  /** إرسال رابط إلى جهاز آخر — يظهر عليه فوراً */
  async function sendTo() {
    if (!url.trim()) return
    setBusy(true)
    const r = await fetch("/api/prod/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: target,
        deviceName: deviceName(target),
        url: url.trim(),
        title: title.trim() || undefined,
        kind: /youtube|youtu\.be|video/i.test(url) ? "video" : "link",
      }),
    })
    const j = await r.json()
    setBusy(false)
    if (j.ok) {
      setHandoff([j.item, ...handoff])
      setOpen(false)
      setUrl(""); setTitle("")
      toast.success(`أُرسل إلى ${deviceName(target)}`, { description: "سيظهر على الجهاز بضغطة فتح" })
    } else {
      toast.error(j.error || "فشل الإرسال")
    }
  }

  const phoneOpen = handoff.filter((h) => h.deviceId !== "pc-office" && h.status !== "opened")

  return (
    <div className="space-y-4">
      {/* شريط الأدوات */}
      <div className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400 grid place-items-center">
            <Send className="w-4.5 h-4.5" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-bold">التسليم بين الأجهزة</div>
            <div className="text-[10.5px] text-muted-foreground">
              {phoneOpen.length > 0
                ? `${phoneOpen.length} عنصر مفتوح على أجهزتك — أكمله هنا بضغطة`
                : "لا شيء بانتظار المتابعة — أرسل رابطاً أو انتظر من الهاتف"}
            </div>
          </div>
        </div>
        <Button className="rounded-xl h-9 gap-1.5 text-[12px]" onClick={() => setOpen(true)}>
          <ArrowUpRight className="w-4 h-4" /> فتح رابط على جهاز آخر
        </Button>
      </div>

      {/* قائمة العناصر */}
      {handoff.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
          <Send className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-[12.5px] text-muted-foreground">
            لا عناصر بعد — افتح رابطاً على هاتفك (عبر /phone ← تبويب إنتاجية) أو أرسل رابطاً من هنا
          </p>
        </div>
      ) : (
        <ScrollArea className="max-h-[420px]">
          <div className="space-y-2 pe-2">
            {handoff.map((h) => {
              const K = KIND[h.kind] ?? KIND.link
              const KIcon = K.icon
              const fromOther = h.deviceId !== "pc-office"
              return (
                <div key={h.id} className={cn("rounded-2xl border bg-card p-3.5 flex items-start gap-3", h.status === "opened" && "opacity-65")}>
                  <div className="w-10 h-10 rounded-xl bg-muted grid place-items-center shrink-0">
                    <KIcon className={cn("w-5 h-5", h.kind === "video" ? "text-red-500" : "text-violet-500")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground mb-0.5">
                      <span className="inline-flex items-center gap-1 font-semibold text-foreground/80">
                        <DeviceIcon id={h.deviceId} className="w-3 h-3" /> {h.deviceName}
                      </span>
                      <span>·</span>
                      <span>{K.label}</span>
                      {h.kind === "video" && h.position > 0 && (
                        <><span>·</span><span>توقف عند {fmtDuration(h.position)}</span></>
                      )}
                      {h.status === "opened" && (
                        <><span>·</span><Badge className="rounded-full text-[8.5px] bg-emerald-500 hover:bg-emerald-500 gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" /> أُكمل على {h.openedOn}</Badge></>
                      )}
                    </div>
                    <p className="text-[13px] font-semibold truncate">{h.title}</p>
                    <p className="text-[10.5px] text-muted-foreground font-mono dir-ltr truncate text-start">{h.url}</p>
                  </div>
                  <div className="shrink-0 flex flex-col gap-1.5">
                    {fromOther && h.status !== "opened" && (
                      <Button size="sm" className="rounded-xl h-8 gap-1.5 text-[11px]" onClick={() => continueHere(h.id, h.kind, h.url, h.position)}>
                        <ExternalLink className="w-3.5 h-3.5" /> أكمل هنا
                      </Button>
                    )}
                    {h.status === "opened" && (
                      <Button size="sm" variant="outline" className="rounded-xl h-8 gap-1.5 text-[11px]" onClick={() => window.open(h.url, "_blank", "noopener,noreferrer")}>
                        <ExternalLink className="w-3.5 h-3.5" /> إعادة الفتح
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}

      {/* حوار إرسال رابط لجهاز */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>فتح رابط على جهاز آخر</DialogTitle>
            <DialogDescription>سيظهر الرابط على الجهاز المستهدف فوراً بزر فتح</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" dir="ltr" className="rounded-xl text-[12.5px] text-start" aria-label="الرابط" />
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان اختياري" className="rounded-xl text-[12.5px]" aria-label="العنوان" />
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-full rounded-xl text-[12px]"><SelectValue placeholder="الجهاز المستهدف" /></SelectTrigger>
              <SelectContent>
                {devices.filter((d) => d.id !== "pc-office").map((d) => (
                  <SelectItem key={d.id} value={d.id} className="text-[12px]">{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full rounded-xl" disabled={busy || !url.trim()} onClick={() => void sendTo()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} إرسال
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
