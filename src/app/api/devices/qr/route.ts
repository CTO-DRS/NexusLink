import { NextRequest, NextResponse } from "next/server"
import QRCode from "qrcode"
import { store, PAIRING_TTL_MS } from "@/lib/nexus/devices"
import { deriveAssistCode, ASSIST_CODE_TTL_MS } from "@/lib/nexus/assist-code"
import crypto from "crypto"

export const dynamic = "force-dynamic"

/** خريطة منافذ جسور Nexus الفعلية (المصدر: docs/protocol-contract.md).
 *  الهاتف (وكيل الجهاز) يحتاجها لبناء اتصالات socket.io بعد الاقتران. */
export const NEXUS_PORTS = {
  rest: 3000, comms: 3003, remote: 3004, media: 3005,
  guard: 3006, prod: 3007, sec: 3009, gateway: 81,
} as const

/** اسم الكمبيوتر كما يظهر في جسر التحكم (remote-service). */
const DESKTOP_NAME = "NEXUS-PC"

/**
 * يولّد QR اقتران بعنوان **حقيقي قابل للاتصال** (الإصلاح G-2):
 * - host/port مشتقان من ترويسة Host للطلب الوارد — أي أن الهاتف يمسح
 *   العنوان الذي وصل به طلب الويب فعليًا (عبر Caddy :81 أو مباشرة :3000).
 * - الحمولة تتضمن خريطة منافذ الجسور كاملة ليعرف الوكيل أين يتصل.
 * - الاستجابة تتضمن `payload` نصيًا لأغراض الفحص والعرض بجانب الصورة.
 */
export async function GET(req: NextRequest) {
  const s = store()
  const secret = crypto.randomBytes(16).toString("hex")
  s.pairingSecret = secret
  s.pairingIssuedAt = Date.now()
  // §46.د — تدوير QR يفتح سقف محاولات رمز المساعدة من جديد (السقف لكل نافذة لا للعملية)
  s.assistAttempts = 0

  // العنوان الفعلي كما وصل الطلب: "192.168.1.2:81" أو "192.168.1.2:3000" …
  const hostHeader = (req.headers.get("host") ?? "").trim() || "127.0.0.1:3000"
  const sep = hostHeader.lastIndexOf(":")
  const host = sep > 0 ? hostHeader.slice(0, sep) : hostHeader
  const port = sep > 0 ? Number(hostHeader.slice(sep + 1)) || 81 : 81

  const payload = {
    v: 1,
    proto: "Nexus/1.2",
    host,
    port,
    secret,
    ts: s.pairingIssuedAt,
    name: DESKTOP_NAME,
    ports: NEXUS_PORTS,
  }
  const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
    width: 320, margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  })
  // G-1 — شفافية نافذة الاقتران: الصلاحية تعتمد على آخر إصدار (تدوير عند كل GET)
  // §46 — رمز المساعدة العددي مشتق من السر نفسه (نفس النافذة، تدوير معًا)
  const assistCode = deriveAssistCode(secret)
  return NextResponse.json({
    qr: dataUrl,
    code: secret.slice(0, 6).toUpperCase(),
    assistCode,
    payload,
    ttlMs: PAIRING_TTL_MS,
    expiresAt: s.pairingIssuedAt + PAIRING_TTL_MS,
    assistExpiresAt: s.pairingIssuedAt + ASSIST_CODE_TTL_MS,
  })
}
