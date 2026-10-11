"use client"
// NexusLink — مخزن طبقة الحماية وإدارة الأجهزة (المرحلة 8)
// مقاييس حية · تطبيقات · منبهات · إعدادات سريعة · رن · فقدان · مسح · قرب
import { create } from "zustand"

export type GuardTab = "dashboard" | "apps" | "find" | "lost" | "proximity" | "control" | "touch"

// ---------- FA-7: جلسة التحكم باللمس ----------

export interface CtlSessionInfo {
  active: boolean
  controller: string
  name: string
  reason: string
  at: number
}

/** أبعاد شاشة الهاتف الحقيقية (dev:screen) — أساس تحويل إحداثيات الويب. */
export interface PhoneScreenInfo {
  w: number
  h: number
  density: number
  deviceId: string | null
  at: number
}

export interface AppEntry {
  pkg: string
  name: string
  version: string
  sizeMB: number
  system: boolean
  installedAt: number
  hue: number
}

export interface AlarmEntry {
  id: string
  hour: number
  minute: number
  label: string
  days: number[] // 0=الأحد .. 6=السبت — فارغة = يومياً
  enabled: boolean
}

export interface QSState {
  wifi: boolean
  bluetooth: boolean
  flashlight: boolean
  dnd: boolean
  rotate: boolean
  data: boolean
  hotspot: boolean
  saver: boolean
  brightness: number
  volMedia: number
  volRing: number
}

export interface DeviceMetrics {
  cpu: number
  cpuHist: number[]
  ramUsedGB: number
  ramTotalGB: number
  battery: number
  charging: boolean
  temp: number
  uptimeSec: number
  storageUsedGB: number
  storageTotalGB: number
}

export interface LostState {
  active: boolean
  message: string
  callback: string
  at: number
}

export interface GuardLog {
  id: string
  text: string
  kind: "in" | "ok" | "info" | "warn"
  at: number
}

export type ProxState = "near" | "grace" | "locked" | "disabled"

interface ProxInfo {
  enabled: boolean
  thresholdRssi: number
  graceSec: number
  autoUnlock: boolean
  rssi: number | null
  state: ProxState
  leftMs: number | null
  source: "real" | "sim" | null
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

// ---------- بذور المقاييس لكل جهاز ----------
const METRIC_SEED: Record<string, DeviceMetrics> = {
  "galaxy-s24": { cpu: 18, cpuHist: [], ramUsedGB: 5.2, ramTotalGB: 8, battery: 78, charging: false, temp: 33, uptimeSec: 92 * 3600 + 1400, storageUsedGB: 88, storageTotalGB: 256 },
  "redmi-note13": { cpu: 12, cpuHist: [], ramUsedGB: 3.1, ramTotalGB: 6, battery: 92, charging: true, temp: 36, uptimeSec: 40 * 3600 + 2200, storageUsedGB: 103, storageTotalGB: 128 },
  "pc-office": { cpu: 34, cpuHist: [], ramUsedGB: 11.4, ramTotalGB: 32, battery: 100, charging: true, temp: 52, uptimeSec: 190 * 3600 + 800, storageUsedGB: 231, storageTotalGB: 512 },
  "nexus-tv": { cpu: 8, cpuHist: [], ramUsedGB: 1.2, ramTotalGB: 2, battery: 100, charging: true, temp: 44, uptimeSec: 300 * 3600, storageUsedGB: 12, storageTotalGB: 32 },
  "ipad-pro": { cpu: 0, cpuHist: [], ramUsedGB: 0, ramTotalGB: 6, battery: 45, charging: false, temp: 28, uptimeSec: 0, storageUsedGB: 61, storageTotalGB: 128 },
}
for (const m of Object.values(METRIC_SEED)) {
  m.cpuHist = Array.from({ length: 60 }, (_, i) => Math.max(4, m.cpu + Math.round(Math.sin(i / 6) * 9 + (Math.random() * 8 - 4))))
}

// ---------- بذور التطبيقات (Galaxy-S24) ----------
const APPS_SEED: AppEntry[] = [
  { pkg: "com.whatsapp", name: "واتساب", version: "2.24.12.75", sizeMB: 78, system: false, installedAt: Date.now() - 400 * 864e5, hue: 142 },
  { pkg: "org.telegram.messenger", name: "تيليجرام", version: "10.9.2", sizeMB: 64, system: false, installedAt: Date.now() - 320 * 864e5, hue: 199 },
  { pkg: "com.instagram.android", name: "إنستغرام", version: "315.1", sizeMB: 89, system: false, installedAt: Date.now() - 210 * 864e5, hue: 330 },
  { pkg: "com.google.android.youtube", name: "يوتيوب", version: "19.10.38", sizeMB: 112, system: false, installedAt: Date.now() - 500 * 864e5, hue: 0 },
  { pkg: "com.spotify.music", name: "سبوتيفاي", version: "8.9.4.210", sizeMB: 92, system: false, installedAt: Date.now() - 180 * 864e5, hue: 130 },
  { pkg: "com.netflix.mediaclient", name: "نتليكس", version: "8.98.1", sizeMB: 48, system: false, installedAt: Date.now() - 150 * 864e5, hue: 355 },
  { pkg: "com.google.android.gm", name: "جيميل", version: "2024.03.17", sizeMB: 55, system: false, installedAt: Date.now() - 600 * 864e5, hue: 12 },
  { pkg: "com.google.android.apps.maps", name: "خرائط جوجل", version: "11.120.0701", sizeMB: 82, system: false, installedAt: Date.now() - 450 * 864e5, hue: 45 },
  { pkg: "com.samsung.android.camera", name: "كاميرا Samsung", version: "14.2.1.0", sizeMB: 210, system: true, installedAt: Date.now() - 365 * 864e5, hue: 260 },
  { pkg: "com.samsung.android.launcher", name: "واجهة Samsung One UI", version: "15.0.2.4", sizeMB: 96, system: true, installedAt: Date.now() - 365 * 864e5, hue: 260 },
  { pkg: "com.android.vending", name: "متجر Play", version: "38.4.12-21", sizeMB: 122, system: true, installedAt: Date.now() - 365 * 864e5, hue: 80 },
  { pkg: "com.google.android.gms", name: "خدمات Google Play", version: "24.09.15", sizeMB: 412, system: true, installedAt: Date.now() - 365 * 864e5, hue: 30 },
  { pkg: "com.samsung.android.app.clockpack", name: "ساعة Samsung", version: "6.1.2.0", sizeMB: 34, system: true, installedAt: Date.now() - 365 * 864e5, hue: 220 },
  { pkg: "com.sec.android.app.launcher.systemui", name: "SystemUI", version: "15.0.1", sizeMB: 41, system: true, installedAt: Date.now() - 365 * 864e5, hue: 260 },
]

// ---------- بذور المنبهات ----------
const ALARMS_SEED: AlarmEntry[] = [
  { id: "a1", hour: 5, minute: 30, label: "الفجر", days: [], enabled: true },
  { id: "a2", hour: 6, minute: 45, label: "الاستيقاظ", days: [0, 1, 2, 3, 4], enabled: true },
  { id: "a3", hour: 13, minute: 15, label: "دواء الظهر", days: [], enabled: false },
  { id: "a4", hour: 22, minute: 30, label: "وقت النوم", days: [], enabled: true },
]

// ---------- إعدادات سريعة ----------
const QS_SEED: QSState = {
  wifi: true, bluetooth: true, flashlight: false, dnd: false,
  rotate: false, data: true, hotspot: false, saver: false,
  brightness: 72, volMedia: 60, volRing: 80,
}

// ---------- معلومات النظام ----------
export const SYSTEM_INFO: Record<string, { label: string; value: string }[]> = {
  "galaxy-s24": [
    { label: "الطراز", value: "Samsung Galaxy S24 (SM-S921B)" },
    { label: "نظام التشغيل", value: "Android 15 · One UI 7.0" },
    { label: "النواة", value: "6.1.75-android15 · Exynos 2400" },
    { label: "الشاشة", value: "6.2″ · 2340×1080 · 120Hz" },
    { label: "الشبكة", value: "Wi-Fi 6E · 192.168.1.14" },
    { label: "عنوان MAC", value: "8C:85:90:3E:7B:21" },
    { label: "بروتوكول Nexus", value: "v1.4 · TLS +libsodium" },
    { label: "زمن الاستجابة", value: "11ms عبر Wi-Fi" },
  ],
  "redmi-note13": [
    { label: "الطراز", value: "Xiaomi Redmi Note 13" },
    { label: "نظام التشغيل", value: "Android 14 · HyperOS 1.0" },
    { label: "النواة", value: "5.15.104 · Snapdragon 685" },
    { label: "الشبكة", value: "نقطة اتصال · 192.168.43.7" },
    { label: "بروتوكول Nexus", value: "v1.4 · وضع Hotspot" },
  ],
  "pc-office": [
    { label: "النظام", value: "Windows 11 Pro 23H2 (بناء 22631)" },
    { label: "المعالج", value: "Intel Core i7-13700K · 16 نواة" },
    { label: "الرسوميات", value: "NVIDIA RTX 4070 · 12GB" },
    { label: "الشبكة", value: "Ethernet 1Gb · 192.168.1.2" },
    { label: "بروتوكول Nexus", value: "v1.4 · خادم أساسي" },
  ],
  "nexus-tv": [
    { label: "الطراز", value: "Nexus TV Box (Android TV 12)" },
    { label: "الشاشة", value: "55″ · 3840×2160 · 60Hz" },
    { label: "الشبكة", value: "Wi-Fi 5 · 192.168.1.50" },
  ],
  "ipad-pro": [],
}

interface GuardState {
  tab: GuardTab
  setTab: (t: GuardTab) => void

  bridgeOnline: boolean
  setBridgeOnline: (b: boolean) => void
  phoneOnline: boolean
  setPhoneOnline: (b: boolean) => void

  targetDeviceId: string
  setTargetDevice: (id: string) => void

  metrics: Record<string, DeviceMetrics>
  tickMetrics: () => void
  nudgeStorage: (deltaMB: number) => void

  apps: AppEntry[]
  backup: { pkg: string; name: string; progress: number } | null
  install: { name: string; sizeMB: number; progress: number } | null
  startBackup: (a: AppEntry) => void
  tickBackup: () => void
  finishBackup: (fileName: string, path: string, bytes: number) => void
  cancelBackup: () => void
  startInstall: (name: string, sizeMB: number) => void
  tickInstall: () => void
  finishInstall: () => void
  uninstallApp: (pkg: string) => void

  alarms: AlarmEntry[]
  addAlarm: (a: Omit<AlarmEntry, "id">) => void
  updateAlarm: (id: string, patch: Partial<AlarmEntry>) => void
  deleteAlarm: (id: string) => void

  qs: QSState
  setQsKey: (k: keyof QSState, v: boolean | number) => void

  ringing: boolean
  setRinging: (b: boolean) => void
  strobe: boolean
  setStrobe: (b: boolean) => void

  lost: LostState
  setLost: (active: boolean, message?: string, callback?: string) => void

  wipe: { stage: "idle" | "wiping" | "wiped"; progress: number }
  setWipe: (w: Partial<GuardState["wipe"]>) => void

  pin: string
  setPin: (p: string) => void

  prox: ProxInfo
  setProx: (p: Partial<ProxInfo>) => void
  simMode: boolean
  setSimMode: (b: boolean) => void
  simRssi: number
  setSimRssi: (n: number) => void

  pcLocked: { reason: string; at: number } | null
  setPcLocked: (l: { reason: string; at: number } | null) => void

  logs: GuardLog[]
  pushLog: (text: string, kind?: GuardLog["kind"]) => void

  ctl: CtlSessionInfo
  setCtl: (c: Partial<CtlSessionInfo>) => void
  phoneScreen: PhoneScreenInfo | null
  setPhoneScreen: (s: PhoneScreenInfo | null) => void
  ctlPending: boolean
  setCtlPending: (b: boolean) => void
  phoneAccessibility: boolean | null
  setPhoneAccessibility: (b: boolean | null) => void

  checks: Record<string, boolean>
  setCheck: (k: string) => void
  celebrated: boolean
  setCelebrated: (b: boolean) => void
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export const useGuard = create<GuardState>((set, get) => ({
  tab: "dashboard",
  setTab: (t) => set({ tab: t }),

  bridgeOnline: false,
  setBridgeOnline: (b) => set({ bridgeOnline: b }),
  phoneOnline: false,
  setPhoneOnline: (b) => set({ phoneOnline: b }),

  targetDeviceId: "galaxy-s24",
  setTargetDevice: (id) => set({ targetDeviceId: id }),

  metrics: METRIC_SEED,
  tickMetrics: () =>
    set((s) => {
      const next: Record<string, DeviceMetrics> = {}
      for (const [id, m] of Object.entries(s.metrics)) {
        if (id === "ipad-pro") { next[id] = m; continue }
        const cpu = clamp(m.cpu + (Math.random() * 14 - 7), id === "pc-office" ? 12 : 5, id === "pc-office" ? 92 : 78)
        const hist = [...m.cpuHist.slice(1), cpu]
        const ramUsedGB = clamp(m.ramUsedGB + (Math.random() * 0.24 - 0.12), m.ramTotalGB * 0.2, m.ramTotalGB * 0.93)
        next[id] = {
          ...m,
          cpu: Math.round(cpu * 10) / 10,
          cpuHist: hist,
          ramUsedGB: Math.round(ramUsedGB * 100) / 100,
          battery: m.charging ? Math.min(100, m.battery + (Math.random() < 0.25 ? 1 : 0)) : Math.max(3, m.battery - (Math.random() < 0.06 ? 1 : 0)),
          temp: clamp(m.temp + (Math.random() * 0.8 - 0.4), 24, 68),
          uptimeSec: m.uptimeSec + 1,
        }
      }
      return { metrics: next }
    }),
  nudgeStorage: (deltaMB) =>
    set((s) => {
      const m = s.metrics[s.targetDeviceId]
      if (!m) return {}
      const gb = m.storageUsedGB + deltaMB / 1024
      return { metrics: { ...s.metrics, [s.targetDeviceId]: { ...m, storageUsedGB: Math.max(1, gb) } } }
    }),

  apps: APPS_SEED,
  backup: null,
  install: null,
  startBackup: (a) => set({ backup: { pkg: a.pkg, name: a.name, progress: 0 } }),
  tickBackup: () =>
    set((s) => (s.backup ? { backup: { ...s.backup, progress: Math.min(100, s.backup.progress + 9 + Math.random() * 14) } } : {})),
  finishBackup: (fileName, path, _bytes) => {
    set({
      backup: null,
      logs: [{ id: uid(), text: `نسخة احتياطية APK حُفظت في الكمبيوتر: Downloads/Backups/${fileName}`, kind: "ok", at: Date.now() }, ...get().logs].slice(0, 120),
    })
    void path
    void _bytes
    get().setCheck("apps")
  },
  cancelBackup: () => set({ backup: null }),
  startInstall: (name, sizeMB) => set({ install: { name, sizeMB, progress: 0 } }),
  tickInstall: () =>
    set((s) => (s.install ? { install: { ...s.install, progress: Math.min(100, s.install.progress + 7 + Math.random() * 13) } } : {})),
  finishInstall: () => {
    const ins = get().install
    if (!ins) return
    const hue = Math.floor(Math.random() * 360)
    const app: AppEntry = {
      pkg: `com.installed.${ins.name.replace(/\s+/g, "").toLowerCase()}.${Math.random().toString(36).slice(2, 6)}`,
      name: ins.name,
      version: "1.0.0",
      sizeMB: Math.round(ins.sizeMB),
      system: false,
      installedAt: Date.now(),
      hue,
    }
    set({
      install: null,
      apps: [app, ...get().apps],
      logs: [{ id: uid(), text: `تم تثبيت «${ins.name}» على الهاتف (${Math.round(ins.sizeMB)}MB)`, kind: "ok", at: Date.now() }, ...get().logs].slice(0, 120),
    })
    get().nudgeStorage(ins.sizeMB)
    get().setCheck("apps")
  },
  uninstallApp: (pkg) => {
    const app = get().apps.find((a) => a.pkg === pkg)
    if (!app) return
    set({
      apps: get().apps.filter((a) => a.pkg !== pkg),
      logs: [{ id: uid(), text: `أُزيل تطبيق «${app.name}» من الهاتف وتحرر ${app.sizeMB}MB`, kind: "ok", at: Date.now() }, ...get().logs].slice(0, 120),
    })
    get().nudgeStorage(-app.sizeMB)
    get().setCheck("apps")
  },

  alarms: ALARMS_SEED,
  addAlarm: (a) =>
    set((s) => ({
      alarms: [...s.alarms, { ...a, id: uid() }],
      logs: [{ id: uid(), text: `منبه جديد ${String(a.hour).padStart(2, "0")}:${String(a.minute).padStart(2, "0")} — ${a.label}`, kind: "ok", at: Date.now() }, ...s.logs].slice(0, 120),
    })),
  updateAlarm: (id, patch) =>
    set((s) => ({ alarms: s.alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  deleteAlarm: (id) => set((s) => ({ alarms: s.alarms.filter((a) => a.id !== id) })),

  qs: QS_SEED,
  setQsKey: (k, v) => set((s) => ({ qs: { ...s.qs, [k]: v } })),

  ringing: false,
  setRinging: (b) => set({ ringing: b }),
  strobe: false,
  setStrobe: (b) => set({ strobe: b }),

  lost: { active: false, message: "هذا الهاتف مفقود. إن وجدته يرجى التواصل معي — شكراً لكم.", callback: "+966 5X XXX XXXX", at: 0 },
  setLost: (active, message, callback) =>
    set((s) => ({
      lost: {
        active,
        message: message ?? s.lost.message,
        callback: callback ?? s.lost.callback,
        at: active ? Date.now() : 0,
      },
    })),

  wipe: { stage: "idle", progress: 0 },
  setWipe: (w) => set((s) => ({ wipe: { ...s.wipe, ...w } })),

  pin: "1234",
  setPin: (p) => set({ pin: p }),

  prox: {
    enabled: true, thresholdRssi: -68, graceSec: 8, autoUnlock: true,
    rssi: null, state: "near", leftMs: null, source: null,
  },
  setProx: (p) => set((s) => ({ prox: { ...s.prox, ...p } })),
  simMode: true,
  setSimMode: (b) => set({ simMode: b }),
  simRssi: -52,
  setSimRssi: (n) => set({ simRssi: n }),

  pcLocked: null,
  setPcLocked: (l) => set({ pcLocked: l }),

  logs: [],
  pushLog: (text, kind = "info") =>
    set((s) => ({ logs: [{ id: uid(), text, kind, at: Date.now() }, ...s.logs].slice(0, 120) })),

  ctl: { active: false, controller: "", name: "", reason: "", at: 0 },
  setCtl: (c) => set((s) => ({ ctl: { ...s.ctl, ...c } })),
  phoneScreen: null,
  setPhoneScreen: (s) => set({ phoneScreen: s }),
  ctlPending: false,
  setCtlPending: (b) => set({ ctlPending: b }),
  phoneAccessibility: null,
  setPhoneAccessibility: (b) => set({ phoneAccessibility: b }),

  checks: {},
  setCheck: (k) => set((s) => (s.checks[k] ? {} : { checks: { ...s.checks, [k]: true } })),
  celebrated: false,
  setCelebrated: (b) => set({ celebrated: b }),
}))

// ---------- مساعدات العرض ----------
export const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]

export function alarmTime(a: AlarmEntry) {
  return `${String(a.hour).padStart(2, "0")}:${String(a.minute).padStart(2, "0")}`
}

export function alarmDaysText(a: AlarmEntry) {
  if (a.days.length === 0) return "كل يوم"
  if (a.days.length === 7) return "كل يوم"
  return a.days
    .slice()
    .sort((x, y) => x - y)
    .map((d) => DAY_NAMES[d])
    .join("، ")
}

/** المنبه القادم (بالثواني من الآن) */
export function nextAlarmIn(a: AlarmEntry): number | null {
  if (!a.enabled) return null
  const now = new Date()
  for (let add = 0; add < 8; add++) {
    const t = new Date(now)
    t.setDate(t.getDate() + add)
    if (a.days.length > 0 && !a.days.includes(t.getDay())) continue
    t.setHours(a.hour, a.minute, 0, 0)
    if (t.getTime() > now.getTime()) return Math.round((t.getTime() - now.getTime()) / 1000)
  }
  return null
}

export function fmtUptime(sec: number) {
  if (sec <= 0) return "—"
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d} يوم و ${h} ساعة`
  if (h > 0) return `${h} ساعة و ${m} دقيقة`
  return `${m} دقيقة`
}

export function fmtRemaining(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h} س ${m} د`
  return `${m} د`
}
