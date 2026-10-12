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
// البيانات لا تمر عبر socket.io — هذه هي قناة البايتات (نمط §8).
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

export const dynamic = "force-dynamic"

const DEFAULT_CHUNK = 4 * 1024 * 1024

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

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("upload") ?? ""
  const s = getSession(id)
  if (!s) return NextResponse.json({ ok: false, error: "جلسة غير معروفة" }, { status: 404 })
  const received = await partialSize(s)
  const job = jobs().get(s.jobId)
  return NextResponse.json({
    ok: true,
    uploadId: s.id,
    received,
    size: s.size,
    name: s.name,
    status: job?.status ?? "unknown",
    jobId: s.jobId,
  })
}

export async function PUT(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("upload") ?? ""
  const s = getSession(id)
  if (!s) return NextResponse.json({ ok: false, error: "جلسة غير معروفة" }, { status: 404 })
  const job = jobs().get(s.jobId)
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

  // كتابة البايتات خامًا على الجزئي (مصدر الحقيقة القرص)
  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length > 0) {
    try {
      await fs.appendFile(s.partialAbs, buf)
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "فشل كتابة الجزئي" },
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
        { ok: false, error: e instanceof Error ? e.message : "مسار غير صالح" },
        { status: 400 },
      )
    }
    const name = sanitizeName(String(body.name ?? ""))
    const size = Math.max(0, Number(body.size ?? 0) || 0)
    const chunkSize = Math.min(
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
        received,
        jobId: existing.jobId,
        chunkSize: existing.chunkSize,
      })
    }

    const received = await fs
      .stat(sessionCore.partialAbs)
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
    }
    uploadSessions().set(uploadId, s)
    return NextResponse.json({
      ok: true,
      uploadId,
      received,
      jobId: job.id,
      chunkSize,
    })
  }

  // ---------- complete ----------
  if (op === "complete") {
    const id = String(body.uploadId ?? "")
    const s = getSession(id)
    if (!s) return NextResponse.json({ ok: false, error: "جلسة غير معروفة" }, { status: 404 })
    const received = await partialSize(s)
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
        { ok: false, error: e instanceof Error ? e.message : "مسار غير صالح" },
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
        { ok: false, error: e instanceof Error ? e.message : "فشل إتمام الرفع" },
        { status: 500 },
      )
    }
    uploadSessions().delete(id)
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
