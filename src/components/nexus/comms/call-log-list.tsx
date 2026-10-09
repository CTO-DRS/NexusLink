"use client"
// قائمة سجل المكالمات (مشتركة)
import { useComms, relTime } from "@/lib/comms-store"
import { dial } from "./dialer"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneCall } from "lucide-react"

export function CallLogList({ compact = false }: { compact?: boolean }) {
  const calllog = useComms((s) => s.calllog)

  if (calllog.length === 0) {
    return (
      <div className="py-12 text-center space-y-1">
        <PhoneCall className="w-8 h-8 mx-auto text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">لا توجد مكالمات بعد — جرّب مكالمة واردة من «الهاتف الافتراضي»</p>
      </div>
    )
  }

  return (
    <ScrollArea className={compact ? "h-[420px] nexus-scroll" : "h-[calc(100vh-245px)] nexus-scroll"}>
      <div className="space-y-0.5 pe-1">
        {calllog.map((c) => {
          const Icon = c.direction === "missed" ? PhoneMissed : c.direction === "out" ? PhoneOutgoing : PhoneIncoming
          const color = c.direction === "missed" ? "text-red-500" : c.direction === "out" ? "text-emerald-600" : "text-primary"
          const label = c.direction === "missed" ? "فائتة" : c.direction === "out" ? "صادرة" : "واردة"
          const dur = `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}`
          return (
            <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-accent/60 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-muted grid place-items-center shrink-0">
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{c.contactName ?? c.number}</div>
                <div className="text-[10px] text-muted-foreground">
                  {label} · {relTime(c.startedAt)}{c.durationSec > 0 && ` · ${dur}`}
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground hidden sm:block" dir="ltr">{c.number}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => dial(c.number, c.contactName ?? undefined)} aria-label="معاودة الاتصال">
                <PhoneCall className="w-4 h-4 text-emerald-600" />
              </Button>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
