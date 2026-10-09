// تصدير التقاط Wireshark حقيقي (ملف pcap يفتح في Wireshark مباشرة)
import { NextRequest } from "next/server"
import { promises as fs } from "fs"
import { exportPcap } from "@/lib/nexus/security-bridge"

export const dynamic = "force-dynamic"

export async function POST() {
  const res = await exportPcap()
  return Response.json(res)
}

export async function GET(req: NextRequest) {
  const res = await exportPcap()
  if (!res.ok || !res.file) return Response.json(res, { status: 400 })
  const buf = await fs.readFile(res.file)
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.tcpdump.pcap",
      "Content-Disposition": `attachment; filename="nexuslink-capture.pcap"`,
    },
  })
}
