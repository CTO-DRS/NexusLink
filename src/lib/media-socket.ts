"use client"
// NexusLink — عميل socket.io لجسر الوسائط والكاميرا (XTransformPort=3005)
import { io, type Socket } from "socket.io-client"

let socket: Socket | null = null

export function getMediaSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3005", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1200,
      timeout: 10000,
    })
    ;(window as unknown as { __nexusMediaSocket?: Socket }).__nexusMediaSocket = socket
  }
  return socket
}

// ---------- إرسال ----------

export function mediaRole(role: "pc" | "phone" | "tv", name?: string) {
  getMediaSocket().emit("media:role", { role, name })
}

/** إشارات WebRTC من هاتف حقيقي إلى الكمبيوتر (أو العكس) */
export function rtcSignal(ev: "rtc:offer" | "rtc:answer" | "rtc:ice", kind: "cam" | "mic" | "baby", payload: Record<string, unknown>) {
  getMediaSocket().emit(ev, { ...payload, kind })
}

export function camState(state: { deviceId: string; active: boolean; facing: string; real: boolean }) {
  getMediaSocket().emit("cam:state", state)
}

export function shutterRequest(timer: number) {
  getMediaSocket().emit("cam:shutter", { timer })
}

export function secMotion(source: string, level: number) {
  getMediaSocket().emit("sec:motion", { source, level })
}

export function babyAlert(from: string, level: number) {
  getMediaSocket().emit("baby:alert", { from, level })
}

export function castCmd(payload: Record<string, unknown>) {
  getMediaSocket().emit("cast:cmd", payload)
}

export function slideshowCmd(payload: Record<string, unknown>) {
  getMediaSocket().emit("slideshow:cmd", payload)
}

export function mediaPing(t: number) {
  getMediaSocket().emit("media:ping", { t })
}
