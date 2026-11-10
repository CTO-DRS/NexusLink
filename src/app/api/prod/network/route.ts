// الشبكة الحالية — قراءة/تبديل (محاكاة انتقال بين شبكات LAN)
import { db } from "@/lib/db"
import { applyNetwork } from "@/lib/nexus/productivity-bridge"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export const NETWORKS = ["منزل-5GHz", "Office-Net", "Cafe-Guest"]

export async function GET() {
  const state = await db.prodState.findUnique({ where: { id: "main" } })
  const profile = state?.activeProfileId
    ? await db.netProfile.findUnique({ where: { id: state.activeProfileId } })
    : null
  return Response.json({ network: state?.network ?? "منزل-5GHz", profile, state, networks: NETWORKS })
}

export async function POST(req: Request) {
  // FA-22 (تكليف 51): تبديل الشبكة (قلب بوابة الإشعارات) فعل المالك — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "prod.denied", "network-switch")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  const { network } = await req.json().catch(() => ({}))
  if (!network || typeof network !== "string") {
    return Response.json({ ok: false, error: "اسم الشبكة مطلوب" }, { status: 400 })
  }
  const r = await applyNetwork(network)
  return Response.json({ ok: true, ...r })
}
