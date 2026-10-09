"use client"
// NexusLink — أصوات النظام عبر Web Audio API (بدون ملفات خارجية)
// تنبيه الإشعارات + رنة المكالمات + نغمة الإرسال

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === "suspended") void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

// فتح الصوت عند أول تفاعل (سياسة المتصفحات)
if (typeof window !== "undefined") {
  const unlock = () => ac()
  window.addEventListener("pointerdown", unlock, { once: true })
  window.addEventListener("keydown", unlock, { once: true })
}

function blip(freq: number, freq2: number, dur: number, vol: number, delay = 0) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = "sine"
  osc.frequency.setValueAtTime(freq, t0)
  if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, t0 + dur)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

/** نغمة تنبيه إشعار وارد */
export function playNotifSound() {
  blip(880, 1320, 0.14, 0.12)
  blip(1320, 990, 0.12, 0.09, 0.12)
}

/** نغمة قصيرة عند إرسال رسالة */
export function playSendSound() {
  blip(660, 880, 0.09, 0.08)
}

/** نغمة عند اتصال المكالمة */
export function playConnectSound() {
  blip(520, 520, 0.1, 0.08)
  blip(780, 780, 0.12, 0.08, 0.12)
}

// ---------- رنة المكالمة (حلقة) ----------
let ringTimer: ReturnType<typeof setInterval> | null = null

function ringBurst() {
  // نمط رنة: نغمتان متذبذبتان 1.2 ثانية
  for (let i = 0; i < 8; i++) {
    blip(i % 2 === 0 ? 620 : 500, i % 2 === 0 ? 640 : 520, 0.09, 0.1, i * 0.11)
  }
}

/** تشغيل رنة المكالمة — تُرجع دالة إيقاف */
export function startRingtone(): () => void {
  stopRingtone()
  ringBurst()
  ringTimer = setInterval(ringBurst, 2100)
  return stopRingtone
}

export function stopRingtone() {
  if (ringTimer) {
    clearInterval(ringTimer)
    ringTimer = null
  }
}
