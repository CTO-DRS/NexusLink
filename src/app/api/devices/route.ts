import { NextRequest, NextResponse } from "next/server"
import { store, heartbeatBump } from "@/lib/nexus/devices"
import { startTransfer } from "@/lib/nexus/transfer-engine"
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
      return NextResponse.json({ ok: true, device: d })
    }
    case "send-file": {
      const job = await startTransfer({
        deviceId: body.deviceId,
        deviceName: body.deviceName || body.deviceId,
        direction: body.direction === "in" ? "in" : "out",
        srcDeviceId: body.srcDeviceId,
        srcVPath: body.srcPath,
        fileName: body.fileName,
      })
      if ("error" in job) return NextResponse.json(job, { status: 400 })
      return NextResponse.json({ ok: true, job })
    }
    default:
      return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 })
  }
}
