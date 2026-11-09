// تصدير التقاط Wireshark حقيقي (ملف pcap يفتح في Wireshark مباشرة)
import { NextRequest } from "next/server"
import { promises as fs } from "fs"
import { exportPcap } from "@/lib/nexus/security-bridge"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  // FA-16 (تكليف 43): pcap-export فعل المالك على الكمبيوتر — loopback حصرًا
  if (!guardPcOnly(req, "pcap.denied", "pcap-export")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }

  const res = await exportPcap()
  return Response.json(res)
}

export async function GET(req: NextRequest) {
  // FA-16 (تكليف 43): pcap-download فعل المالك على الكمبيوتر — loopback حصرًا
  if (!guardPcOnly(req, "pcap.denied", "pcap-download")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }

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
