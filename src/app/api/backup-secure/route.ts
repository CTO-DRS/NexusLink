// عقد §54 — الدرع الاحتياطي المشفّر — المسار العام
// ============================================================
// GET → القائمة: الملفات (بلا مفاتيح) + حالة الجدولة + سياسة الاحتفاظ
// POST { action }:
//  - create: { passphrase, kind?: "manual" } — نسخة يدوية بعبارة المالك
//  - verify: { file, passphrase } — دراي-رن: فك وعدّادات بلا تطبيق
//  - restore: { file, passphrase, mode? } — فك + تطبيق (المكتبة المشتركة)
//  - delete: { file } · prune: { keep? } — إدارة محلية
//  - schedule-enable: { hours } · schedule-disable · schedule-rotate — يد محلية
//    حصرًا (حرس loopback نمط §37/§51/§53)
//  - schedule-tick — نبضة داخلية (استدعاء من نبض التطبيق أو يدويًا)
// المفتاح المحلي لا يعود في GET أبدًا — يُسلّم مرة عند التدوير حصرًا.
import { NextResponse } from "next/server"
import {
  listSecureBackups, createSecureBackup, verifySecureBackup, restoreSecureBackup,
  deleteSecureBackup, pruneSecureBackups, enableSchedule, disableSchedule,
  rotateLocalKey, scheduleTick, guardLocal,
} from "@/lib/nexus/backup-secure-server"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(await listSecureBackups())
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")

  // FA-14 (تكليف 41): إنشاء/تحقق/استعادة/حذف/تقليم أفعال مدمرة أو محاولة
  // فك على النسخ المشفرة — loopback حصرًا (عقيدة FA-13 على HTTP). الجدولة
  // أدناه كانت محمية بحرس loopback نمط §37 أصلًا (guardLocal).
  if (action !== "schedule-tick" && !guardPcOnly(req, "backup.denied", action)) {
    return NextResponse.json(
      { ok: false, error: "backup-admin-loopback-only", detail: "via-gateway-non-loopback" },
      { status: 403 },
    )
  }

  if (action === "create") {
    const kind = body.kind === "scheduled" ? "scheduled" : "manual"
    const r = await createSecureBackup({ passphrase: typeof body.passphrase === "string" ? body.passphrase : undefined, kind })
    if (!r.ok) return NextResponse.json(r, { status: 400 })
    return NextResponse.json(r)
  }

  if (action === "verify" || action === "restore") {
    const file = String(body.file ?? "")
    const passphrase = typeof body.passphrase === "string" ? body.passphrase : ""
    if (!file || !passphrase) return NextResponse.json({ ok: false, error: "missing-file-or-passphrase" }, { status: 400 })
    if (action === "verify") {
      const r = await verifySecureBackup(file, passphrase)
      return NextResponse.json(r, { status: r.ok ? 200 : r.error === "not-found" ? 404 : 400 })
    }
    const mode = body.mode === "replace" ? "replace" : "merge"
    const r = await restoreSecureBackup(file, passphrase, mode)
    return NextResponse.json(r, { status: r.ok ? 200 : r.error === "not-found" ? 404 : 400 })
  }

  if (action === "delete") {
    const r = await deleteSecureBackup(String(body.file ?? ""))
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }

  if (action === "prune") {
    const keep = typeof body.keep === "number" && Number.isInteger(body.keep) && body.keep > 0 ? body.keep : undefined
    return NextResponse.json(await pruneSecureBackups(keep))
  }

  // الجدولة — إدارة محلية حصرًا (نمط §37/§51/§53)
  if (action === "schedule-enable" || action === "schedule-disable" || action === "schedule-rotate") {
    if (!guardLocal(req, action)) {
      return NextResponse.json(
        { ok: false, error: "backup-admin-loopback-only", detail: "via-gateway-non-loopback" },
        { status: 403 },
      )
    }
    if (action === "schedule-enable") {
      const r = await enableSchedule(Number(body.hours ?? 24))
      return NextResponse.json(r, { status: r.ok ? 200 : 400 })
    }
    if (action === "schedule-disable") return NextResponse.json(await disableSchedule())
    const r = await rotateLocalKey()
    return NextResponse.json(r)
  }

  if (action === "schedule-tick") {
    return NextResponse.json(await scheduleTick())
  }

  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
