// عقد §54 — الدرع الاحتياطي المشفّر — طبقة الخادم (ملفات + جدولة + تدقيق §39)
// ============================================================
// مجلد النسخ: NEXUSLINK_BACKUP_DIR أو .zstate/backups/ — كل نسخة ملف
// .nexusbackup (JSON مغلف) باسم زمني قابل للفرز.
// الجدولة: حالة صفر-مخطط في .zstate/backup-secure.json {enabled, hours,
// lastRunAt} + مفتاح محلي 32 بايت مرسوخ في DesktopSetting (صفر مخطط، نمط §34.ب)
// — لا يعود أبدًا في GET؛ يُعرض مرة عند التدوير حصرًا.
import fs from "node:fs"
import path from "node:path"
import { db } from "@/lib/db"
import { appendAudit } from "@/lib/enterprise-audit"
import { buildExport, applyRestore } from "./backup-export"
import {
  sealBackup, openBackup, retentionFilter, backupFileName, kindFromName,
  validatePassphrase, newLocalKey, SCHEDULE_HOURS,
  type SecureBackupKind, type SecureEnvelope,
} from "./backup-secure-core"

const BACKUP_DIR = process.env.NEXUSLINK_BACKUP_DIR || path.join(process.cwd(), ".zstate", "backups")
const SCHEDULE_FILE =
  process.env.NEXUSLINK_BACKUP_SCHEDULE_FILE || path.join(process.cwd(), ".zstate", "backup-secure.json")
const KEY_SETTING = "backup-secure.local-key"

// ---------- حالة الجدولة (ملف صفر-مخطط — الفساد = غير مفعّل بصدق) ----------

export interface ScheduleState {
  enabled: boolean
  hours: number
  lastRunAt: number | null
}

function readSchedule(): ScheduleState {
  try {
    const j = JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf8")) as Partial<ScheduleState>
    if (typeof j.enabled !== "boolean") return { enabled: false, hours: 24, lastRunAt: null }
    const hours = (SCHEDULE_HOURS as readonly number[]).includes(Number(j.hours)) ? Number(j.hours) : 24
    return { enabled: j.enabled, hours, lastRunAt: typeof j.lastRunAt === "number" ? j.lastRunAt : null }
  } catch {
    return { enabled: false, hours: 24, lastRunAt: null }
  }
}

function writeSchedule(s: ScheduleState): void {
  fs.mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${SCHEDULE_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, SCHEDULE_FILE)
  try { fs.chmodSync(SCHEDULE_FILE, 0o600) } catch { /* أنظمة بلا أذونات بوزيكس */ }
}

// ---------- المفتاح المحلي (DesktopSetting — صفر مخطط) ----------

async function readLocalKey(): Promise<string | null> {
  const row = await db.desktopSetting.findUnique({ where: { key: KEY_SETTING } })
  return row?.value ?? null
}

async function writeLocalKey(key: string): Promise<void> {
  await db.desktopSetting.upsert({
    where: { key: KEY_SETTING },
    update: { value: key },
    create: { key: KEY_SETTING, value: key },
  })
}

// ---------- الملفات ----------

function listFiles(): Array<{ name: string; kind: SecureBackupKind; at: number; size: number }> {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".nexusbackup"))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f))
        return { name: f, kind: kindFromName(f), at: Math.floor(st.mtimeMs), size: st.size }
      })
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

function readEnvelope(name: string): SecureEnvelope | null {
  if (!/^backup-[\d-]+-(manual|scheduled)\.nexusbackup$/.test(name)) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), "utf8")) as SecureEnvelope
  } catch {
    return null
  }
}

// ---------- الأفعال ----------

export interface CreateResult {
  ok: boolean
  error?: string
  file?: string
  bytes?: number
  counts?: { devices: number; profiles: number; pairs: number }
}

/** إنشاء نسخة: عبارة يدوية أو المفتاح المحلي للجدولة — التصدير من المكتبة المشتركة */
export async function createSecureBackup(opts: {
  passphrase?: string
  kind: SecureBackupKind
}): Promise<CreateResult> {
  let pass: string | null | undefined = opts.passphrase
  if (opts.kind === "scheduled") {
    pass = await readLocalKey()
    if (!pass) return { ok: false, error: "no-local-key" }
  } else {
    const v = validatePassphrase(pass)
    if (!v.ok) return { ok: false, error: v.error ?? "weak-passphrase" }
  }
  const plain = await buildExport()
  const now = Date.now()
  const env = sealBackup(plain, pass as string, opts.kind, now)
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 })
  const name = backupFileName(opts.kind, now)
  fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(env), { mode: 0o600 })
  await appendAudit("backup.create", true, "local", { kind: opts.kind, file: name, bytes: env.manifest.plainBytes, items: env.manifest.counts })
  return { ok: true, file: name, bytes: fs.statSync(path.join(BACKUP_DIR, name)).size, counts: env.manifest.counts }
}

/** قائمة العرض: ملفات + حالة الجدولة — لا مفاتيح ولا عبارة أبدًا */
export async function listSecureBackups() {
  const sched = readSchedule()
  return {
    ok: true,
    dir: BACKUP_DIR,
    schedule: { enabled: sched.enabled, hours: sched.hours, lastRunAt: sched.lastRunAt, keyAnchored: !!(await readLocalKey()) },
    retention: { manual: 10, scheduled: 5 },
    files: listFiles(),
  }
}

/** تحقق (بلا تطبيق): عبارة → محتوى مفكوك وعدّاداته — دراي-رن الاستعادة */
export async function verifySecureBackup(name: string, passphrase: string) {
  const env = readEnvelope(name)
  if (!env) {
    await appendAudit("backup.denied", false, "local", { reason: "not-found", file: name.slice(0, 60) })
    return { ok: false, error: "not-found" as const }
  }
  const r = openBackup(env, passphrase)
  if (!r.ok) {
    await appendAudit("backup.denied", false, "local", { reason: r.error, file: name.slice(0, 60) })
    return { ok: false, error: r.error }
  }
  const inner = r.plain
  return {
    ok: true as const,
    file: name,
    kind: env.kind,
    createdAt: env.createdAt,
    counts: {
      devices: Array.isArray(inner.devices) ? inner.devices.length : 0,
      profiles: Array.isArray(inner.profiles) ? inner.profiles.length : 0,
      pairs: Array.isArray(inner.pairs) ? inner.pairs.length : 0,
    },
    innerType: typeof inner.type === "string" ? inner.type : "",
  }
}

/** استعادة فعلية: فك ← تطبيق عبر المكتبة المشتركة (نفس سلوك مسار prod حرفيًا) */
export async function restoreSecureBackup(name: string, passphrase: string, mode: "merge" | "replace") {
  const env = readEnvelope(name)
  if (!env) return { ok: false, error: "not-found" as const }
  const r = openBackup(env, passphrase)
  if (!r.ok) {
    await appendAudit("backup.denied", false, "local", { reason: r.error, file: name.slice(0, 60), via: "restore" })
    return { ok: false, error: r.error }
  }
  if (r.plain.type !== "nexuslink-backup") return { ok: false, error: "bad-payload" as const }
  const result = await applyRestore(r.plain, mode)
  await appendAudit("backup.restore", true, "local", {
    file: name.slice(0, 60), mode,
    devices: result.devices, profiles: result.profiles, pairs: result.pairs,
  })
  return { ok: true as const, ...result }
}

/** حذف نسخة واحدة — يد محلية */
export async function deleteSecureBackup(name: string) {
  if (!/^backup-[\d-]+-(manual|scheduled)\.nexusbackup$/.test(name)) return { ok: false, error: "bad-name" as const }
  try { fs.rmSync(path.join(BACKUP_DIR, name), { force: true }) } catch { /* غائب */ }
  await appendAudit("backup.delete", true, "local", { file: name.slice(0, 60) })
  return { ok: true as const }
}

/** الاحتفاظ: طرد الزائد حسب السياسة — يعيد الأسماء المطروحة */
export async function pruneSecureBackups(keepOverride?: number) {
  const files = listFiles()
  const drop = retentionFilter(files, keepOverride)
  for (const f of drop) {
    try { fs.rmSync(path.join(BACKUP_DIR, f), { force: true }) } catch { /* غائب */ }
  }
  if (drop.length) await appendAudit("backup.prune", true, "local", { removed: drop.length })
  return { ok: true, removed: drop }
}

// ---------- الجدولة ----------

export async function enableSchedule(hours: number) {
  const h = Number(hours)
  if (!(SCHEDULE_HOURS as readonly number[]).includes(h)) {
    await appendAudit("backup.denied", false, "local", { reason: "invalid-hours" })
    return { ok: false, error: "invalid-hours" as const }
  }
  // المفتاح المحلي يُولَّد عند أول تمكين ويُدوَّر بطلب حصرًا
  if (!(await readLocalKey())) await writeLocalKey(newLocalKey())
  const s = readSchedule()
  writeSchedule({ ...s, enabled: true, hours: h })
  await appendAudit("backup.schedule.enable", true, "local", { hours: h })
  return { ok: true as const, hours: h }
}

export async function disableSchedule() {
  const s = readSchedule()
  writeSchedule({ ...s, enabled: false })
  await appendAudit("backup.schedule.disable", true, "local", {})
  return { ok: true as const }
}

/** تدوير المفتاح المحلي: يُعاد مرة واحدة — النسخ المجدولة القديمة تُفك بمفتاحها القديم؟
 *  لا — الصدق: المفتاح واحد للقادم حصرًا، والقديم المفتوح بمفتاحه وقت إنشائه لم يعد
 *  ممكنًا بعد التدوير (النسخ القديمة تبقى مغلقة — تُحذف يدويًا). يُعلن ذلك في الواجهة. */
export async function rotateLocalKey() {
  const key = newLocalKey()
  await writeLocalKey(key)
  await appendAudit("backup.schedule.rotate", true, "local", {})
  return { ok: true as const, key }
}

/** نبضة الجدولة: تُستدعى من نبض التطبيق — تنشئ نسخة إذا حان موعدها */
export async function scheduleTick(nowMs = Date.now()): Promise<{ ran: boolean; file?: string }> {
  const s = readSchedule()
  if (!s.enabled) return { ran: false }
  if (s.lastRunAt && nowMs - s.lastRunAt < s.hours * 3600_000) return { ran: false }
  const r = await createSecureBackup({ kind: "scheduled" })
  if (!r.ok) return { ran: false }
  writeSchedule({ ...s, lastRunAt: nowMs })
  await pruneSecureBackups()
  return { ran: true, file: r.file }
}

// FA-23 (تكليف 54): guardLocal القديم (نسخة يدوية من حرس loopback) حُذف —
// الجدولة صارت تحت guardPcOnly المنظومي نفسه في المسار (نمط FA-14/16/22)،
// وبنفس meta.reason "loopback" التي كانت تكتبها فبقي العقد المفحوص كما هو.
