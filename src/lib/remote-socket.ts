"use client"
// NexusLink — عميل socket.io لجسر التحكم عن بُعد (XTransformPort=3004)
import { io, type Socket } from "socket.io-client"
import type {
  RcClickPayload, RcClipboardPayload, RcGamepadPayload, RcKeyPayload,
  RcMediaPayload, RcPowerPayload, RcPresenterPayload, RcSource, DesktopStateReport,
} from "./remote-types"

let socket: Socket | null = null

// ------------------------------------------------------------------
// PERF (عقد §29) — قياس استجابة التحكم: كل أمر متقطع يحمل ختم قياس
// `__m: { mid, mt }` (معرّف وحيد + طابع المرسل)، ويعيد جسر الكمبيوتر
// `rc:ack { mid, mt, ev, at }` بعد تطبيق الأمر — وحدة التحكم تحسب
// RTT من ساعتها (t0 → وصول الإقرار) عبر المسار كاملًا (بوابة + مرحّل + جسر).
// الأوامر عالية التردد (move/scroll/pinch/pointer) بلا ختم — النبض يغطي القناة.
// ------------------------------------------------------------------
export interface MidStamp {
  mid: string
  mt: number
}

const pendingAcks = new Map<string, { ev: string; t0: number }>()
const PENDING_CAP = 64
let midSeq = 0

/** ختم قياس لأمر متقطع + تسجيله بانتظار الإقرار */
function stampMid(ev: string): MidStamp {
  const mid = `m-${Date.now().toString(36)}-${(++midSeq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  if (pendingAcks.size >= PENDING_CAP) {
    const oldest = pendingAcks.keys().next().value
    if (oldest) pendingAcks.delete(oldest)
  }
  pendingAcks.set(mid, { ev, t0: Date.now() })
  return { mid, mt: Date.now() }
}

/** استهلاك إقرار وصل (من معالج rc:ack في خطاف وحدة التحكم) */
export function consumeAck(mid: string): { ev: string; t0: number } | null {
  const p = pendingAcks.get(mid)
  if (!p) return null
  pendingAcks.delete(mid)
  return p
}

/** عدد القياسات المعلّقة (تشخيص) */
export function pendingAckCount(): number {
  return pendingAcks.size
}

/** هل الحدث من الأوامر المتقطعة المقيسة؟ (عقد §29) */
export const MEASURED_EVENTS = new Set([
  "rc:click", "rc:key", "rc:presenter", "rc:media", "rc:power", "rc:clipboard", "rc:handoff",
])

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
    // FA-input (عقد §13) — في وضع سطح المكتب، وحدة التحكم الويبية هي واجهة
    // الكمبيوتر نفسها (صاحب الجهاز) — تسجلها ليميّزها الجسر عن الأجهزة البعيدة
    // (حقن __src=desktop). في المتصفح العادي لا تسجيل (سلوك قائم كما هو).
    if (typeof window !== "undefined" && (window as unknown as { __NEXUS_DESKTOP__?: boolean }).__NEXUS_DESKTOP__) {
      import("./tauri")
        .then(({ tauriInvoke }) =>
          tauriInvoke<string>("system_mac")
            .then((mac) => socket?.emit("desktop:register", { name: "NEXUS-PC", mac }))
            .catch(() => null),
        )
        .catch(() => null)
    }
  }
  return socket
}

// ---------- إرسال: الهاتف → الكمبيوتر ----------

/** حركة المؤشر (لوحة لمس / ماوس هوائي) */
export function rcMove(dx: number, dy: number, source: RcSource) {
  getRemoteSocket().emit("rc:move", { dx, dy, source })
}

/** نقرة (متقطعة — مقيسة §29) */
export function rcClick(button: "left" | "right", type: "tap" | "double" = "tap") {
  getRemoteSocket().emit("rc:click", { button, type, __m: stampMid("rc:click") })
}

/** تمرير بعصريْن */
export function rcScroll(dy: number) {
  getRemoteSocket().emit("rc:scroll", { dy })
}

/** قرص للتكبير/التصغير */
export function rcPinch(scale: number) {
  getRemoteSocket().emit("rc:pinch", { scale })
}

/** ضغطة مفتاح (متقطعة — مقيسة §29) */
export function rcKey(payload: RcKeyPayload) {
  getRemoteSocket().emit("rc:key", { ...payload, __m: stampMid("rc:key") })
}

/** إدخال يد الألعاب — الأزرار متقطعة فتُقاس، والعصا عالية التردد بلا ختم */
export function rcGamepad(payload: RcGamepadPayload) {
  const measured = payload.kind === "button" ? { __m: stampMid("rc:gamepad") } : {}
  getRemoteSocket().emit("rc:gamepad", { ...payload, ...measured })
}

/** أوامر العرض التقديمي — laser-move عالية التردد بلا ختم */
export function rcPresenter(payload: RcPresenterPayload) {
  const measured = payload.action === "laser-move" ? {} : { __m: stampMid("rc:presenter") }
  getRemoteSocket().emit("rc:presenter", { ...payload, ...measured })
}

/** أوامر الوسائط (متقطعة — مقيسة §29؛ volume شريط متصل لكنه منخفض التردد فتُقاس) */
export function rcMedia(payload: RcMediaPayload) {
  getRemoteSocket().emit("rc:media", { ...payload, __m: stampMid("rc:media") })
}

/** أوامر النظام (متقطعة — مقيسة §29) */
export function rcPower(payload: RcPowerPayload) {
  getRemoteSocket().emit("rc:power", { ...payload, __m: stampMid("rc:power") })
}

/** حزمة Wake-on-LAN */
export function rcWakeLan(mac: string) {
  getRemoteSocket().emit("rc:wol", { mac })
}

/** مزامنة الحافظة (متقطعة — مقيسة §29) */
export function rcClipboard(payload: RcClipboardPayload) {
  getRemoteSocket().emit("rc:clipboard", { ...payload, __m: stampMid("rc:clipboard") })
}

/** FA-9: تسليم رابط "أكمل من حيث توقفت" إلى الكمبيوتر (متقطعة — مقيسة §29) */
export function rcHandoff(url: string, title?: string) {
  getRemoteSocket().emit("rc:handoff", { url, title, __m: stampMid("rc:handoff") })
}

/** قياس زمن الاستجابة */
export function rcPing(t: number) {
  getRemoteSocket().emit("rc:ping", { t })
}

// ---------- PERF (عقد §29): إقرار جسر الكمبيوتر ----------

/** إقرار تطبيق أمر مقيس — من دور الكمبيوتر، بلا محتوى (معرفات وأطواب حصرًا) */
export function rcAck(mid: string, mt: number, ev: string) {
  getRemoteSocket().emit("rc:ack", { mid, mt, ev, at: Date.now() })
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
