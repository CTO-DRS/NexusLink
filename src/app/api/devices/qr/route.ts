import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { store } from "@/lib/nexus/devices"
import crypto from "crypto"

export const dynamic = "force-dynamic"

/** Issues a pairing QR containing a one-time secret + local endpoint. */
export async function GET() {
  const s = store()
  const secret = crypto.randomBytes(16).toString("hex")
  s.pairingSecret = secret
  s.pairingIssuedAt = Date.now()
  const payload = JSON.stringify({
    v: 1,
    proto: "Nexus/1.2",
    host: "192.168.1.2",
    port: 7420,
    secret,
    ts: s.pairingIssuedAt,
  })
  const dataUrl = await QRCode.toDataURL(payload, {
    width: 320, margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  })
  return NextResponse.json({ qr: dataUrl, code: secret.slice(0, 6).toUpperCase() })
}
