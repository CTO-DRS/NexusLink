// مزامنة الصور التلقائية — الحالة + معرض المستلمة + توليد صورة جديدة / نبضة يدوية
import { promises as fs } from "fs"
import path from "path"
import { db } from "@/lib/db"
import { resolveSafe } from "@/lib/nexus/fs-server"
import { prodEmit } from "@/lib/nexus/productivity-bridge"
import { generatePhonePhoto, photoSyncTick } from "@/lib/nexus/sync-engine"

export const dynamic = "force-dynamic"

export async function GET() {
  const state = await db.prodState.findUnique({ where: { id: "main" } })
  let photos: { name: string; path: string; size: number; mtime: number }[] = []
  if (state) {
    try {
      const dir = resolveSafe("pc-office", state.photoTarget)
      const items = await fs.readdir(dir, { withFileTypes: true })
      for (const it of items) {
        if (!it.isFile() || !/\.(jpe?g|png)$/i.test(it.name)) continue
        const st = await fs.stat(path.join(dir, it.name)).catch(() => null)
        if (!st) continue
        photos.push({ name: it.name, path: `${state.photoTarget}/${it.name}`, size: st.size, mtime: st.mtimeMs })
      }
      photos.sort((a, b) => b.mtime - a.mtime)
      photos = photos.slice(0, 36)
    } catch { /* مجلد لم يُنشأ بعد */ }
  }
  return Response.json({ state, photos })
}

export async function POST(req: Request) {
  const { action } = await req.json().catch(() => ({}))
  if (action === "new") {
    // توليد صورة حقيقية جديدة على كاميرا الهاتف ثم مزامنة سريعة
    const ph = await generatePhonePhoto()
    prodEmit("photo:new", { name: ph.name, bytes: ph.bytes, device: "Galaxy-S24", at: Date.now() })
    prodEmit("prod:log", { id: String(Date.now()), text: `صورة جديدة على الهاتف: ${ph.name} — المزامنة التلقائية ستنسخها`, kind: "info", at: Date.now() })
    setTimeout(() => {
      void photoSyncTick(prodEmit).then((r) => {
        if (r.copied > 0) {
          prodEmit("prod:log", { id: String(Date.now()), text: `نُسخت ${r.copied} صورة تلقائياً إلى الكمبيوتر (${Math.round(r.bytes / 1024)}KB)`, kind: "ok", at: Date.now() })
        }
      })
    }, 1800)
    return Response.json({ ok: true, photo: ph })
  }
  if (action === "tick") {
    const r = await photoSyncTick(prodEmit)
    return Response.json({ ok: true, ...r })
  }
  return Response.json({ ok: false, error: "إجراء غير معروف" }, { status: 400 })
}

export async function PATCH(req: Request) {
  const d = await req.json().catch(() => null)
  if (!d) return Response.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 })
  const data: Record<string, unknown> = {}
  if (typeof d.photoSync === "boolean") data.photoSync = d.photoSync
  if (typeof d.photoTarget === "string" && d.photoTarget.startsWith("/")) data.photoTarget = d.photoTarget
  const state = await db.prodState.update({ where: { id: "main" }, data })
  prodEmit("prod:log", {
    id: String(Date.now()),
    text: typeof d.photoSync === "boolean" ? `مزامنة الصور التلقائية: ${d.photoSync ? "مفعّلة" : "متوقفة"}` : `مجلد الوجهة: ${d.photoTarget}`,
    kind: "info", at: Date.now(),
  })
  return Response.json({ ok: true, state })
}
