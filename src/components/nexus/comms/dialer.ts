"use client"
// منطق بدء المكالمات الصادرة من الكمبيوتر
import { toast } from "sonner"
import { useComms } from "@/lib/comms-store"
import { dialFromPc } from "@/lib/comms-socket"

export function dial(number: string, contactName?: string) {
  const st = useComms.getState()
  if (st.liveCall) {
    toast.warning("توجد مكالمة جارية بالفعل")
    return
  }
  const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  st.setLiveCall({
    callId,
    number,
    contactName,
    direction: "out",
    state: "outgoing",
    startedAt: null,
  })
  dialFromPc(callId, number, contactName)
}
