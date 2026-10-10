// NexusLink — اختيار جهاز هدف الإرسال من واجهة الويب.
// يفضّل الوكيل الحقيقي المتصل (هاتف Flutter المسجّل بمعرّف غير مزروع) ثم الأجهزة
// المتصلة الأخرى حسب أحدث lastSeen — ليعمل زر "إرسال إلى الهاتف" مع الوكيل الفعلي.
import type { NexusDevice } from "./types"

const SEEDED = new Set(["pc-office", "galaxy-s24", "ipad-pro", "redmi-note13", "nexus-tv"])

export async function pickSendTarget(excludeId: string): Promise<NexusDevice | null> {
  try {
    const r = await fetch("/api/devices")
    const j = await r.json()
    const list: NexusDevice[] = j.devices || []
    const others = list.filter(
      (d) => d.id !== excludeId && (d.kind === "phone" || d.kind === "tablet") && d.state === "connected"
    )
    others.sort((a, b) => Number(SEEDED.has(a.id)) - Number(SEEDED.has(b.id)) || b.lastSeen - a.lastSeen)
    return others[0] ?? null
  } catch {
    return null
  }
}
