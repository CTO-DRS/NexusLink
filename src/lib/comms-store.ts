"use client"
// NexusLink — مخزن طبقة الاتصالات الشخصية (zustand)
import { create } from "zustand"
import type {
  MirroredNotification, NotifFilter, SmsConversation, SmsMessage,
  CommsContact, CallLogEntry, PhoneState, LiveCall, PhoneLogEntry,
} from "./nexus/comms-types"

export interface CommsToast {
  id: string
  notification: MirroredNotification
  at: number
}

export type CommsTab = "notifications" | "messages" | "contacts" | "calls"

interface CommsState {
  bridgeReady: boolean
  setBridgeReady: (b: boolean) => void

  activeTab: CommsTab
  setActiveTab: (t: CommsTab) => void

  notifications: MirroredNotification[]
  setNotifications: (n: MirroredNotification[]) => void
  upsertNotification: (n: MirroredNotification) => void
  removeNotification: (id: string) => void

  toasts: CommsToast[]
  pushToast: (n: MirroredNotification) => void
  dismissToast: (id: string) => void

  filter: NotifFilter
  setFilter: (f: Partial<NotifFilter>) => void

  conversations: SmsConversation[]
  setConversations: (c: SmsConversation[]) => void
  upsertConversation: (c: SmsConversation) => void

  messages: Record<string, SmsMessage[]>
  setThread: (conversationId: string, msgs: SmsMessage[]) => void
  upsertMessage: (conversationId: string, m: SmsMessage) => void
  patchMessage: (messageId: string, status: SmsMessage["status"]) => void

  activeConversationId: string | null
  setActiveConversationId: (id: string | null) => void

  contacts: CommsContact[]
  setContacts: (c: CommsContact[]) => void

  calllog: CallLogEntry[]
  setCalllog: (l: CallLogEntry[]) => void
  prependCall: (c: CallLogEntry) => void

  phone: PhoneState
  setPhone: (p: Partial<PhoneState>) => void

  liveCall: LiveCall | null
  setLiveCall: (c: LiveCall | null) => void
  patchLiveCall: (patch: Partial<LiveCall>) => void

  phoneLogs: PhoneLogEntry[]
  pushPhoneLog: (l: PhoneLogEntry) => void

  // إحصاءات غير المقروء
  unreadNotifications: () => number
  unreadMessages: () => number
}

export const useComms = create<CommsState>((set, get) => ({
  bridgeReady: false,
  setBridgeReady: (b) => set({ bridgeReady: b }),

  activeTab: "notifications",
  setActiveTab: (t) => set({ activeTab: t }),

  notifications: [],
  setNotifications: (n) => set({ notifications: n }),
  upsertNotification: (n) =>
    set((s) => {
      const idx = s.notifications.findIndex((x) => x.id === n.id)
      const notifications = [...s.notifications]
      if (idx >= 0) notifications[idx] = n
      else notifications.unshift(n)
      return { notifications }
    }),
  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  toasts: [],
  pushToast: (n) =>
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id: n.id, notification: n, at: Date.now() }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  filter: { id: "main", hiddenApps: [], grouping: true, quietUntil: null, soundEnabled: true },
  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),

  conversations: [],
  setConversations: (c) => set({ conversations: c }),
  upsertConversation: (c) =>
    set((s) => {
      const idx = s.conversations.findIndex((x) => x.id === c.id)
      const conversations = [...s.conversations]
      if (idx >= 0) conversations[idx] = { ...conversations[idx], ...c }
      else conversations.unshift(c)
      conversations.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      return { conversations }
    }),

  messages: {},
  setThread: (cid, msgs) => set((s) => ({ messages: { ...s.messages, [cid]: msgs } })),
  upsertMessage: (cid, m) =>
    set((s) => {
      const arr = [...(s.messages[cid] ?? [])]
      const idx = arr.findIndex((x) => x.id === m.id)
      if (idx >= 0) arr[idx] = m
      else arr.push(m)
      return { messages: { ...s.messages, [cid]: arr } }
    }),
  patchMessage: (messageId, status) =>
    set((s) => {
      const messages = { ...s.messages }
      for (const cid of Object.keys(messages)) {
        const idx = messages[cid].findIndex((m) => m.id === messageId)
        if (idx >= 0) {
          const arr = [...messages[cid]]
          arr[idx] = { ...arr[idx], status }
          messages[cid] = arr
          break
        }
      }
      return { messages }
    }),

  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),

  contacts: [],
  setContacts: (c) => set({ contacts: c }),

  calllog: [],
  setCalllog: (l) => set({ calllog: l }),
  prependCall: (c) => set((s) => ({ calllog: [c, ...s.calllog] })),

  phone: { dnd: false, dndSource: null, autoMode: true, battery: 78, name: "Galaxy-S24" },
  setPhone: (p) => set((s) => ({ phone: { ...s.phone, ...p } })),

  liveCall: null,
  setLiveCall: (c) => set({ liveCall: c }),
  patchLiveCall: (patch) => {
    const cur = get().liveCall
    if (!cur) return
    set({ liveCall: { ...cur, ...patch } })
  },

  phoneLogs: [],
  pushPhoneLog: (l) => set((s) => ({ phoneLogs: [l, ...s.phoneLogs].slice(0, 60) })),

  unreadNotifications: () => get().notifications.filter((n) => n.status === "new").length,
  unreadMessages: () => get().conversations.reduce((acc, c) => acc + c.unread, 0),
}))

// ---------- أدوات مساعدة ----------
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`
  return name.slice(0, 2)
}

const AVATAR_COLORS = ["#0d9488", "#8b5cf6", "#e11d48", "#ea580c", "#0891b2", "#65a30d", "#d946ef", "#d97706"]
export function avatarColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function relTime(iso: string | number): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso
  const diff = Date.now() - t
  if (diff < 45e3) return "الآن"
  if (diff < 3600e3) return `منذ ${Math.round(diff / 60e3)} د`
  if (diff < 86400e3) return `منذ ${Math.round(diff / 3600e3)} س`
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short" }).format(new Date(t))
}

export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}
