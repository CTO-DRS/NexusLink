// عقد §54 — الدرع الاحتياطي المشفّر (ENCRYPTED-BACKUP) — النواة النقية
// ============================================================
// الخندق التنافسي: #1 الخصوصية المعمارية — نسخ احتياطية مشفّرة AES-256-GCM
// على جهاز المالك حصرًا: المفتاح لا يسافر والمغلف لا يُفكّ إلا بعبارة المالك.
// مقابل المنافسين مباشرة:
//  - AirDroid/Google Backup: النسخة على سحابة الغير — مفتاحك عندهم أو بلا
//    تشفير ساكن أصلًا. هنا: مغلف محلي بمشتق PBKDF2-HMAC-SHA256 وسقف
//    تكرارات معلن — صفر سحابة صفر حساب.
//  - نسخ JSON العارية (المسار القائم /api/prod/backup): مفيدة للترحيل لكنها
//    صريحة النص — §54 يغلفها كاملة بحيث لا يُقرأ شيء بلا عبارة المرور.
//
// الصندوق المزدوج (قرار معماري موثق):
//  1) تحقق سلامة القن약 أولًا: sha256(قناع النص المشفر بالـb64) المخزَّن في
//     المانيفست — التلف يُعلن "tampered" بصدق.
//  2) ثم فتح GCM — الفشل هنا "auth-failed" (عبارة خاطئة أو عبث تجاوز
//     البصمة — GCM لا يفرّق، والصدق يعلن الاثنين معًا).
//
// حدود صادقة (§54.حدود):
//  - PBKDF2 بتكرارات 600,000 (توصية OWASP 2023 لـSHA-256) — argon2id خارج
//    نواة node:crypto القياسية (بلا اعتماد جديد — عقيدة المشروع).
//  - المغلف JSON نصي (b64) — حجمه ~135% من الأصل؛ سقف التصدير المتوقع ميغابايتات.
//  - عبارة المرور لا تُستعاد ولا تُخزَّن — فقدها = فقدان النسخة بصدق (نعلنها).
//  - الجدولة بمفتاح محلي مولود عند التمكين يُرسَّخ في DesktopSetting (صفر
//    مخطط) — عرضه مرة واحدة عند التدوير حصرًا، وقراءته بيد الخادم حصرًا.

import crypto from "node:crypto"

export const SECURE_BACKUP_VERSION = 1
export const PBKDF2_ITERATIONS = 600_000
export const PBKDF2_SALT_BYTES = 16
export const KEY_LEN = 32
export const PASSPHRASE_MIN = 8
/** سياسة الاحتفاظ: سقف النسخ المحفوظة لكل نوع (يدوي/مجدول) */
export const RETENTION_LIMITS = { manual: 10, scheduled: 5 } as const
export type SecureBackupKind = "manual" | "scheduled"
/** فترات الجدولة المسموحة (ساعات) — الحدان شاملان */
export const SCHEDULE_HOURS = [12, 24, 168] as const

export interface SecureEnvelope {
  app: "NexusLink"
  type: "nexuslink-secure-backup"
  v: number
  kind: SecureBackupKind
  createdAt: string
  kdf: { algo: "pbkdf2-sha256"; iterations: number; salt: string }
  cipher: "aes-256-gcm"
  iv: string
  data: string
  manifest: {
    plainBytes: number
    innerType: string
    cipherSha256: string
    counts: { devices: number; profiles: number; pairs: number }
  }
}

/** عبارة مرور سليمة: ≥ 8 محارف بعد القص — والرفض صادق */
export function validatePassphrase(p: unknown): { ok: boolean; error?: string } {
  if (typeof p !== "string" || p.trim().length < PASSPHRASE_MIN) {
    return { ok: false, error: "weak-passphrase" }
  }
  return { ok: true }
}

/** مفتاح المزامنة الجدولية: 32 بايت base64url — يولَّد مرة ويُدوَّر بطلب */
export function newLocalKey(): string {
  return crypto.randomBytes(32).toString("base64url")
}

function deriveKey(passphrase: string, saltB64: string, iterations: number): Buffer {
  return crypto.pbkdf2Sync(passphrase, Buffer.from(saltB64, "base64"), iterations, KEY_LEN, "sha256")
}

/** ختم المغلف: تصدير + عبارة → مغلف مختوم — دال نقية على المدخلات */
export function sealBackup(
  plain: Record<string, unknown>,
  passphrase: string,
  kind: SecureBackupKind,
  nowMs: number,
): SecureEnvelope {
  const plainJson = JSON.stringify(plain)
  const salt = crypto.randomBytes(PBKDF2_SALT_BYTES).toString("base64")
  const iv = crypto.randomBytes(12)
  const key = deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(plainJson, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  // القناغة المخزنة = النص المشفر حصرًا (بلا tag) — سلامة القناع قبل فتح GCM
  const cipherSha256 = crypto.createHash("sha256").update(data).digest("hex")
  const counts = {
    devices: Array.isArray(plain.devices) ? plain.devices.length : 0,
    profiles: Array.isArray(plain.profiles) ? plain.profiles.length : 0,
    pairs: Array.isArray(plain.pairs) ? plain.pairs.length : 0,
  }
  return {
    app: "NexusLink",
    type: "nexuslink-secure-backup",
    v: SECURE_BACKUP_VERSION,
    kind,
    createdAt: new Date(nowMs).toISOString(),
    kdf: { algo: "pbkdf2-sha256", iterations: PBKDF2_ITERATIONS, salt },
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    data: Buffer.concat([data, tag]).toString("base64"),
    manifest: {
      plainBytes: Buffer.byteLength(plainJson),
      innerType: String(plain.type ?? ""),
      cipherSha256,
      counts,
    },
  }
}

export type OpenOutcome =
  | { ok: true; plain: Record<string, unknown>; envelope: SecureEnvelope }
  | { ok: false; error: "bad-envelope" | "tampered" | "auth-failed" }

/** فتح المغلف: شكل ← سلامة القناغة ← GCM — الأسباب الثلاثة مغلقة */
export function openBackup(envelope: unknown, passphrase: string): OpenOutcome {
  if (!envelope || typeof envelope !== "object") return { ok: false, error: "bad-envelope" }
  const e = envelope as Partial<SecureEnvelope>
  if (e.app !== "NexusLink" || e.type !== "nexuslink-secure-backup" || typeof e.data !== "string" || typeof e.iv !== "string" || !e.kdf || !e.manifest) {
    return { ok: false, error: "bad-envelope" }
  }
  let dataBuf: Buffer
  try { dataBuf = Buffer.from(e.data, "base64") } catch { return { ok: false, error: "bad-envelope" } }
  if (dataBuf.length < 28) return { ok: false, error: "bad-envelope" } // 12 iv-side؟ لا: data+tag، tag 16 كحد أدنى مع نص قصير
  // 1) سلامة القناغة أولًا — التلف يعلن بصدق قبل أي محاولة فتح
  if (e.manifest.cipherSha256 !== crypto.createHash("sha256").update(dataBuf.subarray(0, dataBuf.length - 16)).digest("hex")) {
    return { ok: false, error: "tampered" }
  }
  // 2) فتح GCM — tag آخر 16 بايت
  try {
    const key = deriveKey(passphrase, e.kdf.salt, e.kdf.iterations)
    const tag = dataBuf.subarray(dataBuf.length - 16)
    const enc = dataBuf.subarray(0, dataBuf.length - 16)
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"))
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
    const parsed = JSON.parse(plain) as Record<string, unknown>
    return { ok: true, plain: parsed, envelope: e as SecureEnvelope }
  } catch {
    return { ok: false, error: "auth-failed" }
  }
}

/** سياسة الاحتفاظ: الأحدث يبقى حسب النوع — الترتيب بالاسم الزمني تنازليًا */
export function retentionFilter(files: Array<{ name: string; kind: SecureBackupKind; at: number }>, keepOverride?: number): string[] {
  const out: string[] = []
  for (const kind of ["manual", "scheduled"] as const) {
    const list = files
      .filter((f) => f.kind === kind)
      .sort((a, b) => b.at - a.at)
    const keep = keepOverride ?? RETENTION_LIMITS[kind]
    for (const f of list.slice(keep)) out.push(f.name)
  }
  return out
}

/** اسم ملف زمني مرتّب قابل للفرز المعجمي */
export function backupFileName(kind: SecureBackupKind, nowMs: number): string {
  const d = new Date(nowMs)
  const p = (n: number) => String(n).padStart(2, "0")
  return `backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${kind}.nexusbackup`
}

/** فك النوع من الاسم — الغريب يعاد "manual" (توافقية مع ملفات قديمة) */
export function kindFromName(name: string): SecureBackupKind {
  return name.endsWith("-scheduled.nexusbackup") ? "scheduled" : "manual"
}
