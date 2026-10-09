// استلام ملف فُكّ تشفيره على جهاز الاستقبال (الهاتف فك التشفير في متصفحه
// ثم حفظ الناتج — هذا المسار يمثل "حفظ الهاتف للملف محلياً")
import { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"

export const dynamic = "force-dynamic"

const RECV = path.join(process.cwd(), "data", "nexus-storage", "media", "Download")

export async function POST(req: NextRequest) {
  try {
    const { name, dataB64, sha256 } = (await req.json()) as { name?: string; dataB64?: string; sha256?: string }
    if (!name || !dataB64) return Response.json({ ok: false, error: "بيانات ناقصة" }, { status: 400 })
    const buf = Buffer.from(dataB64, "base64")
    await fs.mkdir(RECV, { recursive: true })
    const safe = name.replace(/[\\/:*?"<>|]/g, "_")
    const dest = path.join(RECV, `secure-${Date.now().toString(36)}-${safe}`)
    await fs.writeFile(dest, buf)
    return Response.json({ ok: true, saved: path.basename(dest), size: buf.length, sha256: sha256 ?? null })
  } catch (e) {
    return Response.json({ ok: false, error: String(e instanceof Error ? e.message : e) }, { status: 500 })
  }
}
