import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import { store, heartbeatBump } from "@/lib/nexus/devices"
import { startTransfer, createAgentOfferJob, jobs } from "@/lib/nexus/transfer-engine"
import { resolveSafe, ensureDeviceRoot, mimeOf } from "@/lib/nexus/fs-server"
import { isAgentOnline, getAgentDeviceId, guardEmitToAgent } from "@/lib/nexus/guard-bridge"
import { writeServerAudit } from "@/lib/nexus/desktop-hardening"
import type { NexusDevice } from "@/lib/nexus/types"

export const dynamic = "force-dynamic"

export async function GET() {
  heartbeatBump()
  return NextResponse.json({ devices: store().devices })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = body.action as string
  const s = store()

  switch (action) {
    case "connect": {
      const d = s.devices.find((x) => x.id === body.id)
      if (!d) return NextResponse.json({ error: "الجهاز غير موجود" }, { status: 404 })
      d.state = "connected"
      d.lastSeen = Date.now()
      return NextResponse.json({ ok: true, device: d })
    }
    case "disconnect": {
      const d = s.devices.find((x) => x.id === body.id)
      if (!d) return NextResponse.json({ error: "الجهاز غير موجود" }, { status: 404 })
      d.state = "offline"
      d.lastSeen = Date.now()
      return NextResponse.json({ ok: true, device: d })
    }
    case "forget": {
      s.devices = s.devices.filter((x) => x.id !== body.id)
      return NextResponse.json({ ok: true })
    }
    case "pair": {
      // body: { name, kind, id?, ip?, battery?, storageTotal?, storageUsed?, model? }
      // يُستدعى من وكيل الجهاز (تطبيق Flutter): id = معرّف ثابت (Android ID) يجعل
      // إعادة التسجيل idempotent، والحقول الاختيارية تنقل الحالة الحقيقية للجهاز.
      const exists = s.devices.find(
        (x) => (body.id && typeof body.id === "string" && x.id === body.id) || x.name === body.name
      )
      if (exists) {
        exists.state = "connected"
        exists.lastSeen = Date.now()
        if (typeof body.battery === "number") exists.battery = Math.max(0, Math.min(100, body.battery))
        if (typeof body.storageTotal === "number") exists.storageTotal = body.storageTotal
        if (typeof body.storageUsed === "number") exists.storageUsed = body.storageUsed
        if (typeof body.ip === "string" && body.ip) exists.ip = body.ip
        // سجّل جذرًا فعليًا للوكيل (مرآة ملفاته قابلة للتصفح من الويب)
        try { ensureDeviceRoot(exists.id) } catch { /* معرّف غير قياسي — تجاهل */ }
        return NextResponse.json({ ok: true, device: exists })
      }
      const stableId =
        typeof body.id === "string" && body.id.trim()
          ? body.id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
          : ""
      const d: NexusDevice = {
        id: stableId || body.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "device-new",
        name: body.name || "جهاز جديد",
        kind: body.kind || "phone",
        state: "connected",
        mode: "wifi",
        ip: typeof body.ip === "string" && body.ip ? body.ip : `192.168.1.${50 + Math.floor(Math.random() * 100)}`,
        battery: typeof body.battery === "number" ? Math.max(0, Math.min(100, body.battery)) : 60 + Math.floor(Math.random() * 40),
        storageTotal: typeof body.storageTotal === "number" ? body.storageTotal : 128 * 1024 ** 3,
        storageUsed: typeof body.storageUsed === "number" ? body.storageUsed : 40 * 1024 ** 3,
        lastSeen: Date.now(),
        rttMs: 8 + Math.floor(Math.random() * 20),
        pairedAt: Date.now(),
        trusted: true,
      }
      s.devices.push(d)
      // جذر فعلي لمرآة ملفات الوكيل الجديد
      try { ensureDeviceRoot(d.id) } catch { /* معرّف غير قياسي — تجاهل */ }
      return NextResponse.json({ ok: true, device: d })
    }
    case "send-file": {
      const direction = body.direction === "in" ? "in" : "out"
      const targetId = String(body.deviceId ?? "")

      // وكيل حقيقي متصل؟ → عرض نقل حقيقي عبر جسر الحماية (tx:offer) بدل النسخ المحلية:
      // الهاتف يُبلّغ المستخدم → قبول → ينزّل نفسه بالبايتات عبر /api/preview مع Range.
      if (
        direction === "out" &&
        isAgentOnline() &&
        getAgentDeviceId() === targetId
      ) {
        try {
          const srcAbs = resolveSafe(body.srcDeviceId, body.srcPath)
          const st = await fs.stat(srcAbs)
          if (!st.isFile()) throw new Error("ليس ملفًا")
          const srcName = store().devices.find((x) => x.id === body.srcDeviceId)?.name ?? body.srcDeviceId
          const job = createAgentOfferJob({
            deviceId: targetId,
            deviceName: s.devices.find((x) => x.id === targetId)?.name ?? targetId,
            srcDeviceId: body.srcDeviceId,
            srcVPath: body.srcPath,
            fileName: body.fileName,
            totalBytes: st.size,
            mime: mimeOf(srcAbs),
          })
          const offered = guardEmitToAgent("tx:offer", {
            id: job.id,
            fileName: job.fileName,
            size: job.totalBytes,
            mime: job.mime,
            from: srcName,
            srcDeviceId: body.srcDeviceId,
            srcVPath: body.srcPath,
            device: targetId,
            at: Date.now(),
          })
          if (offered) {
            // FA-harden (عقد §16) — تدقيق النقل (أصل ويب/سحب-وإفلات/قائمة السياق)
            void writeServerAudit({
              action: "transfer",
              detail: `عرض نقل «${job.fileName}» (${job.totalBytes} بايت) → ${targetId}`,
              actor: srcName,
              deviceId: targetId,
            }).catch(() => null)
            return NextResponse.json({ ok: true, job })
          }
          // فشل الإرسال (انقطع الوكيل لحظيًا) → تسقط إلى النسخ المحلية
          jobs().delete(job.id)
        } catch {
          /* ملف مصدر غير صالح — تسقط للنسخ المحلية التي تُعيد الخطأ نفسه */
        }
      }

      const job = await startTransfer({
        deviceId: body.deviceId,
        deviceName: body.deviceName || body.deviceId,
        direction,
        srcDeviceId: body.srcDeviceId,
        srcVPath: body.srcPath,
        fileName: body.fileName,
      })
      if ("error" in job) return NextResponse.json(job, { status: 400 })
      // FA-harden (عقد §16) — تدقيق النقل المحلي (نسخ إلى مجلد الجهاز)
      void writeServerAudit({
        action: "transfer",
        detail: `نقل «${job.fileName}» (${direction === "in" ? "وارد" : "صادر"}) ↔ ${body.deviceId ?? ""}`,
        actor: String(body.deviceName ?? body.deviceId ?? "الكمبيوتر"),
        deviceId: String(body.deviceId ?? ""),
      }).catch(() => null)
      return NextResponse.json({ ok: true, job })
    }
    default:
      return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 })
  }
}
