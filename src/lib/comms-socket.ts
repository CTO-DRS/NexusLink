"use client"
// NexusLink — اتصال socket.io مع جسر Nexus Protocol + إجراءات الطرف المرسل
import { io, type Socket } from "socket.io-client"

let socket: Socket | null = null

export function getCommsSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1200,
      timeout: 10000,
    })
  }
  return socket
}

// ---------- إجراءات: الكمبيوتر → الهاتف ----------

/** رد سريع من إشعار (للتطبيقات الداعمة) */
export function quickReply(n: { id: string; appId: string; appName: string }, text: string) {
  getCommsSocket().emit("phone:reply-action", {
    notifId: n.id,
    appId: n.appId,
    appName: n.appName,
    text,
  })
}

/** إرسال SMS من الكمبيوتر */
export function sendSmsToPhone(messageId: string, address: string, body: string, contactName?: string | null) {
  getCommsSocket().emit("phone:sms-send", { messageId, address, body, contactName: contactName ?? undefined })
}

/** طلب اتصال صادر من الكمبيوتر */
export function dialFromPc(callId: string, number: string, contactName?: string | null) {
  getCommsSocket().emit("phone:call-dial", { callId, number, contactName: contactName ?? undefined })
}

export function answerCall(callId: string) {
  getCommsSocket().emit("phone:call-answer", { callId })
}

export function rejectCall(callId: string) {
  getCommsSocket().emit("phone:call-reject", { callId })
}

export function endCallOnPhone(callId: string, durationSec: number, direction: "in" | "out", number: string, contactName?: string | null) {
  getCommsSocket().emit("phone:call-end", { callId, durationSec, direction, number, contactName: contactName ?? undefined })
}

/** مزامنة وضع عدم الإزعاج → الهاتف */
export function pushDndToPhone(enabled: boolean) {
  getCommsSocket().emit("phone:dnd-set", { enabled })
}

/** أزرار محاكي الهاتف */
export function simulate(kind: string) {
  getCommsSocket().emit("phone:simulate", { kind })
}

export function setAutoMode(enabled: boolean) {
  getCommsSocket().emit("phone:auto-mode", { enabled })
}
