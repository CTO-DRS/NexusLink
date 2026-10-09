"use client"
// NexusLink — عميل socket.io لجسر التحكم عن بُعد (XTransformPort=3004)
import { io, type Socket } from "socket.io-client"
import type {
  RcClickPayload, RcClipboardPayload, RcGamepadPayload, RcKeyPayload,
  RcMediaPayload, RcPowerPayload, RcPresenterPayload, RcSource, DesktopStateReport,
} from "./remote-types"

let socket: Socket | null = null

export function getRemoteSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3004", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1200,
      timeout: 10000,
    })
    // تسهيل التشخيص في وحدة التحكم
    ;(window as unknown as { __nexusRemoteSocket?: Socket }).__nexusRemoteSocket = socket
  }
  return socket
}

// ---------- إرسال: الهاتف → الكمبيوتر ----------

/** حركة المؤشر (لوحة لمس / ماوس هوائي) */
export function rcMove(dx: number, dy: number, source: RcSource) {
  getRemoteSocket().emit("rc:move", { dx, dy, source })
}

/** نقرة */
export function rcClick(button: "left" | "right", type: "tap" | "double" = "tap") {
  getRemoteSocket().emit("rc:click", { button, type })
}

/** تمرير بعصريْن */
export function rcScroll(dy: number) {
  getRemoteSocket().emit("rc:scroll", { dy })
}

/** قرص للتكبير/التصغير */
export function rcPinch(scale: number) {
  getRemoteSocket().emit("rc:pinch", { scale })
}

/** ضغطة مفتاح */
export function rcKey(payload: RcKeyPayload) {
  getRemoteSocket().emit("rc:key", payload)
}

/** إدخال يد الألعاب */
export function rcGamepad(payload: RcGamepadPayload) {
  getRemoteSocket().emit("rc:gamepad", payload)
}

/** أوامر العرض التقديمي */
export function rcPresenter(payload: RcPresenterPayload) {
  getRemoteSocket().emit("rc:presenter", payload)
}

/** أوامر الوسائط */
export function rcMedia(payload: RcMediaPayload) {
  getRemoteSocket().emit("rc:media", payload)
}

/** أوامر النظام */
export function rcPower(payload: RcPowerPayload) {
  getRemoteSocket().emit("rc:power", payload)
}

/** حزمة Wake-on-LAN */
export function rcWakeLan(mac: string) {
  getRemoteSocket().emit("rc:wol", { mac })
}

/** مزامنة الحافظة */
export function rcClipboard(payload: RcClipboardPayload) {
  getRemoteSocket().emit("rc:clipboard", payload)
}

/** قياس زمن الاستجابة */
export function rcPing(t: number) {
  getRemoteSocket().emit("rc:ping", { t })
}

// ---------- إرسال: الكمبيوتر → الهاتف ----------

/** تسجيل الكمبيوتر عند الجسر */
export function desktopRegister(name: string, mac: string) {
  getRemoteSocket().emit("desktop:register", { name, mac })
}

/** بث تقرير الحالة للهواتف */
export function pushDesktopState(report: DesktopStateReport) {
  getRemoteSocket().emit("desktop:state", report)
}

/** دفع نص الحافظة من الكمبيوتر إلى الهاتف */
export function pushDesktopClipboard(text: string) {
  getRemoteSocket().emit("desktop:clipboard", { text, at: Date.now() })
}
