import { NextResponse } from "next/server"
import fs from "node:fs"
import path from "node:path"
import {
  readEnterprisePolicy,
  resolveEffectivePosture,
  rotationDue,
  semverGte,
  isValidSemver,
  policyPaths,
  POLICY_CONTRACT,
} from "@/lib/enterprise-policy"
import { auditSummary, observePolicy, AUDIT_CONTRACT } from "@/lib/enterprise-audit"
import { store } from "@/lib/nexus/devices"
import { listPairMetrics } from "@/lib/nexus/pair-metrics"
import { pairStats, PAIR_TARGET_MS } from "@/lib/pair-math"
import { buildCompliancePdf } from "@/lib/nexus/report-pdf"

export const dynamic = "force-dynamic"

// §47 — مولّد تقارير الامتثال (تصدير محلي حصرًا — docs/enterprise-deploy.md §16)
// ============================================================
// GET /api/enterprise/report?format=json|pdf
//   JSON (الافتراضي) — المرجع الكامل: سياسة + أجهزة + إصدارات + مقاييس
//     §29/§30 + سجل §39 (بيانات وصفية حصرًا — حرس F6: أعداد وأزمنة وبصمات).
//   PDF — إنجليزي للمُدقّقين (قلم Helvetica قياسي — الحد 47.و.4) مولَّد
//     بصفر اعتماد (report-pdf.ts — PDF 1.4 + xref يدوي).
// حرس loopback (نمط §38 حرفيًا): التقرير بيد الجهاز حصرًا — واصله عبر
// البوابة من خارج الجهاز (ترويسة x-gw-client-ip) مرفوض ولو برمز صحيح —
// لا رفع لسحابة ولا بريد ولا قناة (لوعد الجهاز هو الحدود).
// تعمل النقطة بلا إعادة تشغيل: قراءة السياسة بمتغير تعديل-الوقت في كل نداء.

const PAIR_FILE =
  process.env.NEXUSLINK_PAIR_FILE || path.join(process.cwd(), ".zstate", "pair-token.json")

/** مطابق حرفيًا لقراءة §38 في /api/remote-access — نمط النسختين المتطابقتين */
function readPairFile(): { token: string; fingerprint: string; createdAt: string } | null {
  try {
    const j = JSON.parse(fs.readFileSync(PAIR_FILE, "utf8"))
    if (j && typeof j.token === "string" && j.token.length >= 16) {
      return { token: j.token, fingerprint: String(j.fingerprint ?? ""), createdAt: String(j.createdAt ?? "") }
    }
    return null
  } catch {
    return null
  }
}

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

/** الإصدار الموحد من package.json (توصيفي — غيابه لا يفشل التقرير) */
function appVersion(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version
    return typeof v === "string" && v ? v : null
  } catch {
    return null
  }
}

function ago(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "n/a"
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.floor(s / 60)}m ago`
  if (s < 129600) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export async function GET(request: Request) {
  const fwd = request.headers.get("x-gw-client-ip")
  if (fwd && !isLoopbackIp(fwd)) {
    return NextResponse.json(
      { ok: false, error: "report-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  const pol = readEnterprisePolicy()
  await observePolicy(pol)
  const posture = resolveEffectivePosture(pol)
  const pair = readPairFile()
  const managed = pol.state === "managed"
  const rotationDays = managed ? pol.accessCodeRotationDays : null
  const due = rotationDue(pair?.createdAt, rotationDays)
  const ageDays = pair && rotationDays ? Math.floor((Date.now() - Date.parse(pair.createdAt)) / 86_400_000) : null

  // جرد الأجهزة التوصيفي (متجر الأجهزة الخادمي — أسماء وأنواع وآخر تواجد فقط)
  const devs = store().devices.map((d) => ({
    name: d.name,
    kind: d.kind,
    state: d.state,
    lastSeenAgo: ago(d.lastSeen),
    rttMs: Number.isFinite(d.rttMs) ? Math.round(d.rttMs) : null,
  }))
  const byKind: Record<string, number> = {}
  for (const d of devs) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1

  // §30 — إحصاء الاقتران من SQLite (أرقام وأزمنة حصرًا — حرس F6)
  let pairingStats: Record<string, unknown> = {}
  try {
    pairingStats = pairStats(await listPairMetrics(50)) as unknown as Record<string, unknown>
  } catch {
    pairingStats = { n: 0 }
  }

  // §47 — ختم الإصدار الأدنى (إعلان لا حجب — الحد 47.و.3)
  const appV = appVersion()
  const minimumVersion = managed ? pol.minimumVersion : null
  const belowMinimum =
    minimumVersion !== null && appV !== null && isValidSemver(appV) ? !semverGte(appV, minimumVersion) : false

  const report = {
    ok: true,
    contract: "§47",
    generatedAt: new Date().toISOString(),
    organization: pol.organization,
    platform: process.platform,
    policy: {
      contract: POLICY_CONTRACT,
      state: pol.state,
      hash: pol.hash,
      schemaVersion: pol.schemaVersion,
      path: pol.path,
      pathsConfigured: policyPaths(),
    },
    enforced: {
      remoteAccess: pol.remoteAccess,
      blockedBridges: pol.blockedBridges,
      lockedSettings: pol.lockedSettings,
      accessCodeRotationDays: rotationDays,
      disabledCapabilities: pol.disabledCapabilities,
      minimumVersion,
    },
    posture: { source: posture.source, closed: posture.closed },
    pairGate: {
      enabled: !!pair,
      fingerprint: pair?.fingerprint ?? null,
      createdAt: pair?.createdAt ?? null,
      rotation: { days: rotationDays, ageDays, due },
    },
    devices: { total: devs.length, byKind, items: devs },
    versions: { app: appV, minimum: minimumVersion, belowMinimum },
    metrics: {
      contract: "§29/§30",
      pairTargetMs: PAIR_TARGET_MS,
      pairing: pairingStats,
      controlP95Note: "client-side live window (perf panel) - not server-exported",
    },
    audit: { contract: AUDIT_CONTRACT, ...auditSummary() },
  }

  const format = new URL(request.url).searchParams.get("format") ?? "json"
  if (format === "pdf") {
    const bytes = buildCompliancePdf(report as unknown as Record<string, unknown>)
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="nexuslink-compliance-report.pdf"',
        "Cache-Control": "no-store",
      },
    })
  }
  if (format !== "json") {
    return NextResponse.json({ ok: false, error: "unknown-format", detail: format }, { status: 400 })
  }
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } })
}
