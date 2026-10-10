// NexusLink — رفع ملفات من وكيل الجهاز (هاتف) إلى السيرفر — مجزّأ وقابل للاستئناف.
//
// العقد (مطابق لتطبيق Flutter — docs/protocol-contract.md §8):
//  · POST {op:"init", deviceId, path?, name, size, mime?, localPath?, chunkSize?, taskId?}
//      → {ok, uploadId, received, jobId} — received = حجم .nexuspart الموجود (استئناف)
//  · PUT  /api/fs/upload?upload=<id>&offset=<n>  جسم = بايتات خام
//      → {ok, received} | {ok:false, drift:true, received} | {ok:false, paused:true, received}
//  · POST {op:"complete", uploadId}   → {ok, job}  (إعادة تسمية .nexuspart → الاسم النهائي)
//  · POST {op:"pause"|"resume"|"abort", uploadId}
//  · GET  ?upload=<id> → {ok, received, size, name, status}
import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { resolveSafe, ensureDeviceRoot, mimeOf } from "@/lib/nexus/fs-server"
import { jobs } from "@/lib/nexus/transfer-engine"
import { store } from "@/lib/nexus/devices"
import {
  uploadSessions, getSession, partialSize, updateJobProgress,
  abortSession, sanitizeName, type UploadSession,
} from "@/lib/nexus/upload-sessions"
import type { TransferJob } from "@/lib/nexus/types"

export const dynamic = "force-dynamic"

const DEFAULT_CHUNK = 2 * 1024 * 1024 // 2MB افتراضي من الهاتف
const MAX_CHUNK = 8 * 1024 * 1024

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function deviceNameOf(id: string): string {
  return store().devices.find((d) => d.id === id)?.name ?? id
}

/** اسم نهائي فريد داخل مجلد الوجهة (نفس منطق transfer-engine). */
async function uniqueDest(dirAbs: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  let candidate = path.join(dirAbs, name)
  let i = 1
  for (;;) {
    try {
      await fs.stat(candidate)
      candidate = path.join(dirAbs, `${stem} (${i++})${ext}`)
    } catch {
      return candidate
    }
  }
}

function jobOf(s: UploadSession | null): TransferJob | null {
  return s ? jobs().get(s.jobId) ?? null : null
}

async function createSession(body: Record<string, unknown>): Promise<NextResponse> {
  const deviceId = String(body.deviceId ?? "").trim()
  if (!deviceId) return NextResponse.json({ error: "deviceId مطلوب" }, { status: 400 })

  let root: string
  try {
    root = ensureDeviceRoot(deviceId)
  } catch {
    return NextResponse.json({ error: "معرّف جهاز غير صالح" }, { status: 400 })
  }

  const dirV = typeof body.path === "string" && body.path.startsWith("/") ? body.path : "/Downloads"
  const name = sanitizeName(String(body.name ?? ""))
  const size = Math.max(0, Math.floor(Number(body.size ?? 0)))
  if (!name) return NextResponse.json({ error: "اسم الملف مطلوب" }, { status: 400 })
  const chunkSize = Math.min(MAX_CHUNK, Math.max(64 * 1024, Math.floor(Number(body.chunkSize) || DEFAULT_CHUNK)))
  const mime = typeof body.mime === "string" && body.mime ? body.mime : mimeOf(name)
  const localPath = typeof body.localPath === "string" ? body.localPath : undefined

  // dirAbs: أنشئ مجلد الوجهة داخل جذر الجهاز (resolveSafe يمنع الهروب خارج الجذر)
  const dirAbs = resolveSafe(deviceId, dirV)
  await fs.mkdir(dirAbs, { recursive: true })

  // معرّف مستقر: الهاتف يمرر taskId خاصًا به → إعادة init بعد أي قطع تُعيد نفس الجلسة
  const uploadId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : uid("up")

  let s = getSession(uploadId)
  if (!s) {
    const partialAbs = path.join(dirAbs, `.${name}.nexuspart`)
    const jobId = uid("tx")
    const job: TransferJob = {
      id: jobId,
      deviceId,
      deviceName: deviceNameOf(deviceId),
      direction: "out", // من منظور الهاتف: الملف يخرج منه نحو مرآته على السيرفر
      fileName: name,
      srcPath: localPath ?? `(هاتف) ${name}`,
      destPath: path.join(dirAbs, name).replace(process.cwd() + "/", ""),
      totalBytes: size,
      transferred: 0,
      status: "active",
      speedBps: 0,
      chunksTotal: Math.max(1, Math.ceil(size / chunkSize)),
      chunksDone: 0,
      chunkSize,
      startedAt: Date.now(),
      agent: true,
      uploadId,
      mime,
    }
    jobs().set(jobId, job)
    s = {
      id: uploadId, deviceId, dirV, name, size, mime, localPath, chunkSize,
      partialAbs, jobId, createdAt: Date.now(), lastWriteAt: Date.now(),
    }
    uploadSessions().set(uploadId, s)
  } else {
    // جلسة قائمة: حدّث الحجم إن تغيّر (نفس المفتاح = نفس الملف منطقيًا)
    s.size = size
    const job = jobOf(s)
    if (job) {
      job.totalBytes = size
      job.chunksTotal = Math.max(1, Math.ceil(size / chunkSize))
      if (job.status === "done" || job.status === "error") job.status = "active"
    }
  }

  const received = await partialSize(s)
  if (received >= s.size && s.size > 0) {
    // الجزئي مكتمل من قبل (انقطع قبل complete) → أكمل فورًا
    return finalize(s)
  }
  await updateJobProgress(s, received)
  return NextResponse.json({ ok: true, uploadId: s.id, received, jobId: s.jobId, chunkSize: s.chunkSize })
}

/** إقفال الجلسة: نقل .nexuspart إلى الاسم النهائي وتحديد المهمة done. */
async function finalize(s: UploadSession): Promise<NextResponse> {
  const dirAbs = resolveSafe(s.deviceId, s.dirV)
  await fs.mkdir(dirAbs, { recursive: true })
  const finalAbs = await uniqueDest(dirAbs, s.name)
  try {
    await fs.rename(s.partialAbs, finalAbs)
  } catch {
    // عبر الأنظمة قد يفشل rename بين التقسيمات — نسخ ثم حذف
    await fs.copyFile(s.partialAbs, finalAbs)
    await fs.rm(s.partialAbs, { force: true })
  }
  uploadSessions().delete(s.id)
  const job = jobs().get(s.jobId)
  if (job) {
    job.transferred = job.totalBytes
    job.chunksDone = job.chunksTotal
    job.status = "done"
    job.speedBps = 0
    job.destPath = finalAbs.replace(process.cwd() + "/", "")
  }
  return NextResponse.json({ ok: true, job, destPath: job?.destPath })
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const id = sp.get("upload")
  if (!id) return NextResponse.json({ error: "upload مطلوب" }, { status: 400 })
  const s = getSession(id)
  if (!s) return NextResponse.json({ error: "الجلسة غير موجودة" }, { status: 404 })
  const received = await partialSize(s)
  const job = jobOf(s)
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
  const sp = req.nextUrl.searchParams
  const id = sp.get("upload") ?? ""
  const offset = Math.max(0, Math.floor(Number(sp.get("offset") ?? 0)))
  const s = getSession(id)
  if (!s) return NextResponse.json({ ok: false, error: "الجلسة غير موجودة" }, { status: 404 })
  const job = jobOf(s)
  if (job?.status === "paused") {
    return NextResponse.json({ ok: false, paused: true, received: await partialSize(s) }, { status: 409 })
  }

  const received = await partialSize(s)
  if (offset !== received) {
    // انزياح عن حجم الجزئي → أعد الحجم الفعلي ليعيد الهاتف الضبط
    return NextResponse.json({ ok: false, drift: true, received }, { status: 409 })
  }

  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length === 0) {
    return NextResponse.json({ ok: true, received })
  }
  if (received + buf.length > s.size && s.size > 0) {
    return NextResponse.json({ ok: false, error: "تجاوز الحجم المعلن" }, { status: 400 })
  }

  const fh = await fs.open(s.partialAbs, "a")
  try {
    await fh.write(buf, 0, buf.length, offset)
  } finally {
    await fh.close()
  }
  const now = received + buf.length
  await updateJobProgress(s, now)
  return NextResponse.json({ ok: true, received: now })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const op = String(body.op ?? "")
  const id = String(body.uploadId ?? body.taskId ?? "")

  if (op === "init") return createSession(body)

  const s = getSession(id)
  if (!s) {
    return NextResponse.json({ error: "الجلسة غير موجودة" }, { status: 404 })
  }

  switch (op) {
    case "complete": {
      const received = await partialSize(s)
      if (s.size > 0 && received < s.size) {
        return NextResponse.json(
          { ok: false, error: "الملف غير مكتمل", received, size: s.size },
          { status: 400 },
        )
      }
      return finalize(s)
    }
    case "pause": {
      const job = jobOf(s)
      if (job) job.status = "paused"
      return NextResponse.json({ ok: true, status: "paused" })
    }
    case "resume": {
      const job = jobOf(s)
      if (job) job.status = "active"
      return NextResponse.json({ ok: true, status: "active", received: await partialSize(s) })
    }
    case "abort":
      await abortSession(s.id)
      return NextResponse.json({ ok: true })
    default:
      return NextResponse.json({ error: "عملية غير معروفة" }, { status: 400 })
  }
}
