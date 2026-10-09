"use client"
// الحافظة المشتركة — إرسال نص من الهاتف إلى الكمبيوتر والعكس مع سجل مزامنة
import { useState } from "react"
import { ClipboardPaste, ClipboardCopy, Copy, ArrowUpRight, ArrowDownLeft, Send } from "lucide-react"
import { toast } from "sonner"
import { rcClipboard } from "@/lib/remote-socket"
import { useRcMirror } from "@/lib/remote-store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

function rel(at: number) {
  const s = Math.floor((Date.now() - at) / 1000)
  if (s < 60) return `قبل ${s}ث`
  return `قبل ${Math.floor(s / 60)}د`
}

export function ClipboardRemoteMode() {
  const report = useRcMirror((s) => s.report)
  const inbox = useRcMirror((s) => s.clipboardInbox)
  const sent = useRcMirror((s) => s.sentHistory)
  const [text, setText] = useState("")

  function sendToPc() {
    if (!text.trim()) return
    rcClipboard({ direction: "toPc", text: text.trim() })
    useRcMirror.getState().pushSent(text.trim())
    toast.success("أُرسل النص إلى حافظة الكمبيوتر", { description: "يمكن لصقه في المفكرة فوراً" })
    setText("")
  }

  async function copyOut(t: string) {
    try {
      await navigator.clipboard.writeText(t)
      toast.success("نُسخ إلى حافظة الهاتف")
    } catch {
      toast.error("تعذّر النسخ على هذا المتصفح")
    }
  }

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      {/* إرسال إلى الكمبيوتر */}
      <div className="rounded-2xl border bg-card p-3 space-y-2 shrink-0">
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold">
          <ClipboardPaste className="w-4 h-4 text-primary" /> من الهاتف إلى الكمبيوتر
          {report && (
            <span className="ms-auto text-[9px] font-semibold text-muted-foreground">
              حافظة الكمبيوتر: {report.clipboardLen} حرف
            </span>
          )}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="اكتب أو الصق نصاً هنا… سيصل لحافظة الكمبيوتر فوراً"
          className="min-h-[72px] rounded-xl text-[12px] bg-background"
        />
        <div className="flex gap-1.5">
          <Button className="h-9 flex-1 rounded-xl text-[11.5px] font-bold" onClick={sendToPc} disabled={!text.trim()}>
            <Send className="w-3.5 h-3.5" /> إرسال إلى الحافظة
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-xl text-[11px] font-bold gap-1"
            onClick={() => rcClipboard({ direction: "pull" })}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" /> اسحب من الكمبيوتر
          </Button>
        </div>
      </div>

      {/* الوارد من الكمبيوتر */}
      <div className="rounded-2xl border bg-card p-3 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold mb-2 shrink-0">
          <ClipboardCopy className="w-4 h-4 text-amber-500" /> الوارد من الكمبيوتر
          {inbox.length > 0 && (
            <span className="rounded-full bg-primary/10 text-primary text-[9px] font-black px-1.5">{inbox.length}</span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-auto nexus-scroll space-y-1.5 pe-1">
          {inbox.length === 0 && sent.length === 0 && (
            <p className="text-center text-[10.5px] text-muted-foreground py-6 leading-relaxed">
              لا توجد مزامنات بعد<br />اضغط «نسخ إلى الهاتف» في مفكرة الكمبيوتر، أو أرسل نصاً الآن
            </p>
          )}
          {inbox.map((it) => (
            <div key={it.id} className="rounded-xl border bg-background/60 px-2.5 py-2 flex items-start gap-2">
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
              <p className="flex-1 text-[11px] leading-relaxed break-words">{it.text}</p>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <button onClick={() => copyOut(it.text)} className="text-muted-foreground hover:text-foreground" aria-label="نسخ">
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <span className="text-[8px] text-muted-foreground">{rel(it.at)}</span>
              </div>
            </div>
          ))}
          {sent.map((it) => (
            <div key={it.id} className="rounded-xl border border-dashed px-2.5 py-2 flex items-start gap-2 opacity-80">
              <ArrowUpRight className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              <p className="flex-1 text-[11px] leading-relaxed break-words">{it.text}</p>
              <span className="text-[8px] text-muted-foreground shrink-0">{rel(it.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
