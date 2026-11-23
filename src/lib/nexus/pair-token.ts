// G1 (ROADMAP-2027 P0) — رمز الاقتران الإلزامي: مصدر الحقيقة الواحد للمسارات
// ============================================================
// نفس الملف الذي تقرؤه البوابة (mini-services/gateway/index.cjs — §37):
//   NEXUSLINK_PAIR_FILE أو <cwd>/.zstate/pair-token.json  →  { token, fingerprint, createdAt }
// وعلامة التعطيل الصريح <PAIR_FILE>.disabled (يكتبها disable — لا توليد تلقائي بعدها).
//
// - الرمز إلزامي لكل واصل من خارج loopback عبر البوابة (فشل-مغلق).
// - أول تشغيل يولّده (البوابة عند الإقلاع، أو هذا الملف عند أول QR — أيهما أسبق؛
//   الإنشاء حصري عبر link فلا يتسابق طرفان على رمزين مختلفين).
// - QR الاقتران يحمله تلقائيًا (payload.pair) فيرسله الهاتف بكل طلب.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const PAIR_FILE =
  process.env.NEXUSLINK_PAIR_FILE || path.join(process.cwd(), ".zstate", "pair-token.json")
export const PAIR_DISABLED_FILE = `${PAIR_FILE}.disabled`

export interface PairRecord {
  token: string
  fingerprint: string
  createdAt: string
}

export function fingerprintOf(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)
}

/** 32 بايت عشوائية base64url — 43 محرفًا بلا غموض طباعي */
export function newPairToken(): string {
  return crypto.randomBytes(32).toString("base64url")
}

export function readPairFile(): PairRecord | null {
  try {
    const j = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ PAIR_FILE, "utf8"))
    if (j && typeof j.token === "string" && j.token.length >= 16) {
      return { token: j.token, fingerprint: String(j.fingerprint ?? ""), createdAt: String(j.createdAt ?? "") }
    }
    return null
  } catch {
    return null
  }
}

/** كتابة ذرية (tmp → rename) بصلاحية 0600 — للتمكين/التدوير الصريح */
export function writePairFile(token: string): { fingerprint: string; createdAt: string } {
  const fingerprint = fingerprintOf(token)
  const createdAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(PAIR_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${PAIR_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ token, fingerprint, createdAt }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, PAIR_FILE)
  try { fs.chmodSync(PAIR_FILE, 0o600) } catch { /* أنظمة بلا أذونات بوزيكس */ }
  return { fingerprint, createdAt }
}

export function pairDisabled(): boolean {
  try { return fs.statSync(PAIR_DISABLED_FILE).isFile() } catch { return false }
}

export function setPairDisabled(disabled: boolean): void {
  if (disabled) {
    fs.mkdirSync(path.dirname(PAIR_DISABLED_FILE), { recursive: true, mode: 0o700 })
    fs.writeFileSync(PAIR_DISABLED_FILE, JSON.stringify({ disabledAt: new Date().toISOString() }), { mode: 0o600 })
  } else {
    try { fs.rmSync(PAIR_DISABLED_FILE, { force: true }) } catch { /* غائبة أصلًا */ }
  }
}

/**
 * G1 — يضمن وجود رمز (أول تشغيل). null عند التعطيل الصريح أو تعذّر الكتابة.
 * الإنشاء حصري (link يفشل إن سبقته البوابة) فالقيمة المعادة دائمًا ما على القرص.
 */
export function ensurePairToken(): PairRecord | null {
  const cur = readPairFile()
  if (cur) return cur
  if (pairDisabled()) return null
  // NEXUSLINK_PAIR_AUTOGEN=0 (جولات E2E) — فشل-مغلق: بلا رمز فالخارج مرفوض، لا مفتوح
  if (process.env.NEXUSLINK_PAIR_AUTOGEN === "0") return null
  try {
    const token = newPairToken()
    const fingerprint = fingerprintOf(token)
    fs.mkdirSync(path.dirname(PAIR_FILE), { recursive: true, mode: 0o700 })
    const tmp = `${PAIR_FILE}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ token, fingerprint, createdAt: new Date().toISOString(), origin: "first-run" }, null, 2), { mode: 0o600 })
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ PAIR_FILE) && !readPairFile()) fs.rmSync(PAIR_FILE, { force: true })
      fs.linkSync(tmp, PAIR_FILE)
    } catch { /* سبقتنا البوابة — رمزها هو الحقيقة */ }
    try { fs.rmSync(tmp, { force: true }) } catch { /* لا شيء */ }
    try { fs.chmodSync(PAIR_FILE, 0o600) } catch { /* أنظمة بلا بوزيكس */ }
  } catch {
    return null
  }
  return readPairFile()
}
