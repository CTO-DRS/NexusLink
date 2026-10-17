// NexusLink — محرك الروتينات (عقد §26) — يعمل داخل عملية Next.js
// ============================================================
// قواعد «عند حدوث X → نفّذ Y» فوق القنوات القائمة حرفيًا:
//  - الحقائق: سجل الأجهزة (استطلاع حالة/بطارية) + ناقل الحقائق داخل العملية
//    (prod ينشر clip.received) + مؤقّتات الوقت (مرة واحدة / يومي).
//  - الأفعال: إذاعة إشعار للواجهة (auto:fired) · دفع الحافظة (prodInjectClip
//    → clip:new القائم) · رنين الهاتف (guardEmitToAgent → dev:ring القائم)
//    · حزمة WoL سحرية (UDP — نفس مسار Wake-on-LAN القائم).
// منفذ 3008 · نفس نمط guard-bridge (مدمج، idempotent).

import { createServer } from "http"
import { Server as SocketServer } from "socket.io"
import dgram from "dgram"
import { store } from "./devices"
import { ensureGuardBridge, guardEmitToAgent } from "./guard-bridge"
import { ensureProdBridge, prodInjectClip } from "./productivity-bridge"
import { onAutomationFact } from "./automation-facts"
import {
  TRIGGER_KINDS, ACTION_KINDS,
  type AutoRule, type AutoRunEntry, type AutoStatePayload, type AutoFiredPayload,
} from "./automation-types"

const PORT = 3008

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const g = globalThis as unknown as { __nexusAutoBooted?: boolean }
const BOOT_KEY = "__nexusAutoBooted"

// ---------- الحالة (ذاكرة الجسر — حد موثق في العقد §26.هـ) ----------
let io: SocketServer | null = null
let rules: AutoRule[] = []
let runLog: AutoRunEntry[] = []
let bootedAt = 0

/** حافة البطارية لكل قاعدة: مسلّحة بانتظار الهبوط تحت العتبة. */
const batteryArmed = new Map<string, boolean>()
/** آخر يوم أُطلقت فيه قاعدة يومية (yyyymmdd محلي). */
const dailyFiredDay = new Map<string, number>()
/** قواعد time.once التي أطلقت بالفعل. */
const onceFired = new Set<string>()
/** مانع تكرار عام لكل قاعدة (ms). */
const COOLDOWN_MS = 20_000

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i

function seedRules(): AutoRule[] {
  const now = Date.now()
  return [
    {
      id: uid(), name: "بطارية جهاز منخفضة", enabled: true,
      trigger: { kind: "battery.below", threshold: 20, deviceId: null },
      action: { kind: "notify", text: "بطارية أحد الأجهزة هبطت تحت 20%" },
      createdAt: now, lastFiredAt: null, fireCount: 0,
    },
    {
      id: uid(), name: "جهاز غادر الشبكة", enabled: true,
      trigger: { kind: "device.disconnect", deviceId: null },
      action: { kind: "notify", text: "انقطع جهاز عن الشبكة" },
      createdAt: now, lastFiredAt: null, fireCount: 0,
    },
    {
      id: uid(), name: "وصل محتوى جديد للحافظة", enabled: false,
      trigger: { kind: "clip.received" },
      action: { kind: "notify", text: "وصل محتوى جديد إلى الحافظة الموحدة" },
      createdAt: now, lastFiredAt: null, fireCount: 0,
    },
  ]
}

function buildState(): AutoStatePayload {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const firesToday = runLog.filter((r) => r.at >= dayStart.getTime() && r.ok).length
  const lastFired = runLog.filter((r) => r.ok).map((r) => r.at)
  return {
    rules: rules.map((r) => ({ ...r })),
    log: runLog.slice(0, 80).map((r) => ({ ...r })),
    stats: {
      rulesTotal: rules.length,
      rulesEnabled: rules.filter((r) => r.enabled).length,
      firesToday,
      lastFiredAt: lastFired.length ? Math.max(...lastFired) : null,
    },
    bootedAt,
  }
}

function broadcastState() {
  try { io?.emit("auto:state", buildState()) } catch { /* ignore */ }
}

function pushLog(entry: Omit<AutoRunEntry, "id">) {
  runLog.unshift({ id: uid(), ...entry })
  if (runLog.length > 80) runLog.length = 80
}

// ---------- تنفيذ الأفعال (القنوات القائمة حرفيًا) ----------

function sendWol(mac: string): Promise<{ ok: boolean; detail: string }> {
  const hex = mac.replace(/-/g, ":").toLowerCase()
  if (!MAC_RE.test(hex)) return Promise.resolve({ ok: false, detail: `عنوان MAC غير صالح: ${mac}` })
  const parts = hex.split(":").map((p) => parseInt(p, 16))
  // 6 بايت 0xFF ثم عنوان MAC مكرر 16 مرة — حزمة الإيقاظ القياسية
  const buf = Buffer.alloc(6 + 16 * 6, 0xff)
  for (let i = 0; i < 16; i++) parts.forEach((b, j) => { buf[6 + i * 6 + j] = b })
  return new Promise<{ ok: boolean; detail: string }>((resolve) => {
    try {
      const s = dgram.createSocket({ type: "udp4", reuseAddr: true })
      s.on("error", () => { try { s.close() } catch { /* ignore */ }; resolve({ ok: false, detail: "فشل إرسال حزمة الإيقاظ (UDP)" }) })
      s.bind(() => {
        try {
          s.setBroadcast(true)
          s.send(buf, 9, "255.255.255.255", () => {
            try { s.close() } catch { /* ignore */ }
            resolve({ ok: true, detail: `أُرسلت حزمة إيقاظ إلى ${hex} (بث الشبكة :9)` })
          })
        } catch {
          try { s.close() } catch { /* ignore */ }
          resolve({ ok: false, detail: "فشل إرسال حزمة الإيقاظ (UDP)" })
        }
      })
    } catch {
      resolve({ ok: false, detail: "فشل إرسال حزمة الإيقاظ (UDP)" })
    }
  })
}

async function executeAction(rule: AutoRule): Promise<{ ok: boolean; detail: string }> {
  const a = rule.action
  switch (a.kind) {
    case "notify":
      return { ok: true, detail: `إشعار أُذيع للواجهة: ${a.text || rule.name}` }
    case "clipboard.push": {
      const text = (a.text || "").trim()
      if (!text) return { ok: false, detail: "فعل دفع الحافظة يتطلب نصًا" }
      ensureProdBridge()
      const sent = await prodInjectClip(text, "روتين: " + rule.name)
      return sent
        ? { ok: true, detail: `دُفع النص إلى الحافظة الموحدة (${text.length} حرفًا) عبر قناة prod القائمة` }
        : { ok: false, detail: "لم يُنفّذ الدفع — جسر الإنتاجية غير متاح" }
    }
    case "phone.ring": {
      ensureGuardBridge()
      const sent = guardEmitToAgent("dev:ring", { at: Date.now() })
      return sent
        ? { ok: true, detail: "أُرسل أمر الرن عبر قناة الحماية (dev:ring) — الوكيل متصل" }
        : { ok: false, detail: "لا وكيل هاتف متصل على قناة الحماية — لم يُرسل الرن" }
    }
    case "wol":
      return sendWol(a.mac || "")
    default:
      return { ok: false, detail: "نوع فعل غير معروف" }
  }
}

// ---------- إطلاق قاعدة ----------

async function fireRule(rule: AutoRule, detail: string, manual: boolean) {
  const now = Date.now()
  rule.lastFiredAt = now
  rule.fireCount++
  const res = await executeAction(rule)
  pushLog({ ruleId: rule.id, ruleName: rule.name, at: now, ok: res.ok, detail: res.detail || detail, manual })
  const payload: AutoFiredPayload = {
    ruleId: rule.id, ruleName: rule.name, at: now, ok: res.ok, detail: res.detail || detail, manual,
  }
  try { io?.emit("auto:fired", payload) } catch { /* ignore */ }
  broadcastState()
}

function coolingDown(rule: AutoRule): boolean {
  return !!rule.lastFiredAt && Date.now() - rule.lastFiredAt < COOLDOWN_MS
}

async function onTriggerHit(rule: AutoRule, detail: string) {
  if (!rule.enabled || coolingDown(rule)) return
  await fireRule(rule, detail, false)
}

// ---------- حلقات استطلاع الحقائق ----------

/** لقطة سابقة لسجل الأجهزة: id → {state, battery}. */
let prevSnapshot = new Map<string, { state: string; battery: number }>()
let snapshotPrimed = false

function pollDevices() {
  try {
    const devs = store().devices
    const now = new Map<string, { state: string; battery: number }>()
    for (const d of devs) now.set(d.id, { state: d.state, battery: d.battery })

    if (snapshotPrimed) {
      for (const rule of rules) {
        if (!rule.enabled) continue
        const t = rule.trigger
        const matches = (id: string) => !t.deviceId || t.deviceId === id
        // اتصال/انقطاع — انتقال حالة في سجل الأجهزة
        for (const [id, cur] of now) {
          const prev = prevSnapshot.get(id)
          if (!prev || prev.state === cur.state || !matches(id)) continue
          if (t.kind === "device.connect" && cur.state === "connected") {
            void onTriggerHit(rule, `الاتصال: الجهاز «${id}» عاد إلى الشبكة`)
          }
          if (t.kind === "device.disconnect" && cur.state !== "connected") {
            void onTriggerHit(rule, `الانقطاع: الجهاز «${id}» غادر الشبكة`)
          }
        }
        // بطارية — حافة نازلة مع إعادة تسليح
        if (t.kind === "battery.below") {
          const th = Math.min(100, Math.max(1, Math.round(t.threshold ?? 20)))
          for (const [id, cur] of now) {
            if (!matches(id)) continue
            const prev = prevSnapshot.get(id)
            const key = rule.id
            const armed = batteryArmed.get(key) !== false
            if (cur.battery <= th && armed && (!prev || prev.battery > th)) {
              batteryArmed.set(key, false)
              void onTriggerHit(rule, `البطارية: «${id}» عند ${cur.battery}% (العتبة ${th}%)`)
            } else if (cur.battery >= th + 5 && !batteryArmed.get(key)) {
              batteryArmed.set(key, true)
            }
          }
        }
      }
    }
    prevSnapshot = now
    snapshotPrimed = true
  } catch { /* سجل الأجهزة غير جاهز بعد */ }
}

function pollTime() {
  try {
    const now = new Date()
    const day = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
    for (const rule of rules) {
      if (!rule.enabled) continue
      const t = rule.trigger
      if (t.kind === "time.once") {
        const at = Number(t.at ?? 0)
        if (at > 0 && Date.now() >= at && !onceFired.has(rule.id)) {
          onceFired.add(rule.id)
          void onTriggerHit(rule, "الموعد المحدد (مرة واحدة) حان")
        }
      } else if (t.kind === "time.daily") {
        const hh = Number(t.hh ?? -1), mm = Number(t.mm ?? -1)
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59) continue
        if (now.getHours() === hh && now.getMinutes() === mm && dailyFiredDay.get(rule.id) !== day) {
          dailyFiredDay.set(rule.id, day)
          void onTriggerHit(rule, `الموعد اليومي ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} حان`)
        }
      }
    }
  } catch { /* ignore */ }
}

// ---------- تعقيم المدخلات ----------

function sanitizeRule(input: unknown, existingId?: string): AutoRule | { error: string } {
  if (!input || typeof input !== "object") return { error: "قاعدة غير صالحة" }
  const r = input as Record<string, unknown>
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : ""
  if (!name) return { error: "اسم القاعدة مطلوب" }
  const tr = (r.trigger ?? {}) as Record<string, unknown>
  const ac = (r.action ?? {}) as Record<string, unknown>
  const tKind = String(tr.kind ?? "")
  const aKind = String(ac.kind ?? "")
  if (!TRIGGER_KINDS.includes(tKind as never)) return { error: `نوع مشغّل غير معروف: ${tKind}` }
  if (!ACTION_KINDS.includes(aKind as never)) return { error: `نوع فعل غير معروف: ${aKind}` }

  const trigger: AutoRule["trigger"] = { kind: tKind as AutoRule["trigger"]["kind"] }
  if (typeof tr.deviceId === "string" && tr.deviceId.trim()) trigger.deviceId = tr.deviceId.trim().slice(0, 64)
  if (tKind === "battery.below") {
    const th = Math.round(Number(tr.threshold ?? 20))
    if (!Number.isFinite(th)) return { error: "عتبة البطارية يجب أن تكون رقمًا" }
    trigger.threshold = Math.min(100, Math.max(1, th))
  }
  if (tKind === "time.once") {
    const at = Number(tr.at)
    if (!Number.isFinite(at) || at <= 0) return { error: "الموعد (مرة واحدة) يتطلب طابعًا زمنيًا صالحًا" }
    trigger.at = Math.min(Math.round(at), Date.now() + 366 * 864e5)
  }
  if (tKind === "time.daily") {
    const hh = Math.round(Number(tr.hh ?? -1)), mm = Math.round(Number(tr.mm ?? -1))
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return { error: "الموعد اليومي يتطلب ساعة 0-23 ودقيقة 0-59" }
    trigger.hh = hh; trigger.mm = mm
  }

  const action: AutoRule["action"] = { kind: aKind as AutoRule["action"]["kind"] }
  if (typeof ac.text === "string") action.text = ac.text.slice(0, 300)
  if (aKind === "clipboard.push" && !(action.text || "").trim()) return { error: "دفع الحافظة يتطلب نصًا" }
  if (aKind === "wol") {
    const mac = String(ac.mac ?? "").trim()
    if (!MAC_RE.test(mac.replace(/-/g, ":"))) return { error: "عنوان MAC يجب أن يطابق XX:XX:XX:XX:XX:XX" }
    action.mac = mac.toUpperCase().replace(/-/g, ":")
  }

  return {
    id: existingId || uid(),
    name,
    enabled: r.enabled !== false,
    trigger, action,
    createdAt: Date.now(),
    lastFiredAt: null,
    fireCount: 0,
  }
}

// ---------- الإقلاع (idempotent) ----------

export function automationBridgeStatus() {
  return { booted: !!g[BOOT_KEY], port: PORT, rules: rules.length, log: runLog.length }
}

export function ensureAutomationBridge() {
  if (g[BOOT_KEY]) return automationBridgeStatus()
  g[BOOT_KEY] = true

  try {
    rules = seedRules()
    bootedAt = Date.now()

    const httpServer = createServer()
    const io2 = new SocketServer(httpServer, {
      path: "/",
      cors: { origin: "*", methods: ["GET", "POST"] },
      pingTimeout: 60000,
      pingInterval: 25000,
    })
    io = io2

    io2.on("connection", (socket) => {
      socket.emit("auto:hello", { at: Date.now() })
      socket.emit("auto:state", buildState())

      socket.on("rule:upsert", (d: { rule?: unknown; id?: string }) => {
        const clean = sanitizeRule(d?.rule, typeof d?.id === "string" && d.id ? d.id : undefined)
        if ("error" in clean) {
          socket.emit("auto:rejected", { error: clean.error, at: Date.now() })
          return
        }
        if (d?.id) {
          const prev = rules.find((r) => r.id === d.id)
          if (prev) {
            // الحفاظ على إحصاءات التشغيل عند التعديل
            rules = rules.map((r) => (r.id === d.id ? { ...clean, id: d.id, createdAt: prev.createdAt, lastFiredAt: prev.lastFiredAt, fireCount: prev.fireCount } : r))
          } else {
            rules.push(clean)
          }
        } else {
          rules.push(clean)
        }
        broadcastState()
      })

      socket.on("rule:delete", (d: { id?: string }) => {
        if (!d?.id) return
        rules = rules.filter((r) => r.id !== d.id)
        onceFired.delete(d.id)
        batteryArmed.delete(d.id)
        dailyFiredDay.delete(d.id)
        broadcastState()
      })

      socket.on("rule:toggle", (d: { id?: string; enabled?: boolean }) => {
        if (!d?.id) return
        rules = rules.map((r) => (r.id === d.id ? { ...r, enabled: d.enabled !== false } : r))
        broadcastState()
      })

      socket.on("rule:run-now", (d: { id?: string }) => {
        const rule = rules.find((r) => r.id === d?.id)
        if (!rule) {
          socket.emit("auto:rejected", { error: "قاعدة غير موجودة", at: Date.now() })
          return
        }
        void fireRule({ ...rule }, "تشغيل يدوي من الواجهة", true)
      })

      socket.on("log:clear", () => {
        runLog = []
        broadcastState()
      })
    })

    httpServer.on("error", () => {
      // المنفذ مشغول (خدمة قائمة) — لا شيء يحدث
    })

    // حقائق الحافظة من ناقل العملية (prod ينشر clip.received)
    onAutomationFact((f) => {
      if (f.kind !== "clip.received") return
      for (const rule of rules) {
        if (rule.enabled && rule.trigger.kind === "clip.received") {
          void onTriggerHit(rule, `وصل محتوى ${f.clipKind === "image" ? "صورة" : "نص"} من ${f.deviceName || "جهاز"} إلى الحافظة`)
        }
      }
    })

    // استطلاع سجل الأجهزة كل 4 ثوانٍ + المؤقّت الزمني كل 5 ثوانٍ
    setInterval(pollDevices, 4000)
    setInterval(pollTime, 5000)

    httpServer.listen(PORT, () => {
      console.log(`[nexus] Automation Bridge on port ${PORT}`)
    })
  } catch {
    // تجاهل — قد يكون المنفذ مشغولًا
  }
  return automationBridgeStatus()
}
