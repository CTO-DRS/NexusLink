"use client"
// NexusLink — مخزن طبقة الإنتاجية (المرحلة 9)
import { create } from "zustand"

export type ProdTab = "clipboard" | "folders" | "photos" | "handoff" | "profiles" | "backup"

export interface ProdClipItem {
  id: string
  deviceId: string
  deviceName: string
  kind: "text" | "image" | "file"
  content: string
  fileName?: string | null
  filePath?: string | null
  size: number
  mode: "auto" | "manual"
  received: boolean
  createdAt: number
  // §50 خزنة الحافظة الذكية — حقول إضافية (تظهر من الخادم بعد الترقية)
  pinned?: boolean
  sensitive?: string | null
  masked?: boolean
  expiresAt?: number | null
}

export interface SyncEventItem {
  id: string
  pairId: string
  relPath: string
  action: string // new-A2B | new-B2A | upd-A2B | upd-B2A | conflict
  bytes: number
  at: number
}

export interface SyncPairItem {
  id: string
  deviceA: string
  folderA: string
  deviceB: string
  folderB: string
  active: boolean
  autoSync: boolean
  lastSyncAt: number | null
  lastCount: number
  lastBytes: number
  running: boolean
  progress: number
  createdAt: number
  events?: SyncEventItem[]
}

export interface HandoffItemT {
  id: string
  deviceId: string
  deviceName: string
  kind: "link" | "video" | "article"
  title: string
  url: string
  position: number
  status: string // new | opened
  openedOn?: string | null
  openedAt?: number | null
  createdAt: number
}

export interface NetProfileT {
  id: string
  name: string
  icon: string
  networkName: string
  photoSync: boolean
  notifs: boolean
  clipboard: boolean
  folderSync: boolean
  builtin: boolean
}

export interface ProdStateT {
  network: string
  activeProfileId: string | null
  clipMode: "auto" | "manual"
  photoSync: boolean
  photoTarget: string
  notifsPaused: boolean
}

export interface PhotoSynced {
  name: string
  path: string
  size: number
  mtime: number
}

export interface SnapshotT {
  id: string
  label: string
  sizeBytes: number
  devicesCount: number
  profilesCount: number
  pairsCount: number
  createdAt: number
}

export interface ProdLogItem {
  id: string
  text: string
  kind: "in" | "ok" | "info" | "warn"
  at: number
}

interface ProdStore {
  tab: ProdTab
  setTab: (t: ProdTab) => void

  bridgeOnline: boolean
  setBridgeOnline: (b: boolean) => void

  state: ProdStateT
  setState: (s: Partial<ProdStateT>) => void
  profile: NetProfileT | null
  setProfile: (p: NetProfileT | null) => void
  networks: string[]

  // الحافظة الموحدة
  clips: ProdClipItem[]
  setClips: (c: ProdClipItem[]) => void
  addClip: (c: ProdClipItem) => void
  unseenClips: number
  clearUnseen: () => void
  sysClipboardArmed: boolean // وصل آخر نص من الهاتف إلى حافظة النظام
  setSysClipboardArmed: (b: boolean) => void
  pasteZoneText: string
  setPasteZoneText: (t: string) => void

  // المزامنة
  pairs: SyncPairItem[]
  setPairs: (p: SyncPairItem[]) => void
  patchPair: (id: string, patch: Partial<SyncPairItem>) => void

  // الصور
  photos: PhotoSynced[]
  setPhotos: (p: PhotoSynced[]) => void

  // التسليم
  handoff: HandoffItemT[]
  setHandoff: (h: HandoffItemT[]) => void
  patchHandoff: (id: string, patch: Partial<HandoffItemT>) => void

  // ملفات التعريف
  profiles: NetProfileT[]
  setProfiles: (p: NetProfileT[]) => void

  // النسخ الاحتياطي
  snapshots: SnapshotT[]
  setSnapshots: (s: SnapshotT[]) => void

  // السجل والاختبار
  logs: ProdLogItem[]
  pushLog: (text: string, kind?: ProdLogItem["kind"]) => void
  checks: Record<string, boolean>
  setCheck: (k: string) => void
  celebrated: boolean
  setCelebrated: (b: boolean) => void
}

export const useProd = create<ProdStore>((set, get) => ({
  tab: "clipboard",
  setTab: (t) => {
    set({ tab: t })
    if (t === "clipboard") get().clearUnseen()
  },

  bridgeOnline: false,
  setBridgeOnline: (b) => set({ bridgeOnline: b }),

  state: { network: "منزل-5GHz", activeProfileId: null, clipMode: "auto", photoSync: true, photoTarget: "/Pictures/FromPhone", notifsPaused: false },
  setState: (s) => set({ state: { ...get().state, ...s } }),
  profile: null,
  setProfile: (p) => set({ profile: p }),
  networks: ["منزل-5GHz", "Office-Net", "Cafe-Guest"],

  clips: [],
  setClips: (c) => set({ clips: c }),
  addClip: (c) => {
    const isPc = c.deviceId === "pc-office"
    // FA-clipboard-sync — السجل التعاقدي: آخر 50 عنصرًا (عقد §11)
    set({ clips: [c, ...get().clips].slice(0, 50), unseenClips: isPc ? get().unseenClips : get().unseenClips + 1 })
  },
  unseenClips: 0,
  clearUnseen: () => set({ unseenClips: 0 }),
  sysClipboardArmed: false,
  setSysClipboardArmed: (b) => set({ sysClipboardArmed: b }),
  pasteZoneText: "",
  setPasteZoneText: (t) => set({ pasteZoneText: t }),

  pairs: [],
  setPairs: (p) => set({ pairs: p }),
  patchPair: (id, patch) =>
    set({ pairs: get().pairs.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),

  photos: [],
  setPhotos: (p) => set({ photos: p }),

  handoff: [],
  setHandoff: (h) => set({ handoff: h }),
  patchHandoff: (id, patch) =>
    set({ handoff: get().handoff.map((h) => (h.id === id ? { ...h, ...patch } : h)) }),

  profiles: [],
  setProfiles: (p) => set({ profiles: p }),

  snapshots: [],
  setSnapshots: (s) => set({ snapshots: s }),

  logs: [],
  pushLog: (text, kind = "info") =>
    set({ logs: [{ id: Math.random().toString(36).slice(2) + Date.now(), text, kind, at: Date.now() }, ...get().logs].slice(0, 80) }),

  checks: {},
  setCheck: (k) => {
    if (get().checks[k]) return
    set({ checks: { ...get().checks, [k]: true } })
  },
  celebrated: false,
  setCelebrated: (b) => set({ celebrated: b }),
}))
