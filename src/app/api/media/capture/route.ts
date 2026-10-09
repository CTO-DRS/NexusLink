// حفظ الصور الملتقطة عن بُعد من كاميرا الهاتف إلى تخزين الجهاز الحقيقي.
// POST { device, dir, dataUrl } → يكتب ملف JPEG فعلي في data/nexus-storage
// فيظهر تلقائياً في متصفح الملفات ومعرض الصور.
import { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { DEVICE_ROOTS } from "@/lib/nexus/fs-server"
import { mediaBroadcast } from "@/lib/nexus/media-bridge"

export const dynamic = "force-dynamic"

const ALLOWED_DIRS = ["DCIM/Camera", "DCIM/Security"]

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      device?: string
      dir?: string
      dataUrl?: string
      label?: string
    }
    const device = body.device && DEVICE_ROOTS[body.device] ? body.device : "galaxy-s24"
    const dir = ALLOWED_DIRS.includes(body.dir ?? "") ? body.dir! : "DCIM/Camera"

    const m = (body.dataUrl ?? "").match(/^data:image\/(jpeg|png);base64,(.+)$/)
    if (!m) {
      return Response.json({ ok: false, error: "بيانات صورة غير صالحة" }, { status: 400 })
    }
    const ext = m[1] === "png" ? "png" : "jpg"
    const buf = Buffer.from(m[2], "base64")
    if (buf.length < 1000) {
      return Response.json({ ok: false, error: "الصورة صغيرة جداً" }, { status: 400 })
    }

    const root = DEVICE_ROOTS[device]
    const dirAbs = path.join(root, dir)
    await fs.mkdir(dirAbs, { recursive: true })
    const ts = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    const name =
      (dir.includes("Security") ? "SEC_" : "IMG_") +
      ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + "_" +
      pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds()) +
      `.${ext}`
    await fs.writeFile(path.join(dirAbs, name), buf)

    const vpath = `/${dir}/${name}`
    mediaBroadcast("cam:captured", { name, device, path: vpath, at: Date.now() })
    return Response.json({ ok: true, name, path: vpath, device, bytes: buf.length })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "فشل الحفظ" },
      { status: 500 }
    )
  }
}
