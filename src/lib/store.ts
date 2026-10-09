"use client"
import { create } from "zustand"
import type { FsEntry, NexusDevice, TransferJob } from "./nexus/types"

export type ViewId = "devices" | "files" | "transfers" | "storage" | "comms" | "simulator" | "remote" | "media" | "guard" | "settings"
export type SortKey = "name" | "size" | "mtime" | "category"
export type ViewMode = "grid" | "list"

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
}))

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
  return `${fmtSize(bps)}/ث`
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}
