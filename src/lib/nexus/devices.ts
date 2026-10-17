// NexusLink — device registry with simulated live state + heartbeat.
import type { NexusDevice } from "./types"
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
}

const g = globalThis as unknown as { __nexusStore?: Store; __nexusStoreVersion?: number }

// v3: + Nexus-TV + Redmi-Note13 متصل (طبقة الوسائط والكاميرا)
const SEED_VERSION = 3

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
  }
}

export function store(): Store {
  if (!g.__nexusStore || g.__nexusStoreVersion !== SEED_VERSION) {
    g.__nexusStore = seed()
    g.__nexusStoreVersion = SEED_VERSION
  }
  return g.__nexusStore
}

export function heartbeatBump() {
  for (const d of store().devices) {
    if (d.state === "connected") {
      d.lastSeen = Date.now()
      // small realistic jitter around a base rtt
      const base = d.kind === "desktop" ? 3 : d.kind === "phone" ? 11 : 22
      d.rttMs = Math.max(2, Math.round(base + (Math.random() * 6 - 3)))
      d.battery = Math.max(5, d.battery - (Math.random() < 0.15 ? 1 : 0))
    }
  }
}
