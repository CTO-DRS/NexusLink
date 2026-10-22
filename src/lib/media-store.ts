"use client"
// NexusLink — مخزن طبقة الوسائط والكاميرا (المرحلة 7)
// إدارة: مصادر الكاميرا/الميكروفون، وصلة الويب كام، مكالمة الفيديو،
// المراقبة بالحركة، مراقبة الأطفال، الميكروفون اللاسلكي، البث، المعرض.
import { create } from "zustand"
import type {
  CamSourceState, CastMediaItem, CastSession, Facing, GalleryPhoto,
  LinkState, MediaAlert, MediaAlertKind, MediaCheckKey, MediaDeviceId,
  MediaLogEntry, MicSourceState, ScreenTarget, SlideshowState, VideoCallState,
} from "./media-types"
import {
  acquireCamera, acquireMic, blobToDataUrl, cameraActive, captureFromDevice,
  createLoopback, getReceiver, mediaBeep, mediaUid, registerReceiver, releaseCamera,
  releaseMic, retargetSyntheticFacing, setTorch, torchSupported,
  type LoopbackHandle,
} from "./media-engine"
import { castState } from "./media-socket"

export type MediaTab = "webcam" | "security" | "baby" | "mic" | "cast" | "gallery"
export type CamDeviceId = "galaxy-s24" | "redmi-note13" | "pc-office"

// §22 — آخر موضع بُث عبر cast:state (تقييد الإعلان — لا إغراق للمستقبل)
let castLastPos: number | null = null


const idb = (v: number | null) => v

interface SecState {
  enabled: boolean
  source: CamDeviceId
  viewer: ScreenTarget
  sensitivity: number
  level: number
  pct: number
  lastAlertAt: number
  armedSince: number | null
}

interface BabyState {
  enabled: boolean
  sender: "redmi-note13" | "galaxy-s24"
  receiver: "galaxy-s24" | "pc-office"
  level: number
  peak: number
  gain: number
  lastCryAt: number | null
  listeningSince: number | null
}

interface MicState {
  level: number
  peak: number
  gain: number
  monitor: boolean
  startedAt: number | null
}

interface GalleryState {
  device: "all" | MediaDeviceId
  photos: GalleryPhoto[]
  loading: boolean
  loadedOnce: boolean
  slideshow: SlideshowState | null
}

interface MediaState {
  tab: MediaTab
  bridgeOnline: boolean
  phoneOnline: string | null
  latency: number | null

  // بثوصات حية للعرض في الواجهة (مراجع غير قابلة للتسلسل)
  webcamStream: MediaStream | null
  secStream: MediaStream | null
  babyStream: MediaStream | null
  micStream: MediaStream | null

  cams: Record<CamDeviceId, CamSourceState>
  mics: Record<"galaxy-s24" | "redmi-note13", MicSourceState>

  // FA-8 — الهاتف الحقيقي: بث صوت/طفل وارد + حالة كاميرته + مستشعراته
  remoteMicStream: MediaStream | null
  remoteBabyStream: MediaStream | null
  realCam: { active: boolean; facing: string; torch: boolean; watch: boolean; at: number } | null
  sensors: { a: number[]; g: number[]; at: number } | null

  webcam: LinkState & { auto: boolean }
  call: VideoCallState
  shutter: { counting: number | null; lastCapture: { name: string; at: number } | null }

  sec: SecState
  baby: BabyState
  mic: MicState

  cast: CastSession | null
  castLibrary: CastMediaItem[]
  castLoading: boolean

  gallery: GalleryState

  alerts: MediaAlert[]
  checks: Record<MediaCheckKey, boolean>
  logs: MediaLogEntry[]

  // actions
  setTab: (t: MediaTab) => void
  setBridge: (b: boolean) => void
  setPhoneOnline: (n: string | null) => void
  setLatency: (ms: number | null) => void
  log: (text: string, kind?: MediaLogEntry["kind"]) => void
  pushAlert: (kind: MediaAlertKind, text: string, extra?: Partial<MediaAlert>) => void
  pass: (k: MediaCheckKey) => void

  startCam: (id: CamDeviceId) => Promise<void>
  stopCam: (id: CamDeviceId) => Promise<void>
  switchFacing: (id: CamDeviceId) => Promise<void>
  toggleTorch: (id: CamDeviceId) => Promise<void>

  // FA-8
  setRemoteMicStream: (s: MediaStream | null) => void
  setRemoteBabyStream: (s: MediaStream | null) => void
  setRealCam: (c: { active: boolean; facing: string; torch: boolean; watch: boolean; at: number } | null) => void
  setSensors: (s: { a: number[]; g: number[]; at: number } | null) => void

  linkWebcam: () => Promise<void>
  unlinkWebcam: () => void
  setWebcamAuto: (b: boolean) => void
  setRemoteWebcam: (stream: MediaStream) => void

  startCall: () => void
  endCall: () => void
  toggleCallMute: () => void

  triggerShutter: (timer: number) => Promise<void>

  startSecurity: () => Promise<void>
  stopSecurity: () => void
  setSecSource: (id: CamDeviceId) => Promise<void>
  setSecViewer: (t: ScreenTarget) => void
  setSensitivity: (v: number) => void
  bumpMotion: (level: number, pct: number) => void

  startBaby: () => Promise<void>
  stopBaby: () => void
  setBabyReceiver: (r: "galaxy-s24" | "pc-office") => Promise<void>
  setBabyGain: (v: number) => void
  bumpBabyLevel: (rms: number, peak: number) => void

  startMic: () => Promise<void>
  stopMic: () => void
  setMicGain: (v: number) => void
  toggleMonitor: () => void
  bumpMicLevel: (rms: number, peak: number) => void

  loadCastLibrary: () => Promise<void>
  startCast: (item: CastMediaItem, target: ScreenTarget) => void
  stopCast: () => void
  castToggle: () => void
  castSeek: (pos: number) => void
  castVolume: (v: number) => void
  castMute: () => void
  updateCastPos: (position: number, duration: number, playing: boolean) => void

  loadGallery: () => Promise<void>
  setGalleryDevice: (d: "all" | MediaDeviceId) => void
  startSlideshow: (target: ScreenTarget) => void
  stopSlideshow: () => void
  slideshowNext: (dir?: 1 | -1) => void
  slideshowToggle: () => void
  setSlideshowInterval: (sec: number) => void
  toggleSlideshowShuffle: () => void
}

// محرك توصيل الميزات بالمصادر والوصلات (خارج الحالة لأنه غير قابل للتسلسل)
interface FeatureRig {
  loopback?: LoopbackHandle
  stream?: MediaStream
}
const rigs: Record<string, FeatureRig> = {}
function setRig(name: string, rig: FeatureRig | undefined) {
  const old = rigs[name]
  if (old?.loopback) old.loopback.cleanup()
  rigs[name] = rig ?? {}
}

export const useMedia = create<MediaState>((set, get) => ({
  tab: "webcam",
  bridgeOnline: false,
  phoneOnline: null,
  latency: null,

  webcamStream: null,
  secStream: null,
  babyStream: null,
  micStream: null,

  cams: {
    "galaxy-s24": { active: false, facing: "back", real: false, label: "", torch: false, torchSupported: false },
    "redmi-note13": { active: false, facing: "back", real: false, label: "", torch: false, torchSupported: false },
    "pc-office": { active: false, facing: "back", real: false, label: "", torch: false, torchSupported: false },
  },
  mics: {
    "galaxy-s24": { active: false, real: false, label: "" },
    "redmi-note13": { active: false, real: false, label: "" },
  },

  // FA-8
  remoteMicStream: null,
  remoteBabyStream: null,
  realCam: null,
  sensors: null,

  webcam: { status: "idle", mode: null, startedAt: idb(null), quality: "1080p", fps: 0, auto: true },
  call: { inCall: false, contact: "ليان — Nexus Video", startedAt: null, micMuted: false, camSource: null },
  shutter: { counting: null, lastCapture: null },

  sec: { enabled: false, source: "galaxy-s24", viewer: "pc", sensitivity: 6, level: 0, pct: 0, lastAlertAt: 0, armedSince: null },
  baby: { enabled: false, sender: "redmi-note13", receiver: "galaxy-s24", level: 0, peak: 0, gain: 80, lastCryAt: null, listeningSince: null },
  mic: { level: 0, peak: 0, gain: 85, monitor: true, startedAt: null },

  cast: null,
  castLibrary: [],
  castLoading: false,

  gallery: { device: "all", photos: [], loading: false, loadedOnce: false, slideshow: null },

  alerts: [],
  checks: {
    webcam: false, call: false, controls: false, security: false,
    baby: false, mic: false, cast: false, gallery: false,
  },
  logs: [],

  setTab: (t) => set({ tab: t }),
  setBridge: (b) => set({ bridgeOnline: b }),
  setPhoneOnline: (n) => set({ phoneOnline: n }),
  setLatency: (ms) => set({ latency: ms }),

  // FA-8
  setRemoteMicStream: (s) => set({ remoteMicStream: s }),
  setRemoteBabyStream: (s) => set({ remoteBabyStream: s }),
  setRealCam: (c) => set({ realCam: c }),
  setSensors: (s) => set({ sensors: s }),

  log: (text, kind = "info") =>
    set((s) => ({ logs: [{ id: mediaUid(), at: Date.now(), text, kind }, ...s.logs].slice(0, 80) })),

  pushAlert: (kind, text, extra) =>
    set((s) => ({
      alerts: [{ id: mediaUid(), at: Date.now(), kind, text, ...extra }, ...s.alerts].slice(0, 50),
    })),

  pass: (k) => {
    if (get().checks[k]) return
    set((s) => ({ checks: { ...s.checks, [k]: true } }))
    get().log("اختبار النجاح: بند جديد مكتمل ✓", "ok")
  },

  // ================= مصادر الكاميرا =================
  startCam: async (id) => {
    const cur = get().cams[id]
    if (cur.active) return
    try {
      const src = await acquireCamera(id, cur.facing)
      const torchOk = await torchSupported(id)
      set((s) => ({
        cams: { ...s.cams, [id]: { ...s.cams[id], active: true, real: src.real, label: src.label, torchSupported: torchOk } },
      }))
      get().log(`كاميرا ${id === "galaxy-s24" ? "Galaxy-S24" : id === "redmi-note13" ? "Redmi-Note13" : "PC"} تعمل الآن — ${src.real ? "عتاد حقيقي" : "بث محاكى"}`, "ok")
    } catch {
      get().log("تعذر تشغيل الكاميرا", "warn")
    }
  },

  stopCam: async (id) => {
    const st = get()
    // أوقف الميزات التي تستهلك هذه الكاميرا
    if (st.webcam.status !== "idle" && id === "galaxy-s24") st.unlinkWebcam()
    if (st.sec.enabled && st.sec.source === id) st.stopSecurity()
    releaseCamera(id)
    set((s) => ({
      cams: { ...s.cams, [id]: { ...s.cams[id], active: false, torch: false } },
    }))
    get().log(`كاميرا ${id} توقفت`)
  },

  switchFacing: async (id) => {
    const st = get()
    const next: Facing = st.cams[id].facing === "back" ? "front" : "back"
    if (!st.cams[id].real) {
      retargetSyntheticFacing(id, next)
      set((s) => ({ cams: { ...s.cams, [id]: { ...s.cams[id], facing: next } } }))
    } else {
      // عتاد حقيقي: أعد فتح الكاميرا بالاتجاه الجديد وأعد الوصلات
      const wasWebcam = st.webcam.status === "live" && id === "galaxy-s24"
      const wasSec = st.sec.enabled && st.sec.source === id
      if (wasWebcam) st.unlinkWebcam()
      if (wasSec) st.stopSecurity()
      releaseCamera(id)
      set((s) => ({ cams: { ...s.cams, [id]: { ...s.cams[id], active: false, facing: next } } }))
      await get().startCam(id)
      if (wasWebcam) await get().linkWebcam()
      if (wasSec) await get().startSecurity()
    }
    set((s) => ({ cams: { ...s.cams, [id]: { ...s.cams[id], facing: next } } }))
    get().log(`تبديل الكاميرا: ${next === "front" ? "الأمامية" : "الخلفية"}`)
    get().pass("controls")
  },

  toggleTorch: async (id) => {
    const st = get()
    if (!st.cams[id].active) return
    const next = !st.cams[id].torch
    const ok = await setTorch(id, next)
    set((s) => ({ cams: { ...s.cams, [id]: { ...s.cams[id], torch: next, torchSupported: s.cams[id].torchSupported || ok } } }))
    get().log(next ? "تشغيل الفلاش (كشاف)" : "إطفاء الفلاش")
    get().pass("controls")
  },

  // ================= وصلة الويب كام =================
  linkWebcam: async () => {
    const st = get()
    if (st.webcam.status === "linking" || st.webcam.status === "live") return
    set({ webcam: { ...st.webcam, status: "linking" } })
    try {
      if (!cameraActive("galaxy-s24")) await get().startCam("galaxy-s24")
      const ex = cameraActive("galaxy-s24")
      if (!ex) throw new Error("no-source")
      const lb = await createLoopback(ex.stream)
      setRig("webcam", { loopback: lb })
      set({
        webcamStream: lb.stream,
        webcam: {
          status: "live", mode: lb.mode, startedAt: Date.now(),
          quality: ex.real ? "1280×720 حقيقي" : "640×360 محاكى", fps: 24,
          auto: get().webcam.auto,
        },
      })
      mediaBeep("link")
      get().log(`كويب كام نشط: كاميرا Galaxy-S24 → NEXUS-PC عبر ${lb.mode === "webrtc" ? "WebRTC" : "قناة مباشرة"}`, "ok")
      get().pass("webcam")
      if (st.webcam.auto) {
        // الاتصال التلقائي: الكمبيوتر يتبنى الكاميرا فور توفرها
        get().log("الاتصال التلقائي: تم تعيين الكاميرا الافتراضية للنظام", "ok")
      }
    } catch {
      set({ webcam: { ...get().webcam, status: "error" } })
      get().log("فشل ربط الكويب كام", "warn")
    }
  },

  unlinkWebcam: () => {
    setRig("webcam", undefined)
    set((s) => ({ webcamStream: null, webcam: { ...s.webcam, status: "idle", mode: null, startedAt: null, fps: 0 } }))
    get().log("كويب كام متوقف")
  },

  setWebcamAuto: (b) => set((s) => ({ webcam: { ...s.webcam, auto: b } })),

  /** بث كاميرا هاتف حقيقي وصل عبر الجسر — يعيّن نفسه كويب كام */
  setRemoteWebcam: (stream) => {
    setRig("webcam", { stream })
    set({
      webcamStream: stream,
      webcam: {
        status: "live", mode: "webrtc", startedAt: Date.now(),
        quality: "بث من هاتف حقيقي", fps: 30, auto: get().webcam.auto,
      },
    })
    get().log("استُلم بث كاميرا الهاتف الحقيقي — عُيّن كويب كام للكمبيوتر", "ok")
    get().pass("webcam")
  },

  // ================= مكالمة الفيديو =================
  startCall: () => {
    const st = get()
    if (st.webcam.status !== "live") return
    set({ call: { inCall: true, contact: st.call.contact, startedAt: Date.now(), micMuted: false, camSource: "Nexus Virtual Camera (Galaxy-S24)" } })
    get().log("مكالمة فيديو بدأت — تستخدم كاميرا الهاتف الافتراضية", "ok")
    get().pass("call")
  },
  endCall: () => {
    set((s) => ({ call: { ...s.call, inCall: false, startedAt: null } }))
    get().log("انتهت مكالمة الفيديو")
  },
  toggleCallMute: () =>
    set((s) => ({ call: { ...s.call, micMuted: !s.call.micMuted } })),

  // ================= مصراع عن بُعد =================
  triggerShutter: async (timer) => {
    const doCapture = async () => {
      const blob = await captureFromDevice("galaxy-s24")
      if (!blob) {
        get().log("لا يوجد بث كاميرا لالتقاطه", "warn")
        return
      }
      mediaBeep("shutter")
      try {
        const dataUrl = await blobToDataUrl(blob)
        const r = await fetch("/api/media/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device: "galaxy-s24", dir: "DCIM/Camera", dataUrl }),
        })
        const j = await r.json()
        if (j.ok) {
          set((s) => ({ shutter: { ...s.shutter, lastCapture: { name: j.name, at: Date.now() } } }))
          get().pushAlert("capture", `صورة جديدة من كاميرا Galaxy-S24: ${j.name}`, { snapshot: j.path })
          get().log(`التقطت صورة وحُفظت في DCIM/Camera: ${j.name} (${Math.round(j.bytes / 1024)} KB)`, "ok")
          get().pass("controls")
          // حدث المعرض إن محمّل
          if (get().gallery.loadedOnce) void get().loadGallery()
        } else {
          get().log("فشل حفظ الصورة", "warn")
        }
      } catch {
        get().log("فشل رفع الصورة", "warn")
      }
    }
    if (timer > 0) {
      get().log(`مؤقت التصوير: ${timer} ثانية`)
      set((s) => ({ shutter: { ...s.shutter, counting: timer } }))
      let left = timer
      const iv = window.setInterval(() => {
        left -= 1
        if (left <= 0) {
          window.clearInterval(iv)
          set((s) => ({ shutter: { ...s.shutter, counting: null } }))
          void doCapture()
        } else {
          set((s) => ({ shutter: { ...s.shutter, counting: left } }))
        }
      }, 1000)
    } else {
      await doCapture()
    }
  },

  // ================= وضع المراقبة =================
  startSecurity: async () => {
    const st = get()
    if (st.sec.enabled) return
    set({ sec: { ...st.sec, enabled: true, armedSince: Date.now(), level: 0, pct: 0 } })
    if (!cameraActive(st.sec.source)) await get().startCam(st.sec.source)
    const ex = cameraActive(st.sec.source)
    if (ex) {
      const lb = await createLoopback(ex.stream)
      setRig("security", { loopback: lb })
      set({ secStream: lb.stream })
      get().log(`بث المراقبة يعبر WebRTC (${lb.mode === "webrtc" ? "قناة مشفرة" : "قناة مباشرة"})`, "info")
    }
    get().log(`وضع المراقبة فعّال: مصدر ${st.sec.source} → شاشة ${st.sec.viewer === "tv" ? "Nexus-TV" : "الكمبيوتر"} (كشف حركة بدون AI)`, "ok")
  },

  stopSecurity: () => {
    setRig("security", undefined)
    set((s) => ({ secStream: null, sec: { ...s.sec, enabled: false, armedSince: null, level: 0, pct: 0 } }))
    get().log("وضع المراقبة متوقف")
  },

  setSecSource: async (id) => {
    const st = get()
    const was = st.sec.enabled
    if (was) {
      setRig("security", undefined)
      set({ secStream: null, sec: { ...st.sec, enabled: false } })
    }
    set((s) => ({ sec: { ...s.sec, source: id } }))
    if (was) {
      await get().startSecurity()
    }
  },

  setSecViewer: (t) => set((s) => ({ sec: { ...s.sec, viewer: t } })),
  setSensitivity: (v) => set((s) => ({ sec: { ...s.sec, sensitivity: v } })),

  bumpMotion: (level, pct) => {
    const st = get()
    if (!st.sec.enabled) return
    set({ sec: { ...st.sec, level, pct } })
    if (level >= 15 && Date.now() - st.sec.lastAlertAt > 4000) {
      set({ sec: { ...get().sec, lastAlertAt: Date.now() } })
      mediaBeep("motion")
      get().pushAlert("motion", `حركة مرصودة! شدة ${level}% — المصدر: ${st.sec.source === "galaxy-s24" ? "Galaxy-S24" : st.sec.source === "pc-office" ? "كاميرا PC" : "Redmi-Note13"}`, { level })
      get().log(`تنبيه حركة: ${pct.toFixed(1)}% من الإطار تغيّر (عتبة قواعدية، بدون AI)`, "in")
      get().pass("security")
    }
  },

  // ================= مراقبة الأطفال =================
  startBaby: async () => {
    const st = get()
    if (st.baby.enabled) return
    set({ baby: { ...st.baby, enabled: true, listeningSince: Date.now(), level: 0, peak: 0 } })
    const src = await acquireMic(st.baby.sender, "baby")
    set((s) => ({ mics: { ...s.mics, [st.baby.sender]: { active: true, real: src.real, label: src.label } } }))
    const lb = await createLoopback(src.stream)
    setRig("baby", { loopback: lb })
    set({ babyStream: lb.stream })
    get().log(`مراقبة الأطفال: بث صوت دائم من ${st.baby.sender === "redmi-note13" ? "Redmi-Note13 (غرفة الطفل)" : "Galaxy-S24"} → ${st.baby.receiver === "pc-office" ? "سماعات الكمبيوتر" : "Galaxy-S24 (هاتف الوالدين)"} عبر ${lb.mode === "webrtc" ? "WebRTC" : "قناة مباشرة"}`, "ok")
    get().pass("baby")
  },

  stopBaby: () => {
    const st = get()
    setRig("baby", undefined)
    releaseMic(st.baby.sender)
    set((s) => ({
      babyStream: null,
      baby: { ...s.baby, enabled: false, listeningSince: null, level: 0, peak: 0 },
      mics: { ...s.mics, [st.baby.sender]: { active: false, real: false, label: "" } },
    }))
    get().log("مراقبة الأطفال متوقفة")
  },

  setBabyReceiver: async (r) => {
    const st = get()
    const was = st.baby.enabled
    if (was) st.stopBaby()
    set((s) => ({ baby: { ...s.baby, receiver: r } }))
    if (was) await get().startBaby()
  },

  setBabyGain: (v) => set((s) => ({ baby: { ...s.baby, gain: v } })),

  bumpBabyLevel: (rms, peak) => {
    const st = get()
    if (!st.baby.enabled) return
    set({ baby: { ...st.baby, level: rms, peak } })
    if (rms >= 55 && Date.now() - (st.baby.lastCryAt ?? 0) > 6000) {
      set({ baby: { ...get().baby, lastCryAt: Date.now() } })
      mediaBeep("cry")
      get().pushAlert("cry", `تنبيه بكاء! مستوى الصوت ${rms}% في غرفة الطفل`, { level: rms })
      get().log("تنبيه: صوت بكاء مرتفع (عتبة شدة 55% بدون AI)", "warn")
    }
  },

  // ================= ميكروفون لاسلكي =================
  startMic: async () => {
    const st = get()
    if (st.mics["galaxy-s24"].active) return
    const src = await acquireMic("galaxy-s24", "voice")
    set((s) => ({
      mics: { ...s.mics, "galaxy-s24": { active: true, real: src.real, label: src.label } },
      mic: { ...s.mic, startedAt: Date.now(), level: 0, peak: 0 },
    }))
    const lb = await createLoopback(src.stream)
    setRig("mic", { loopback: lb })
    set({ micStream: lb.stream })
    get().log(`Galaxy-S24 أصبح ميكروفوناً لاسلكياً للكمبيوتر — ${src.real ? "عتاد حقيقي" : "محاكاة"} عبر ${lb.mode === "webrtc" ? "WebRTC" : "قناة مباشرة"}`, "ok")
    get().pass("mic")
  },

  stopMic: () => {
    setRig("mic", undefined)
    releaseMic("galaxy-s24")
    set((s) => ({
      micStream: null,
      mics: { ...s.mics, "galaxy-s24": { active: false, real: false, label: "" } },
      mic: { ...s.mic, startedAt: null, level: 0, peak: 0 },
    }))
    get().log("الميكروفون اللاسلكي متوقف")
  },

  setMicGain: (v) => set((s) => ({ mic: { ...s.mic, gain: v } })),
  toggleMonitor: () => set((s) => ({ mic: { ...s.mic, monitor: !s.mic.monitor } })),
  bumpMicLevel: (rms, peak) => set((s) => ({ mic: { ...s.mic, level: rms, peak } })),

  // ================= بث الوسائط =================
  loadCastLibrary: async () => {
    if (get().castLoading || get().castLibrary.length) return
    set({ castLoading: true })
    try {
      const dirs: Array<{ d: string; p: string }> = [
        { d: "galaxy-s24", p: "/Movies" },
        { d: "galaxy-s24", p: "/Music" },
        { d: "galaxy-s24", p: "/DCIM/Camera" },
      ]
      const items: CastMediaItem[] = []
      for (const { d, p } of dirs) {
        const r = await fetch(`/api/fs?device=${d}&path=${encodeURIComponent(p)}`)
        const j = await r.json()
        for (const e of (j.entries ?? []) as Array<{ type: string; category: string; name: string; path: string; size: number }>) {
          if (e.type === "file" && (e.category === "video" || e.category === "audio")) {
            items.push({
              id: `${d}:${e.path}`,
              device: "galaxy-s24",
              path: e.path,
              name: e.name,
              kind: e.category === "video" ? "video" : "audio",
              size: e.size,
            })
          }
        }
      }
      set({ castLibrary: items, castLoading: false })
    } catch {
      set({ castLoading: false })
      get().log("تعذر تحميل مكتبة الوسائط", "warn")
    }
  },

  startCast: (item, target) => {
    const st = get()
    // أوقف الجلسة السابقة
    if (st.cast) get().stopCast()
    set({
      cast: {
        media: item, target, sender: "Galaxy-S24", playing: true,
        position: 0, duration: 0, volume: 90, muted: false, startedAt: Date.now(),
      },
    })
    // §22 — إعلان حالة البث للمستقبلات (صفحة /tv على شاشة التلفاز)
    castState({ active: true, media: { device: item.device, path: item.path, name: item.name, kind: item.kind }, target, sender: "Galaxy-S24", playing: true, volume: 90, muted: false, at: Date.now() })
    get().log(`بث ${item.kind === "video" ? "فيديو" : "موسيقى"} «${item.name}» إلى ${target === "tv" ? "Nexus-TV" : "الكمبيوتر"} — بث مباشر بدون نسخ`, "ok")
    get().pass("cast")
  },

  stopCast: () => {
    set({ cast: null })
    // §22 — إخبار المستقبلات بانتهاء البث
    castState({ active: false, at: Date.now() })
    get().log("انتهى البث")
  },

  castToggle: () => {
    const st = get()
    if (!st.cast) return
    const el = registerAndGet(st.cast.target)
    if (el) {
      if (st.cast.playing) el.pause()
      else void el.play().catch(() => {})
    }
    set((s) => ({ cast: s.cast ? { ...s.cast, playing: !s.cast.playing } : null }))
    // §22 — إعلان حالة التشغيل الجديدة
    const c = get().cast
    if (c) castState({ active: true, media: { device: c.media.device, path: c.media.path, name: c.media.name, kind: c.media.kind }, target: c.target, playing: c.playing, volume: c.volume, muted: c.muted, at: Date.now() })
    get().log(st.cast.playing ? "إيقاف مؤقت" : "استئناف التشغيل")
  },

  castSeek: (pos) => {
    const st = get()
    if (!st.cast) return
    const el = registerAndGet(st.cast.target)
    if (el) el.currentTime = pos
    set((s) => ({ cast: s.cast ? { ...s.cast, position: pos } : null }))
    // §22 — إعلان الموضع (مقيّد — لا إغراق للمستقبل)
    const c = get().cast
    if (c && Math.abs(pos - (castLastPos ?? -1)) > 1) {
      castLastPos = pos
      castState({ active: true, target: c.target, position: pos, playing: c.playing, at: Date.now() })
    }
  },

  castVolume: (v) => {
    const st = get()
    if (!st.cast) return
    const el = registerAndGet(st.cast.target)
    if (el) { el.volume = v / 100; el.muted = false }
    set((s) => ({ cast: s.cast ? { ...s.cast, volume: v, muted: false } : null }))
    const c = get().cast
    if (c) castState({ active: true, target: c.target, volume: c.volume, muted: c.muted, at: Date.now() })
  },

  castMute: () => {
    const st = get()
    if (!st.cast) return
    const el = registerAndGet(st.cast.target)
    const next = !st.cast.muted
    if (el) el.muted = next
    set((s) => ({ cast: s.cast ? { ...s.cast, muted: next } : null }))
    const c = get().cast
    if (c) castState({ active: true, target: c.target, volume: c.volume, muted: c.muted, at: Date.now() })
  },

  updateCastPos: (position, duration, playing) =>
    set((s) => ({ cast: s.cast ? { ...s.cast, position, duration: duration || s.cast.duration, playing } : null })),

  // ================= المعرض وعرض الشرائح =================
  loadGallery: async () => {
    set((s) => ({ gallery: { ...s.gallery, loading: true } }))
    try {
      const pickers: Array<{ dev: MediaDeviceId | "ipad-pro"; dirs: string[] }> = [
        { dev: "galaxy-s24", dirs: ["/DCIM/Camera", "/WhatsApp/Media"] },
        { dev: "pc-office", dirs: ["/Photos"] },
        { dev: "ipad-pro", dirs: ["/Media"] },
      ]
      const dev = get().gallery.device
      const targets = dev === "all" ? pickers : pickers.filter((p) => (p.dev === dev)) as any
      const photos: GalleryPhoto[] = []
      for (const t of targets) {
        for (const dir of t.dirs) {
          try {
            const r = await fetch(`/api/fs?device=${t.dev}&path=${encodeURIComponent(dir)}`)
            const j = await r.json()
            for (const e of (j.entries ?? []) as Array<{ type: string; category: string; name: string; path: string; size: number; mtime: number }>) {
              if (e.type === "file" && e.category === "image") {
                photos.push({
                  id: `${t.dev}:${e.path}`, device: t.dev as MediaDeviceId, path: e.path,
                  name: e.name, mtime: e.mtime, size: e.size,
                })
              }
            }
          } catch { /* تجاهل مجلد مفقود */ }
        }
      }
      photos.sort((a, b) => b.mtime - a.mtime)
      set((s) => ({ gallery: { ...s.gallery, photos, loading: false, loadedOnce: true } }))
      get().pass("gallery")
    } catch {
      set((s) => ({ gallery: { ...s.gallery, loading: false } }))
    }
  },

  setGalleryDevice: (d) => {
    set((s) => ({ gallery: { ...s.gallery, device: d } }))
    void get().loadGallery()
  },

  startSlideshow: (target) => {
    const photos = get().gallery.photos
    if (!photos.length) return
    const order = photos.map((_, i) => i)
    set((s) => ({
      gallery: {
        ...s.gallery,
        slideshow: { target, playing: true, index: order[0], interval: 5, shuffle: false, order },
      },
    }))
    get().log(`عرض شرائح بدأ على ${target === "tv" ? "Nexus-TV (الشاشة الكبيرة)" : "شاشة الكمبيوتر"} — ${photos.length} صورة`, "ok")
    get().pass("gallery")
  },

  stopSlideshow: () =>
    set((s) => ({ gallery: { ...s.gallery, slideshow: null } })),

  slideshowNext: (dir = 1) => {
    const ss = get().gallery.slideshow
    if (!ss) return
    const pos = ss.order.indexOf(ss.index)
    const nextPos = (pos + dir + ss.order.length) % ss.order.length
    set((s) => ({
      gallery: {
        ...s.gallery,
        slideshow: s.gallery.slideshow ? { ...s.gallery.slideshow, index: s.gallery.slideshow.order[nextPos] } : null,
      },
    }))
  },

  slideshowToggle: () =>
    set((s) => ({
      gallery: {
        ...s.gallery,
        slideshow: s.gallery.slideshow ? { ...s.gallery.slideshow, playing: !s.gallery.slideshow.playing } : null,
      },
    })),

  setSlideshowInterval: (sec) =>
    set((s) => ({
      gallery: { ...s.gallery, slideshow: s.gallery.slideshow ? { ...s.gallery.slideshow, interval: sec } : null },
    })),

  toggleSlideshowShuffle: () =>
    set((s) => {
      const ss = s.gallery.slideshow
      if (!ss) return s
      const order = ss.shuffle
        ? ss.order // إعادة للترتيب الأصلي
        : [...ss.order].sort(() => Math.random() - 0.5)
      return {
        gallery: {
          ...s.gallery,
          slideshow: { ...ss, shuffle: !ss.shuffle, order, index: order[0] },
        },
      }
    }),
}))

/** يجلب عنصر المستقبل المسجل للبث */
function registerAndGet(target: ScreenTarget): HTMLVideoElement | HTMLAudioElement | null {
  return getReceiver(target)
}

// ملاحظة: registerReceiver يُصدَّر من المحرك مباشرة للاستخدام في المكونات
export { registerReceiver }
