"use client"
// NexusLink — مخزن سطح المكتب الافتراضي (المرحلة 6)
// حالة الكمبيوتر التي يتحكم بها الهاتف: مؤشر، نوافذ، عرض تقديمي،
// وسائط، مفكرة، لعبة، حافظة، طاقة، وسجل الأوامر + اختبار النجاح.
import { create } from "zustand"
import type {
  AppId, DesktopStateReport, PowerState, RcLogEntry, RcSource,
} from "./remote-types"

export interface ClickRipple {
  id: string
  x: number
  y: number
  kind: "left" | "right" | "double"
}

export interface Slide {
  emoji: string
  title: string
  lines: string[]
}

export interface Track {
  title: string
  artist: string
  len: number
}

const SLIDES: Slide[] = [
  {
    emoji: "🚀",
    title: "NexusLink — المرحلة السادسة",
    lines: ["الهاتف يتحكم بالكمبيوتر", "لمس · كيبورد · جيروسكوب · وسائط · نظام"],
  },
  {
    emoji: "🖱️",
    title: "لمس وكيبورد لاسلكي",
    lines: ["إيماءات متعددة اللمس", "نقرة، نقرة أيمن، تمرير، قرص للتكبير"],
  },
  {
    emoji: "🛰️",
    title: "ماوس هوائي ويد ألعاب",
    lines: ["حركة الهاتف + الجيروسكوب", "أزرار قابلة للتخصيص وتوجيه بالميلان"],
  },
  {
    emoji: "📊",
    title: "جهاز تحكم بالعروض",
    lines: ["تقليب الشرائح عن بُعد", "مؤشر ليزري ومؤقّت للعرض"],
  },
  {
    emoji: "⚡",
    title: "أوامر النظام والحافظة",
    lines: ["إيقاف · إسبات · Wake-on-LAN", "حافظة مشتركة بين الهاتف والكمبيوتر"],
  },
]

const TRACKS: Track[] = [
  { title: "نغمة الشبكة المحلية", artist: "Nexus Band", len: 96 },
  { title: "أجواء التركيز", artist: "Ambient C", len: 145 },
  { title: "إيقاعات البيانات", artist: "Data Beats", len: 112 },
  { title: "رحلة الفجر", artist: "Morning Wave", len: 158 },
]

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

// مؤقتات انتقالات الطاقة (تُنظف عند كل انتقال جديد)
let powerTimers: ReturnType<typeof setTimeout>[] = []
function clearPowerTimers() {
  powerTimers.forEach(clearTimeout)
  powerTimers = []
}
function later(fn: () => void, ms: number) {
  powerTimers.push(setTimeout(fn, ms))
}

export interface DesktopState {
  // ==== الاتصال ====
  rcOnline: boolean
  setRcOnline: (b: boolean) => void
  phoneConnected: string | null
  setPhoneConnected: (name: string | null) => void
  latency: number | null
  setLatency: (ms: number | null) => void

  // ==== الطاقة ====
  power: PowerState
  powerStage: string
  applyPower: (action: "shutdown" | "restart" | "sleep" | "hibernate" | "lock" | "unlock") => void
  applyWake: (source: string) => void

  // ==== المؤشر ====
  cursor: { x: number; y: number }
  ripples: ClickRipple[]
  applyMove: (dx: number, dy: number, source: RcSource) => void
  applyClick: (button: "left" | "right", type: "tap" | "double") => void
  applyScroll: (dy: number) => void
  applyPinch: (scale: number) => void
  desktopZoom: number

  // ==== النوافذ ====
  activeApp: AppId
  setActiveApp: (a: AppId) => void

  // ==== العرض التقديمي ====
  slides: Slide[]
  slideIndex: number
  slideBlack: boolean
  laser: { active: boolean; x: number; y: number }
  applyPresenter: (p: { action: string; value?: boolean; x?: number; y?: number }) => void

  // ==== الوسائط ====
  tracks: Track[]
  trackIndex: number
  mediaPos: number
  mediaPlaying: boolean
  mediaVolume: number
  mediaMuted: boolean
  mediaTarget: string
  applyMedia: (p: { action: string; value?: number; target?: string }) => void
  tickMedia: () => void

  // ==== المفكرة ====
  notepad: string
  applyKey: (p: { ch?: string; special?: string }) => void
  pasteClipboard: () => void
  clearNotepad: () => void

  // ==== اللعبة ====
  stick: { x: number; y: number }
  gameBoost: boolean
  gameScore: number
  gameJumpSeq: number
  gameHornSeq: number
  applyGamepad: (p: { kind: string; x?: number; y?: number; button?: string; action?: string }) => void

  // ==== الحافظة ====
  clipboard: { text: string; at: number; from: "phone" | "pc" } | null
  clipboardHistory: { id: string; text: string; from: "phone" | "pc"; at: number }[]
  applyClipboardToPc: (text: string) => void
  setClipboardFromPc: (text: string) => void

  // ==== FA-9: التسليم (أكمل من حيث توقفت) ====
  handoffInbox: { id: string; url: string; title?: string; at: number }[]
  pushHandoff: (url: string, title?: string) => void
  openHandoff: (id: string) => void

  // ==== السجل واختبار النجاح ====
  rcLogs: RcLogEntry[]
  pushRcLog: (e: RcLogEntry) => void
  pushLocalLog: (text: string, kind?: RcLogEntry["kind"]) => void
  checklist: Record<string, boolean>
  markCheck: (k: string) => void

  buildReport: () => DesktopStateReport
}

export const useDesktop = create<DesktopState>((set, get) => ({
  // ==== الاتصال ====
  rcOnline: false,
  setRcOnline: (b) => set({ rcOnline: b }),
  phoneConnected: null,
  setPhoneConnected: (n) => set({ phoneConnected: n }),
  latency: null,
  setLatency: (ms) => set({ latency: ms }),

  // ==== الطاقة ====
  power: "on",
  powerStage: "",
  applyPower: (action) => {
    const { power } = get()
    clearPowerTimers()
    if (action === "shutdown") {
      if (power !== "on" && power !== "locked") return
      set({ power: "shutting-down", powerStage: "جارٍ إيقاف التشغيل…" })
      later(() => set({ power: "off", powerStage: "" }), 1800)
      get().pushLocalLog("الكمبيوتر: إيقاف التشغيل (أمر من الهاتف)", "in")
    } else if (action === "restart") {
      if (power !== "on" && power !== "locked") return
      set({ power: "shutting-down", powerStage: "جارٍ إعادة التشغيل…" })
      later(() => set({ power: "booting", powerStage: "بدء التشغيل…" }), 1800)
      later(() => set({ power: "on", powerStage: "" }), 4300)
      get().pushLocalLog("الكمبيوتر: إعادة التشغيل (أمر من الهاتف)", "in")
    } else if (action === "sleep") {
      if (power !== "on") return
      set({ power: "sleeping", powerStage: "" })
      get().pushLocalLog("الكمبيوتر: دخول وضع السكون", "in")
    } else if (action === "hibernate") {
      if (power !== "on") return
      set({ power: "shutting-down", powerStage: "جارٍ الإسبات وحفظ الجلسة…" })
      later(() => set({ power: "hibernating", powerStage: "" }), 1600)
      get().pushLocalLog("الكمبيوتر: إسبات (Hibernation) — يستيقظ بحزمة Wake-on-LAN", "in")
    } else if (action === "lock") {
      if (power !== "on") return
      set({ power: "locked", powerStage: "" })
      get().pushLocalLog("الكمبيوتر: قفل الشاشة", "in")
    } else if (action === "unlock") {
      if (power !== "locked") return
      set({ power: "on", powerStage: "" })
      get().pushLocalLog("تم فتح قفل الشاشة بنقرة من الهاتف", "ok")
    }
    get().markCheck("power")
  },
  applyWake: (source) => {
    const { power } = get()
    clearPowerTimers()
    if (power === "off" || power === "hibernating") {
      if (source === "wol") {
        set({ power: "booting", powerStage: power === "hibernating" ? "استئناف من الإسبات…" : "بدء التشغيل…" })
        later(() => set({ power: "on", powerStage: "" }), 2800)
        get().pushLocalLog("استيقظ الكمبيوتر عبر حزمة Wake-on-LAN السحرية ⚡", "ok")
      }
    } else if (power === "sleeping") {
      set({ power: "on", powerStage: "" })
    }
  },

  // ==== المؤشر ====
  cursor: { x: 0.5, y: 0.5 },
  ripples: [],
  desktopZoom: 1,
  applyMove: (dx, dy, source) => {
    const { power, cursor } = get()
    if (power === "off" || power === "hibernating" || power === "shutting-down" || power === "booting") return
    const x = Math.min(0.985, Math.max(0.008, cursor.x + dx))
    const y = Math.min(0.965, Math.max(0.01, cursor.y + dy))
    set({
      cursor: { x, y },
      checklist: { ...get().checklist, move: true, ...(source === "airmouse" ? { air: true } : {}) },
    })
  },
  applyClick: (button, type) => {
    const { power, cursor } = get()
    if (power === "off" || power === "hibernating" || power === "shutting-down" || power === "booting") return
    if (power === "locked") {
      set({ power: "on", powerStage: "" })
      get().pushLocalLog("تم فتح قفل الشاشة بنقرة من الهاتف", "ok")
    }
    if (power === "sleeping") set({ power: "on" })
    const r: ClickRipple = { id: uid(), x: cursor.x, y: cursor.y, kind: type === "double" ? "double" : button }
    const ripples = [...get().ripples, r].slice(-6)
    set({ ripples, checklist: { ...get().checklist, click: true } })
    setTimeout(() => set({ ripples: get().ripples.filter((x) => x.id !== r.id) }), 750)
  },
  applyScroll: (dy) => {
    const { power, activeApp } = get()
    if (power !== "on" && power !== "locked") return
    get().markCheck("click")
    if (activeApp === "media") {
      const v = Math.min(100, Math.max(0, get().mediaVolume - Math.round(dy * 120)))
      set({ mediaVolume: v, mediaMuted: v === 0 })
    } else if (activeApp === "presentation" && Math.abs(dy) > 0.02) {
      const dir = dy > 0 ? 1 : -1
      const idx = Math.min(get().slides.length - 1, Math.max(0, get().slideIndex + dir))
      if (idx !== get().slideIndex) set({ slideIndex: idx })
    }
  },
  applyPinch: (scale) => {
    const z = Math.min(1.5, Math.max(0.8, get().desktopZoom * scale))
    set({ desktopZoom: z })
  },

  // ==== النوافذ ====
  activeApp: "presentation",
  setActiveApp: (a) => set({ activeApp: a }),

  // ==== العرض التقديمي ====
  slides: SLIDES,
  slideIndex: 0,
  slideBlack: false,
  laser: { active: false, x: 0.5, y: 0.5 },
  applyPresenter: (p) => {
    const { power } = get()
    if (power !== "on" && power !== "locked") return
    const total = get().slides.length
    if (p.action === "next") {
      set({ slideIndex: Math.min(total - 1, get().slideIndex + 1), activeApp: "presentation" })
      get().markCheck("presenter")
    } else if (p.action === "prev") {
      set({ slideIndex: Math.max(0, get().slideIndex - 1), activeApp: "presentation" })
      get().markCheck("presenter")
    } else if (p.action === "black") {
      set({ slideBlack: !!p.value, activeApp: "presentation" })
      get().markCheck("presenter")
    } else if (p.action === "laser-on") {
      set({ laser: { ...get().laser, active: true }, activeApp: "presentation" })
    } else if (p.action === "laser-off") {
      set({ laser: { ...get().laser, active: false } })
    } else if (p.action === "laser-move") {
      set({ laser: { active: true, x: p.x ?? 0.5, y: p.y ?? 0.5 }, activeApp: "presentation" })
      get().markCheck("presenter")
    }
  },

  // ==== الوسائط ====
  tracks: TRACKS,
  trackIndex: 0,
  mediaPos: 0,
  mediaPlaying: false,
  mediaVolume: 65,
  mediaMuted: false,
  mediaTarget: "المشغل الافتراضي",
  applyMedia: (p) => {
    const { power } = get()
    if (power !== "on" && power !== "locked") return
    const len = get().tracks[get().trackIndex].len
    if (p.action === "toggle" || p.action === "play" || p.action === "pause") {
      const playing = p.action === "toggle" ? !get().mediaPlaying : p.action === "play"
      set({ mediaPlaying: playing, activeApp: "media" })
    } else if (p.action === "next") {
      set({ trackIndex: (get().trackIndex + 1) % get().tracks.length, mediaPos: 0, mediaPlaying: true, activeApp: "media" })
    } else if (p.action === "prev") {
      set({ trackIndex: (get().trackIndex - 1 + get().tracks.length) % get().tracks.length, mediaPos: 0, mediaPlaying: true, activeApp: "media" })
    } else if (p.action === "volume") {
      const v = Math.min(100, Math.max(0, Math.round(p.value ?? get().mediaVolume)))
      set({ mediaVolume: v, mediaMuted: v === 0, activeApp: "media" })
    } else if (p.action === "mute") {
      set({ mediaMuted: !get().mediaMuted, activeApp: "media" })
    }
    if (p.target) set({ mediaTarget: p.target })
    void len
    get().markCheck("media")
  },
  tickMedia: () => {
    const { mediaPlaying, mediaPos, trackIndex, tracks, power } = get()
    if (!mediaPlaying || power === "off" || power === "hibernating" || power === "shutting-down") return
    const len = tracks[trackIndex].len
    if (mediaPos + 1 >= len) {
      set({ trackIndex: (trackIndex + 1) % tracks.length, mediaPos: 0 })
    } else {
      set({ mediaPos: mediaPos + 1 })
    }
  },

  // ==== المفكرة ====
  notepad: "ملاحظات الاجتماع:\n- مراجعة خطة المرحلة السادسة\n- اختبار تحكم الهاتف بالكمبيوتر\n",
  applyKey: (p) => {
    const { power, activeApp } = get()
    if (power !== "on" && power !== "locked") return
    get().markCheck("key")
    if (activeApp === "presentation") {
      if (p.special === "right" || p.special === "space") get().applyPresenter({ action: "next" })
      else if (p.special === "left") get().applyPresenter({ action: "prev" })
      return
    }
    if (activeApp === "media") {
      if (p.special === "space") get().applyMedia({ action: "toggle" })
      return
    }
    // المفكرة هي الهدف الافتراضي للكتابة
    let text = get().notepad
    if (p.ch) text = (text + p.ch).slice(-2000)
    else if (p.special === "backspace") text = text.slice(0, -1)
    else if (p.special === "enter") text = (text + "\n").slice(-2000)
    else if (p.special === "space") text = (text + " ").slice(-2000)
    else if (p.special === "tab") text = (text + "  ").slice(-2000)
    set({ notepad: text, activeApp: "notepad" })
  },
  pasteClipboard: () => {
    const c = get().clipboard
    if (!c) return
    set({ notepad: (get().notepad + c.text).slice(-2000), activeApp: "notepad" })
    get().pushLocalLog(`تم لصق الحافظة في المفكرة (${c.text.length} حرف من ${c.from === "phone" ? "الهاتف" : "الكمبيوتر"})`, "ok")
  },
  clearNotepad: () => set({ notepad: "" }),

  // ==== اللعبة ====
  stick: { x: 0, y: 0 },
  gameBoost: false,
  gameScore: 0,
  gameJumpSeq: 0,
  gameHornSeq: 0,
  applyGamepad: (p) => {
    const { power } = get()
    if (power !== "on") return
    if (p.kind === "stick") {
      set({ stick: { x: p.x ?? 0, y: p.y ?? 0 }, activeApp: "game" })
      get().markCheck("game")
    } else if (p.kind === "button") {
      const a = p.action
      set({ activeApp: "game" })
      get().markCheck("game")
      if (a === "boost") set({ gameBoost: true })
      else if (a === "brake") set({ gameBoost: false, stick: { x: 0, y: 0 } })
      else if (a === "jump") set({ gameJumpSeq: get().gameJumpSeq + 1, gameScore: get().gameScore + 10 })
      else if (a === "horn") set({ gameHornSeq: get().gameHornSeq + 1 })
      else if (a === "nitro") set({ gameBoost: true })
      else if (a === "pause") set({ gameBoost: false, stick: { x: 0, y: 0 } })
    }
  },

  // ==== الحافظة ====
  clipboard: null,
  clipboardHistory: [],
  applyClipboardToPc: (text) => {
    if (!text.trim()) return
    const item = { id: uid(), text, from: "phone" as const, at: Date.now() }
    set({
      clipboard: { text, at: Date.now(), from: "phone" },
      clipboardHistory: [item, ...get().clipboardHistory].slice(0, 10),
    })
    get().markCheck("clipboard")
    get().pushLocalLog(`وصل نص للحافظة المشتركة من الهاتف: «${text.slice(0, 40)}${text.length > 40 ? "…" : ""}»`, "in")
  },
  setClipboardFromPc: (text) => {
    if (!text.trim()) return
    const item = { id: uid(), text, from: "pc" as const, at: Date.now() }
    set({
      clipboard: { text, at: Date.now(), from: "pc" },
      clipboardHistory: [item, ...get().clipboardHistory].slice(0, 10),
    })
    get().markCheck("clipboard")
    get().pushLocalLog("تم نسخ حافظة الكمبيوتر — جاهزة على الهاتف", "ok")
  },

  // ==== FA-9: التسليم ====
  handoffInbox: [],
  pushHandoff: (url, title) => {
    if (!url) return
    const item = { id: uid(), url, title, at: Date.now() }
    set({ handoffInbox: [item, ...get().handoffInbox].slice(0, 8) })
    get().markCheck("handoff")
    get().pushLocalLog(`تسليم من الهاتف: رابط بانتظار الفتح هنا («${title ?? url.slice(0, 50)}»)`, "in")
  },
  openHandoff: (id) => {
    const item = get().handoffInbox.find((h) => h.id === id)
    if (!item) return
    if (typeof window !== "undefined") window.open(item.url, "_blank", "noopener,noreferrer")
    set({ handoffInbox: get().handoffInbox.filter((h) => h.id !== id) })
    get().pushLocalLog(`فُتح رابط التسليم على الكمبيوتر: ${item.url.slice(0, 60)}`, "ok")
  },

  // ==== السجل واختبار النجاح ====
  rcLogs: [],
  pushRcLog: (e) => set({ rcLogs: [e, ...get().rcLogs].slice(0, 80) }),
  pushLocalLog: (text, kind = "info") =>
    set({ rcLogs: [{ id: uid(), text, kind, at: Date.now() }, ...get().rcLogs].slice(0, 80) }),
  checklist: {},
  markCheck: (k) => {
    if (!get().checklist[k]) set({ checklist: { ...get().checklist, [k]: true } })
  },

  buildReport: () => {
    const s = get()
    const t = s.tracks[s.trackIndex]
    return {
      power: s.power,
      activeApp: s.activeApp,
      presenter: { index: s.slideIndex, total: s.slides.length, black: s.slideBlack },
      media: {
        playing: s.mediaPlaying,
        track: s.trackIndex,
        trackTitle: t.title,
        trackArtist: t.artist,
        trackLen: t.len,
        position: s.mediaPos,
        volume: s.mediaMuted ? 0 : s.mediaVolume,
        muted: s.mediaMuted,
        target: s.mediaTarget,
      },
      gameScore: s.gameScore,
      clipboardLen: s.clipboard?.text.length ?? 0,
      notepadLen: s.notepad.length,
      at: Date.now(),
    }
  },
}))

// ---------- مخزن جهة الهاتف (مرآة حالة الكمبيوتر) ----------
interface ControllerMirrorState {
  online: boolean
  setOnline: (b: boolean) => void
  report: DesktopStateReport | null
  setReport: (r: DesktopStateReport) => void
  desktopName: string
  desktopMac: string
  setDesktopInfo: (name: string, mac: string) => void
  latency: number | null
  setLatency: (ms: number | null) => void
  rejected: { reason: string; at: number } | null
  setRejected: (r: string) => void
  clipboardInbox: { id: string; text: string; at: number }[]
  pushClipboardInbox: (text: string) => void
  sentHistory: { id: string; text: string; at: number }[]
  pushSent: (text: string) => void
  /** FA-9: وضع السحب النشط (من rc:move drag=true) */
  dragActive: boolean
  setDragActive: (b: boolean) => void
}

export const useRcMirror = create<ControllerMirrorState>((set, get) => ({
  online: false,
  setOnline: (b) => set({ online: b }),
  report: null,
  setReport: (r) => set({ report: r }),
  desktopName: "NEXUS-PC",
  desktopMac: "A4:5E:60:C1:2D:9F",
  setDesktopInfo: (name, mac) => set({ desktopName: name, desktopMac: mac }),
  latency: null,
  setLatency: (ms) => set({ latency: ms }),
  rejected: null,
  setRejected: (reason) => set({ rejected: { reason, at: Date.now() } }),
  clipboardInbox: [],
  pushClipboardInbox: (text) =>
    set({
      clipboardInbox: [{ id: uid(), text, at: Date.now() }, ...get().clipboardInbox].slice(0, 10),
    }),
  sentHistory: [],
  pushSent: (text) =>
    set({ sentHistory: [{ id: uid(), text, at: Date.now() }, ...get().sentHistory].slice(0, 10) }),
  dragActive: false,
  setDragActive: (b) => set({ dragActive: b }),
}))
