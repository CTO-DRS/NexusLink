"use client"
// NexusLink — FA-9: شريط التسليم "أكمل من حيث توقفت"
// روابط واردة من الهاتف (rc:handoff) بانتظار الفتح على الكمبيوتر
import { SendToBack, ExternalLink, X, Inbox } from "lucide-react"
import { useDesktop } from "@/lib/remote-store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function HandoffBar() {
  const { handoffInbox, openHandoff, pushLocalLog } = useDesktop()

  if (handoffInbox.length === 0) return null

  function dismiss(id: string) {
    useDesktop.setState({ handoffInbox: useDesktop.getState().handoffInbox.filter((h) => h.id !== id) })
    pushLocalLog("أُزيل رابط تسليم دون فتح", "info")
  }

  return (
    <div className="rounded-2xl border border-teal-500/40 bg-teal-500/5 p-3.5" data-testid="handoff-bar">
      <div className="flex items-center gap-2 mb-2.5">
        <Inbox className="w-4 h-4 text-teal-500" />
        <span className="text-[13px] font-bold">أكمل من حيث توقفت — روابط من هاتفك</span>
        <Badge variant="secondary" className="rounded-full text-[10px]" dir="ltr">{handoffInbox.length}</Badge>
      </div>
      <div className="space-y-1.5">
        {handoffInbox.map((h) => (
          <div
            key={h.id}
            className="flex items-center gap-2 rounded-xl bg-background/80 border px-2.5 py-2"
          >
            <SendToBack className="w-3.5 h-3.5 text-teal-500 shrink-0" />
            <div className="flex-1 min-w-0">
              {h.title ? (
                <p className="text-[12px] font-semibold truncate">{h.title}</p>
              ) : null}
              <code className="text-[10.5px] text-muted-foreground truncate block" dir="ltr">{h.url}</code>
            </div>
            <Button
              size="sm"
              className="rounded-xl h-7 px-2.5 text-[11px] gap-1 shrink-0"
              onClick={() => openHandoff(h.id)}
            >
              <ExternalLink className="w-3 h-3" /> افتح هنا
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 shrink-0 text-muted-foreground"
              onClick={() => dismiss(h.id)}
              aria-label="إزالة الرابط"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
