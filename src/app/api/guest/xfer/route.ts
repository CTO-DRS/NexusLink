// عقد §51 — المشاركة الضيوفة المباشرة — مسار النقل العام (بلا جلسة ولا حساب)
// ============================================================
// GET  ?g=<token>            → صفحة الاستقبال (send: قائمة تنزيل / drop: نموذج رفع)
// GET  ?g=<token>&d=<idx>    → تنزيل ملف من قائمة «الإرسال» (بثّ مباشر بلا وسيط)
// POST ?g=<token> (multipart)→ رفع ملف إلى صندوق الاستقبال (وضع drop)
//
// الأبواب (كلها حية بلا إعادة تشغيل — مصدر الحقيقة ملف الحالة):
//  - رمز خاطئ → 403 + عدّاد محاولات لكل عنوان؛ 8 محاولات → قفل 60 ثانية (429).
//  - منتهي/محذوف → 410/404 بصفحة صادقة ثنائية اللغة.
//  - معدل: 30 طلبًا/دقيقة لكل عنوان (نافذة منزلقة).
//  - حجم ملف الضيف ≤ 200MB — تجاوز → 413.
// F6: السجل يحمل الأسماء والأحجام حصرًا — لا محتوى ولا عناوين خام.
import { NextResponse } from "next/server"
import fs from "node:fs"
import path from "node:path"
import { DATA_ROOT } from "@/lib/nexus/fs-server"
import { appendAudit } from "@/lib/enterprise-audit"
import {
  isGuestActive, guestTokenEqual, sanitizeGuestName, mimeFromName,
  guestPageHtml, createRateLimiter, createFailGuard,
  GUEST_RATE_PER_MIN, GUEST_FAIL_LOCK_AFTER, GUEST_FAIL_LOCK_MS, GUEST_MAX_FILE_BYTES,
  type GuestState,
} from "@/lib/nexus/guest-core"

export const dynamic = "force-dynamic"

const GUEST_FILE =
  process.env.NEXUSLINK_GUEST_FILE || path.join(process.cwd(), ".zstate", "guest-share.json")
const INBOX_DIR = path.join(DATA_ROOT, "guest-inbox")

const rate = createRateLimiter({ max: GUEST_RATE_PER_MIN, windowMs: 60_000 })
const fails = createFailGuard({ after: GUEST_FAIL_LOCK_AFTER, lockMs: GUEST_FAIL_LOCK_MS })

function readGuestState(): GuestState | null {
  try {
    const j = JSON.parse(fs.readFileSync(GUEST_FILE, "utf8"))
    if (j && typeof j.token === "string" && (j.mode === "send" || j.mode === "drop")) {
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

function clientIp(req: Request): string {
  // البوابة تستبدل الترويسة دائمًا بعنوان العميل الحقيقي — بلا بوابة فهو محلي
  return req.headers.get("x-gw-client-ip") ?? "local"
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const ip = clientIp(req)
  if (!rate.hit(`page:${ip}`, Date.now())) {
    return NextResponse.json({ ok: false, error: "rate-limited" }, { status: 429 })
  }
  const given = url.searchParams.get("g") ?? ""
  const s = readGuestState()
  const actionPath = `/api/guest/xfer?g=${encodeURIComponent(given)}`

  if (!s) {
    return htmlResponse(guestPageHtml({ mode: "send", lang: "ar", files: [], actionPath, label: "", expired: true }), 404)
  }
  if (typeof s.expiresAt === "number" && s.expiresAt <= Date.now()) {
    return htmlResponse(guestPageHtml({ mode: s.mode, lang: "ar", files: [], actionPath, label: "", expired: true }), 410)
  }
  if (fails.locked(ip, Date.now())) {
    return NextResponse.json({ ok: false, error: "locked" }, { status: 429 })
  }
  if (!guestTokenEqual(given, s.token)) {
    const f = fails.fail(ip, Date.now())
    return htmlResponse(guestPageHtml({ mode: "send", lang: "ar", files: [], actionPath, label: "", expired: true }), 403)
  }
  fails.clear(ip)

  // تنزيل ملف من قائمة «الإرسال»
  const dIdx = url.searchParams.get("d")
  if (dIdx !== null) {
    const idx = Number(dIdx)
    const f = s.files[idx]
    if (!f || !Number.isInteger(idx) || idx < 0) {
      return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 })
    }
    try {
      const st = fs.statSync(f.absPath)
      const stream = fs.createReadStream(f.absPath)
      void appendAudit("guest.download", true, "remote", { name: f.name, size: st.size })
      return new Response(stream as unknown as ReadableStream, {
        headers: {
          "Content-Type": mimeFromName(f.name),
          "Content-Length": String(st.size),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          "Cache-Control": "no-store",
        },
      })
    } catch {
      return NextResponse.json({ ok: false, error: "file-missing" }, { status: 404 })
    }
  }

  const lang = url.searchParams.get("lang") === "en" ? "en" : "ar"
  void appendAudit("guest.page", true, "remote", { mode: s.mode })
  return htmlResponse(
    guestPageHtml({
      mode: s.mode, lang, files: s.files.map((f) => ({ name: f.name, size: f.size })),
      actionPath, label: s.label,
    }),
  )
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const ip = clientIp(req)
  if (!rate.hit(`up:${ip}`, Date.now())) {
    return NextResponse.json({ ok: false, error: "rate-limited" }, { status: 429 })
  }
  const given = url.searchParams.get("g") ?? ""
  const s = readGuestState()
  if (!s) return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 })
  if (typeof s.expiresAt === "number" && s.expiresAt <= Date.now()) {
    return NextResponse.json({ ok: false, error: "expired" }, { status: 410 })
  }
  if (fails.locked(ip, Date.now())) {
    return NextResponse.json({ ok: false, error: "locked" }, { status: 429 })
  }
  if (s.mode !== "drop") {
    return NextResponse.json({ ok: false, error: "send-mode-readonly" }, { status: 405 })
  }
  if (!guestTokenEqual(given, s.token)) {
    fails.fail(ip, Date.now())
    return NextResponse.json({ ok: false, error: "invalid-token" }, { status: 403 })
  }
  fails.clear(ip)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid-form" }, { status: 400 })
  }
  const entries = [...form.getAll("file")].filter((v): v is File => v instanceof File)
  if (entries.length === 0) {
    return NextResponse.json({ ok: false, error: "no-file" }, { status: 400 })
  }
  fs.mkdirSync(INBOX_DIR, { recursive: true })
  const saved: Array<{ name: string; size: number }> = []
  for (const file of entries) {
    if (file.size > GUEST_MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, error: "too-large", name: sanitizeGuestName(file.name) }, { status: 413 })
    }
    const clean = sanitizeGuestName(file.name)
    const target = path.join(INBOX_DIR, `${Date.now()}-${clean}`)
    const buf = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(target, buf)
    saved.push({ name: path.basename(target), size: buf.length })
  }
  void appendAudit("guest.upload", true, "remote", { n: saved.length, bytes: saved.reduce((a, b) => a + b.size, 0) })
  return NextResponse.json({ ok: true, saved })
}
