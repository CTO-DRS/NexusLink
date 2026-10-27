// NexusLink — device registry with simulated live state + heartbeat.
import type { NexusDevice, DeviceKind } from "./types"
import crypto from "crypto"

/** نافذة صلاحية سر الاقتران (G-1): آخر رمز QR مُصدَر يقبل الاقتران لعشر دقائق فقط،
 *  وكل استدعاء جديد لـ /api/devices/qr يُدوّر السر (آخر رمز مُصدَر هو الصالح). */
export const PAIRING_TTL_MS = 10 * 60_000

export type PairingRejectReason = "no-window" | "missing" | "expired" | "invalid"

/** G-1 (عقد §6) — التحقق من سر الاقتران قبل تسجيل أي جهاز:
 *  - no-window: لم يُصدر رمز QR إطلاقًا (لا نافذة اقتران نشطة)
 *  - missing: الطلب بلا سر (الاقتران يتطلب إثبات قرب = مسح الرمز من شاشة الكمبيوتر)
 *  - expired: فاتت نافذة العشر دقائق
 *  - invalid: سر لا يطابق آخر رمز مُصدَر (مقارنة timing-safe)
 *  السر يُبوتستراب من نفس قناة REST عند الإدخال اليدوي (حد موثق بصدق في العقد §6) —
 *  الإثبات الأقوى يبقى مسح الكاميرا لرمز معروض على شاشة الكمبيوتر. */
export function verifyPairingSecret(provided: unknown): { ok: true } | { ok: false; reason: PairingRejectReason } {
  const s = store()
  if (!s.pairingSecret) return { ok: false, reason: "no-window" }
  if (typeof provided !== "string" || !provided.trim()) return { ok: false, reason: "missing" }
  if (Date.now() - s.pairingIssuedAt > PAIRING_TTL_MS) return { ok: false, reason: "expired" }
  const a = Buffer.from(provided)
  const b = Buffer.from(s.pairingSecret)
  // timingSafeEqual يشترط الطول نفسه — فحص الطول أولًا ثم مقارنة زمن-ثابت
  const match = a.length === b.length && crypto.timingSafeEqual(a, b)
  return match ? { ok: true } : { ok: false, reason: "invalid" }
}

interface Store {
  devices: NexusDevice[]
  pairingSecret: string | null
  pairingIssuedAt: number
  /** عقد §46 — طلب اقتران برمز المساعدة في انتظار موافقة مالك سطح المكتب */
  assistPending: AssistPending | null
  /** عقد §46.د — محاولات الرمز الخاطئ المستنفدة على نافذة الاقتران الحالية */
  assistAttempts: number
  /** عقد §46.هـ — جلسة المساعدة النشطة (بعد قبول صريح) — تظهر لافتة وقطع بضغطة */
  assistSession: AssistSession | null
}

/** طلب اقتران برمز المساعدة — بيانات وصفية حصرًا (حرس F6 متوافق) */
export interface AssistPending {
  id: string
  name: string
  model: string
  kind: DeviceKind
  ip: string
  requestedAt: number
}

/** جلسة مساعدة نشطة عبر رمز قصير — يقطعها مالك سطح المكتب أو الوكيل */
export interface AssistSession {
  deviceId: string
  deviceName: string
  startedAt: number
  via: "short-code"
}

const g = globalThis as unknown as { __nexusStore?: Store; __nexusStoreVersion?: number }

// v4: + حالة المساعدة عن بعد §46 (assistPending/assistAttempts/assistSession)
const SEED_VERSION = 4

function seed(): Store {
  return {
    devices: [
      {
        id: "pc-office", name: "PC-OFFICE", kind: "desktop", state: "connected",
        mode: "wifi", ip: "192.168.1.2", battery: 100, storageTotal: 512 * 1024 ** 3,
        storageUsed: 231 * 1024 ** 3, lastSeen: Date.now(), rttMs: 3,
        pairedAt: Date.now() - 90 * 864e5, trusted: true,
      },
      {
        id: "galaxy-s24", name: "Galaxy-S24", kind: "phone", state: "connected",
        mode: "wifi", ip: "192.168.1.14", battery: 78, storageTotal: 256 * 1024 ** 3,
        storageUsed: 88 * 1024 ** 3, lastSeen: Date.now(), rttMs: 11,
        pairedAt: Date.now() - 12 * 864e5, trusted: true,
      },
      {
        id: "ipad-pro", name: "iPad-Pro", kind: "tablet", state: "offline",
        mode: "wifi", ip: "192.168.1.21", battery: 45, storageTotal: 128 * 1024 ** 3,
        storageUsed: 61 * 1024 ** 3, lastSeen: Date.now() - 36e5, rttMs: 24,
        pairedAt: Date.now() - 30 * 864e5, trusted: true,
      },
      {
        id: "redmi-note13", name: "Redmi-Note13", kind: "phone", state: "connected",
        mode: "hotspot", ip: "192.168.43.7", battery: 92, storageTotal: 128 * 1024 ** 3,
        storageUsed: 103 * 1024 ** 3, lastSeen: Date.now(), rttMs: 40,
        pairedAt: Date.now() - 60 * 864e5, trusted: true,
      },
      {
        id: "nexus-tv", name: "Nexus-TV", kind: "tv", state: "connected",
        mode: "wifi", ip: "192.168.1.50", battery: 100, storageTotal: 32 * 1024 ** 3,
        storageUsed: 12 * 1024 ** 3, lastSeen: Date.now(), rttMs: 8,
        pairedAt: Date.now() - 45 * 864e5, trusted: true,
      },
    ],
    pairingSecret: null,
    pairingIssuedAt: 0,
    assistPending: null,
    assistAttempts: 0,
    assistSession: null,
  }
}

// نبض الخدمة الذاتي (عقد §27.هـ): توليد عينات الصحة يعيش في عملية الخادم نفسها —
// لا يعتمد على فتح أي واجهة. أي «لمسة أولى» على المنظومة (نبضة واجهة، تكة force،
// تقرير وكيل report، إقلاع جسر الروتينات) تشعل النبض الدائم؛ وبعدها يستمر القياس
// كل SERVICE_PULSE_MS حتى لو أُغلقت كل الصفحات — فتُبنى سلاسل الدليل للمشغلات
// التاريخية (§26.و) على مدار الساعة لا على مدار جلسة المتصفح.
export const SERVICE_PULSE_MS = 4000 // نفس إيقاع نبضة الواجهة — اتساق معدل الجيتر والاستنزاف المحاكى (موثق §27.هـ)

const gPulse = globalThis as unknown as { __nexusServicePulse?: { startedAt: number } }

/** يشعل نبض الخدمة مرة واحدة لكل عملية (idempotent — نمط الجسور: globalThis + علم قبل المؤقت). */
export function ensureServicePulse() {
  if (gPulse.__nexusServicePulse) return
  gPulse.__nexusServicePulse = { startedAt: Date.now() } // العلم قبل المؤقت — لا سباق تكرار حتى مع HMR
  const timer = setInterval(() => {
    try { heartbeatBump() } catch { /* النبض لا يُهلِك عملية الخادم أبدًا */ }
  }, SERVICE_PULSE_MS)
  // unref: مؤقت لا يحجز عملية قصيرة العمر (سكربتات/اختبارات تستورد الوحدة) —
  // خادم Next يبقى حيًا بمستمعيه HTTP فيعمل النبض طوال عمر العملية.
  timer.unref?.()
}

/** حالة النبض الذاتي — تُعرض في لقطة الصحة (شارة الواجهة + فحوص E2E). */
export function getServicePulse() {
  const p = gPulse.__nexusServicePulse
  return { active: !!p, intervalMs: SERVICE_PULSE_MS, startedAt: p?.startedAt ?? 0 }
}

export function store(): Store {
  if (!g.__nexusStore || g.__nexusStoreVersion !== SEED_VERSION) {
    g.__nexusStore = seed()
    g.__nexusStoreVersion = SEED_VERSION
  }
  return g.__nexusStore
}

export function heartbeatBump() {
  // §27.هـ: أي نبضة (واجهة أو وكيل أو تكة force) تشعل النبض الذاتي الدائم —
  // بعدها لا تحتاج المنظومة أي واجهة مفتوحة لتوليد العينات.
  ensureServicePulse()
  for (const d of store().devices) {
    if (d.state === "connected") {
      d.lastSeen = Date.now()
      // small realistic jitter around a base rtt
      const base = d.kind === "desktop" ? 3 : d.kind === "phone" ? 11 : 22
      d.rttMs = Math.max(2, Math.round(base + (Math.random() * 6 - 3)))
      d.battery = Math.max(5, d.battery - (Math.random() < 0.15 ? 1 : 0))
    }
  }
  // مركز صحة الأجهزة (عقد §27): كل نبضة = تكة قياس (خانقة 30ث لكل جهاز) + كشف
  // العبورات (انقطاع/عودة/بطارية/استجابة/تخزين). استيراد ديناميكي يكسر دورة
  // الوحدات (health.ts يقرأ store من هنا) — fire-and-forget لا يُبطئ النبضة.
  import("./health")
    .then((m) => m.recordHealthTick(store().devices))
    .catch(() => {})
}
