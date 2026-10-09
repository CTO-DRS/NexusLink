// NexusLink — طبقة الاتصالات الشخصية: أنواع مشتركة (عميل + خادم)

export interface CommsAppMeta {
  id: string
  name: string
  color: string
  actionable: boolean
}

export const COMMS_APPS: CommsAppMeta[] = [
  { id: "whatsapp",  name: "واتساب",    color: "#25D366", actionable: true },
  { id: "telegram",  name: "تيليجرام",  color: "#229ED9", actionable: true },
  { id: "gmail",     name: "Gmail",     color: "#EA4335", actionable: false },
  { id: "instagram", name: "إنستغرام",  color: "#E1306C", actionable: false },
  { id: "youtube",   name: "YouTube",   color: "#FF0000", actionable: false },
  { id: "slack",     name: "Slack",     color: "#611f69", actionable: true },
  { id: "sms",       name: "الرسائل",   color: "#0d9488", actionable: true },
]

export function appMeta(appId: string): CommsAppMeta {
  return (
    COMMS_APPS.find((a) => a.id === appId) ?? {
      id: appId, name: appId, color: "#64748b", actionable: false,
    }
  )
}

// ---------- الإشعارات ----------
export type NotifStatus = "new" | "read" | "replied" | "muted" | "hidden" | "archived"

export interface MirroredNotification {
  id: string
  appId: string
  appName: string
  title: string
  body: string
  deviceId: string
  actionable: boolean
  status: NotifStatus
  replyText: string | null
  createdAt: string
}

export interface NotifFilter {
  id: string
  hiddenApps: string[]
  grouping: boolean
  quietUntil: string | null
  soundEnabled: boolean
}

// ---------- SMS ----------
export type MsgDirection = "in" | "out"
export type MsgStatus = "sending" | "sent" | "delivered" | "read"

export interface SmsMessage {
  id: string
  conversationId: string
  body: string
  direction: MsgDirection
  status: MsgStatus
  createdAt: string
}

export interface SmsConversation {
  id: string
  address: string
  contactName: string | null
  unread: number
  updatedAt: string
  lastMessage?: string
}

// ---------- جهات الاتصال والمكالمات ----------
export interface CommsContact {
  id: string
  name: string
  phone: string
  email: string | null
  favorite: boolean
}

export type CallDirection = "in" | "out" | "missed"

export interface CallLogEntry {
  id: string
  number: string
  contactName: string | null
  direction: CallDirection
  startedAt: string
  durationSec: number
}

// ---------- حالة الهاتف ----------
export interface PhoneState {
  dnd: boolean
  dndSource: "pc" | "phone" | null
  autoMode: boolean
  battery: number
  name: string
}

// ---------- المكالمة الحية ----------
export type LiveCallState = "incoming" | "outgoing" | "ringing" | "active"

export interface LiveCall {
  callId: string
  number: string
  contactName?: string
  direction: "in" | "out"
  state: LiveCallState
  startedAt: number | null // لحظة الاتصال الفعلي
  dbRecordId?: string
}

// ---------- سجل الهاتف ----------
export interface PhoneLogEntry {
  id: string
  text: string
  kind: "info" | "in" | "out" | "ok"
  at: number
}

// ---------- أحداث Nexus Protocol (socket) ----------
export interface BridgeHello {
  phone: { name: string; dnd: boolean; autoMode: boolean; battery: number }
  at: number
}
