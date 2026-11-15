import { NextRequest, NextResponse } from "next/server"
import QRCode from "qrcode"
import { store, PAIRING_TTL_MS } from "@/lib/nexus/devices"
import { deriveAssistCode, ASSIST_CODE_TTL_MS } from "@/lib/nexus/assist-code"
import crypto from "crypto"
import os from "node:os"
import { ensurePairToken } from "@/lib/nexus/pair-token"
import { readEnterprisePolicy, resolveEffectivePosture } from "@/lib/enterprise-policy"

export const dynamic = "force-dynamic"

/** خريطة منافذ جسور Nexus الفعلية (المصدر: docs/protocol-contract.md).
 *  الهاتف (وكيل الجهاز) يحتاجها لبناء اتصالات socket.io بعد الاقتران. */
export const NEXUS_PORTS = {
  rest: 3000, comms: 3003, remote: 3004, media: 3005,
  guard: 3006, prod: 3007, sec: 3009, gateway: 81,
} as const

/** اسم الكمبيوتر كما يظهر في جسر التحكم (remote-service). */
const DESKTOP_NAME = "NEXUS-PC"

function isLoopbackHost(h: string): boolean {
  const x = h.replace(/^\[|\]$/g, "").toLowerCase()
  return x === "localhost" || x === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(x)
}

/** أول IPv4 غير داخلي — عنوان الجهاز على الشبكة المحلية (للهاتف). */
function lanIpv4(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a && !a.internal && a.family === "IPv4") return a.address
  }
  return null
}

/** منفذ البوابة الفعلي: NEXUSLINK_GATEWAY_PORT أو فحص 81 ثم 8180 (تراجع المنافذ المميزة). */
async function gatewayPort(): Promise<number | null> {
  const envPort = Number(process.env.NEXUSLINK_GATEWAY_PORT || 0)
  const candidates = envPort > 0 ? [envPort] : [81, 8180]
  for (const p of candidates) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/__gw/health`, { signal: AbortSignal.timeout(400), cache: "no-store" })
      const j = (await r.json()) as { ok?: boolean; role?: string }
      if (j?.ok === true && j?.role === "gateway") return p
    } catch { /* غير مُقلعة على هذا المنفذ */ }
  }
  return null
}

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
  let host = sep > 0 ? hostHeader.slice(0, sep) : hostHeader
  let port = sep > 0 ? Number(hostHeader.slice(sep + 1)) || 81 : 81

  // G1 — نافذة سطح المكتب تفتح 127.0.0.1:3000 (والهاتف لا يصل لعنوان حلقي):
  // نعلن عنوان الشبكة المحلية ومنفذ البوابة — الباب الوحيد المفتوح للشبكة.
  if (isLoopbackHost(host)) {
    const lan = lanIpv4()
    const gw = await gatewayPort()
    if (lan && gw) { host = lan; port = gw }
  }

  // G1 — رمز الاقتران الإلزامي يُحمل تلقائيًا في QR (الهاتف يرسله بكل طلب عبر
  // البوابة). يُولَّد هنا إن سبق QR البوابة في أول تشغيل. تحت إغلاق مؤسسي/OEM
  // أو تعطيل صريح لا رمز (الخارج مغلق أصلًا) — lan:false يخبر الهاتف بصدق.
  // من يصل لهذا المسار: loopback (Next يُصغي على 127.0.0.1) أو حامل الرمز عبر البوابة.
  const posture = resolveEffectivePosture(readEnterprisePolicy())
  const pairRec = posture.closed ? null : ensurePairToken()

  const payload = {
    v: 1,
    proto: "Nexus/1.2",
    host,
    port,
    secret,
    ts: s.pairingIssuedAt,
    name: DESKTOP_NAME,
    ports: NEXUS_PORTS,
    // G1 — رمز البوابة (x-pair-token / ?pair=) — غيابه = الوصول من الشبكة مغلق
    ...(pairRec ? { pair: pairRec.token } : {}),
    lan: !!pairRec,
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
