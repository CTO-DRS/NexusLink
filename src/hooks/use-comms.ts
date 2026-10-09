"use client"
// NexusLink — خطاف ربط الأحداث الفورية (يُستدعى مرة واحدة في الصفحة)
import { useEffect } from "react"
import { toast } from "sonner"
import { useComms } from "@/lib/comms-store"
import { getCommsSocket } from "@/lib/comms-socket"
import { playNotifSound, playSendSound, stopRingtone, playConnectSound } from "@/lib/nexus/sounds"
import type {
  MirroredNotification, NotifFilter, SmsConversation, SmsMessage, BridgeHello, PhoneLogEntry,
} from "@/lib/nexus/comms-types"

async function loadBootstrap() {
  try {
    const r = await fetch("/api/comms/bootstrap")
    const j = await r.json()
    const s = useComms.getState()
    s.setNotifications(j.notifications ?? [])
    s.setFilter(j.filter ?? {})
    s.setConversations(j.conversations ?? [])
    s.setContacts(j.contacts ?? [])
    s.setCalllog(j.calllog ?? [])
    s.setPhone({ dnd: j.phone?.dnd ?? false, dndSource: j.phone?.dndSource ?? null })
  } catch { /* ignore */ }
}

export function useCommsBridge() {
  useEffect(() => {
    const socket = getCommsSocket()
    const s = () => useComms.getState()

    socket.on("connect", () => { s().setBridgeReady(true) })
    socket.on("disconnect", () => { s().setBridgeReady(false) })

    socket.on("bridge:hello", (data: BridgeHello) => {
      s().setBridgeReady(true)
      s().setPhone({
        dnd: data.phone.dnd,
        autoMode: data.phone.autoMode,
        battery: data.phone.battery,
        name: data.phone.name,
      })
    })

    // ==== انعكاس إشعار في الوقت الحقيقي ====
    socket.on("notif:mirror", (data: { notification: MirroredNotification }) => {
      const n = data.notification
      s().upsertNotification(n)
      if (n.status === "new") {
        if (s().filter.soundEnabled) playNotifSound()
        s().pushToast(n)
      }
    })

    // ==== SMS وارد ====
    socket.on("sms:incoming", (data: { conversation: SmsConversation; message: SmsMessage }) => {
      const { conversation, message } = data
      const st = s()
      st.upsertConversation(conversation)
      st.upsertMessage(conversation.id, message)
      if (st.activeConversationId === conversation.id) {
        // المحادثة مفتوحة → قراءة فورية
        st.setConversations(st.conversations.map((c) => (c.id === conversation.id ? { ...c, unread: 0 } : c)))
        fetch("/api/comms/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "read", conversationId: conversation.id }),
        }).catch(() => { })
      } else if (message.direction === "in") {
        toast(`رسالة من ${conversation.contactName ?? conversation.address}`, {
          description: message.body,
        })
        if (st.filter.soundEnabled) playNotifSound()
      }
    })

    // ==== حالة رسالة صادرة (وصلت/تم التسليم) ====
    socket.on("sms:status", (data: { messageId: string; status: SmsMessage["status"] }) => {
      s().patchMessage(data.messageId, data.status)
    })

    // ==== مكالمة واردة ====
    socket.on("call:incoming", (data: { callId: string; number: string; contactName?: string; at: number }) => {
      import("@/lib/nexus/sounds").then(({ startRingtone }) => startRingtone())
      s().setLiveCall({
        callId: data.callId,
        number: data.number,
        contactName: data.contactName,
        direction: "in",
        state: "incoming",
        startedAt: null,
      })
    })

    // ==== حالة المكالمة ====
    socket.on("call:state", (data: { callId: string; state: string; missed?: boolean; rejected?: boolean; durationSec?: number }) => {
      const st = s()
      const call = st.liveCall
      if (!call || call.callId !== data.callId) return
      if (data.state === "active") {
        stopRingtone()
        playConnectSound()
        st.patchLiveCall({ state: "active", startedAt: Date.now() })
      } else if (data.state === "ringing") {
        st.patchLiveCall({ state: "ringing" })
      } else if (data.state === "ended") {
        stopRingtone()
        // مكالمة فائتة أو مرفوضة (لم يُرد)
        if (data.missed || data.rejected) {
          if (data.missed) {
            toast.error(`مكالمة فائتة من ${call.contactName ?? call.number}`)
          }
          st.setLiveCall(null)
        } else {
          st.setLiveCall(null)
        }
      }
    })

    // ==== مزامنة عدم الإزعاج ====
    socket.on("dnd:state", (data: { enabled: boolean; source: "pc" | "phone" }) => {
      s().setPhone({ dnd: data.enabled, dndSource: data.source })
    })

    // ==== سجل الهاتف ====
    socket.on("phone:log", (entry: PhoneLogEntry) => {
      s().pushPhoneLog(entry)
    })

    void loadBootstrap()
    return () => {
      socket.off()
    }
  }, [])
}

// ---------- تحميل سلسلة محادثة SMS ----------
export async function loadThread(conversationId: string) {
  try {
    const r = await fetch(`/api/comms/sms?conversationId=${conversationId}`)
    const j = await r.json()
    if (j.messages) {
      const st = useComms.getState()
      st.setThread(conversationId, j.messages)
      st.upsertConversation({ ...j.conversation, unread: 0 })
    }
  } catch { /* ignore */ }
}

/** إرسال رسالة نصية من الكمبيوتر */
export async function sendSms(conversationId: string, text: string) {
  const st = useComms.getState()
  const conv = st.conversations.find((c) => c.id === conversationId)
  if (!conv || !text.trim()) return
  try {
    const r = await fetch("/api/comms/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "send", conversationId, text }),
    })
    const j = await r.json()
    if (j.message) {
      st.upsertMessage(conversationId, j.message)
      st.upsertConversation({ ...j.conversation, lastMessage: `أنت: ${j.message.body}` })
      playSendSound()
      // إرسال إلى الهاتف عبر الجسر
      const { sendSmsToPhone } = await import("@/lib/comms-socket")
      sendSmsToPhone(j.message.id, conv.address, j.message.body, conv.contactName)
    }
  } catch {
    toast.error("فشل إرسال الرسالة")
  }
}

/** الرد السريع من الإشعار */
export async function quickReplyToNotification(n: MirroredNotification, text: string) {
  if (!text.trim()) return
  try {
    const r = await fetch("/api/comms/notifications/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, action: "reply", text }),
    })
    const j = await r.json()
    if (j.notification) {
      useComms.getState().upsertNotification(j.notification)
      useComms.getState().dismissToast(n.id)
      playSendSound()
      const { quickReply } = await import("@/lib/comms-socket")
      quickReply({ id: n.id, appId: n.appId, appName: n.appName }, text.trim())
      toast.success(`تم إرسال ردك عبر ${n.appName}`)
    }
  } catch {
    toast.error("فشل إرسال الرد")
  }
}

/** مزامنة وضع عدم الإزعاج من الكمبيوتر إلى الهاتف */
export async function syncDnd(enabled: boolean) {
  const st = useComms.getState()
  st.setPhone({ dnd: enabled, dndSource: "pc" })
  try {
    await fetch("/api/comms/phone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dnd: enabled, dndSource: "pc" }),
    })
    const { pushDndToPhone } = await import("@/lib/comms-socket")
    pushDndToPhone(enabled)
    toast.success(enabled ? "تمت مزامنة وضع عدم الإزعاج مع الهاتف" : "تم إيقاف عدم الإزعاج على الهاتف")
  } catch {
    toast.error("فشلت المزامنة")
  }
}

/** إجراءات الإشعارات */
export async function notifAction(id: string, action: "read" | "archive" | "delete" | "restore") {
  try {
    const r = await fetch("/api/comms/notifications/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    })
    const j = await r.json()
    const st = useComms.getState()
    if (action === "delete") st.removeNotification(id)
    else if (j.notification) st.upsertNotification(j.notification)
  } catch { /* ignore */ }
}

/** تحديث قواعد الفلترة */
export async function saveFilter(patch: Partial<NotifFilter>) {
  const st = useComms.getState()
  st.setFilter(patch)
  try {
    await fetch("/api/comms/filter", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  } catch { /* ignore */ }
}

/** تسجيل مكالمة منتهية في السجل */
export async function logEndedCall(direction: "in" | "out", number: string, contactName: string | null, durationSec: number) {
  try {
    const r = await fetch("/api/comms/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "ended", direction, number, contactName, durationSec }),
    })
    const j = await r.json()
    if (j.call) useComms.getState().prependCall(j.call)
  } catch { /* ignore */ }
}
