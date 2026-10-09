"use client"
// NexusLink — عميل socket.io لجسر الحماية (XTransformPort=3006)
import { io, type Socket } from "socket.io-client"

let socket: Socket | null = null

export function getGuardSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3006", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 1200,
      timeout: 10000,
    })
    // تسهيل التشخيص والاختبار من الكونسول
    ;(window as unknown as { __nexusGuardSocket?: Socket }).__nexusGuardSocket = socket
  }
  return socket
}

// ---------- منارة القرب ----------

/** منارة من الهاتف الحقيقي (صفحة /phone) */
export function proxBeacon(rssi: number, device = "galaxy-s24") {
  getGuardSocket().emit("prox:beacon", { rssi, device })
}

/** منارة محاكاة من الكمبيوتر (شرائح القرب اليدوية) */
export function proxSim(rssi: number) {
  getGuardSocket().emit("prox:sim", { rssi })
}

/** تحديث إعدادات محرك القرب على الجسر */
export function guardSettings(s: { enabled?: boolean; thresholdRssi?: number; graceSec?: number; autoUnlock?: boolean }) {
  getGuardSocket().emit("guard:settings", s)
}

// ---------- أوامر الكمبيوتر → الهاتف ----------

/** رنين قوي يتجاوز الوضع الصامت */
export function cmdRing(on: boolean) {
  getGuardSocket().emit(on ? "dev:ring" : "dev:ring-stop", { at: Date.now() })
}

/** إضاءة الشاشة / الفلاش على الهاتف */
export function cmdLight(on: boolean) {
  getGuardSocket().emit("dev:light", { on })
}

/** وضع الفقدان */
export function cmdLost(on: boolean, message?: string, callback?: string) {
  getGuardSocket().emit(on ? "dev:lost" : "dev:lost-off", { on, message, callback, at: Date.now() })
}

/** مسح عن بُعد */
export function cmdWipe() {
  getGuardSocket().emit("dev:wipe", { at: Date.now() })
}

/** أوامر المنبهات */
export function cmdAlarm(payload: { action: "add" | "update" | "delete" | "toggle"; alarm?: unknown; id?: string; enabled?: boolean; time?: string; label?: string }) {
  getGuardSocket().emit("dev:alarm", payload)
}

/** الإعدادات السريعة */
export function cmdQs(key: string, value: boolean | number) {
  getGuardSocket().emit("dev:qs", { key, value, at: Date.now() })
}

/** إدارة التطبيقات عن بُعد */
export function cmdApp(action: "open" | "uninstall" | "install", pkg: string, name?: string) {
  getGuardSocket().emit("dev:app", { action, pkg, name })
}

/** قفل الكمبيوتر يدوياً من لوحة الحماية */
export function proxManualLock() {
  getGuardSocket().emit("prox:manual-lock")
}

/** فتح القفل بكلمة المرور */
export function proxManualUnlock() {
  getGuardSocket().emit("prox:manual-unlock")
}

// ---------- الهاتف → الكمبيوتر ----------

/** إعلان الهاتف عن حالته (رن/فقدان/مسح/إعدادات) */
export function devState(state: Record<string, unknown>) {
  getGuardSocket().emit("dev:state", state)
}

/** الهاتف يطلب مزامنة الحالة الكاملة من الكمبيوتر */
export function devSyncRequest() {
  getGuardSocket().emit("dev:sync-request")
}

/** تأكيد وصول أمر */
export function devAcked(text: string) {
  getGuardSocket().emit("dev:acked", { text })
}
