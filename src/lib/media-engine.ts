"use client"
// NexusLink — محرك الوسائط والكاميرا (جهة العميل)
// ================================================
// كل شيء حقيقي قدر الإمكان: getUserMedia للكاميرا والميكروفون، WebRTC
// (RTCPeerConnection) لنقل البث بين "الأجهزة"، كشف الحركة بمعالجة إطارات
// بسيطة (فروق لمعان — بدون أي AI)، وقياس الصوت عبر AnalyserNode.
// عند غياب العتاد (بيئة بدون كاميرا/ميك) يُنتج محرك محاكاة ببث حقيقي
// عبر canvas.captureStream / MediaStreamDestination كي تعمل كل الميزات.

import type { Facing } from "./media-types"

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

// ============================================================
// 1) كاميرا محاكاة: مشهد حي متحرك عبر canvas.captureStream
//    — يحتوي حركة دورية كي يعمل كاشف الحركة في وضع المراقبة
// ============================================================
export class SyntheticCamera {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private timer: number | null = null
  private stream: MediaStream | null = null
  private t0 = Date.now()
  private droneX = 0.15
  private droneDir = 1
  private droneDown = false
  facing: Facing = "back"
  torch = false

  constructor(facing: Facing = "back") {
    this.facing = facing
    this.canvas = document.createElement("canvas")
    this.canvas.width = 640
    this.canvas.height = 360
    const ctx = this.canvas.getContext("2d")
    if (!ctx) throw new Error("canvas 2d غير متاح")
    this.ctx = ctx
  }

  getStream(): MediaStream {
    if (!this.stream) {
      this.start()
      this.stream = this.canvas.captureStream(24)
    }
    return this.stream
  }

  private start() {
    if (this.timer) return
    this.timer = window.setInterval(() => this.draw(), 1000 / 24)
    this.draw()
  }

  private draw() {
    const { ctx, canvas } = this
    const w = canvas.width, h = canvas.height
    const t = (Date.now() - this.t0) / 1000
    const front = this.facing === "front"

    // خلفية: غرفة بجدار متدرج
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    if (front) {
      grad.addColorStop(0, "#2b3a55")
      grad.addColorStop(1, "#1c2740")
    } else {
      grad.addColorStop(0, "#3a4657")
      grad.addColorStop(1, "#222b38")
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    // نافذة بضوء يوم يتحرك ببطء
    const winX = front ? w * 0.68 : w * 0.1
    ctx.fillStyle = "#87a7c9"
    ctx.globalAlpha = 0.85
    ctx.fillRect(winX, 40, 150, 120)
    ctx.globalAlpha = 1
    ctx.strokeStyle = "#5b6b80"
    ctx.lineWidth = 8
    ctx.strokeRect(winX, 40, 150, 120)
    ctx.beginPath()
    ctx.moveTo(winX + 75, 40)
    ctx.lineTo(winX + 75, 160)
    ctx.moveTo(winX, 100)
    ctx.lineTo(winX + 150, 100)
    ctx.stroke()
    // بقعة ضوء متحركة على الأرضية
    const lx = winX + 75 + Math.sin(t / 4) * 120
    const lg = ctx.createRadialGradient(lx, 300, 8, lx, 300, 120)
    lg.addColorStop(0, "rgba(255,236,180,0.35)")
    lg.addColorStop(1, "rgba(255,236,180,0)")
    ctx.fillStyle = lg
    ctx.fillRect(0, 200, w, 160)

    // أثاث بسيط
    ctx.fillStyle = "#4a3b2f"
    ctx.fillRect(front ? w * 0.08 : w * 0.62, 250, 180, 12) // طاولة
    ctx.fillRect(front ? w * 0.1 : w * 0.64, 262, 14, 70)
    ctx.fillRect(front ? w * 0.24 : w * 0.78, 262, 14, 70)
    if (front) {
      // وجه (سيلفي): دائرة + عيون ترمش
      const cx = w / 2, cy = 170
      const rg = ctx.createRadialGradient(cx, cy, 20, cx, cy, 95)
      rg.addColorStop(0, "#e8b98f")
      rg.addColorStop(1, "#c9955f")
      ctx.fillStyle = rg
      ctx.beginPath()
      ctx.arc(cx, cy, 88, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#2f2a26"
      const blink = Math.sin(t * 1.7) > 0.97 ? 2 : 9
      ctx.beginPath()
      ctx.ellipse(cx - 30, cy - 12, 9, blink / 2 + 2, 0, 0, Math.PI * 2)
      ctx.ellipse(cx + 30, cy - 12, 9, blink / 2 + 2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "#7a4b2c"
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(cx, cy + 105, 120, Math.PI * 1.15, Math.PI * 1.85)
      ctx.stroke()
    } else {
      // نبتة
      ctx.fillStyle = "#2f5e3a"
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.28 + Math.sin(t + i) * 0.04
        ctx.save()
        ctx.translate(w * 0.3, 250)
        ctx.rotate(a)
        ctx.beginPath()
        ctx.ellipse(0, -32, 10, 34, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    // شخص يعبر الغرفة دورياً — حركة واقعية لكاشف الحركة (كاميرا أمنية)
    const cycle = 11
    const wt = t % cycle
    if (wt > 4.5 && wt < 10.2) {
      const p = (wt - 4.5) / 5.7
      const px = -70 + p * (w + 140)
      const py = 288 + Math.sin(p * Math.PI * 6) * 2
      ctx.fillStyle = "rgba(13,16,22,0.88)"
      ctx.beginPath()
      ctx.arc(px, py - 118, 16, 0, Math.PI * 2) // رأس
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(px, py - 72, 21, 48, 0, 0, Math.PI * 2) // جذع
      ctx.fill()
      const legSwing = Math.sin(p * Math.PI * 10) * 13
      ctx.fillRect(px - 15, py - 30, 11, 60 + legSwing) // رِجل
      ctx.fillRect(px + 4, py - 30, 11, 60 - legSwing) // رِجل
    }

    // درون صغير يحلّق بسرعة كافية لكشف الحركة — مصدر حركة دورية
    this.droneX += this.droneDir * 0.006
    if (this.droneX > 0.86 || this.droneX < 0.1) this.droneDir *= -1
    this.droneDown = !this.droneDown
    const dy = 90 + Math.sin(t / 2.2) * 26
    const dx = this.droneX * w
    ctx.fillStyle = "#12161c"
    ctx.beginPath()
    ctx.ellipse(dx, dy, 18, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.5)"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(dx - 24, dy - 5)
    ctx.lineTo(dx + 24, dy - 5)
    ctx.stroke()
    if (Math.floor(t * 8) % 2 === 0) {
      ctx.strokeStyle = "rgba(180,220,255,0.4)"
      ctx.beginPath()
      ctx.arc(dx, dy, 28, 0, Math.PI * 2)
      ctx.stroke()
    }

    // وميض الفلاش (كشاف محاكى)
    if (this.torch) {
      ctx.fillStyle = "rgba(255,255,240,0.28)"
      ctx.fillRect(0, 0, w, h)
    }

    // HUD: إطار كاميرا حقيقي
    ctx.strokeStyle = "rgba(255,255,255,0.28)"
    ctx.lineWidth = 2
    ctx.strokeRect(14, 14, w - 28, h - 28)
    ctx.fillStyle = "rgba(0,0,0,0.45)"
    ctx.fillRect(20, h - 52, 210, 30)
    ctx.fillStyle = "#ff5252"
    ctx.beginPath()
    ctx.arc(36, h - 37, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#fff"
    ctx.font = "13px monospace"
    ctx.textAlign = "left"
    ctx.fillText("NEXUS-CAM · " + (front ? "FRONT" : "REAR"), 48, h - 32)
    const d = new Date()
    ctx.textAlign = "right"
    ctx.fillText(
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`,
      w - 24, h - 32
    )
    ctx.textAlign = "left"
    ctx.fillStyle = "rgba(255,255,255,0.75)"
    ctx.fillText("1080p · 24fps", 22, 34)
  }

  destroy() {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}

// ============================================================
// 2) مركز المصادر: بث واحد لكل جهاز يستهلكه عدة مستقبلين (عدّ مرجعي)
// ============================================================
type SourceKey = string // "cam:galaxy-s24" | "mic:redmi-note13"

interface SourceEntry {
  stream: MediaStream
  real: boolean
  label: string
  users: number
  synthCam?: SyntheticCamera
  synthAudio?: { stream: MediaStream; stop: () => void; level?: () => { rms: number; peak: number } }
}

const sources = new Map<SourceKey, SourceEntry>()

export interface AcquiredSource {
  stream: MediaStream
  real: boolean
  label: string
}

/** الحصول على بث كاميرا جهاز (حقيقي إن توفر، وإلا مشهد محاكى) */
export async function acquireCamera(
  deviceId: string,
  facing: Facing
): Promise<AcquiredSource> {
  const key = `cam:${deviceId}`
  const ex = sources.get(key)
  if (ex && ex.users > 0) {
    // نفس الاتجاه مطلوب — أعِد المرجع
    ex.users++
    return { stream: ex.stream, real: ex.real, label: ex.label }
  }
  let real = false
  let label = "كاميرا محاكاة — NEXUS-CAM"
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing === "front" ? "user" : "environment", width: { ideal: 1280 } },
      audio: false,
    })
    real = true
    const vt = stream.getVideoTracks()[0]
    label = vt?.label ? `كاميرا حقيقية — ${vt.label}` : "كاميرا حقيقية"
  } catch {
    stream = null
  }
  if (!stream) {
    const synth = new SyntheticCamera(facing)
    try {
      stream = synth.getStream()
    } catch {
      throw new Error("تعذر فتح الكاميرا")
    }
    sources.set(key, { stream, real: false, label, users: 1, synthCam: synth })
    return { stream, real: false, label }
  }
  sources.set(key, { stream, real, label, users: 1 })
  return { stream, real, label }
}

/** تحرير مرجع لمصدر كاميرا */
export function releaseCamera(deviceId: string) {
  const key = `cam:${deviceId}`
  const ex = sources.get(key)
  if (!ex) return
  ex.users = Math.max(0, ex.users - 1)
  if (ex.users === 0) {
    ex.stream.getTracks().forEach((t) => t.stop())
    ex.synthCam?.destroy()
    ex.synthAudio?.stop()
    sources.delete(key)
  }
}

/** هل مصدر الكاميرا يعمل حالياً (مستخدم من ميزة أخرى) */
export function cameraActive(deviceId: string): SourceEntry | null {
  return sources.get(`cam:${deviceId}`) ?? null
}

/** بث كاميرا جهاز إن كانت تعمل (للعرض في الواجهة) */
export function getCamSource(deviceId: string): AcquiredSource | null {
  const ex = sources.get(`cam:${deviceId}`)
  return ex ? { stream: ex.stream, real: ex.real, label: ex.label } : null
}

/** بث ميكروفون جهاز إن كان يعمل (للعرض والقياس) */
export function getMicSource(deviceId: string): AcquiredSource | null {
  const ex = sources.get(`mic:${deviceId}`)
  return ex ? { stream: ex.stream, real: ex.real, label: ex.label } : null
}

/** مستوى المولّد التركيبي (يعمل حتى عند حجب سياق الصوت) */
export function getSynthLevel(deviceId: string): { rms: number; peak: number } | null {
  const ex = sources.get(`mic:${deviceId}`)
  if (!ex?.synthAudio?.level) return null
  try {
    return ex.synthAudio.level()
  } catch {
    return null
  }
}

/** تحديث اتجاه الكاميرا المحاكاة دون إعادة فتح (للمشهد المحاكى) */
export function retargetSyntheticFacing(deviceId: string, facing: Facing) {
  const ex = sources.get(`cam:${deviceId}`)
  if (ex?.synthCam) {
    ex.synthCam.facing = facing
    ex.synthCam.torch = ex.synthCam.torch
  }
}

/** تفعيل/إطفاء الفلاش: عتاد حقيقي عبر constraints وإلا وميض المشهد */
export async function setTorch(deviceId: string, on: boolean): Promise<boolean> {
  const ex = sources.get(`cam:${deviceId}`)
  if (!ex) return false
  if (ex.real) {
    const vt = ex.stream.getVideoTracks()[0]
    if (vt) {
      try {
        await vt.applyConstraints({ advanced: [{ torch: on } as never] })
        return true
      } catch {
        // الكشاف غير مدعوم — استخدم وميض المحاكاة إن وُجد
      }
    }
  }
  if (ex.synthCam) {
    ex.synthCam.torch = on
    return true
  }
  return false
}

/** دعم الكشاف في العتاد الحقيقي */
export async function torchSupported(deviceId: string): Promise<boolean> {
  const ex = sources.get(`cam:${deviceId}`)
  if (!ex?.real) return false
  try {
    const caps = ex.stream.getVideoTracks()[0]?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean } | undefined
    return !!caps?.torch
  } catch {
    return false
  }
}

// ============================================================
// 3) صوت تركيبي: غرفة طفل (هدوء + نوبات بكاء دورية) وهمس مكالمات
// ============================================================
let sharedCtx: AudioContext | null = null
function ac(): AudioContext {
  if (!sharedCtx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    sharedCtx = new AC!()
    // تسهيل التشخيص وفتح الصوت من أدوات الاختبار
    ;(window as unknown as { __nexusAudio?: AudioContext }).__nexusAudio = sharedCtx
  }
  if (sharedCtx.state === "suspended") void sharedCtx.resume()
  return sharedCtx
}

// فتح الصوت عند أول تفاعل (سياسة المتصفحات)
if (typeof window !== "undefined") {
  const unlock = () => {
    try { ac() } catch { /* ignore */ }
  }
  window.addEventListener("pointerdown", unlock)
  window.addEventListener("keydown", unlock)
  window.addEventListener("touchstart", unlock)
}

export interface SyntheticAudioHandle {
  stream: MediaStream
  stop: () => void
  /** مستوى الشدة الحالي للمولّد (يُستخدم عندما يمنع المتصفح سياق الصوت) */
  level?: () => { rms: number; peak: number }
}

/** بث غرفة طفل محاكى: ضجيج أبيض خفيف + هدوء + بكاء دوري (لتنبيه المستقبل) */
export function createSyntheticBabyRoom(): SyntheticAudioHandle {
  // جدول الشدة: أساس الضجيج + توهج الهنّاء + نوبات البكاء
  let cryUntil = 0
  let humUntil = 0
  const level = () => {
    const now = Date.now()
    const jitter = Math.random() * 4
    let base = 22 + jitter
    if (now < humUntil) base += 10 + Math.random() * 6
    if (now < cryUntil) base = 62 + Math.random() * 26
    return { rms: Math.min(100, Math.round(base)), peak: Math.min(100, Math.round(base + 14 + Math.random() * 8)) }
  }

  const c = ac()
  const dest = c.createMediaStreamDestination()
  // ضجيج خلفية ناعم
  const len = c.sampleRate * 2
  const buf = c.createBuffer(1, len, c.sampleRate)
  const ch = buf.getChannelData(0)
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * 0.12
  const noise = c.createBufferSource()
  noise.buffer = buf
  noise.loop = true
  const lp = c.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 480
  const noiseGain = c.createGain()
  noiseGain.gain.value = 0.16
  noise.connect(lp).connect(noiseGain).connect(dest)
  noise.start()

  // نغمة هدوء لطيفة تتكرر
  const melody = [523.25, 587.33, 659.25, 587.33, 523.25, 440]
  let mi = 0
  const hum = () => {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = "sine"
    o.frequency.value = melody[mi % melody.length]
    g.gain.setValueAtTime(0.0001, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.05, c.currentTime + 0.3)
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.6)
    o.connect(g).connect(dest)
    o.start()
    o.stop(c.currentTime + 1.7)
    mi++
  }
  const humIv = window.setInterval(hum, 2600)
  hum()
  humUntil = Date.now() + 1600

  // نوبة بكاء كل 12–20 ثانية (سواري عالي → ينبه المستقبل)
  let cryTimer: number | null = null
  const cry = () => {
    const dur = 1.4 + Math.random() * 0.7
    cryUntil = Date.now() + dur * 1000 + 300
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = "sawtooth"
    const t0 = c.currentTime
    o.frequency.setValueAtTime(380, t0)
    o.frequency.linearRampToValueAtTime(760, t0 + dur * 0.35)
    o.frequency.linearRampToValueAtTime(420, t0 + dur)
    const vib = c.createOscillator()
    const vg = c.createGain()
    vib.frequency.value = 9
    vg.gain.value = 26
    vib.connect(vg).connect(o.frequency)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.18)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g).connect(dest)
    o.start()
    vib.start()
    o.stop(t0 + dur + 0.05)
    vib.stop(t0 + dur + 0.05)
    scheduleCry()
  }
  function scheduleCry() {
    if (cryTimer) window.clearTimeout(cryTimer)
    cryTimer = window.setTimeout(cry, 12000 + Math.random() * 8000)
  }
  scheduleCry()

  return {
    stream: dest.stream,
    level,
    stop: () => {
      window.clearInterval(humIv)
      if (cryTimer) window.clearTimeout(cryTimer)
      try { noise.stop() } catch { /* ignore */ }
    },
  }
}

/** ميكروفون محاكى: همهمة كلام متقطعة (لعرض مستوى الصوت الحي) */
export function createSyntheticVoice(): SyntheticAudioHandle {
  const c = ac()
  const dest = c.createMediaStreamDestination()
  const master = c.createGain()
  master.gain.value = 0.5
  master.connect(dest)

  let talking = false
  let talkUntil = 0
  const formants = [700, 1200, 2600]
  const oscs = formants.map((f) => {
    const o = c.createOscillator()
    o.type = "sawtooth"
    o.frequency.value = 140 + Math.random() * 60
    const bp = c.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = f
    bp.Q.value = 5
    const g = c.createGain()
    g.gain.value = 0
    o.connect(bp).connect(g).connect(master)
    o.start()
    return { o, g, bp }
  })
  const tick = () => {
    talking = !talking || Math.random() < 0.65
    if (talking) {
      talkUntil = Date.now() + 420
      const pitch = 120 + Math.random() * 90
      oscs.forEach(({ o, g }, i) => {
        const t0 = c.currentTime
        g.gain.cancelScheduledValues(t0)
        g.gain.setValueAtTime(g.gain.value, t0)
        g.gain.linearRampToValueAtTime(0.22 / (i + 1), t0 + 0.06)
        o.frequency.linearRampToValueAtTime(pitch * (1 + i * 0.02), t0 + 0.15)
      })
    } else {
      oscs.forEach(({ g }) => {
        const t0 = c.currentTime
        g.gain.linearRampToValueAtTime(0, t0 + 0.1)
      })
    }
    iv = window.setTimeout(tick, 240 + Math.random() * 480)
  }
  let iv = window.setTimeout(tick, 300)

  const level = () => {
    const talkingNow = Date.now() < talkUntil
    if (talkingNow) {
      const v = 34 + Math.random() * 34
      return { rms: Math.round(v), peak: Math.round(Math.min(100, v + 16 + Math.random() * 10)) }
    }
    return { rms: Math.round(3 + Math.random() * 5), peak: Math.round(6 + Math.random() * 8) }
  }

  return {
    stream: dest.stream,
    level,
    stop: () => {
      window.clearTimeout(iv)
      oscs.forEach(({ o }) => { try { o.stop() } catch { /* ignore */ } })
    },
  }
}

/** فتح ميكروفون جهاز (حقيقي إن أمكن وإلا محاكاة) */
export async function acquireMic(
  deviceId: string,
  flavor: "voice" | "baby" = "voice"
): Promise<AcquiredSource> {
  const key = `mic:${deviceId}`
  const ex = sources.get(key)
  if (ex && ex.users > 0) {
    ex.users++
    return { stream: ex.stream, real: ex.real, label: ex.label }
  }
  let real = false
  let label = "ميكروفون محاكى"
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    real = true
    const at = stream.getAudioTracks()[0]
    label = at?.label ? `ميكروفون حقيقي — ${at.label}` : "ميكروفون حقيقي"
  } catch {
    stream = null
  }
  if (!stream) {
    const synth = flavor === "baby" ? createSyntheticBabyRoom() : createSyntheticVoice()
    stream = synth.stream
    sources.set(key, { stream, real: false, label, users: 1, synthAudio: synth })
    return { stream, real: false, label }
  }
  sources.set(key, { stream, real, label, users: 1 })
  return { stream, real, label }
}

export function releaseMic(deviceId: string) {
  const key = `mic:${deviceId}`
  const ex = sources.get(key)
  if (!ex) return
  ex.users = Math.max(0, ex.users - 1)
  if (ex.users === 0) {
    ex.stream.getTracks().forEach((t) => t.stop())
    ex.synthCam?.destroy()
    ex.synthAudio?.stop()
    sources.delete(key)
  }
}

// ============================================================
// 4) وصلة WebRTC بين جهازين داخل نفس الصفحة (نقل حقيقي)
// ============================================================
export interface LoopbackHandle {
  stream: MediaStream
  mode: "webrtc" | "direct"
  cleanup: () => void
}

/**
 * ينقل بث المصدر عبر RTCPeerConnection حقيقية (زوج متصل محلياً) —
 * نفس مسار Nexus Media في الإنتاج. عند فشل ICE يعود للربط المباشر.
 */
export async function createLoopback(source: MediaStream): Promise<LoopbackHandle> {
  try {
    const pc1 = new RTCPeerConnection()
    const pc2 = new RTCPeerConnection()
    pc1.onicecandidate = (e) => {
      if (e.candidate) void pc2.addIceCandidate(e.candidate).catch(() => {})
    }
    pc2.onicecandidate = (e) => {
      if (e.candidate) void pc1.addIceCandidate(e.candidate).catch(() => {})
    }
    const receiver = new MediaStream()
    pc2.ontrack = (e) => {
      if (!receiver.getTracks().includes(e.track)) receiver.addTrack(e.track)
    }
    source.getTracks().forEach((t) => pc1.addTrack(t, source))
    const offer = await pc1.createOffer()
    await pc1.setLocalDescription(offer)
    await pc2.setRemoteDescription(offer)
    const answer = await pc2.createAnswer()
    await pc2.setLocalDescription(answer)
    await pc1.setRemoteDescription(answer)

    await new Promise<void>((res, rej) => {
      const to = window.setTimeout(() => rej(new Error("ice-timeout")), 3500)
      const check = () => {
        const s = pc2.connectionState
        if (s === "connected") { window.clearTimeout(to); res() }
        else if (s === "failed" || s === "closed") { window.clearTimeout(to); rej(new Error("ice-failed")) }
      }
      pc2.onconnectionstatechange = check
      check()
    })

    return {
      stream: receiver,
      mode: "webrtc",
      cleanup: () => {
        try { pc1.close() } catch { /* ignore */ }
        try { pc2.close() } catch { /* ignore */ }
      },
    }
  } catch {
    return {
      stream: source,
      mode: "direct",
      cleanup: () => { /* المصدر مملوك لهاب المصادر */ },
    }
  }
}

// ============================================================
// 5) كاشف الحركة: فروق لمعان على شبكة مصغرة — بدون AI
// ============================================================
export class MotionDetector {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private prev: Float32Array | null = null
  private timer: number | null = null
  private lastEmit = 0

  constructor() {
    this.canvas = document.createElement("canvas")
    this.canvas.width = 80
    this.canvas.height = 45
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("canvas غير متاح")
    this.ctx = ctx
  }

  /** sensitivity: 1..10 → حساسية أعلى = عتبة فرق أقل */
  start(
    video: HTMLVideoElement,
    sensitivity: number,
    onLevel: (level: number, changedPct: number) => void
  ) {
    this.stop()
    const px = (v: number) => Math.round(64 - v * 5.2) // 1→59 ، 10→12
    const tick = () => {
      try {
        const { width: w, height: h } = this.canvas
        this.ctx.drawImage(video, 0, 0, w, h)
        const data = this.ctx.getImageData(0, 0, w, h).data
        const lum = new Float32Array(w * h)
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        }
        if (this.prev) {
          const thr = px(sensitivity)
          let changed = 0
          for (let i = 0; i < lum.length; i++) {
            if (Math.abs(lum[i] - this.prev[i]) > thr) changed++
          }
          const pct = (changed / lum.length) * 100
          const level = Math.min(100, Math.round(pct * 8))
          const now = Date.now()
          if (now - this.lastEmit > 220) {
            this.lastEmit = now
            onLevel(level, pct)
          }
        }
        this.prev = lum
      } catch { /* الفيديو غير جاهز بعد */ }
    }
    this.timer = window.setInterval(tick, 200) // 5 إطارات/ثانية تكفي للكشف
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = null
    this.prev = null
  }
}

// ============================================================
// 6) مقياس صوت: RMS + ذروة عبر AnalyserNode
// ============================================================
export class AudioMeter {
  private ctx: AudioContext
  private analyser: AnalyserNode
  private src: MediaStreamAudioSourceNode | null = null
  private data: Float32Array
  private timer: number | null = null
  private fallback: (() => { rms: number; peak: number }) | null

  constructor(fallback?: () => { rms: number; peak: number }) {
    this.ctx = ac()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.data = new Float32Array(this.analyser.fftSize)
    this.fallback = fallback ?? null
  }

  attach(stream: MediaStream) {
    this.detach()
    this.src = this.ctx.createMediaStreamSource(stream)
    this.src.connect(this.analyser)
  }

  /** يقرأ المستوى ويستدعي onLevel(rmsPct, peakPct) كل ~120ms */
  start(onLevel: (rms: number, peak: number) => void) {
    this.stopTimer()
    const tick = () => {
      // عند حجب سياق الصوت (بيئة اختبار) نعتمد على مستوى المولّد التركيبي
      if (this.ctx.state !== "running" && this.fallback) {
        const f = this.fallback()
        onLevel(f.rms, f.peak)
        return
      }
      this.analyser.getFloatTimeDomainData(this.data)
      let sum = 0
      let peak = 0
      for (let i = 0; i < this.data.length; i++) {
        const v = this.data[i]
        sum += v * v
        const a = Math.abs(v)
        if (a > peak) peak = a
      }
      const rms = Math.min(100, Math.sqrt(sum / this.data.length) * 420)
      const pk = Math.min(100, peak * 130)
      onLevel(Math.round(rms), Math.round(pk))
    }
    this.timer = window.setInterval(tick, 120)
  }

  stopTimer() {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = null
  }

  detach() {
    this.stopTimer()
    try { this.src?.disconnect() } catch { /* ignore */ }
    this.src = null
  }
}

// ============================================================
// 7) التقاط إطار من فيديو (مصراع الكاميرا) → Blob
// ============================================================
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  return new Promise((res) => {
    try {
      const w = Math.min(video.videoWidth || 640, 1280)
      const scale = w / (video.videoWidth || 640)
      const c = document.createElement("canvas")
      c.width = Math.round(w)
      c.height = Math.round((video.videoHeight || 360) * scale)
      const ctx = c.getContext("2d")
      if (!ctx) return res(null)
      ctx.drawImage(video, 0, 0, c.width, c.height)
      c.toBlob((b) => res(b), "image/jpeg", 0.9)
    } catch {
      res(null)
    }
  })
}

/** تحويل Blob إلى dataURL (للرفع إلى /api/media/capture) */
export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error("read-fail"))
    r.readAsDataURL(b)
  })
}

/** التقاط صورة من بث كاميرا جهاز (سواء كان معروضاً في الواجهة أم لا) */
export async function captureFromDevice(deviceId: string): Promise<Blob | null> {
  const ex = sources.get(`cam:${deviceId}`)
  if (!ex) return null
  const v = document.createElement("video")
  v.srcObject = ex.stream
  v.muted = true
  v.playsInline = true
  try {
    await v.play()
  } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 150))
  const blob = await captureFrame(v)
  v.srcObject = null
  return blob
}

// ============================================================
// 8) سجلّ المستقبلين لبث الوسائط (TV / كمبيوتر)
// ============================================================
const receivers = new Map<string, HTMLVideoElement | HTMLAudioElement>()

export function registerReceiver(target: string, el: HTMLVideoElement | HTMLAudioElement | null) {
  if (el) receivers.set(target, el)
  else receivers.delete(target)
}

export function getReceiver(target: string) {
  return receivers.get(target) ?? null
}

// ============================================================
// 9) نغمات تنبيه محلية (WebAudio — بدون ملفات)
// ============================================================
export function mediaBeep(kind: "motion" | "cry" | "shutter" | "link") {
  try {
    const c = ac()
    const beep = (f: number, f2: number, dur: number, vol: number, delay = 0) => {
      const t0 = c.currentTime + delay
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = kind === "cry" ? "triangle" : "sine"
      o.frequency.setValueAtTime(f, t0)
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      o.connect(g).connect(c.destination)
      o.start()
      o.stop(t0 + dur + 0.05)
    }
    if (kind === "motion") { beep(880, 660, 0.16, 0.16); beep(880, 660, 0.16, 0.14, 0.22) }
    else if (kind === "cry") { beep(620, 900, 0.3, 0.2); beep(900, 620, 0.3, 0.18, 0.32) }
    else if (kind === "shutter") { beep(1400, 700, 0.09, 0.22) }
    else { beep(520, 780, 0.14, 0.12) }
  } catch { /* ignore */ }
}

export { uid as mediaUid }

