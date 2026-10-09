// NexusLink — shared types
export type FsCategory =
  | "image" | "video" | "audio" | "pdf" | "text" | "apk" | "zip" | "other"

export interface FsEntry {
  name: string
  path: string // virtual path relative to device root, always starts with "/"
  type: "dir" | "file"
  size: number
  mtime: number
  ext: string
  category: FsCategory
  mime?: string
}

export type DeviceKind = "phone" | "tablet" | "desktop" | "tv"
export type ConnState = "connected" | "offline" | "pairing"
export type ConnMode = "wifi" | "hotspot" | "usb"

export interface NexusDevice {
  id: string
  name: string
  kind: DeviceKind
  state: ConnState
  mode: ConnMode
  ip: string
  battery: number
  storageTotal: number
  storageUsed: number
  lastSeen: number
  rttMs: number
  pairedAt: number
  trusted: boolean
}

export type TransferStatus =
  | "queued" | "active" | "paused" | "done" | "error"

export interface TransferJob {
  id: string
  deviceId: string
  deviceName: string
  direction: "out" | "in" // out: this device -> remote, in: remote -> this device
  fileName: string
  srcPath: string
  destPath: string
  totalBytes: number
  transferred: number
  status: TransferStatus
  speedBps: number
  chunksTotal: number
  chunksDone: number
  chunkSize: number
  startedAt: number
  error?: string
}

export interface StorageCategory {
  category: string
  bytes: number
  count: number
}

export interface StorageAnalysis {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  categories: StorageCategory[]
  folders: { name: string; path: string; bytes: number; count: number }[]
}

export interface DuplicateGroup {
  hash: string
  size: number
  files: FsEntry[]
}
