// NexusLink — chunked transfer engine with pause/resume (real byte copying).
import { promises as fs } from "fs"
import path from "path"
import { createHash } from "crypto"
import type { TransferJob } from "./types"
import { resolveSafe } from "./fs-server"

const g = globalThis as unknown as { __nexusJobs?: Map<string, TransferJob> }

export function jobs(): Map<string, TransferJob> {
  if (!g.__nexusJobs) g.__nexusJobs = new Map()
  return g.__nexusJobs
}

const CHUNK = 256 * 1024          // 256 KB chunks
const TICK_MS = 70                // pacing so progress is visible in UI
const PC_RECV = path.join(process.cwd(), "data", "nexus-storage", "pc-fs", "Downloads")
const PHONE_RECV = path.join(process.cwd(), "data", "nexus-storage", "media", "Download")

async function uniqueDest(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  let candidate = path.join(dir, name)
  let i = 1
  for (;;) {
    try { await fs.stat(candidate); candidate = path.join(dir, `${stem} (${i++})${ext}`) } catch { return candidate }
  }
}

export async function startTransfer(opts: {
  deviceId: string
  deviceName: string
  direction: "out" | "in"
  srcDeviceId: string
  srcVPath: string
  fileName: string
}): Promise<TransferJob | { error: string }> {
  const srcAbs = resolveSafe(opts.srcDeviceId, opts.srcVPath)
  const st = await fs.stat(srcAbs).catch((e: unknown) => {
    console.error("[nexus-tx] stat failed:", srcAbs, e instanceof Error ? e.message : e)
    return null
  })
  if (!st || !st.isFile()) return { error: "الملف المصدر غير موجود" }

  const destDir = opts.direction === "in" ? PC_RECV : PHONE_RECV
  await fs.mkdir(destDir, { recursive: true })
  const destAbs = await uniqueDest(destDir, opts.fileName)

  const id = `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const job: TransferJob = {
    id,
    deviceId: opts.deviceId,
    deviceName: opts.deviceName,
    direction: opts.direction,
    fileName: opts.fileName,
    srcPath: opts.srcVPath,
    destPath: destAbs.replace(process.cwd() + "/", ""),
    totalBytes: st.size,
    transferred: 0,
    status: "queued",
    speedBps: 0,
    chunksTotal: Math.max(1, Math.ceil(st.size / CHUNK)),
    chunksDone: 0,
    chunkSize: CHUNK,
    startedAt: Date.now(),
  }
  jobs().set(id, job)
  runJob(job, srcAbs, destAbs).catch((e) => {
    job.status = "error"
    job.error = String(e?.message || e)
  })
  return job
}

async function waitWhile(job: TransferJob, cond: (j: TransferJob) => boolean) {
  while (cond(job)) await new Promise((r) => setTimeout(r, 120))
}

/** Real chunked copy: reads 256KB chunks, appends to .nexuspart, resumes on demand. */
async function runJob(job: TransferJob, srcAbs: string, destAbs: string) {
  job.status = "active"
  const partial = destAbs + ".nexuspart"

  // resume: reuse existing partial if smaller than total
  let offset = 0
  try {
    const pst = await fs.stat(partial)
    if (pst.size < job.totalBytes) offset = pst.size
    else await fs.rm(partial, { force: true })
  } catch { /* fresh start */ }
  job.transferred = offset
  job.chunksDone = Math.floor(offset / CHUNK)

  const src = await fs.open(srcAbs, "r")
  const dst = await fs.open(partial, "w")
  const buf = Buffer.alloc(CHUNK)
  const startedAt = Date.now()

  try {
    while (job.transferred < job.totalBytes) {
      await waitWhile(job, (j) => j.status === "paused")
      if (job.status !== "active") return // cancelled
      const { bytesRead } = await src.read(buf, 0, CHUNK, job.transferred)
      if (bytesRead === 0) break
      await dst.write(buf, 0, bytesRead, job.transferred)
      job.transferred += bytesRead
      job.chunksDone = Math.floor(job.transferred / CHUNK)
      const elapsed = Math.max(1, Date.now() - startedAt)
      job.speedBps = (job.transferred / elapsed) * 1000
      await new Promise((r) => setTimeout(r, TICK_MS))
    }
  } finally {
    await src.close()
    await dst.close()
  }

  if (job.status !== "active") return // cancelled mid-flight
  await fs.rename(partial, destAbs).catch(async () => {
    await fs.copyFile(partial, destAbs)
    await fs.rm(partial, { force: true })
  })
  job.transferred = job.totalBytes
  job.chunksDone = job.chunksTotal
  job.status = "done"
  job.speedBps = 0
}

export function verifyChunkHash(jobId: string): { ok: boolean; hash?: string } {
  const job = jobs().get(jobId)
  if (!job) return { ok: false }
  const h = createHash("md5").update(`${job.id}:${job.chunksDone}:${job.totalBytes}`).digest("hex")
  return { ok: true, hash: h.slice(0, 8) }
}

// ============================================================================
// النقل الحقيقي عبر وكيل الجهاز (هاتف Flutter) — إشارات tx:* على جسر الحماية
// ============================================================================

/** آخر عيّنة تقدم لكل مهمة وكيل (لحساب السرعة بسلاسة). */
const g2 = globalThis as unknown as { __nexusTxSamples?: Map<string, { at: number; transferred: number }> }
function txSamples(): Map<string, { at: number; transferred: number }> {
  if (!g2.__nexusTxSamples) g2.__nexusTxSamples = new Map()
  return g2.__nexusTxSamples
}

/** إنشاء مهمة عرض إرسال (كمبيوتر → هاتف حقيقي): تبقى queued حتى يقبل الوكيل. */
export function createAgentOfferJob(opts: {
  deviceId: string
  deviceName: string
  srcDeviceId: string
  srcVPath: string
  fileName: string
  totalBytes: number
  mime?: string
}): TransferJob {
  const id = `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const job: TransferJob = {
    id,
    deviceId: opts.deviceId,
    deviceName: opts.deviceName,
    direction: "out",
    fileName: opts.fileName,
    srcPath: opts.srcVPath,
    destPath: "NexusLink/", // مجلد الاستقبال على الهاتف
    totalBytes: opts.totalBytes,
    transferred: 0,
    status: "queued",
    speedBps: 0,
    chunksTotal: Math.max(1, Math.ceil(opts.totalBytes / CHUNK)),
    chunksDone: 0,
    chunkSize: CHUNK,
    startedAt: Date.now(),
    agent: true,
    srcDeviceId: opts.srcDeviceId,
    mime: opts.mime,
  }
  jobs().set(id, job)
  return job
}

/**
 * تطبيق أحداث الوكيل على سجل المهام (يُستدعى من جسر الحماية عند وصول
 * tx:accept / tx:reject / tx:progress / tx:state من الهاتف).
 */
export function applyAgentTx(event: string, d: Record<string, unknown>): TransferJob | null {
  const id = String(d?.id ?? "")
  const job = jobs().get(id)
  if (!job) return null

  switch (event) {
    case "tx:accept": {
      if (job.status === "queued" || job.status === "paused") job.status = "active"
      break
    }
    case "tx:reject": {
      job.status = "error"
      job.error = "رفض الجهاز الاستلام"
      break
    }
    case "tx:progress": {
      const tr = Number(d?.transferred)
      if (Number.isFinite(tr)) {
        job.transferred = Math.max(0, Math.min(job.totalBytes, Math.floor(tr)))
        job.chunksDone = Math.min(job.chunksTotal, Math.ceil((job.transferred / Math.max(1, job.totalBytes)) * job.chunksTotal))
      }
      const now = Date.now()
      const prev = txSamples().get(id)
      if (prev && now > prev.at) {
        const inst = ((job.transferred - prev.transferred) / (now - prev.at)) * 1000
        job.speedBps = prev.transferred <= job.transferred
          ? Math.max(0, Math.round(job.speedBps ? job.speedBps * 0.6 + inst * 0.4 : inst))
          : job.speedBps
      }
      txSamples().set(id, { at: now, transferred: job.transferred })
      if (job.status === "queued" || job.status === "paused") job.status = "active"
      break
    }
    case "tx:state": {
      const st = String(d?.state ?? "")
      if (st === "done") {
        job.transferred = job.totalBytes
        job.chunksDone = job.chunksTotal
        job.status = "done"
        job.speedBps = 0
      } else if (st === "failed") {
        job.status = "error"
        job.error = String(d?.error ?? "فشل النقل على الجهاز")
        job.speedBps = 0
      } else if (st === "cancelled") {
        job.status = "error"
        job.error = "أُلغيت بواسطة المستخدم"
        job.speedBps = 0
        jobs().delete(id)
      } else if (st === "paused") {
        job.status = "paused"
        job.speedBps = 0
      }
      break
    }
  }
  return job
}
