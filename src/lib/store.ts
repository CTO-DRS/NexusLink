"use client"
import { create } from "zustand"
import type { FsEntry, NexusDevice, TransferJob } from "./nexus/types"

export type ViewId = "devices" | "files" | "transfers" | "storage" | "comms" | "simulator" | "remote" | "media" | "guard" | "prod" | "security" | "automation" | "tools" | "settings"
export type SortKey = "name" | "size" | "mtime" | "category"
export type ViewMode = "grid" | "list"

export type ShortcutAction =
  | "palette"
  | "help"
  | "devices"
  | "files"
  | "transfers"
  | "comms"
  | "security"
  | "tools"
  | "settings"
  | "sendFile"
  | "lock"
  | "theme"
  | "lang"
  | "contrast"
  | "speedtest"
  | "dnd"
  | "sendClipboard"
  | "toggleWindow"

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  palette: "Ctrl+K",
  help: "?",
  devices: "Alt+1",
  files: "Alt+2",
  transfers: "Alt+3",
  comms: "Alt+4",
  security: "Alt+5",
  tools: "Alt+6",
  settings: "Alt+7",
  sendFile: "Ctrl+Shift+F",
  lock: "Ctrl+Shift+L",
  theme: "Ctrl+Shift+D",
  lang: "Ctrl+Shift+E",
  contrast: "Ctrl+Shift+H",
  speedtest: "Ctrl+Shift+S",
  dnd: "Ctrl+Shift+M",
  sendClipboard: "Ctrl+Shift+N",
  toggleWindow: "Ctrl+Shift+D",
}

export const SHORTCUT_META: Record<ShortcutAction, string> = {
  palette: "لوحة الأوامر",
  help: "دليل الاختصارات",
  devices: "شاشة الأجهزة",
  files: "شاشة الملفات",
  transfers: "شاشة النقل",
  comms: "شاشة الاتصالات",
  security: "شاشة الأمان",
  tools: "شاشة الأدوات",
  settings: "شاشة الإعدادات",
  sendFile: "إرسال ملف سريع",
  lock: "قفل التطبيق",
  theme: "تبديل المظهر",
  lang: "تبديل اللغة (دورة الست)",
  contrast: "تبديل التباين العالي",
  speedtest: "بدء اختبار السرعة",
  dnd: "تبديل عدم الإزعاج",
  sendClipboard: "إرسال الحافظة للهاتف (سطح المكتب)",
  toggleWindow: "إظهار/إخفاء النافذة (سطح المكتب)",
}

interface NexusState {
  view: ViewId
  setView: (v: ViewId) => void

  theme: "light" | "dark"
  toggleTheme: () => void

  devices: NexusDevice[]
  setDevices: (d: NexusDevice[]) => void
  activeDeviceId: string
  setActiveDeviceId: (id: string) => void

  // file browser
  cwd: string
  setCwd: (p: string) => void
  entries: FsEntry[]
  setEntries: (e: FsEntry[]) => void
  loading: boolean
  setLoading: (b: boolean) => void
  selection: Set<string>
  toggleSelect: (p: string) => void
  clearSelection: () => void
  selectAll: () => void
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
  sortKey: SortKey
  sortAsc: boolean
  setSort: (k: SortKey) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  searchResults: FsEntry[] | null
  setSearchResults: (r: FsEntry[] | null) => void

  previewEntry: FsEntry | null
  setPreviewEntry: (e: FsEntry | null) => void

  transfers: TransferJob[]
  setTransfers: (t: TransferJob[]) => void

  // ---- Stage 11: polish ----
  fontScale: 1 | 1.125 | 1.25
  setFontScale: (s: 1 | 1.125 | 1.25) => void
  contrast: "normal" | "high"
  setContrast: (c: "normal" | "high") => void
  motion: "full" | "reduced"
  setMotion: (m: "full" | "reduced") => void
  srMode: boolean
  setSrMode: (b: boolean) => void

  shortcuts: Record<ShortcutAction, string>
  setShortcut: (a: ShortcutAction, combo: string) => void
  resetShortcuts: () => void

  onboarded: boolean
  setOnboarded: (b: boolean) => void
  onboardingOpen: boolean
  setOnboardingOpen: (b: boolean) => void
  paletteOpen: boolean
  setPaletteOpen: (b: boolean) => void
  shortcutsHelpOpen: boolean
  setShortcutsHelpOpen: (b: boolean) => void

  autostart: boolean
  setAutostart: (b: boolean) => void
  silentUpdates: boolean
  setSilentUpdates: (b: boolean) => void
  batterySaver: boolean
  setBatterySaver: (b: boolean) => void

  applyAppearance: () => void
  locked: boolean
  setLocked: (b: boolean) => void
}

export const useNexus = create<NexusState>((set, get) => ({
  view: "devices",
  setView: (v) => set({ view: v }),

  theme: "light",
  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light"
    set({ theme: next })
    try {
      localStorage.setItem("nexus-theme", next)
    } catch { /* ignore */ }
    document.documentElement.classList.toggle("dark", next === "dark")
  },

  devices: [],
  setDevices: (d) => set({ devices: d }),
  activeDeviceId: "galaxy-s24",
  setActiveDeviceId: (id) =>
    set({ activeDeviceId: id, cwd: "/", entries: [], selection: new Set(), searchResults: null }),

  cwd: "/",
  setCwd: (p) => set({ cwd: p, selection: new Set(), searchResults: null }),
  entries: [],
  setEntries: (e) => set({ entries: e }),
  loading: false,
  setLoading: (b) => set({ loading: b }),
  selection: new Set<string>(),
  toggleSelect: (p) => {
    const s = new Set(get().selection)
    if (s.has(p)) s.delete(p)
    else s.add(p)
    set({ selection: s })
  },
  clearSelection: () => set({ selection: new Set() }),
  selectAll: () => set({ selection: new Set(get().entries.map((e) => e.path)) }),
  viewMode: "grid",
  setViewMode: (m) => set({ viewMode: m }),
  sortKey: "name",
  sortAsc: true,
  setSort: (k) => {
    if (get().sortKey === k) set({ sortAsc: !get().sortAsc })
    else set({ sortKey: k, sortAsc: true })
  },
  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),
  searchResults: null,
  setSearchResults: (r) => set({ searchResults: r }),

  previewEntry: null,
  setPreviewEntry: (e) => set({ previewEntry: e }),

  transfers: [],
  setTransfers: (t) => set({ transfers: t }),

  // ---- Stage 11 ----
  fontScale: 1,
  setFontScale: (s) => {
    set({ fontScale: s })
    try {
      localStorage.setItem("nexus-font-scale", String(s))
    } catch { /* ignore */ }
    get().applyAppearance()
  },
  contrast: "normal",
  setContrast: (c) => {
    set({ contrast: c })
    try {
      localStorage.setItem("nexus-contrast", c)
    } catch { /* ignore */ }
    get().applyAppearance()
  },
  motion: "full",
  setMotion: (m) => {
    set({ motion: m })
    try {
      localStorage.setItem("nexus-motion", m)
    } catch { /* ignore */ }
    get().applyAppearance()
  },
  srMode: false,
  setSrMode: (b) => {
    set({ srMode: b })
    try {
      localStorage.setItem("nexus-sr", b ? "1" : "0")
    } catch { /* ignore */ }
  },

  shortcuts: { ...DEFAULT_SHORTCUTS },
  setShortcut: (a, combo) => {
    const next = { ...get().shortcuts, [a]: combo }
    set({ shortcuts: next })
    try {
      localStorage.setItem("nexus-shortcuts", JSON.stringify(next))
    } catch { /* ignore */ }
  },
  resetShortcuts: () => {
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } })
    try {
      localStorage.removeItem("nexus-shortcuts")
    } catch { /* ignore */ }
  },

  onboarded: false,
  setOnboarded: (b) => {
    set({ onboarded: b })
    try {
      localStorage.setItem("nexus-onboarded", b ? "1" : "0")
    } catch { /* ignore */ }
  },
  onboardingOpen: false,
  setOnboardingOpen: (b) => set({ onboardingOpen: b }),
  paletteOpen: false,
  setPaletteOpen: (b) => set({ paletteOpen: b }),
  shortcutsHelpOpen: false,
  setShortcutsHelpOpen: (b) => set({ shortcutsHelpOpen: b }),

  autostart: false,
  setAutostart: (b) => {
    set({ autostart: b })
    try {
      localStorage.setItem("nexus-autostart", b ? "1" : "0")
    } catch { /* ignore */ }
  },
  silentUpdates: true,
  setSilentUpdates: (b) => {
    set({ silentUpdates: b })
    try {
      localStorage.setItem("nexus-silent-updates", b ? "1" : "0")
    } catch { /* ignore */ }
  },
  batterySaver: false,
  setBatterySaver: (b) => {
    set({ batterySaver: b })
    try {
      localStorage.setItem("nexus-battery", b ? "1" : "0")
    } catch { /* ignore */ }
  },

  applyAppearance: () => {
    if (typeof document === "undefined") return
    const { fontScale, contrast, motion } = get()
    const html = document.documentElement
    html.style.fontSize = `${16 * fontScale}px`
    html.classList.toggle("contrast-high", contrast === "high")
    html.classList.toggle("motion-reduced", motion === "reduced")
  },

  locked: false,
  setLocked: (b) => set({ locked: b }),
}))

/** restore persisted Stage-11 prefs (call once on app mount) */
export function initPolishPrefs() {
  try {
    const fs = localStorage.getItem("nexus-font-scale")
    const ct = localStorage.getItem("nexus-contrast")
    const mo = localStorage.getItem("nexus-motion")
    const sr = localStorage.getItem("nexus-sr")
    const sc = localStorage.getItem("nexus-shortcuts")
    const ob = localStorage.getItem("nexus-onboarded")
    const au = localStorage.getItem("nexus-autostart")
    const su = localStorage.getItem("nexus-silent-updates")
    const ba = localStorage.getItem("nexus-battery")
    useNexus.setState({
      fontScale: fs === "1.125" ? 1.125 : fs === "1.25" ? 1.25 : 1,
      contrast: ct === "high" ? "high" : "normal",
      motion: mo === "reduced" ? "reduced" : "full",
      srMode: sr === "1",
      shortcuts: sc ? { ...DEFAULT_SHORTCUTS, ...JSON.parse(sc) } : { ...DEFAULT_SHORTCUTS },
      onboarded: ob === "1",
      autostart: au === "1",
      silentUpdates: su !== "0",
      batterySaver: ba === "1",
    })
  } catch { /* ignore */ }
  useNexus.getState().applyAppearance()
}

// ---------- formatting helpers ----------
export function fmtSize(bytes: number): string {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function fmtDate(ms: number): string {
  if (!ms) return "—"
  try {
    return new Intl.DateTimeFormat("ar", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleDateString()
  }
}

export function fmtSpeed(bps: number): string {
  if (bps <= 0) return "—"
  let suffix = "/ث"
  try {
    const l = localStorage.getItem("nexus-lang")
    if (l === "en") suffix = "/s"
  } catch { /* ignore */ }
  return `${fmtSize(bps)}${suffix}`
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}
