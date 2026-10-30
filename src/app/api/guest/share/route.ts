// عقد §51 — المشاركة الضيوفة المباشرة — مسار الإدارة (نمط §37 حرفيًا)
// ============================================================
// GET           → حالة فقط: { enabled, mode, fingerprint, expiresAt, files, inbox }
//                 الرمز الخام لا يعود أبدًا في GET (يُسلَّم مرة عند enable/rotate).
// GET ?list=inbox → صندوق الاستقبال (ما أرسل إليك الضيوف).
// POST { action: "enable" | "rotate" | "disable" | "inbox-save" | "inbox-clear" }
//  - enable/rotate: { mode, ttlMinutes, paths?, deviceId? } — مسارات "إرسال"
//    تُحل من نظام الملفات الافتراضي عبر resolveSafe وتُخزَّن بحجمها.
//  - inbox-save: { name } — نسخ مستلم من الضيف إلى تنزيلات الكمبيوتر.
// حرس loopback للإدارة: الإدارة بيد الجهاز حصرًا (نمط §37 — ترويسة
// x-gw-client-ip التي تستبدلها البوابة دائمًا).
// صفر مخطط وصفر db: مصدر الحقيقة ملف JSON خارج المخطط
// (.zstate/guest-share.json أو NEXUSLINK_GUEST_FILE) — حذفه = تعطيل فوري.
import { NextResponse } from "next/server"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DATA_ROOT, resolveSafe } from "@/lib/nexus/fs-server"
import { appendAudit } from "@/lib/enterprise-audit"
import {
  validateGuestConfig, guestFingerprint, isGuestActive,
  sanitizeGuestName, GUEST_MAX_TOTAL_BYTES, type GuestState,
} from "@/lib/nexus/guest-core"

export const dynamic = "force-dynamic"

const GUEST_FILE =
  process.env.NEXUSLINK_GUEST_FILE || path.join(process.cwd(), ".zstate", "guest-share.json")
const INBOX_DIR = path.join(DATA_ROOT, "guest-inbox")

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

function readGuestState(): GuestState | null {
  try {
    const j = JSON.parse(fs.readFileSync(GUEST_FILE, "utf8"))
    if (j && typeof j.token === "string" && j.token.length >= 16 && (j.mode === "send" || j.mode === "drop")) {
      return {
        token: j.token, fingerprint: String(j.fingerprint ?? ""), mode: j.mode,
        expiresAt: Number(j.expiresAt ?? 0), label: String(j.label ?? ""),
        files: Array.isArray(j.files) ? j.files : [], createdAt: Number(j.createdAt ?? 0),
      }
    }
    return null
  } catch {
    return null
  }
}

function writeGuestState(s: Omit<GuestState, "fingerprint">): string {
  const fingerprint = guestFingerprint(s.token)
  fs.mkdirSync(path.dirname(GUEST_FILE), { recursive: true, mode: 0o700 })
  const tmp = `${GUEST_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...s, fingerprint }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, GUEST_FILE)
  try { fs.chmodSync(GUEST_FILE, 0o600) } catch { /* أنظمة بلا أذونات بوزيكس */ }
  return fingerprint
}

function inboxList(): Array<{ name: string; size: number; at: number }> {
  try {
    return fs
      .readdirSync(INBOX_DIR)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const st = fs.statSync(path.join(INBOX_DIR, f))
        return { name: f, size: st.size, at: Math.floor(st.mtimeMs) }
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 50)
  } catch {
    return []
  }
}

function publicView(s: GuestState | null) {
  if (!s) return { enabled: false }
  const now = Date.now()
  return {
    enabled: isGuestActive(s, now),
    expired: !!s.expiresAt && s.expiresAt <= now,
    mode: s.mode,
    fingerprint: s.fingerprint,
    expiresAt: s.expiresAt,
    label: s.label,
    files: s.files.map((f) => ({ name: f.name, size: f.size })),
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const s = readGuestState()
  if (url.searchParams.get("list") === "inbox") {
    return NextResponse.json({ ok: true, inbox: inboxList() })
  }
  return NextResponse.json({ ok: true, ...publicView(s), inbox: inboxList() })
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")

  // حرس loopback للإدارة (نمط §37): الإدارة بيد الجهاز حصرًا
  const fwd = req.headers.get("x-gw-client-ip")
  if (fwd && !isLoopbackIp(fwd)) {
    await appendAudit("guest.admin.denied", false, "remote", { action: action.slice(0, 24), reason: "loopback" })
    return NextResponse.json(
      { ok: false, error: "guest-admin-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  if (action === "disable") {
    const last = readGuestState()
    try { fs.rmSync(GUEST_FILE, { force: true }) } catch { /* غائب أصلًا */ }
    await appendAudit("guest.disable", true, "local", { fp: last?.fingerprint ?? null })
    return NextResponse.json({ ok: true, enabled: false })
  }

  if (action === "enable" || action === "rotate") {
    const mode = body.mode === "drop" ? "drop" : body.mode === "send" ? "send" : null
    const ttlMinutes = Number(body.ttlMinutes ?? 30)
    const paths = Array.isArray(body.paths) ? body.paths.map(String) : []
    const deviceId = typeof body.deviceId === "string" && body.deviceId ? body.deviceId : "pc-office"
    const label = typeof body.label === "string" ? body.label.slice(0, 80) : ""
    const v = validateGuestConfig({ mode: mode ?? "", ttlMinutes, fileCount: paths.length })
    if (!mode || !v.ok) {
      await appendAudit("guest.admin.denied", false, "local", { action, reason: v.error ?? "invalid-mode" })
      return NextResponse.json({ ok: false, error: v.error ?? "invalid-mode" }, { status: 400 })
    }
    if (action === "enable" && readGuestState()) {
      await appendAudit("guest.admin.denied", false, "local", { action, reason: "conflict" })
      return NextResponse.json({ ok: false, error: "already-enabled", hint: "rotate" }, { status: 409 })
    }
    // حل مسارات «الإرسال» من نظام الملفات الافتراضي — خارجه مرفوض (resolveSafe)
    const files: GuestState["files"] = []
    let totalBytes = 0
    for (const p of paths) {
      try {
        const abs = resolveSafe(deviceId, p)
        const st = fs.statSync(abs)
        if (!st.isFile()) continue
        totalBytes += st.size
        if (totalBytes > GUEST_MAX_TOTAL_BYTES) {
          return NextResponse.json({ ok: false, error: "too-large-total" }, { status: 413 })
        }
        files.push({ name: path.basename(abs), size: st.size, absPath: abs })
      } catch { /* مسار غائب — يُتجاهل بصدق */ }
    }
    const token = crypto.randomBytes(24).toString("base64url")
    const expiresAt = Date.now() + ttlMinutes * 60_000
    const fingerprint = writeGuestState({ token, mode, expiresAt, label, files, createdAt: Date.now() })
    await appendAudit(action === "enable" ? "guest.enable" : "guest.rotate", true, "local", {
      fp: fingerprint, mode, ttlMinutes, files: files.length,
    })
    return NextResponse.json({
      ok: true, enabled: true, token, fingerprint, expiresAt, mode, files: files.map((f) => ({ name: f.name, size: f.size })), urlQuery: `?g=${token}`,
    })
  }

  if (action === "inbox-save") {
    const name = sanitizeGuestName(String(body.name ?? ""))
    const src = path.join(INBOX_DIR, name)
    try {
      const dstDir = resolveSafe("pc-office", "/Downloads")
      let target = path.join(dstDir, name)
      for (let i = 1; i < 50; i++) {
        if (!fs.existsSync(target)) break
        const dot = name.lastIndexOf(".")
        const stem = dot > 0 ? name.slice(0, dot) : name
        const ext = dot > 0 ? name.slice(dot) : ""
        target = path.join(dstDir, `${stem} (${i})${ext}`)
      }
      fs.copyFileSync(src, target)
      await appendAudit("guest.inbox.save", true, "local", { name })
      return NextResponse.json({ ok: true, name: path.basename(target) })
    } catch (e) {
      return NextResponse.json({ ok: false, error: "تعذر الحفظ: " + String(e).slice(0, 80) }, { status: 500 })
    }
  }

  if (action === "inbox-clear") {
    try {
      for (const f of inboxList()) fs.rmSync(path.join(INBOX_DIR, f.name), { force: true })
      await appendAudit("guest.inbox.clear", true, "local", {})
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ ok: false, error: "تعذر التفريغ" }, { status: 500 })
    }
  }

  await appendAudit("guest.admin.denied", false, "local", { action: action.slice(0, 24), reason: "unknown-action" })
  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
