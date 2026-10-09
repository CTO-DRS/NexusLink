"use client"
// توستات الإشعارات الفورية — ظهور لحظي مع رد سريع مدمج
import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { useComms, relTime } from "@/lib/comms-store"
import { quickReplyToNotification } from "@/hooks/use-comms"
import { appMeta } from "@/lib/nexus/comms-types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, X, Reply } from "lucide-react"

const TOAST_TTL = 9000

function ToastCard({ toastId }: { toastId: string }) {
  const t = useComms((s) => s.toasts.find((x) => x.id === toastId))
  const dismiss = useComms((s) => s.dismissToast)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (!t) return
    const iv = setInterval(() => {
      if (Date.now() - t.at > TOAST_TTL) dismiss(t.id)
    }, 1000)
    return () => clearInterval(iv)
  }, [t, dismiss])

  if (!t) return null
  const n = t.notification
  const meta = appMeta(n.appId)

  const send = async () => {
    if (!text?.trim()) return
    await quickReplyToNotification(n, text)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -40, scale: 0.95 }}
      className="w-[min(88vw,340px)] rounded-2xl border bg-card/95 backdrop-blur-xl shadow-2xl p-3 relative overflow-hidden"
      role="alert"
    >
      <span className="absolute inset-y-0 start-0 w-1" style={{ background: meta.color }} />
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-xl grid place-items-center text-white text-[11px] font-bold shrink-0" style={{ background: meta.color }}>
          {n.appName.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold truncate">{n.title}</span>
            <span className="text-[10px] text-muted-foreground ms-auto shrink-0">{relTime(t.at)}</span>
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="إغلاق">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[12px] text-foreground/85 leading-snug line-clamp-2">{n.body}</p>
          <span className="text-[9px] text-muted-foreground">{n.appName}</span>

          {n.actionable && (
            <div className="flex items-center gap-1.5 mt-2">
              {text === null ? (
                <Button variant="secondary" size="sm" className="h-7 text-[11px] rounded-lg gap-1.5" onClick={() => setText("")}>
                  <Reply className="w-3 h-3" /> رد سريع
                </Button>
              ) : (
                <>
                  <Input
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder={`رد عبر ${n.appName}…`}
                    className="h-7 text-[11px] rounded-lg"
                  />
                  <Button size="icon" className="h-7 w-7 rounded-lg shrink-0" onClick={send} aria-label="إرسال">
                    <Send className="w-3 h-3" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export function CommsToaster() {
  const toasts = useComms((s) => s.toasts)
  return (
    <div className="fixed bottom-24 start-4 z-[80] flex flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.slice(-3).map((t) => (
          <ToastCard key={t.id} toastId={t.id} />
        ))}
      </AnimatePresence>
    </div>
  )
}
