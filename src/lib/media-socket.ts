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

/**
 * مصراع عن بُعد — FA-8: يمرر فلاش وكاميرا الهاتف الحقيقي (عقد §4.3)
 * [flash] يشعل الكشاف أثناء العد التنازلي ثم يلتقط، [camera] أمامية/خلفية.
 */
export function shutterRequest(timer: number, flash = false, camera: "front" | "back" = "back") {
  getMediaSocket().emit("cam:shutter", { timer, flash, camera })
}

/**
 * FA-8: أوامر وسائط للهاتف الحقيقي — قائمة بيضاء على الجسر:
 * cam-start/cam-stop/switch/torch/mic-start/mic-stop/baby-start/baby-stop/watch-start/watch-stop
 */
export function camCmd(
  action:
    | "cam-start" | "cam-stop" | "switch" | "torch"
    | "mic-start" | "mic-stop"
    | "baby-start" | "baby-stop"
    | "watch-start" | "watch-stop",
  extra?: { camera?: "front" | "back"; on?: boolean; sensitivity?: number },
) {
  getMediaSocket().emit("cam:cmd", { action, ...extra })
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

/**
 * §22 — حالة البث الحالية إلى كل المستقبلات (صفحة /tv على شاشة التلفاز
 * مثلًا): الوسائط + الوجهة + التشغيل/الصوت — المستقبل يبني تيار /api/preview
 * من device/path. إصدار واحد صغير لكل تغيّر (بلا تكرار زمني).
 */
export function castState(payload: Record<string, unknown>) {
  getMediaSocket().emit("cast:state", payload)
}

export function slideshowCmd(payload: Record<string, unknown>) {
  getMediaSocket().emit("slideshow:cmd", payload)
}

export function mediaPing(t: number) {
  getMediaSocket().emit("media:ping", { t })
}
