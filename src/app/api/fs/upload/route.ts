// /api/fs/upload — الرفع المجزّأ القابل للاستئناف (هاتف وكيل حقيقي → سيرفر)
// ============================================================
// العقد §8.2 حرفيًا (مصدر الحقيقة: docs/protocol-contract.md):
// · POST {op:"init"}  → {ok, uploadId, received, jobId, chunkSize}
//   taskId معرّف مستقر من الهاتف: إعادة init بعد أي قتل تعيد نفس الجلسة
//   (uploadId اشتقاقي حتمي من taskId) وreceived = حجم .nexuspart الموجود.
// · PUT  ?upload=<id>&offset=<n> — جسم = بايتات خام (2–8MB)
//   → 200 {ok, received} · 409 {ok:false, drift:true, received} ·
//     409 {ok:false, paused:true, received} (موقوفة من الكمبيوتر)
// · POST {op:"complete"} → rename .nexuspart → الاسم النهائي الفريد → {ok, job}
// · POST {op:"pause"|"resume"|"abort"} — abort يحذف الجزئي ويقفل المهمة
// · GET  ?upload=<id> → {ok, received, size, name, status, jobId}
// P1 — v2 (§8.6): init {proto:2} → {v:2, pieceSize, pieces, have, hash, maxInflight}
// · PUT ?upload=<id>&piece=<i> + x-nexus-sha256 → 200 {ok, piece, received, dup} ·
//   422 hash_mismatch · 400 bad_index/bad_length · 409 paused
// · complete {root} → root = sha256(concatenated piece digests in order) — 422 on mismatch
// v1 unchanged for old phones; the protocol follows the response's "v" field and not the request.
// البيانات لا تمر عبر socket.io — هذه هي قناة البايتات (نمط §8).
//
// تكليف 48 (FA-20 — حرس العقود الحي): هذا المسار فُقد من الشجرة في commit
// d705e49 (2026-10-14 — حادثة تنظيف بلا أثر في worklog) وظل مفقودًا شهرًا
// كاملًا رغم توثيقه في العقد §8.2 واستعماله بوكيل الهاتف (transfer_api.dart)
// وبوابة agent-tx-e2e — لأن فحص desktop-e2e للعقد نصي حصرًا والبوابة الثقيلة
// خارج الأساس. أُعيد بناؤه حرفيًا من d705e49^ مع حمايتين إضافتين معلنتين:
// · سقف جزء PUT ‏16MB (العقد يقول 2–8MB — السقف رحيم ضد الذاكرة) → 400
// · قصّ الجلسات الميتة (خمول > 6س) عند كل init — خريطة الجلسات على globalThis
//   لم تكن تُقص أبدًا (تسريب بطيء بإعادة init بمهام لا نهائية)
// قناة جهاز (نمط FA-16 الحدود الصادقة): تُخدَم من الهاتف المقترن عبر البوابة
// (حاجز الاقتران على 81) — لا pcOnly عليها؛ الكتابة محصورة بجذر الجهاز نفسه
// عبر resolveSafe/ensureDeviceRoot وsanitizeName (§8.1/§8.2).
import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { createHash } from "crypto"
import { ensureDeviceRoot, resolveSafe } from "@/lib/nexus/fs-server"
import { jobs } from "@/lib/nexus/transfer-engine"
import {
  uploadSessions, getSession, partialSize, updateJobProgress, abortSession, sanitizeName,
  type UploadSession,
} from "@/lib/nexus/upload-sessions"
import type { TransferJob } from "@/lib/nexus/types"
import { publicErrorMessage } from "@/lib/nexus/safe-error"
import {
  openV2, writePiece, receivedBytes, haveList, isComplete, rootHash, dropV2, clampPiece,
  V2_HASH, V2_MAX_INFLIGHT,
} from "@/lib/nexus/upload-v2"

export const dynamic = "force-dynamic"

const DEFAULT_CHUNK = 4 * 1024 * 1024
// تكليف 48: سقف حدة الجزء الواحد (العقد §8.2: 2–8MB — السقف ضعف الحد الأعلى)
const MAX_CHUNK_BYTES = 16 * 1024 * 1024
// تكليف 48: عمر الخمول الذي يُقص عنده الجزئي والجلسة (استئناف عملي حتى 6 ساعات)
const IDLE_GC_MS = 6 * 60 * 60 * 1000

function toRelCwd(abs: string): string {
  return abs.replace(process.cwd() + path.sep, "").split(path.sep).join("/")
}

/** uploadId حتمي من taskId — إعادة init بعد أي قتل تعيد نفس الجلسة (§8.2). */
function stableUploadId(taskId: string): string {
  const h = createHash("sha256").update(`nexus-upload:${taskId}`).digest("hex")
  return `up_${h.slice(0, 16)}`
}

function newUploadId(): string {
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function makeJob(
  uploadId: string,
  s: Omit<UploadSession, "id" | "jobId" | "createdAt" | "lastWriteAt">,
  received: number,
): TransferJob {
  return {
    id: `txu_${uploadId.slice(3)}_${Math.random().toString(36).slice(2, 6)}`,
    deviceId: s.deviceId,
    deviceName: s.deviceId,
    direction: "out", // من منظور الهاتف: خارج هاتفه → نحو الكمبيوتر
    fileName: s.name,
    srcPath: s.localPath || s.name,
    destPath: toRelCwd(path.join(resolveSafe(s.deviceId, s.dirV), s.name)),
    totalBytes: s.size,
    transferred: received,
    status: "active",
    speedBps: 0,
    chunksTotal: Math.max(1, Math.ceil(s.size / s.chunkSize)),
    chunksDone: Math.floor(received / s.chunkSize),
    chunkSize: s.chunkSize,
    startedAt: Date.now(),
    agent: true,
    uploadId,
    mime: s.mime,
  }
}

/** تكليف 48: قصّ الجلسات الخاملة — يُستدعى كسولًا من init بلا مؤقّتات. */
function sweepIdleSessions() {
  const now = Date.now()
  for (const [id, s] of uploadSessions()) {
    if (now - s.lastWriteAt > IDLE_GC_MS) void abortSession(id, "انتهت مهلة الجلسة (خمول > 6س)")
  }
}

function v2Shape(s: UploadSession) {
  const st = s.v2!
  return {
    v: 2,
    pieceSize: st.pieceSize,
    pieces: st.pieces,
    have: haveList(st),
    hash: V2_HASH,
    maxInflight: V2_MAX_INFLIGHT,
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("upload") ?? ""
  const s = getSession(id)
  if (!s) return NextResponse.json({ ok: false, error: "جلسة غير معروفة" }, { status: 404 })
  const received = s.v2 ? receivedBytes(s.v2, s.size) : await partialSize(s)
  const job = jobs().get(s.jobId)
  return NextResponse.json({
    ok: true,
    uploadId: s.id,
    received,
    size: s.size,
    name: s.name,
    status: job?.status ?? "unknown",
    jobId: s.jobId,
    ...(s.v2 ? v2Shape(s) : { v: 1 }),
  })
}

export async function PUT(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("upload") ?? ""
  const s = getSession(id)
  if (!s) return NextResponse.json({ ok: false, error: "جلسة غير معروفة" }, { status: 404 })
  const job = jobs().get(s.jobId)

  // ---------- v2: index-addressed piece ----------
  if (s.v2) {
    const st = s.v2
    const pieceRaw = req.nextUrl.searchParams.get("piece")
    if (pieceRaw === null) {
      return NextResponse.json(
        { ok: false, code: "v2_session", error: "جلسة v2 تتطلب ?piece=" }, { status: 400 },
      )
    }
    if (job && job.status === "paused") {
      return NextResponse.json(
        { ok: false, paused: true, received: receivedBytes(st, s.size), have: haveList(st) }, { status: 409 },
      )
    }
    const declaredV2 = Number(req.headers.get("content-length") ?? "0")
    if (Number.isFinite(declaredV2) && declaredV2 > st.pieceSize) {
      return NextResponse.json({ ok: false, code: "bad_length", error: "القطعة أكبر من pieceSize" }, { status: 400 })
    }
    const body = Buffer.from(await req.arrayBuffer())
    let r
    try {
      r = await writePiece(st, s.partialAbs, s.size, Number(pieceRaw), body, req.headers.get("x-nexus-sha256"))
    } catch (e) {
      return NextResponse.json({ ok: false, error: publicErrorMessage(e, "فشل كتابة القطعة") }, { status: 500 })
    }
    if (!r.ok) return NextResponse.json({ ok: false, code: r.code, error: r.error }, { status: r.status })
    const rec = receivedBytes(st, s.size)
    await updateJobProgress(s, rec)
    return NextResponse.json({ ok: true, piece: Number(pieceRaw), received: rec, dup: r.dup })
  }
  if (req.nextUrl.searchParams.get("piece") !== null) {
    return NextResponse.json(
      { ok: false, code: "v1_session", error: "جلسة v1 — استعمل ?offset=" }, { status: 400 },
    )
  }
  const received = await partialSize(s)

  // موقوفة من الكمبيوتر (§8.2: 409 paused) — حالة المهمة هي المصدر
  if (job && job.status === "paused") {
    return NextResponse.json({ ok: false, paused: true, received }, { status: 409 })
  }
  // انزياح إزاحة (§8.2: 409 drift) — أعِد الضبط من received
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0")
  if (!Number.isFinite(offset) || offset !== received) {
    return NextResponse.json({ ok: false, drift: true, received }, { status: 409 })
  }

  // تكليف 48: سقف الجزء الواحد — جسم أكبر من 16MB يُرفض قبل أي كتابة
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_CHUNK_BYTES) {
    return NextResponse.json(
      { ok: false, error: "الجزء أكبر من السقف (16MB — العقد §8.2: 2–8MB)" },
      { status: 400 },
    )
  }
  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length > MAX_CHUNK_BYTES) {
    return NextResponse.json(
      { ok: false, error: "الجزء أكبر من السقف (16MB — العقد §8.2: 2–8MB)" },
      { status: 400 },
    )
  }

  // كتابة البايتات خامًا على الجزئي (مصدر الحقيقة القرص)
  if (buf.length > 0) {
    try {
      await fs.appendFile(s.partialAbs, buf)
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: publicErrorMessage(e, "فشل كتابة الجزئي") },
        { status: 500 },
      )
    }
  }
  const now = await partialSize(s)
  await updateJobProgress(s, now)
  return NextResponse.json({ ok: true, received: now })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const op = String(body.op ?? "")

  // ---------- init ----------
  if (op === "init") {
    sweepIdleSessions()
    const deviceId = String(body.deviceId ?? "")
    if (!deviceId.trim()) {
      return NextResponse.json({ ok: false, error: "deviceId مطلوب" }, { status: 400 })
    }
    let dirAbs: string
    try {
      ensureDeviceRoot(deviceId)
      dirAbs = resolveSafe(deviceId, String(body.path ?? "/Downloads"))
      await fs.mkdir(dirAbs, { recursive: true })
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: publicErrorMessage(e, "مسار غير صالح") },
        { status: 400 },
      )
    }
    const name = sanitizeName(String(body.name ?? ""))
    const size = Math.max(0, Number(body.size ?? 0) || 0)
    const wantV2 = Number(body.proto) === 2
    const chunkSize = wantV2
      ? clampPiece(body.pieceSize ?? body.chunkSize)
      : Math.min(
          8 * 1024 * 1024,
          Math.max(2 * 1024 * 1024, Number(body.chunkSize ?? DEFAULT_CHUNK) || DEFAULT_CHUNK),
        )
    const sessionCore = {
      deviceId,
      dirV: String(body.path ?? "/Downloads"),
      name,
      size,
      mime: typeof body.mime === "string" ? body.mime : undefined,
      localPath: typeof body.localPath === "string" ? body.localPath : undefined,
      chunkSize,
      partialAbs: path.join(dirAbs, `${name}.nexuspart`),
    }
    const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : null
    const uploadId = taskId ? stableUploadId(taskId) : newUploadId()

    // جلسة قائمة؟ (إعادة init بنفس taskId بعد أي قتل — استئناف من القرص)
    const existing = getSession(uploadId)
    if (existing) {
      existing.lastWriteAt = Date.now()
      const received = await partialSize(existing)
      // حافظ على المهمة حية (قد تكون أُسقطت بعد إعادة تشغيل السيرفر)
      if (!jobs().get(existing.jobId)) {
        const job = makeJob(existing.id, existing, received)
        job.id = existing.jobId
        jobs().set(job.id, job)
      }
      return NextResponse.json({
        ok: true,
        uploadId: existing.id,
        received: existing.v2 ? receivedBytes(existing.v2, existing.size) : received,
        jobId: existing.jobId,
        chunkSize: existing.chunkSize,
        ...(existing.v2 ? v2Shape(existing) : { v: 1 }),
      })
    }

    let v2State
    if (wantV2) {
      try {
        v2State = await openV2(sessionCore.partialAbs, size, chunkSize)
      } catch (e) {
        return NextResponse.json(
          { ok: false, error: publicErrorMessage(e, "تعذر تجهيز الملف") }, { status: 500 },
        )
      }
    }
    const received = v2State
      ? receivedBytes(v2State, size)
      : await fs
          .stat(/*turbopackIgnore: true*/ sessionCore.partialAbs)
          .then((st) => st.size)
          .catch(() => 0)
    const job = makeJob(uploadId, sessionCore, received)
    jobs().set(job.id, job)
    const s: UploadSession = {
      ...sessionCore,
      id: uploadId,
      jobId: job.id,
      createdAt: Date.now(),
      lastWriteAt: Date.now(),
      ...(v2State ? { v2: v2State } : {}),
    }
    uploadSessions().set(uploadId, s)
    return NextResponse.json({
      ok: true,
      uploadId,
      received,
      jobId: job.id,
      chunkSize,
      ...(s.v2 ? v2Shape(s) : { v: 1 }),
    })
  }

  // ---------- complete ----------
  if (op === "complete") {
    const id = String(body.uploadId ?? "")
    const s = getSession(id)
    if (!s) return NextResponse.json({ ok: false, error: "جلسة غير معروفة" }, { status: 404 })
    if (s.v2) {
      if (!isComplete(s.v2)) {
        const missing = s.v2.pieces - haveList(s.v2).length
        return NextResponse.json(
          { ok: false, code: "incomplete", error: `قطع ناقصة: ${missing}`, have: haveList(s.v2) }, { status: 400 },
        )
      }
      const root = typeof body.root === "string" ? body.root.toLowerCase() : ""
      if (root !== rootHash(s.v2)) {
        return NextResponse.json(
          { ok: false, code: "root_mismatch", error: "هاش الملف الكامل لا يطابق" }, { status: 422 },
        )
      }
      await s.v2.saving
    }
    const received = s.v2 ? s.size : await partialSize(s)
    if (s.size > 0 && received < s.size) {
      return NextResponse.json(
        { ok: false, error: `الجلسة غير مكتملة: ${received}/${s.size}` },
        { status: 400 },
      )
    }
    // rename .nexuspart → الاسم النهائي الفريد (§8.2)
    let dirAbs: string
    try {
      dirAbs = resolveSafe(s.deviceId, s.dirV)
      await fs.mkdir(dirAbs, { recursive: true })
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: publicErrorMessage(e, "مسار غير صالح") },
        { status: 400 },
      )
    }
    let finalName = s.name
    const finalAbs = path.join(dirAbs, finalName)
    let candidate = finalAbs
    let i = 1
    while (i < 200) {
      try {
        await fs.stat(candidate)
        const dot = s.name.lastIndexOf(".")
        const stem = dot > 0 ? s.name.slice(0, dot) : s.name
        const ext = dot > 0 ? s.name.slice(dot) : ""
        finalName = `${stem} (${i++})${ext}`
        candidate = path.join(dirAbs, finalName)
      } catch {
        break
      }
    }
    try {
      await fs.rename(s.partialAbs, candidate)
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: publicErrorMessage(e, "فشل إتمام الرفع") },
        { status: 500 },
      )
    }
    uploadSessions().delete(id)
    if (s.v2) await dropV2(s.v2, s.partialAbs)
    const job = jobs().get(s.jobId)
    if (job) {
      job.status = "done"
      job.transferred = s.size
      job.chunksDone = job.chunksTotal
      job.destPath = toRelCwd(candidate)
      job.speedBps = 0
    }
    return NextResponse.json({
      ok: true,
      job: job ?? {
        id: s.jobId,
        status: "done",
        destPath: toRelCwd(candidate),
        totalBytes: s.size,
        transferred: s.size,
      },
    })
  }

  // ---------- pause / resume / abort ----------
  if (op === "pause" || op === "resume" || op === "abort") {
    const id = String(body.uploadId ?? "")
    const s = getSession(id)
    if (!s) return NextResponse.json({ ok: false, error: "جلسة غير معروفة" }, { status: 404 })
    const job = jobs().get(s.jobId)
    if (op === "pause") {
      if (job) job.status = "paused"
      return NextResponse.json({ ok: true })
    }
    if (op === "resume") {
      if (job) job.status = "active"
      return NextResponse.json({ ok: true })
    }
    await abortSession(id, "أُجهضت من الهاتف")
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: "op غير معروف" }, { status: 400 })
}
