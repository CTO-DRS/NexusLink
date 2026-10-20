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
import { store, ensureServicePulse } from "./devices"
import { ensureGuardBridge, guardEmitToAgent } from "./guard-bridge"
import { ensureProdBridge, prodInjectClip } from "./productivity-bridge"
import { onAutomationFact } from "./automation-facts"
import { evalSustainedTrigger, MIN_DURATION_MIN, MAX_DURATION_MIN } from "./automation-health"
import { loadPersistedRules, persistRuleUpsert, persistRuleDelete, persistFire, loadPersistedFires, markFiresSeenDb } from "./automation-persist"
import { socketCors } from "./socket-security" // SEC (M0.3 F4)
import {
  TRIGGER_KINDS, ACTION_KINDS, isSustainedTrigger, COMPOSITE_STATE_KINDS, isCompositeStateKind,
  type AutoRule, type AutoRunEntry, type AutoStatePayload, type AutoFiredPayload, type AutoFireEntry, type AutoTrigger,
} from "./automation-types"

const PORT = 3008

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const g = globalThis as unknown as { __nexusAutoBooted?: boolean }
const BOOT_KEY = "__nexusAutoBooted"

// ---------- الحالة (القواعد مرسوخة في SQLite §26.ز — السجل في الذاكرة) ----------
let io: SocketServer | null = null
let rules: AutoRule[] = []
let runLog: AutoRunEntry[] = []
let bootedAt = 0
/** الإطلاقات المرسوخة (§26.ح): مرآة ذاكرة لآخر 200 إطلاق — تُستعاد من SQLite
 *  عند الإقلاع وتُرسَّخ عند كل إطلاق، فتبقى التنبيهات بعد إعادة التشغيل. */
let fireLog: AutoFireEntry[] = []

/** حافة البطارية لكل قاعدة: مسلّحة بانتظار الهبوط تحت العتبة. */
const batteryArmed = new Map<string, boolean>()
/** تسليح القواعد التاريخية المستمرة (§26.و): تُطلق مرة لكل حقبة استمرارية —
 *  وتُعاد التسليح تلقائيًا عند زوال الشرط من التاريخ الحالي. */
const sustainedArmed = new Map<string, boolean>()
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
    {
      // بذرة توضيحية للمشغلات التاريخية (§26.و) — معطلة افتراضيًا (تحتاج تاريخ عينات)
      id: uid(), name: "بطارية تحت 15% لمدة ساعة", enabled: false,
      trigger: { kind: "health.battery.sustained", threshold: 15, durationMin: 60, deviceId: null },
      action: { kind: "notify", text: "بطارية أحد الأجهزة تحت 15% لمدة ساعة متواصلة" },
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
    alerts: {
      unseen: fireLog.filter((f) => !f.seenAt).length,
      latest: fireLog.slice(0, 12).map((f) => ({ ...f })),
      total: fireLog.length,
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

async function fireRule(rule: AutoRule, detail: string, manual: boolean, reason?: string) {
  // القاعدة الحية في المصفوفة دائمًا — الإطلاق اليدوي (run-now) يمرر نسخة
  // {…rule} فتُحدّث إحصاءاتها النسخة الحية لا النسخة (وإلا ظهر الإطلاق بلا أثر في العدّاد)
  const live = rules.find((r) => r.id === rule.id) ?? rule
  const now = Date.now()
  live.lastFiredAt = now
  live.fireCount++
  const res = await executeAction(live)
  // ترسيخ الإحصاءات (§26.ز): lastFiredAt/fireCount يعيشان عبر إعادة التشغيل
  void persistRuleUpsert(live)
  // الدليل التفسيري (§33.ج): جملة «لماذا» المهيكلة تُدمج في التفصيل الصادق
  // بالبادئة «الدليل:» فتبقى التنبيهات التاريخية/المركبة بذليلها بعد إعادة
  // التشغيل (التخزين داخل detail القائم — صفر تغيير مخطط).
  const reasonFull = reason ? `الدليل: ${reason}` : ""
  const full = [detail, res.detail, reasonFull].filter(Boolean).filter((s, i, arr) => arr.indexOf(s) === i).join(" — ")
  pushLog({ ruleId: live.id, ruleName: live.name, at: now, ok: res.ok, detail: full, manual })
  // ترسيخ الإطلاق نفسه (§26.ح): البث الحي لواجهة متصلة يعدّه رؤية عند التسليم
  // (clientsCount > 0)، وإلا يبقى «غير مرئي» بانتظار ملخص العودة عند الاتصال التالي.
  let clients = 0
  try { clients = io?.engine?.clientsCount ?? 0 } catch { clients = 0 }
  const fireEntry: AutoFireEntry = {
    id: uid(), ruleId: live.id, ruleName: live.name, at: now, ok: res.ok, detail: full, manual,
    seenAt: clients > 0 ? now : null,
    ...(reason ? { reason } : {}),
  }
  fireLog.unshift(fireEntry)
  if (fireLog.length > 200) fireLog.length = 200
  void persistFire(fireEntry)
  const payload: AutoFiredPayload = {
    ruleId: live.id, ruleName: live.name, at: now, ok: res.ok, detail: full, manual,
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
        // بطارية — حافة صاعدة مع إعادة تسليح (اكتمال الشحن: «نبّهني عندما تصل بطارية X إلى 80%»)
        if (t.kind === "battery.above") {
          const th = Math.min(100, Math.max(1, Math.round(t.threshold ?? 80)))
          for (const [id, cur] of now) {
            if (!matches(id)) continue
            const prev = prevSnapshot.get(id)
            const key = rule.id
            const armed = batteryArmed.get(key) !== false
            if (cur.battery >= th && armed && (!prev || prev.battery < th)) {
              batteryArmed.set(key, false)
              void onTriggerHit(rule, `البطارية: «${id}» بلغت ${cur.battery}% (العتبة ${th}%)`)
            } else if (cur.battery <= th - 5 && !batteryArmed.get(key)) {
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

// ---------- حلقة الصحة التاريخية (§26.و) ----------

/** تقييم القواعد المستمرة من عينات §27 كل 15 ثانية: الإطلاق مرة لكل حقبة
 *  استمرارية (تسليح)، وإعادة التسليح تلقائية عند ظهور عينة مخالفة/زوال الشرط. */
async function pollHealthSustained() {
  try {
    for (const rule of rules) {
      if (!rule.enabled || !isSustainedTrigger(rule.trigger.kind)) continue
      const v = await evalSustainedTrigger(rule.trigger)
      if (v.satisfied) {
        if (rule.trigger.and) {
          // مركب (§33.ج): التاريخ اكتمل — بانتظار شرط الحالة أيضًا. الحقبة
          // لا تُستهلك إلا بالإطلاق الفعلي، وإذا زال التاريخ يُعاد التسليح
          // كالعادة (فرع else أدناه) — فلا يُفوّت اكتمال الشرطين لاحقًا.
          const st = compositeStateSatisfied(rule.trigger.and)
          if (st.ok && sustainedArmed.get(rule.id) !== false && !coolingDown(rule)) {
            sustainedArmed.set(rule.id, false)
            await fireRule(rule, v.reason, false, `${v.reason} + ${st.reason}`)
          }
        } else if (sustainedArmed.get(rule.id) !== false && !coolingDown(rule)) {
          sustainedArmed.set(rule.id, false)
          await fireRule(rule, v.reason, false, v.reason)
        }
      } else {
        sustainedArmed.set(rule.id, true)
      }
    }
  } catch { /* قاعدة البيانات غير جاهزة بعد */ }
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

/** تعقيم المشغّل وحده (§26.ي) — مشترك بين rule:upsert (sanitizeRule)
 *  وrule:test (فحص التاريخ الحي من المحرر) — نفس القواعد حرفيًا. */
function sanitizeTrigger(tr: Record<string, unknown>): AutoTrigger | { error: string } {
  const tKind = String(tr.kind ?? "")
  if (!TRIGGER_KINDS.includes(tKind as never)) return { error: `نوع مشغّل غير معروف: ${tKind}` }
  const trigger: AutoTrigger = { kind: tKind as AutoTrigger["kind"] }
  if (typeof tr.deviceId === "string" && tr.deviceId.trim()) trigger.deviceId = tr.deviceId.trim().slice(0, 64)
  if (tKind === "battery.below" || tKind === "battery.above") {
    const th = Math.round(Number(tr.threshold ?? (tKind === "battery.above" ? 80 : 20)))
    if (!Number.isFinite(th)) return { error: "عتبة البطارية يجب أن تكون رقمًا" }
    trigger.threshold = Math.min(100, Math.max(1, th))
  }
  if (tKind === "health.battery.sustained" || tKind === "health.rtt.sustained" || tKind === "health.silence.sustained" || tKind === "health.storage.sustained") {
    const dm = Math.round(Number(tr.durationMin ?? 60))
    if (!Number.isFinite(dm) || dm < MIN_DURATION_MIN || dm > MAX_DURATION_MIN) {
      return { error: `المدة بالدقائق يجب أن تكون بين ${MIN_DURATION_MIN} و ${MAX_DURATION_MIN} (سقف تاريخ §27)` }
    }
    trigger.durationMin = dm
  }
  if (tKind === "health.battery.sustained") {
    const th = Math.round(Number(tr.threshold ?? 15))
    if (!Number.isFinite(th)) return { error: "عتبة البطارية يجب أن تكون رقمًا" }
    trigger.threshold = Math.min(100, Math.max(1, th))
  }
  if (tKind === "health.rtt.sustained") {
    const th = Math.round(Number(tr.threshold ?? 200))
    if (!Number.isFinite(th)) return { error: "عتبة الاستجابة يجب أن تكون رقمًا" }
    trigger.threshold = Math.min(60000, Math.max(10, th))
  }
  if (tKind === "health.storage.sustained") {
    const th = Math.round(Number(tr.threshold ?? 90))
    if (!Number.isFinite(th)) return { error: "عتبة التخزين يجب أن تكون رقمًا" }
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
  // الشرط المركب (§33.ج): تاريخي أولًا حصرًا + شرط حالة ثانٍ من القائمة،
  // بلا تعشيش (and داخل and مرفوض) — والثاني يُعقّم بنفس المطيّم.
  const andRaw = tr.and
  if (andRaw && typeof andRaw === "object") {
    if (!isSustainedTrigger(trigger.kind)) return { error: "الدمج (و/AND) يتطلب مشغلًا تاريخيًا مستمرًا أولًا" }
    if ((andRaw as Record<string, unknown>).and) return { error: "تعشيش الدمج مرفوض — مستوى واحد حصرًا" }
    const aSubKind = String((andRaw as Record<string, unknown>).kind ?? "")
    if (!COMPOSITE_STATE_KINDS.includes(aSubKind as never)) {
      return { error: `شرط الحالة الثاني يجب أن يكون من: ${COMPOSITE_STATE_KINDS.join(" · ")}` }
    }
    const sub = sanitizeTrigger({ ...(andRaw as Record<string, unknown>) })
    if ("error" in sub) return { error: `الشرط الثاني: ${sub.error}` }
    if (!isCompositeStateKind(sub.kind)) return { error: "الشرط الثاني خارج قائمة حالات الدمج" }
    trigger.and = sub
  }
  return trigger
}

// ---------- الشرط المركب (§33.ج): تقييم «شرط الحالة» كحالة الآن ----------

/** يقيّم الشرط الثاني للمشغل المركب كحالة لحظية على سجل الأجهزة الحالي:
 *  device.connect = يوجد جهاز مطابق متصل الآن · device.disconnect = يوجد غير متصل
 *  · battery.below/above = بطارية جهاز (مطابق) تحت/فوق العتبة. قراءة محضة —
 *  لا تسليح ولا إحصاءات؛ فشل السجل = غير مستوفى بصدق (لا إطلاق زائف). */
function compositeStateSatisfied(and: AutoTrigger): { ok: boolean; reason: string } {
  try {
    const devs = store().devices
    const pool = and.deviceId ? devs.filter((d) => d.id === and.deviceId) : devs
    if (and.kind === "device.connect") {
      const hit = pool.find((d) => d.state === "connected")
      return hit ? { ok: true, reason: `الحالة: «${hit.id}» متصل الآن` } : { ok: false, reason: "الحالة: لا جهاز مطابق متصل الآن" }
    }
    if (and.kind === "device.disconnect") {
      const hit = pool.find((d) => d.state !== "connected")
      return hit ? { ok: true, reason: `الحالة: «${hit.id}» غير متصل الآن` } : { ok: false, reason: "الحالة: كل الأجهزة المتابعة متصلة الآن" }
    }
    const th = Math.min(100, Math.max(1, Math.round(and.threshold ?? (and.kind === "battery.above" ? 80 : 20))))
    if (and.kind === "battery.below") {
      const hit = pool.find((d) => d.battery <= th)
      return hit ? { ok: true, reason: `الحالة: «${hit.id}» بطاريته ${hit.battery}% (≤ ${th}%)` } : { ok: false, reason: `الحالة: لا بطارية تحت ${th}% الآن` }
    }
    if (and.kind === "battery.above") {
      const hit = pool.find((d) => d.battery >= th)
      return hit ? { ok: true, reason: `الحالة: «${hit.id}» بطاريته ${hit.battery}% (≥ ${th}%)` } : { ok: false, reason: `الحالة: لا بطارية فوق ${th}% الآن` }
    }
    return { ok: false, reason: "الحالة: نوع غير مدعوم" }
  } catch {
    return { ok: false, reason: "الحالة: سجل الأجهزة غير جاهز بعد" }
  }
}

function sanitizeRule(input: unknown, existingId?: string): AutoRule | { error: string } {
  if (!input || typeof input !== "object") return { error: "قاعدة غير صالحة" }
  const r = input as Record<string, unknown>
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : ""
  if (!name) return { error: "اسم القاعدة مطلوب" }
  const tr = (r.trigger ?? {}) as Record<string, unknown>
  const ac = (r.action ?? {}) as Record<string, unknown>
  const aKind = String(ac.kind ?? "")
  if (!ACTION_KINDS.includes(aKind as never)) return { error: `نوع فعل غير معروف: ${aKind}` }

  const trigger = sanitizeTrigger(tr)
  if ("error" in trigger) return trigger

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

  // §27.هـ: إقلاع محرك الروتينات يشعل نبض الخدمة الذاتي — فبمجرد عمل المحرك
  // (حتى بلا أي واجهة مفتوحة) تتولد عينات الصحة ويبقى الكشف التاريخي حيًا.
  ensureServicePulse()

  try {
    rules = seedRules()
    bootedAt = Date.now()

    // استعادة القواعد المرسوخة (§26.ز) — غير حاجبة: الجسر يقلع بالبذور فورًا
    // وتُستبدل القواعد عند جاهزية القراءة (أول إقلاع: البذور نفسها تُرسَّخ)
    void (async () => {
      try {
        const persisted = await loadPersistedRules()
        if (persisted && persisted.length) {
          rules = persisted
          // مواعيد time.once الماضية لا تُعاد عند الإقلاع (§26.ز): طابع في الماضي
          // = موعد أُطلق قبل الترسيخ أو فائت أثناء التوقف — لا إعادة إطلاق قديم
          for (const r of rules) {
            if (r.trigger.kind === "time.once" && Number(r.trigger.at ?? 0) <= Date.now()) {
              onceFired.add(r.id)
            }
          }
        } else if (!persisted) {
          // null بلا صفوف أو بفشل — نرسّخ البذور فقط إذا لم يكن فشل وصول…
          // التمييز صعب هنا، والأبسط والأصدق: إن كان الجدول فارغًا فعلًا فالتكرار
          // upsert لا يضر (نفس المعرفات) — نرسّخ البذور الحالية
          for (const r of rules) await persistRuleUpsert(r)
        }
        broadcastState()
      } catch { /* بلا هلع — البذور تبقى في الذاكرة */ }
    })()

    // استعادة الإطلاقات المرسوخة (§26.ح) — غير حاجبة: مرآة الذاكرة تُملأ من
    // آخر 200 إطلاق، فتبقى التنبيهات غير المرئية بعد إعادة التشغيل
    void (async () => {
      try {
        const fires = await loadPersistedFires()
        if (fires && fires.length) {
          fireLog = fires
          broadcastState()
        }
      } catch { /* بلا هلع — التنبيهات الحالية تبقى */ }
    })()

    const httpServer = createServer()
    const io2 = new SocketServer(httpServer, {
      path: "/",
      cors: socketCors(), // SEC (M0.3 F4): بديل السماح المفتوح — Origin خارجي يُرفض عند المصافحة
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
        void persistRuleUpsert(rules.find((r) => r.id === clean.id) ?? clean)
        broadcastState()
      })

      socket.on("rule:delete", (d: { id?: string }) => {
        if (!d?.id) return
        rules = rules.filter((r) => r.id !== d.id)
        onceFired.delete(d.id)
        batteryArmed.delete(d.id)
        dailyFiredDay.delete(d.id)
        sustainedArmed.delete(d.id)
        void persistRuleDelete(d.id)
        broadcastState()
      })

      socket.on("rule:toggle", (d: { id?: string; enabled?: boolean }) => {
        if (!d?.id) return
        rules = rules.map((r) => (r.id === d.id ? { ...r, enabled: d.enabled !== false } : r))
        const updated = rules.find((r) => r.id === d.id)
        if (updated) void persistRuleUpsert(updated)
        broadcastState()
      })

      socket.on("rule:run-now", (d: { id?: string }) => {
        const rule = rules.find((r) => r.id === d?.id)
        if (!rule) {
          socket.emit("auto:rejected", { error: "قاعدة غير موجودة", at: Date.now() })
          return
        }
        if (isSustainedTrigger(rule.trigger.kind)) {
          // باب اختبار التاريخ (§26.و): قيّم من التاريخ الحالي — إن استوفى أُطلق
          // يدويًا، وإلا سُجّل الرفض مسببًا (بلا تغيير لحالة التسليح التلقائية)
          void (async () => {
            try {
              const v = await evalSustainedTrigger(rule.trigger)
              if (v.satisfied) {
                // الإطلاق اليدوي الصريح يستهلك الحقبة أيضًا (منع إشعار مزدوج مع التيك)
                sustainedArmed.set(rule.id, false)
                await fireRule({ ...rule }, `${v.reason} — تشغيل يدوي`, true)
              } else {
                pushLog({ ruleId: rule.id, ruleName: rule.name, at: Date.now(), ok: false, detail: `تشغيل يدوي: التاريخ الحالي لا يثبت استمرار الشرط — ${v.reason}`, manual: true })
                broadcastState()
              }
            } catch {
              pushLog({ ruleId: rule.id, ruleName: rule.name, at: Date.now(), ok: false, detail: "تشغيل يدوي: فشل تقييم التاريخ الصحي", manual: true })
              broadcastState()
            }
          })()
          return
        }
        void fireRule({ ...rule }, "تشغيل يدوي من الواجهة", true)
      })

      // فحص التاريخ الحي من المحرر (§26.ي) — قراءة محضة: تقييم المشغّل التاريخي من
      // عينات §27 الحالية بمقيّم سلسلة الدليل نفسه (evalSustainedTrigger حرفيًا)،
      // والنتيجة للمطالب حصرًا (socket.emit لا بث) — بلا سجل تشغيل ولا ترسيخ ولا
      // أي مسٍ للتسليح أو الإحصاءات: auto:state لا يتغير أبدًا بفعل فحص.
      socket.on("rule:test", (d: { trigger?: unknown }) => {
        const tr = (d?.trigger ?? {}) as Record<string, unknown>
        const tKind = String(tr.kind ?? "")
        if (!isSustainedTrigger(tKind as AutoTrigger["kind"])) {
          socket.emit("auto:test-result", { ok: false, error: "فحص التاريخ متاح للمشغلات التاريخية المستمرة فقط", at: Date.now() })
          return
        }
        const clean = sanitizeTrigger(tr)
        if ("error" in clean) {
          socket.emit("auto:test-result", { ok: false, error: clean.error, at: Date.now() })
          return
        }
        void (async () => {
          try {
            const v = await evalSustainedTrigger(clean)
            socket.emit("auto:test-result", {
              ok: true, satisfied: v.satisfied, reason: v.reason, evidence: v.evidence, at: Date.now(),
            })
          } catch (e) {
            socket.emit("auto:test-result", { ok: false, error: `فشل تقييم التاريخ: ${e instanceof Error ? e.message : String(e)}`, at: Date.now() })
          }
        })()
      })

      socket.on("log:clear", () => {
        runLog = []
        broadcastState()
      })

      // تعليم كل التنبيهات غير المرئية كمقروءة (§26.ح) — رسوخًا في SQLite
      socket.on("alerts:mark-seen", () => {
        const now2 = Date.now()
        for (const f of fireLog) if (!f.seenAt) f.seenAt = now2
        void markFiresSeenDb(now2)
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

    // استطلاع سجل الأجهزة كل 4 ثوانٍ + المؤقّت الزمني كل 5 ثوانٍ + تاريخ الصحة كل 15 ثانية
    setInterval(pollDevices, 4000)
    setInterval(pollTime, 5000)
    setInterval(() => { void pollHealthSustained() }, 15000)

    httpServer.listen(PORT, () => {
      console.log(`[nexus] Automation Bridge on port ${PORT}`)
    })
  } catch {
    // تجاهل — قد يكون المنفذ مشغولًا
  }
  return automationBridgeStatus()
}
