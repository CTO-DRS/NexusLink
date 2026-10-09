"use client"
// نافذة المكالمة الشاملة — واردة/صادرة/نشطة — الصوت عبر سماعات الكمبيوتر
import { useEffect, useReducer, useState } from "react"
import { useComms, initials, avatarColor } from "@/lib/comms-store"
import { answerCall, rejectCall, endCallOnPhone } from "@/lib/comms-socket"
import { logEndedCall } from "@/hooks/use-comms"
import { stopRingtone } from "@/lib/nexus/sounds"
import { Button } from "@/components/ui/button"
import { Mic, MicOff, Volume2, PhoneOff, Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react"

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function CallOverlay() {
  const liveCall = useComms((s) => s.liveCall)
  const patchLiveCall = useComms((s) => s.patchLiveCall)
  const setLiveCall = useComms((s) => s.setLiveCall)
  const [muted, setMuted] = useState(false)
  const [speaker, setSpeaker] = useState(true)
  // نبضة إعادة رسم كل ثانية أثناء المكالمة النشطة
  const [, tick] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    if (liveCall?.state !== "active" || !liveCall.startedAt) return
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [liveCall?.state, liveCall?.startedAt])

  const elapsed =
    liveCall?.state === "active" && liveCall.startedAt
      ? Math.floor((Date.now() - liveCall.startedAt) / 1000)
      : 0

  if (!liveCall) return null

  const name = liveCall.contactName ?? liveCall.number
  const isIncoming = liveCall.state === "incoming"
  const isRingingOut = liveCall.state === "outgoing" || liveCall.state === "ringing"

  const end = () => {
    const durationSec = liveCall.state === "active" && liveCall.startedAt ? Math.floor((Date.now() - liveCall.startedAt) / 1000) : 0
    stopRingtone()
    endCallOnPhone(liveCall.callId, durationSec, liveCall.direction, liveCall.number, liveCall.contactName)
    if (liveCall.state === "active") {
      void logEndedCall(liveCall.direction, liveCall.number, liveCall.contactName ?? null, durationSec)
    }
    setLiveCall(null)
  }

  const answer = () => {
    stopRingtone()
    answerCall(liveCall.callId)
    patchLiveCall({ state: "active", startedAt: Date.now() })
  }

  const reject = () => {
    stopRingtone()
    rejectCall(liveCall.callId)
    setLiveCall(null)
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 backdrop-blur-md" role="dialog" aria-label="نافذة المكالمة">
      <div className={`w-[min(92vw,380px)] rounded-3xl border bg-card shadow-2xl overflow-hidden ${isIncoming ? "ring-2 ring-emerald-500/60 nexus-call-pulse" : ""}`}>
        {/* شريط الحالة */}
        <div className={`h-16 grid place-items-center relative ${isIncoming ? "bg-emerald-500" : "bg-primary"}`}>
          <div className="flex items-center gap-2 text-white text-[13px] font-semibold">
            {liveCall.direction === "in" ? <PhoneIncoming className="w-4 h-4" /> : <PhoneOutgoing className="w-4 h-4" />}
            {isIncoming ? "مكالمة واردة عبر الهاتف" : isRingingOut ? "جارٍ الاتصال عبر الهاتف…" : "مكالمة نشطة"}
          </div>
        </div>

        <div className="p-6 text-center space-y-5">
          {/* الهوية */}
          <div className="space-y-2">
            <div
              className="w-20 h-20 mx-auto rounded-3xl grid place-items-center text-white text-2xl font-bold shadow-lg"
              style={{ background: avatarColor(liveCall.number) }}
            >
              {initials(name)}
            </div>
            <div className="text-lg font-bold">{name}</div>
            <div className="text-[12px] text-muted-foreground" dir="ltr">{liveCall.number}</div>
            <div className="text-[13px] font-mono text-primary h-5">
              {liveCall.state === "active" ? fmt(elapsed) : isIncoming ? "يرن…" : isRingingOut ? "يرن عند الطرف الآخر…" : ""}
            </div>
          </div>

          {/* أزرار الواردة */}
          {isIncoming && (
            <div className="flex items-center justify-center gap-8 pt-1">
              <div className="space-y-1.5">
                <Button size="icon" className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 shadow-lg" onClick={reject} aria-label="رفض">
                  <PhoneOff className="w-6 h-6" />
                </Button>
                <div className="text-[10px] text-muted-foreground">رفض</div>
              </div>
              <div className="space-y-1.5">
                <Button size="icon" className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 shadow-lg animate-bounce" onClick={answer} aria-label="قبول">
                  <Phone className="w-6 h-6" />
                </Button>
                <div className="text-[10px] text-muted-foreground">قبول</div>
              </div>
            </div>
          )}

          {/* أدوات المكالمة النشطة */}
          {(liveCall.state === "active" || isRingingOut) && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant={muted ? "default" : "outline"}
                  size="icon" className="w-12 h-12 rounded-2xl"
                  onClick={() => setMuted((m) => !m)}
                  aria-label="كتم الميكروفون"
                >
                  {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </Button>
                <Button
                  variant={speaker ? "default" : "outline"}
                  size="icon" className="w-12 h-12 rounded-2xl"
                  onClick={() => setSpeaker((sp) => !sp)}
                  aria-label="مكبر الصوت"
                >
                  <Volume2 className="w-5 h-5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {muted ? "الميكروفون مكتوم · " : ""}الصوت يُبث عبر {speaker ? "مكبر" : "سماعة"} الكمبيوتر
              </p>
              <Button className="w-full h-12 rounded-2xl gap-2 bg-red-500 hover:bg-red-600" onClick={end}>
                <PhoneOff className="w-4.5 h-4.5" /> إنهاء المكالمة
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
