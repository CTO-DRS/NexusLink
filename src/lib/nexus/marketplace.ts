import crypto from "node:crypto"
import { db, dbReady } from "@/lib/db"

// سوق التكاملات — القناة الموقعة محليًا (عقد §34.ب — M3.2)
// ============================================================
// النموذج الأمني (تصريحي لا تنفيذي): التكامل **manifest JSON** يصرّح بقدراته
// — لا كود تنفيذي يُثبَّت أبدًا — فلا سطح تنفيذ جديد. التثبيت يتطلب:
//   (1) توقيع HMAC-SHA256 صحيحًا على الشكل المتعارف (مفاتيح مرتبة)
//   (2) قدرات كلها ضمن كتالوج القدرات المعروف
//   (3) معرف فريد + إصدار شكل semver
// والتوقيع بمفتاح قناة محلي يُولَّد عند أول استخدام (randomBytes 32) ويرسخ
// في DesktopSetting — بصمته تُعلن في كل رد. الارتساء صفر-مخطط (DesktopSetting).

export const MARKET_KEY_SETTING = "marketplace.key"
export const MARKET_INSTALLED_SETTING = "marketplace.installed"

/** كتالوج القدرات المعروف — أي قدرة خارجه ترفض (لا توسيع صامت) */
export const PLUGIN_CAPABILITIES = [
  "read.devices",       // قراءة قائمة الأجهزة وحالتها
  "read.search",        // استدعاء البحث الموحد المحلي
  "read.insights",      // قراءة لوحة الرؤى (أرقام حصرًا)
  "read.ops",           // قراءة رأس سجل العمليات (بلا حمولات — F6)
  "invoke.automation",  // إنشاء/تعديل قواعد روتين (تعقيم الجسر نفسه)
  "invoke.transfer",    // بدء نقل ملفات محلي
  "notify.user",        // إشعار للمستخدم عبر قناة auto:fired القائمة
] as const

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number]

export interface MarketManifest {
  id: string
  name: string
  description: string
  version: string
  author: string
  capabilities: string[]
  /** نوع الدخول التصريحي — لا كود: قالب قاعدة روتين أو رابط محلي للفتح */
  entry: { kind: "automation-rule" | "local-open"; template?: Record<string, unknown>; url?: string }
  homepage?: string
}

// ---------- التعارف الشكلي (canonical) والتوقيع ----------

/** JSON متعارف: مفاتيح مرتبة ترتيبيًا — نفس البايتات على أي جهاز */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`
}

export async function getChannelKey(): Promise<{ key: string; fp: string }> {
  await dbReady
  const row = await db.desktopSetting.findUnique({ where: { key: MARKET_KEY_SETTING } })
  let key = row?.value
  if (!key || !/^[0-9a-f]{64}$/.test(key)) {
    key = crypto.randomBytes(32).toString("hex")
    await db.desktopSetting.upsert({
      where: { key: MARKET_KEY_SETTING },
      create: { key: MARKET_KEY_SETTING, value: key },
      update: { value: key },
    })
  }
  const fp = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)
  return { key, fp }
}

export function signManifest(manifest: MarketManifest, keyHex: string): string {
  return crypto.createHmac("sha256", keyHex).update(canonicalize(manifest)).digest("hex")
}

export function verifySignature(manifest: MarketManifest, sigHex: string, keyHex: string): boolean {
  if (typeof sigHex !== "string" || !/^[0-9a-f]{64}$/.test(sigHex)) return false
  const expect = signManifest(manifest, keyHex)
  const a = Buffer.from(sigHex, "hex")
  const b = Buffer.from(expect, "hex")
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ---------- قناة البداية: 10 تكاملات موقعة (معيار خروج M3) ----------

type Seed = Omit<MarketManifest, "version" | "author"> & { version?: string; author?: string }

const CHANNEL_SEEDS: Seed[] = [
  { id: "battery-warden", name: "Battery Warden", description: "تنبيهات بطارية مركبة عبر الروتينات: نبّهني عند 20% أو عند بلوغ الشحن 80%", capabilities: ["read.devices", "invoke.automation", "notify.user"], entry: { kind: "automation-rule", template: { trigger: { kind: "battery.below", threshold: 20 }, action: { kind: "notify", text: "البطارية هبطت تحت 20%" } } } },
  { id: "focus-timer", name: "Focus Timer", description: "روتين «وقت التركيز»: إشعار يومي بلغة المستخدم عبر القناة القائمة", capabilities: ["invoke.automation", "notify.user"], entry: { kind: "automation-rule", template: { trigger: { kind: "time.daily", hh: 9, mm: 0 }, action: { kind: "notify", text: "بدء جلسة التركيز" } } } },
  { id: "clipboard-bridge", name: "Clipboard Bridge", description: "مراقبة الحافظة الموحدة وإشعار عند وصول محتوى جديد من أي جهاز", capabilities: ["invoke.automation", "notify.user"], entry: { kind: "automation-rule", template: { trigger: { kind: "clip.received" }, action: { kind: "notify", text: "وصل محتوى جديد إلى الحافظة" } } } },
  { id: "night-sync", name: "Night Sync", description: "استئناف المزامنة لياليًا: تذكير يومي بفحص رأس سجل العمليات قبل النوم", capabilities: ["read.ops", "invoke.automation", "notify.user"], entry: { kind: "automation-rule", template: { trigger: { kind: "time.daily", hh: 23, mm: 30 }, action: { kind: "notify", text: "فحص حالة المزامنة" } } } },
  { id: "storage-sentinel", name: "Storage Sentinel", description: "سقف صامت على امتلاء التخزين: تنبيه تاريخي عند بقاء التخزين فوق 90% ساعة", capabilities: ["read.devices", "invoke.automation", "notify.user"], entry: { kind: "automation-rule", template: { trigger: { kind: "health.storage.sustained", threshold: 90, durationMin: 60 }, action: { kind: "notify", text: "التخزين ممتلئ لمدة ساعة" } } } },
  { id: "handoff-pinner", name: "Handoff Pinner", description: "فتح لوحة التسليم المحلية بنقرة من أي سطح — رابط محلي فقط", capabilities: [], entry: { kind: "local-open", url: "/?app=1#handoff" } },
  { id: "health-digest", name: "Health Digest", description: "ملخص صحة الأجهزة اليومي من لوحة الرؤى (أرقام حصرًا بلا أي مغادرة)", capabilities: ["read.insights", "notify.user"], entry: { kind: "automation-rule", template: { trigger: { kind: "time.daily", hh: 20, mm: 0 }, action: { kind: "notify", text: "ملخص صحة اليوم جاهز في الرؤى" } } } },
  { id: "call-log-exporter", name: "Call Log Exporter", description: "تصدير سجل النداءات المحلي عبر واجهة الملفات — بلا مغادرة أي بايت", capabilities: ["read.devices", "invoke.transfer"], entry: { kind: "local-open", url: "/?app=1#comms" } },
  { id: "message-router", name: "Message Router", description: "توجيه رسائل الهاتف إلى روتين: إشعار عند وصول رسالة من جهة محددة", capabilities: ["invoke.automation", "notify.user"], entry: { kind: "automation-rule", template: { trigger: { kind: "time.daily", hh: 8, mm: 0 }, action: { kind: "notify", text: "مراجعة الرسائل الجديدة" } } } },
  { id: "backup-beacon", name: "Backup Beacon", description: "منارة نسخ احتياطي أسبوعية: تذكير بمزامنة النسخ المحلية عبر الروتينات", capabilities: ["read.insights", "invoke.automation", "notify.user"], entry: { kind: "automation-rule", template: { trigger: { kind: "time.daily", hh: 12, mm: 0 }, action: { kind: "notify", text: "موعد النسخ الاحتياطي الأسبوعي" } } } },
]

/** قناة البداية موقعة بمفتاح القناة المحلية (قناة موقعة ذاتيًا — موثقة بصدق §34.ب) */
export async function signedChannel(): Promise<{ manifest: MarketManifest; sig: string; bundled: boolean }[]> {
  const { key } = await getChannelKey()
  return CHANNEL_SEEDS.map((s) => {
    const manifest: MarketManifest = { version: "1.0.0", author: "NexusLink Labs", homepage: "", ...s } as MarketManifest
    return { manifest, sig: signManifest(manifest, key), bundled: true }
  })
}

// ---------- التثبيت (الارتساء صفر-مخطط: DesktopSetting) ----------

export interface InstalledPlugin { manifest: MarketManifest; sig: string; installedAt: number }

export async function listInstalled(): Promise<InstalledPlugin[]> {
  await dbReady
  const row = await db.desktopSetting.findUnique({ where: { key: MARKET_INSTALLED_SETTING } })
  if (!row?.value) return []
  try {
    const arr = JSON.parse(row.value)
    return Array.isArray(arr) ? (arr as InstalledPlugin[]) : []
  } catch { return [] }
}

async function persistInstalled(list: InstalledPlugin[]): Promise<void> {
  await dbReady
  await db.desktopSetting.upsert({
    where: { key: MARKET_INSTALLED_SETTING },
    create: { key: MARKET_INSTALLED_SETTING, value: JSON.stringify(list) },
    update: { value: JSON.stringify(list) },
  })
}

export type InstallRejectReason =
  | "manifest غير صالح" | "توقيع مفقود أو مشوه" | "التوقيع لا يطابق المحتوى"
  | "قدرة خارج الكتالوج" | "معرف التكامل مكرر" | "إصدار غير صالح"

export async function installPlugin(rawManifest: unknown, rawSig: unknown):
  Promise<{ ok: true; installed: InstalledPlugin } | { ok: false; reason: InstallRejectReason }> {
  if (!rawManifest || typeof rawManifest !== "object" || Array.isArray(rawManifest)) return { ok: false, reason: "manifest غير صالح" }
  const m = rawManifest as Partial<MarketManifest>
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(m.id)) return { ok: false, reason: "manifest غير صالح" }
  if (typeof m.name !== "string" || m.name.length < 2 || m.name.length > 48) return { ok: false, reason: "manifest غير صالح" }
  if (typeof m.description !== "string" || m.description.length > 240) return { ok: false, reason: "manifest غير صالح" }
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+$/.test(m.version)) return { ok: false, reason: "إصدار غير صالح" }
  if (typeof m.author !== "string" || !m.author.trim()) return { ok: false, reason: "manifest غير صالح" }
  if (!Array.isArray(m.capabilities)) return { ok: false, reason: "manifest غير صالح" }
  const unknownCap = m.capabilities.find((c) => !(PLUGIN_CAPABILITIES as readonly string[]).includes(c))
  if (unknownCap) return { ok: false, reason: "قدرة خارج الكتالوج" }
  if (!m.entry || (m.entry.kind !== "automation-rule" && m.entry.kind !== "local-open")) return { ok: false, reason: "manifest غير صالح" }
  if (m.entry.kind === "automation-rule" && !m.entry.template) return { ok: false, reason: "manifest غير صالح" }
  if (m.entry.kind === "local-open" && (typeof m.entry.url !== "string" || !m.entry.url.startsWith("/"))) {
    return { ok: false, reason: "manifest غير صالح" }
  }
  // التوقيع على الشكل المتعارف حصرًا
  const { key } = await getChannelKey()
  if (!verifySignature(m as MarketManifest, String(rawSig ?? ""), key)) {
    if (typeof rawSig !== "string" || !/^[0-9a-f]{64}$/.test(rawSig)) return { ok: false, reason: "توقيع مفقود أو مشوه" }
    return { ok: false, reason: "التوقيع لا يطابق المحتوى" }
  }
  const installed = await listInstalled()
  if (installed.some((p) => p.manifest.id === m.id)) return { ok: false, reason: "معرف التكامل مكرر" }
  const entry: InstalledPlugin = { manifest: m as MarketManifest, sig: String(rawSig), installedAt: Date.now() }
  await persistInstalled([...installed, entry])
  return { ok: true, installed: entry }
}

export async function uninstallPlugin(id: string): Promise<boolean> {
  const installed = await listInstalled()
  const next = installed.filter((p) => p.manifest.id !== id)
  if (next.length === installed.length) return false
  await persistInstalled(next)
  return true
}
