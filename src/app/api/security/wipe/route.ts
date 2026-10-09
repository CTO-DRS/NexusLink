// الحذف الآمن: قائمة الملفات القابلة للمسح
import { wipableFiles } from "@/lib/nexus/secure-wipe"

export const dynamic = "force-dynamic"

export async function GET() {
  const files = await wipableFiles()
  return Response.json({ ok: true, files })
}
