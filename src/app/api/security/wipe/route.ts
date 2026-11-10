// الحذف الآمن: قائمة الملفات القابلة للمسح
import { wipableFiles } from "@/lib/nexus/secure-wipe"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  // FA-22 (تكليف 51): جرد الملفات القابلة للمسح فعل المالك على الكمبيوتر — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "sec.denied", "wipe-list")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  const files = await wipableFiles()
  return Response.json({ ok: true, files })
}
