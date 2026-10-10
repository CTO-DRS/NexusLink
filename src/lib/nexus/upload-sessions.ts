// NexusLink — سجل جلسات رفع الوكيل الحقيقي (هاتف → سيرفر).
// كل جلسة = ملف .nexuspart قابل للاستئناف + مهمة TransferJob مرتبطة.
// الجلسات في الذاكرة (globalThis يقاوم hot-reload) بينما .nexuspart على القرص
// يبقى بعد إعادة تشغيل السيرفر — وإعادة init بنفس المفتاح تعيد الارتباط.
import path from "path"
import { promises as fs } from "fs"
import type { TransferJob } from "./types"
import { jobs } from "./transfer-engine"

export interface UploadSession {
  id: string
  deviceId: string
  dirV: string // مجلد الوجهة الافتراضي داخل جذر الجهاز (مثل "/Downloads")
  name: string // اسم الملف النهائي (بدون مسار)
  size: number
  mime?: string
  localPath?: string // مسار الهاتف المحلي (للعرض فقط)
  chunkSize: number
  partialAbs: string // مسار .nexuspart المطلق
  jobId: string
  createdAt: number
  lastWriteAt: number
}

const g = globalThis as unknown as { __nexusUploads?: Map<string, UploadSession> }

export function uploadSessions(): Map<string, UploadSession> {
  if (!g.__nexusUploads) g.__nexusUploads = new Map()
  return g.__nexusUploads
}

export function getSession(id: string): UploadSession | null {
  return uploadSessions().get(id) ?? null
}

/** حجم الجزئي الحالي من القرص (مصدر الحقيقة للاستئناف). */
export async function partialSize(s: UploadSession): Promise<number> {
  try {
    const st = await fs.stat(s.partialAbs)
    return st.size
  } catch {
    return 0
  }
}

/** إحصاء السرعة الحالية للجلسة (خوارزمية مطابقة لمهام الوكيل). */
const g2 = globalThis as unknown as { __nexusUpSamples?: Map<string, { at: number; transferred: number }> }
function upSamples(): Map<string, { at: number; transferred: number }> {
  if (!g2.__nexusUpSamples) g2.__nexusUpSamples = new Map()
  return g2.__nexusUpSamples
}

export async function updateJobProgress(s: UploadSession, received: number) {
  const job = jobs().get(s.jobId)
  if (!job) return
  job.transferred = Math.min(job.totalBytes, received)
  job.chunksDone = Math.min(job.chunksTotal, Math.floor(received / s.chunkSize))
  const now = Date.now()
  const prev = upSamples().get(s.id)
  if (prev && now > prev.at && received > prev.transferred) {
    const inst = ((received - prev.transferred) / (now - prev.at)) * 1000
    job.speedBps = job.speedBps ? Math.round(job.speedBps * 0.6 + inst * 0.4) : Math.round(inst)
  }
  upSamples().set(s.id, { at: now, transferred: received })
  s.lastWriteAt = now
  if (job.status === "queued") job.status = "active"
}

/** إلغاء جلسة رفع: حذف الجزئي + إقفال المهمة كما يفعل إلغاء الويب. */
export async function abortSession(id: string, reason = "أُلغيت بواسطة المستخدم"): Promise<boolean> {
  const s = uploadSessions().get(id)
  if (!s) return false
  uploadSessions().delete(id)
  upSamples().delete(id)
  try {
    await fs.rm(s.partialAbs, { force: true })
  } catch {
    /* لا شيء */
  }
  const job = jobs().get(s.jobId)
  if (job) {
    job.status = "error"
    job.error = reason
    jobs().delete(s.jobId)
  }
  return true
}

/** اسم ملف آمن (بلا مسارات). */
export function sanitizeName(name: string): string {
  const base = path.basename(String(name || "file"))
  return base.replace(/[\\/:*?"<>|\u0000]/g, "_").trim() || "file"
}
