import { NextResponse } from "next/server"
import fs from "node:fs"
import path from "node:path"
import { readEnterprisePolicy, oemPrivacyActive, resolveEffectivePosture, type PostureSource } from "@/lib/enterprise-policy"
import { appendAudit, observePolicy } from "@/lib/enterprise-audit"
import { normalizeRelayUrl, validateSecret, MAX_VISITORS_PER_ROOM, MAX_BODY_BYTES, MAX_FRAME_CHARS, RELAY_PROTOCOL_VERSION } from "@/lib/nexus/relay-core"
import { ensureRelayTunnel, relayTunnelStatus, writeRelayConfig, disableRelayConfig } from "@/lib/nexus/relay-tunnel"

export const dynamic = "force-dynamic"

// API عام 2.0 — المرحّل الذاتي (عقد §49 — النواة المحلية لـ E4)
// ============================================================
// GET  → حالة حية فقط: { enabled, state, url(معتّمة), roomId, fingerprint,
//        stats, policy, oemPrivacy, pairEnabled } — السر لا يعود أبدًا.
// POST { action: "enable", url, secret } | { action: "disable" }
//        حرس loopback للإدارة (نمط §37): واصل عبر البوابة من خارج الجهاز لا
//        يُدير النفق ولو برمز صحيح — الإدارة بيد الجهاز حصرًا.
//        قفل السياسة §38/§40: force-off يرفض التفعيل · المولود خاصًا يرفضه.
// صفر تغيير مخطط: مصدر الحقيقة ملف خارج المخطط (.zstate/relay.json أو
// NEXUSLINK_RELAY_FILE) بمتغير تعديل-وقت — حذفه/تعطيله = قطع فوري بلا إعادة تشغيل.
// تذكير صادق لا قفل: تفعيل النفق مع رمز §37 معطّل يُعلن في GET (pairEnabled=false)
// ليضغط الواجهة بصراحة — باب الوصول البعيد يُدار برمزه (§37) لا بالنفق وحده.

const PAIR_FILE =
  process.env.NEXUSLINK_PAIR_FILE || path.join(process.cwd(), ".zstate", "pair-token.json")

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

function pairEnabled(): boolean {
  try {
    const j = JSON.parse(fs.readFileSync(PAIR_FILE, "utf8"))
    return !!(j && typeof j.token === "string" && j.token.length >= 16)
  } catch {
    return false
  }
}

export async function GET() {
  const status = ensureRelayTunnel() // تسليح idempotent (نمط /api/remote/boot)
  const pol = readEnterprisePolicy()
  await observePolicy(pol)
  const posture = resolveEffectivePosture(pol)
  const oemPrivacy = { active: oemPrivacyActive(), source: posture.source as PostureSource }
  return NextResponse.json({
    ok: true,
    ...status,
    enabled: status.state !== "disabled" || !!status.createdAt,
    pairEnabled: pairEnabled(),
    policy: { remoteAccess: pol.remoteAccess, organization: pol.organization },
    oemPrivacy,
    limits: {
      protocolVersion: RELAY_PROTOCOL_VERSION,
      visitorsPerRoom: MAX_VISITORS_PER_ROOM,
      bodyBytes: MAX_BODY_BYTES,
      frameChars: MAX_FRAME_CHARS,
    },
  })
}

export async function POST(request: Request) {
  // §39 — تحليل الجسم أولًا (بلا أثر جانبي) ليُوثَّق الفعل المرفوض كاملًا
  let body: { action?: string; url?: string; secret?: string } = {}
  try { body = await request.json() } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")

  // حرس loopback للإدارة (نمط §37 حرفيًا): البوابة تستبدل x-gw-client-ip دائمًا
  const fwd = request.headers.get("x-gw-client-ip")
  if (fwd && !isLoopbackIp(fwd)) {
    await appendAudit("relay.admin.denied", false, "remote", { action: action.slice(0, 24), reason: "loopback" })
    return NextResponse.json(
      { ok: false, error: "relay-admin-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  // §38/§40 — قفل السياسة المؤسسية (نفس أولوية §37: المُدار فوق المستخدم)
  const pol = readEnterprisePolicy()
  await observePolicy(pol)
  const postureForLock = resolveEffectivePosture(pol)
  if (postureForLock.source === "oem-default" && action === "enable") {
    await appendAudit("relay.admin.denied", false, "local", { action, reason: "oem-privacy-default" })
    return NextResponse.json(
      { ok: false, error: "oem-privacy-default", hint: "deploy-policy-file" },
      { status: 403 },
    )
  }
  if (pol.state === "managed" && pol.remoteAccess === "force-off" && action === "enable") {
    await appendAudit("relay.admin.denied", false, "local", { action, reason: "policy-force-off" })
    return NextResponse.json({ ok: false, error: "policy-remote-access-locked", policy: "force-off" }, { status: 403 })
  }

  if (action === "disable") {
    const last = relayTunnelStatus()
    disableRelayConfig()
    // §39 — دليل التعطيل: بصمة السر الأخير لا السر نفسه (نمط pair.disable)
    await appendAudit("relay.disable", true, "local", { fp: last.fingerprint || null, room: last.roomId || null })
    return NextResponse.json({ ok: true, enabled: false })
  }

  if (action === "enable") {
    const nu = normalizeRelayUrl(body.url)
    if (!nu.ok) {
      await appendAudit("relay.admin.denied", false, "local", { action, reason: `url-${nu.reason}` })
      return NextResponse.json({ ok: false, error: "relay-url-invalid", reason: nu.reason }, { status: 400 })
    }
    if (!validateSecret(body.secret)) {
      await appendAudit("relay.admin.denied", false, "local", { action, reason: "secret-invalid" })
      return NextResponse.json({ ok: false, error: "relay-secret-invalid", hint: "16..256-chars-no-whitespace" }, { status: 400 })
    }
    const url = nu.origin
    const secret = String(body.secret)
    const { fingerprint, createdAt } = writeRelayConfig(url, secret)
    ensureRelayTunnel()
    // §39 — دليل التفعيل: بصمة السر ومعرّف الغرفة — لا السر أبدًا
    await appendAudit("relay.enable", true, "local", { fp: fingerprint, room: relayTunnelStatus().roomId })
    return NextResponse.json({
      ok: true, enabled: true, fingerprint, createdAt,
      roomId: relayTunnelStatus().roomId,
      // تذكير صادق لا قفل: باب الوصول البعيد يُدار برمز §37 — يُعرض في البطاقة
      pairEnabled: pairEnabled(),
    })
  }

  await appendAudit("relay.admin.denied", false, "local", { action: action.slice(0, 24), reason: "unknown-action" })
  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
