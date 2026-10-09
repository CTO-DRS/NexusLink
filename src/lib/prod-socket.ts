"use client"
// NexusLink — عميل socket.io لجسر الإنتاجية (XTransformPort=3007)
import { io, type Socket } from "socket.io-client"

let socket: Socket | null = null

export function getProdSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3007", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 1200,
      timeout: 10000,
    })
    ;(window as unknown as { __nexusProdSocket?: Socket }).__nexusProdSocket = socket
  }
  return socket
}

// ---------- الحافظة الموحدة ----------

/** دفع عنصر حافظة من الهاتف (أو الكمبيوتر) — يُبث للجميع ويُخزن */
export function clipPush(d: {
  deviceId?: string; deviceName?: string; kind?: "text" | "image" | "file"
  content?: string; fileName?: string; filePath?: string; size?: number; mode?: "auto" | "manual"
}) {
  getProdSocket().emit("clip:push", d)
}

/** مسح الحافظة الموحدة */
export function clipClear() {
  getProdSocket().emit("clip:clear")
}

// ---------- التسليم: أكمل من حيث توقفت ----------

/** إرسال عنصر تسليم (رابط/فيديو/مقال) — موجود مسبقاً بمعرّف أو جديد */
export function handPush(d: { id?: string; deviceId?: string; deviceName?: string; kind?: string; title?: string; url?: string; position?: number }) {
  getProdSocket().emit("hand:push", d)
}

/** تعليم عنصر كمفتوح على جهاز */
export function handOpened(id: string, openedOn?: string) {
  getProdSocket().emit("hand:opened", { id, openedOn })
}

// ---------- الصور ----------

/** طلب توليد صورة جديدة على الهاتف ثم مزامنتها تلقائياً */
export function photoNewRequest() {
  getProdSocket().emit("photo:new-request")
}

// ---------- الشبكة ----------

/** تبديل الشبكة الحالية (محاكاة انتقال) — يطبّق الملف الشخصي المطابق */
export function netSet(network: string) {
  getProdSocket().emit("net:set", { network })
}
