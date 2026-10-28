import { NextRequest, NextResponse } from "next/server"
import { store, heartbeatBump, PAIRING_TTL_MS, type AssistPending } from "@/lib/nexus/devices"
import { verifyAssistCode, deriveAssistCode, MAX_ASSIST_ATTEMPTS, ASSIST_CODE_TTL_MS } from "@/lib/nexus/assist-code"
import { ensureDeviceRoot } from "@/lib/nexus/fs-server"
import { writeServerAudit } from "@/lib/nexus/desktop-hardening"
import { recordPairMetric } from "@/lib/nexus/pair-metrics"
import { readEnterprisePolicy } from "@/lib/enterprise-policy"
import { appendAudit, observePolicy } from "@/lib/enterprise-audit"
import type { NexusDevice } from "@/lib/nexus/types"
import crypto from "crypto"

export const dynamic = "force-dynamic"

// عقد §46 — المساعدة عن بعد برمز قصير (سيناريو العائلة)
// ============================================================
// الطريق البديل لمسح QR: رمز عددي من ست خانات يُقرأ هاتفيًا على المكالمة.
//  1. الهاتف (جهاز من تُساعده):  POST action=request  {assistCode, name, model, kind, ip}
//  2. سطح المكتب (باب الموافقة): GET                  → pending يظهر في الواجهة
//  3. المالك يقبل/يرفض:          POST action=consent  {pendingId, accept}
//     القبول يسجّل الجهاز ويفتح جلسة مساعدة مرئية — الرفض يطوي الطلب.
//  4. قطع بضغطة:                 POST action=cut      → إبطال الاقتران وطي الجلسة
// حدود §46 الصادقة: لا تسجيل بلا موافقة صريحة · سقف محاولات §46.د ·
// الرمز داخل نافذة سر الاقتران نفسها (تدوير QR يُدوّره) · لا سرّ يُحرَّر للطالب.
//
// §47 — تعطيل قدرة المساعدة مؤسسيًا: managed.disabledCapabilities تحتوي
// "assist" → POST كله → 403 capability-disabled-by-policy (مساعدة العائلة
// مطوية مؤسسيًا — لا رموز ولا طلبات ولا جلسات) — GET يبقى لقطة صادقة مع
// علم التعطيل (الواجهة تُخفي زر الرمز وتعلن السبب).

const forceHealthTick = () => {
  import("@/lib/nexus/health")
    .then((m) => m.recordHealthTick(store().devices, { force: true }))
    .catch(() => {})
}

const audit = (action: string, detail: string, severity?: "warn") =>
  void writeServerAudit({ action, detail, severity, actor: "assist-code" }).catch(() => null)

/** لقطة موحدة + علم تعطيل §47 (توصيفي — الواجهة تتصرف به) */
function assistDisabledByPolicy(): boolean {
  const pol = readEnterprisePolicy()
  return pol.state === "managed" && pol.disabledCapabilities.includes("assist")
}

/** اللقطة الموحدة لواجهة سطح المكتب (تستطلعها اللوحة كل 2ث داخل نافذة الاقتران) */
function snapshot() {
  const s = store()
  const hasWindow = !!s.pairingSecret
  const disabled = assistDisabledByPolicy()
  return {
    ok: true,
    active: !disabled && hasWindow && Date.now() - s.pairingIssuedAt <= ASSIST_CODE_TTL_MS,
    code: !disabled && hasWindow ? deriveAssistCode(s.pairingSecret!) : null,
    expiresAt: hasWindow ? s.pairingIssuedAt + ASSIST_CODE_TTL_MS : 0,
    attemptsLeft: Math.max(0, MAX_ASSIST_ATTEMPTS - s.assistAttempts),
    pending: disabled ? null : s.assistPending,
    session: disabled ? null : s.assistSession,
    policy: { assistDisabled: disabled },
  }
}

export async function GET() {
  heartbeatBump()
  return NextResponse.json(snapshot())
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = body.action as string
  const s = store()
  heartbeatBump()

  // §47 — حسم التعطيل قبل أي منطق (لا رموز ولا طلبات ولا جلسات مؤسسيًا)
  const pol = readEnterprisePolicy()
  await observePolicy(pol)
  if (pol.state === "managed" && pol.disabledCapabilities.includes("assist")) {
    await appendAudit("capability.denied", false, "local", { capability: "assist", action: String(action ?? "").slice(0, 24) })
    return NextResponse.json(
      { ok: false, error: "capability-disabled-by-policy", detail: { capability: "assist" } },
      { status: 403 },
    )
  }

  switch (action) {
    /* ── 1) طلب الهاتف: رمز صحيح → طلب معلّق (لا تسجيل — الموافقة لاحقة) ── */
    case "request": {
      const verdict = verifyAssistCode(body.assistCode, s.pairingSecret, s.pairingIssuedAt, s.assistAttempts)
      if (!verdict.ok) {
        if (verdict.reason === "invalid" || verdict.reason === "malformed") s.assistAttempts++
        if (verdict.reason === "invalid") {
          await audit("assist-reject", `رمز مساعدة خاطئ من «${String(body.name ?? "مجهول")}» — المحاولة ${s.assistAttempts}/${MAX_ASSIST_ATTEMPTS}`, "warn")
        }
        const msgs: Record<string, string> = {
          "no-window": "لا نافذة اقتران نشطة — اطلب من مالك الكمبيوتر فتح «اقتران جهاز جديد» أولًا",
          missing: "رمز المساعدة مفقود — اطلب الرمز العددي من مالك الكمبيوتر",
          expired: `انتهت صلاحية رمز المساعدة (${ASSIST_CODE_TTL_MS / 60000} دقائق) — اطلب رمزًا جديدًا`,
          invalid: "رمز المساعدة لا يطابق — تحقق من الرقم المسموع",
          locked: `استُنفد سقف المحاولات (${MAX_ASSIST_ATTEMPTS}) — على المالك إصدار رمز QR جديد`,
          malformed: "رمز غير سليم — ستّ خانات رقمية فقط",
        }
        return NextResponse.json({ ok: false, reason: verdict.reason, error: msgs[verdict.reason] }, { status: 403 })
      }
      // الرمز صحيح → طلب معلّق بياناته الوصفية (آخر طلب يطوي السابق — جلسة واحدة)
      const pending: AssistPending = {
        id: crypto.randomBytes(8).toString("hex"),
        name: String(body.name ?? "هاتف مساعدة").slice(0, 60),
        model: String(body.model ?? "").slice(0, 60),
        kind: ["phone", "tablet", "desktop", "tv"].includes(body.kind) ? body.kind : "phone",
        ip: String(body.ip ?? "").slice(0, 45) || "غير معروف",
        requestedAt: Date.now(),
      }
      s.assistPending = pending
      await audit("assist-request", `طلب اقتران برمز المساعدة من «${pending.name}» (${pending.model || pending.kind})`)
      return NextResponse.json({
        ok: true,
        pendingId: pending.id,
        pollAfterMs: 1500,
        expiresAt: s.pairingIssuedAt + PAIRING_TTL_MS,
      })
    }

    /* ── 2) موافقة المالك: القبول يسجّل ويفتح جلسة — الرفض يطوي ── */
    case "consent": {
      if (!s.assistPending || s.assistPending.id !== String(body.pendingId ?? "")) {
        return NextResponse.json({ ok: false, error: "لا طلب معلّق مطابق — ربما طُوي أو استُبدل" }, { status: 404 })
      }
      const p = s.assistPending
      if (body.accept !== true) {
        s.assistPending = null
        await audit("assist-deny", `رُفض طلب المساعدة من «${p.name}» بيد المالك`, "warn")
        return NextResponse.json({ ok: true, state: "denied" })
      }
      // تسجيل الجهاز بنفس مسار الاقتران التعاقدي (idempotent على الاسم/المعرّف)
      const stableId = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "assist-device"
      let d = s.devices.find((x) => x.id === stableId || x.name === p.name)
      const reregister = !!d
      if (d) {
        d.state = "connected"
        d.lastSeen = Date.now()
        if (p.ip !== "غير معروف") d.ip = p.ip
        d.trusted = true
      } else {
        d = {
          id: stableId,
          name: p.name,
          kind: p.kind,
          state: "connected",
          mode: "wifi",
          ip: p.ip !== "غير معروف" ? p.ip : `192.168.1.${50 + Math.floor(Math.random() * 100)}`,
          battery: 70,
          storageTotal: 128 * 1024 ** 3,
          storageUsed: 40 * 1024 ** 3,
          lastSeen: Date.now(),
          rttMs: 12,
          pairedAt: Date.now(),
          trusted: true,
        }
        s.devices.push(d)
      }
      try { ensureDeviceRoot(d.id) } catch { /* معرّف غير قياسي — تجاهل */ }
      s.assistPending = null
      s.assistSession = { deviceId: d.id, deviceName: d.name, startedAt: Date.now(), via: "short-code" }
      await audit("assist-paired", `اقتران مساعدة مقبول: «${d.name}» — جلسة نشطة قابلة للقطع بضغطة`)
      await recordPairMetric({ deviceId: d.id, deviceName: d.name, qrToPairMs: Date.now() - s.pairingIssuedAt, reregister })
      forceHealthTick()
      return NextResponse.json({ ok: true, state: "accepted", device: d, session: s.assistSession })
    }

    /* ── 3) قطع بضغطة: المالك من اللافتة أو الوكيل من تطبيقه ── */
    case "cut": {
      const sess = s.assistSession
      if (!sess) return NextResponse.json({ ok: false, error: "لا جلسة مساعدة نشطة" }, { status: 404 })
      const d = s.devices.find((x) => x.id === sess.deviceId)
      if (d) { d.state = "offline"; d.trusted = false; d.lastSeen = Date.now() }
      s.assistSession = null
      s.assistPending = null
      await audit("assist-cut", `قُطعت جلسة المساعدة «${sess.deviceName}» بضغطة — الاقتران مُبطل`)
      forceHealthTick()
      return NextResponse.json({ ok: true, cut: sess.deviceName })
    }

    /* ── 4) طي الطلب المعلّق (انتهى انتظار الموافقة من جهة الوكيل) ── */
    case "dismiss": {
      if (s.assistPending?.id === String(body.pendingId ?? "")) s.assistPending = null
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 })
  }
}
