"use client"
// NexusLink — المرحلة 10: حالة طبقة الأمان (zustand)
import { create } from "zustand"

export type SecTab = "crypto" | "capture" | "applock" | "perms" | "audit" | "wipe" | "stealth"

export interface SecPeerInfo { deviceId: string; name: string; role: string; pub: string | null; eph: string | null }
export interface WireRow { id: string; at: number; channel: string; from: string; to: string; kind: string; len: number; hex: string; b64: string; encrypted: boolean }
export interface AuditRow { id: string; at: number; actor: string; deviceId?: string | null; action: string; detail: string; severity: string; stealth: boolean }
export interface PermRow { id?: string; feature: string; deviceId: string; enabled: boolean }
export interface AlertRow { id: string; probeId: string; deviceId: string; name: string; kind: string; at: number; resolved: string | null }
export interface PhoneLockState { locked: boolean; hasPin: boolean; hasPattern: boolean; hasBiometric: boolean; autoLockSec: number; lastUnlockAt?: number }

export interface LiveTransfer {
  name: string; size: number; sent: number; stealth: boolean; direction: "out" | "in";
  status: "active" | "done" | "error" | "denied"; error?: string; hashOk?: boolean; startedAt: number
}
export interface WipeJobUI { file: string; pass: number; totalPasses: number; pattern: string; pct: number; phase: string }
export interface WipeResultUI { ok: boolean; file: string; size?: number; passes?: { index: number; pattern: string; bytes: number; ms: number }[]; hashBefore?: string; verifyGone?: boolean; error?: string }

interface SecState {
  bridgeOnline: boolean
  tab: SecTab
  setTab: (t: SecTab) => void

  // مصافحة المفاتيح
  myPub: string | null
  myFingerprint: string
  peer: SecPeerInfo | null
  kexDone: boolean
  sas: { emoji: string; hex: string } | null
  sasConfirmed: boolean
  rotations: number
  framesSent: number
  bytesOnWire: number
  setKex: (p: { myPub: string | null; myFingerprint: string; peer: SecPeerInfo | null; kexDone: boolean; sas: { emoji: string; hex: string } | null }) => void
  confirmSas: () => void
  setCounters: (c: { rotations?: number; framesSent?: number; bytesOnWire?: number }) => void
  setBridgeOnline: (b: boolean) => void

  // الالتقاط
  wire: WireRow[]
  addWire: (f: WireRow) => void
  setWire: (f: WireRow[]) => void
  capturePaused: boolean
  toggleCapturePaused: () => void
  leakScan: { needle: string; hits: number | null; scannedBytes: number } | null
  setLeakScan: (s: { needle: string; hits: number | null; scannedBytes: number } | null) => void

  // التنبيهات
  alerts: AlertRow[]
  addAlert: (a: AlertRow) => void
  resolveAlert: (alertId: string, decision: string) => void

  // الصلاحيات
  perms: PermRow[]
  setPerms: (p: PermRow[]) => void
  upsertPerm: (p: PermRow) => void

  // التدقيق
  audit: AuditRow[]
  setAudit: (a: AuditRow[]) => void
  addAudit: (a: AuditRow) => void

  // التخفي
  stealth: boolean
  setStealth: (b: boolean) => void

  // النقل الحي
  transfer: LiveTransfer | null
  setTransfer: (t: LiveTransfer | null) => void
  updateTransfer: (p: Partial<LiveTransfer>) => void
  recvEphemeral: { name: string; size: number; at: number } | null
  setRecvEphemeral: (r: { name: string; size: number; at: number } | null) => void
  receivedClip: { text: string; from: string; at: number } | null
  setReceivedClip: (c: { text: string; from: string; at: number } | null) => void

  // قفل الهاتف
  phoneLock: PhoneLockState | null
  setPhoneLock: (p: PhoneLockState | null) => void

  // الحذف الآمن
  wipeJob: WipeJobUI | null
  setWipeJob: (w: WipeJobUI | null) => void
  wipeResult: WipeResultUI | null
  setWipeResult: (w: WipeResultUI | null) => void

  // اختبار النجاح
  checks: Record<string, boolean>
  setCheck: (k: string, v: boolean) => void
  celebrated: boolean
  setCelebrated: (b: boolean) => void
}

export const useSec = create<SecState>((set) => ({
  bridgeOnline: false,
  tab: "crypto",
  setTab: (t) => set({ tab: t }),

  myPub: null,
  myFingerprint: "",
  peer: null,
  kexDone: false,
  sas: null,
  sasConfirmed: false,
  rotations: 0,
  framesSent: 0,
  bytesOnWire: 0,
  setKex: (p) => set(p),
  confirmSas: () => set({ sasConfirmed: true }),
  setCounters: (c) => set((s) => ({ rotations: c.rotations ?? s.rotations, framesSent: c.framesSent ?? s.framesSent, bytesOnWire: c.bytesOnWire ?? s.bytesOnWire })),
  setBridgeOnline: (b) => set({ bridgeOnline: b }),

  wire: [],
  addWire: (f) => set((s) => ({ wire: [f, ...s.wire].slice(0, 400) })),
  setWire: (f) => set({ wire: f }),
  capturePaused: false,
  toggleCapturePaused: () => set((s) => ({ capturePaused: !s.capturePaused })),
  leakScan: null,
  setLeakScan: (x) => set({ leakScan: x }),

  alerts: [],
  addAlert: (a) => set((s) => ({ alerts: [a, ...s.alerts].slice(0, 40) })),
  resolveAlert: (alertId, decision) => set((s) => ({ alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, resolved: decision } : a)) })),

  perms: [],
  setPerms: (p) => set({ perms: p }),
  upsertPerm: (p) => set((s) => {
    const i = s.perms.findIndex((x) => x.feature === p.feature && x.deviceId === p.deviceId)
    if (i === -1) return { perms: [...s.perms, p] }
    const copy = [...s.perms]
    copy[i] = { ...copy[i], ...p }
    return { perms: copy }
  }),

  audit: [],
  setAudit: (a) => set({ audit: a }),
  addAudit: (a) => set((s) => ({ audit: [a, ...s.audit].slice(0, 400) })),

  stealth: false,
  setStealth: (b) => set({ stealth: b }),

  transfer: null,
  setTransfer: (t) => set({ transfer: t }),
  updateTransfer: (p) => set((s) => (s.transfer ? { transfer: { ...s.transfer, ...p } } : {})),
  recvEphemeral: null,
  setRecvEphemeral: (r) => set({ recvEphemeral: r }),
  receivedClip: null,
  setReceivedClip: (c) => set({ receivedClip: c }),

  phoneLock: null,
  setPhoneLock: (p) => set({ phoneLock: p }),

  wipeJob: null,
  setWipeJob: (w) => set({ wipeJob: w }),
  wipeResult: null,
  setWipeResult: (w) => set({ wipeResult: w }),

  checks: (() => { try { return JSON.parse(localStorage.getItem("nl-sec-checks") || "{}") } catch { return {} } })() as Record<string, boolean>,
  setCheck: (k, v) => set((s) => {
    // دمج مع آخر قيمة مخزنة (تبويبات الهاتف والكمبيوتر تتشارك نفس الأصل)
    let merged: Record<string, boolean> = { ...s.checks, [k]: v }
    try { merged = { ...JSON.parse(localStorage.getItem("nl-sec-checks") || "{}"), ...merged } } catch { /* ignore */ }
    try { localStorage.setItem("nl-sec-checks", JSON.stringify(merged)) } catch { /* ignore */ }
    return { checks: merged }
  }),
  celebrated: false,
  setCelebrated: (b) => set({ celebrated: b }),
}))
