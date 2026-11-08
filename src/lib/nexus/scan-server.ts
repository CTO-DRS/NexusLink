// عقد §55 — الماسح الموثق الحي — طبقة الخادم (جلسات على القرص + ختم PDF + تدقيق §39)
// ============================================================
// حالة الجلسة على القرص حصرًا: .zstate/scans/<id>/ — الصفحات p-NNN.jpg
// بترتيب معجمي والبيانات الوصفية session.json — بلا ذاكرة زومبي (إعادة
// الإقلاع تجد الجلسات كما هي — نمط PERSIST الموثق في DEEP-AUDIT).
import fs from "node:fs"
import path from "node:path"
import { resolveSafe } from "./fs-server"
import { appendAudit } from "@/lib/enterprise-audit"
import { createRateLimiter } from "./guest-core"
import {
  sanitizeScanTitle, scanPdfFileName, rotatePage, movePage, removePage,
  isJpegBytes, jpegDimensions,
  SCAN_MAX_PAGES, SCAN_PAGE_MAX_BYTES, SCAN_MAX_OPEN_SESSIONS,
  type ScanSession, type ScanRotation,
} from "./scan-core"
import { buildScanPdf } from "./scan-pdf"

const SCANS_ROOT = process.env.NEXUSLINK_SCANS_DIR || path.join(process.cwd(), ".zstate", "scans")
const DEFAULT_TARGET = "/Documents"

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

const pageLimiter = createRateLimiter({ max: 60, windowMs: 60_000 })

let counter = 0
function newSessionId(): string {
  counter = (counter + 1) % 0xffff
  return `s${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function sessionDir(id: string): string {
  if (!/^s[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/.test(id)) throw new Error("bad-session-id")
  return path.join(SCANS_ROOT, id)
}

function readSession(id: string): ScanSession | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(sessionDir(id), "session.json"), "utf8")) as ScanSession
    if (j && typeof j.id === "string" && Array.isArray(j.pages) && j.status === "open") return j
    return null
  } catch {
    return null
  }
}

function writeSession(s: ScanSession): void {
  fs.mkdirSync(sessionDir(s.id), { recursive: true, mode: 0o700 })
  const tmp = path.join(sessionDir(s.id), "session.json.tmp")
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, path.join(sessionDir(s.id), "session.json"))
}

function removeSessionDir(id: string): void {
  try { fs.rmSync(sessionDir(id), { recursive: true, force: true }) } catch { /* غائب */ }
}

export function openSessions(): ScanSession[] {
  try {
    return fs.readdirSync(SCANS_ROOT)
      .map((d) => { try { return readSession(d) } catch { return null } })
      .filter((s): s is ScanSession => !!s)
      .sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

// ---------- الأفعال ----------

export async function openScanSession(body: { title?: unknown }) {
  const open = openSessions()
  if (open.length >= SCAN_MAX_OPEN_SESSIONS) {
    await appendAudit("scan.denied", false, "local", { reason: "too-many-sessions" })
    return { ok: false, error: "too-many-sessions" as const }
  }
  const now = Date.now()
  const s: ScanSession = {
    id: newSessionId(),
    title: sanitizeScanTitle(typeof body.title === "string" ? body.title : ""),
    status: "open",
    pages: [],
    createdAt: now,
  }
  writeSession(s)
  await appendAudit("scan.session.open", true, "local", { id: s.id.slice(0, 24), title: s.title.slice(0, 40) })
  return { ok: true as const, session: s }
}

export function getScanSession(id: string) {
  const s = readSession(id)
  if (!s) return { ok: false as const, error: "not-found" as const }
  return { ok: true as const, session: publicSession(s) }
}

function publicSession(s: ScanSession) {
  return { id: s.id, title: s.title, status: s.status, createdAt: s.createdAt, sealedFile: s.sealedFile ?? null, pages: s.pages.map((p) => ({ n: p.n, name: p.name, size: p.size, rotate: p.rotate, at: p.at })) }
}

/** دفع صفحة JPEG (multipart من الوكيل/الواجهة) — فحص السحر والسقف حرفيًا */
export async function addScanPage(id: string, bytes: Buffer, rateKey = "page") {
  const s = readSession(id)
  if (!s) return { ok: false, error: "not-found" as const }
  if (s.pages.length >= SCAN_MAX_PAGES) {
    await appendAudit("scan.denied", false, "local", { reason: "too-many-pages", id: id.slice(0, 24) })
    return { ok: false, error: "too-many-pages" as const }
  }
  if (!pageLimiter.hit(rateKey, Date.now())) {
    await appendAudit("scan.denied", false, "local", { reason: "rate-limited", id: id.slice(0, 24) })
    return { ok: false, error: "rate-limited" as const }
  }
  if (!isJpegBytes(bytes)) {
    await appendAudit("scan.denied", false, "local", { reason: "not-jpeg", id: id.slice(0, 24) })
    return { ok: false, error: "not-jpeg" as const }
  }
  if (bytes.length > SCAN_PAGE_MAX_BYTES) {
    await appendAudit("scan.denied", false, "local", { reason: "page-too-large", id: id.slice(0, 24) })
    return { ok: false, error: "page-too-large" as const }
  }
  const dims = jpegDimensions(bytes)
  if (!dims) {
    await appendAudit("scan.denied", false, "local", { reason: "bad-dimensions", id: id.slice(0, 24) })
    return { ok: false, error: "bad-dimensions" as const }
  }
  const n = (s.pages.reduce((m, p) => Math.max(m, p.n), 0)) + 1
  const name = `p-${String(n).padStart(3, "0")}.jpg`
  fs.mkdirSync(sessionDir(id), { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(sessionDir(id), name), bytes, { mode: 0o600 })
  const next: ScanSession = { ...s, pages: [...s.pages, { n, name, size: bytes.length, rotate: 0, at: Date.now() }] }
  writeSession(next)
  await appendAudit("scan.page.add", true, "local", { id: id.slice(0, 24), page: n, bytes: bytes.length, w: dims.w, h: dims.h })
  return { ok: true as const, page: { n, name, size: bytes.length, rotate: 0 as ScanRotation, at: next.pages[next.pages.length - 1].at } }
}

export async function actScanPage(id: string, action: "rotate" | "move" | "remove", args: Record<string, unknown>) {
  const s = readSession(id)
  if (!s) return { ok: false, error: "not-found" as const }
  let r: { ok: true; session: ScanSession } | { ok: false; error: string }
  if (action === "rotate") r = rotatePage(s, Number(args.n), Number(args.deg))
  else if (action === "move") r = movePage(s, Number(args.from), Number(args.to))
  else {
    r = removePage(s, Number(args.n))
    if (r.ok) {
      const dead = s.pages.find((p) => p.n === Number(args.n))
      if (dead) { try { fs.rmSync(path.join(sessionDir(id), dead.name), { force: true }) } catch { /* غائب */ } }
    }
  }
  if (!r.ok) {
    await appendAudit("scan.denied", false, "local", { reason: r.error.slice(0, 24), id: id.slice(0, 24), via: action })
    return { ok: false, error: r.error }
  }
  writeSession(r.session)
  await appendAudit(action === "rotate" ? "scan.page.rotate" : action === "move" ? "scan.page.move" : "scan.page.remove", true, "local", { id: id.slice(0, 24), args: { n: Number(args.n), deg: Number(args.deg), from: Number(args.from), to: Number(args.to) } })
  return { ok: true as const, session: publicSession(r.session) }
}

export async function cancelScanSession(id: string) {
  const s = readSession(id)
  if (!s) return { ok: false, error: "not-found" as const }
  removeSessionDir(id)
  await appendAudit("scan.cancel", true, "local", { id: id.slice(0, 24), pages: s.pages.length })
  return { ok: true as const }
}

/** الختم: بناء PDF من الصفحات بالترتيب وكتابته في مجلد الكمبيوتر الافتراضي */
export async function sealScanSession(id: string, targetFolder?: string) {
  const s = readSession(id)
  if (!s) return { ok: false, error: "not-found" as const }
  if (s.pages.length === 0) {
    await appendAudit("scan.denied", false, "local", { reason: "no-pages", id: id.slice(0, 24) })
    return { ok: false, error: "no-pages" as const }
  }
  const items: import("./scan-pdf").ScanPdfItem[] = []
  for (const p of [...s.pages].sort((a, b) => a.n - b.n)) {
    try {
      const bytes = fs.readFileSync(path.join(sessionDir(id), p.name))
      const d = jpegDimensions(bytes)
      if (!d) {
        await appendAudit("scan.denied", false, "local", { reason: "bad-dimensions", id: id.slice(0, 24), page: p.n })
        return { ok: false, error: "bad-dimensions" as const }
      }
      items.push({ bytes, rotate: p.rotate, w: d.w, h: d.h })
    } catch {
      await appendAudit("scan.denied", false, "local", { reason: "page-file-missing", id: id.slice(0, 24), page: p.n })
      return { ok: false, error: "page-file-missing" as const }
    }
  }
  const built = buildScanPdf(items)
  if (!built.ok) {
    await appendAudit("scan.denied", false, "local", { reason: built.error, id: id.slice(0, 24) })
    return { ok: false, error: built.error }
  }
  // المجلد الهدف: مسار افتراضي آمن (خارج الجذر مرفوض — resolveSafe)
  let dirAbs: string
  try { dirAbs = resolveSafe("pc-office", targetFolder && typeof targetFolder === "string" ? targetFolder : DEFAULT_TARGET) } catch {
    await appendAudit("scan.denied", false, "local", { reason: "bad-target", id: id.slice(0, 24) })
    return { ok: false, error: "bad-target" as const }
  }
  fs.mkdirSync(dirAbs, { recursive: true })
  let file = scanPdfFileName(s.title, Date.now())
  const abs = path.join(dirAbs, file)
  fs.writeFileSync(abs, built.pdf, { mode: 0o600 })
  const sealed: ScanSession = { ...s, status: "sealed", sealedFile: file }
  removeSessionDir(id)
  await appendAudit("scan.seal", true, "local", {
    id: id.slice(0, 24), pages: items.length, bytes: built.pdf.length, file: file.slice(0, 60),
  })
  return { ok: true as const, file, bytes: built.pdf.length, pages: items.length, target: targetFolder ?? DEFAULT_TARGET }
}
