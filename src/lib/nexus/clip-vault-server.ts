// عقد §50 — خزنة الحافظة الذكية — طبقة الخادم المشتركة (تطهير + تسلسل آمن للعرض)
// ============================================================
// مستخدمة من مساري الحافظة الرئيسي (§11) وإجراءات الخزنة — بلا ازدواج.
import { db } from "@/lib/db"
import { maskClip, type ClipSensitivity } from "@/lib/nexus/clip-vault-core"

/** تطهير المنتهي (غير المثبت) — يُستدعى من القراءات والإجراءات. المثبت لا يُنقّى أبدًا */
export async function purgeExpired(): Promise<number> {
  const r = await db.prodClip.deleteMany({ where: { pinned: false, expiresAt: { lt: new Date() } } })
  return r.count
}

/** تسلسل عنصر للعرض: الحساس مخفيّ تلقائيًا — الكشف الكامل بمسار reveal المقصود حصرًا */
export function serClipItem(
  i: {
    id: string; deviceId: string; deviceName: string; kind: string; content: string
    fileName: string | null; filePath: string | null; size: number; mode: string
    received: boolean; pinned: boolean; sensitive: string | null
    expiresAt: Date | null; createdAt: Date
  },
  reveal = false,
) {
  const masked = !!i.sensitive && !reveal
  return {
    id: i.id, deviceId: i.deviceId, deviceName: i.deviceName, kind: i.kind,
    content: masked ? maskClip(i.content, i.sensitive as ClipSensitivity) : i.content,
    masked, sensitive: i.sensitive,
    fileName: i.fileName, filePath: i.filePath, size: i.size, mode: i.mode,
    received: i.received, pinned: i.pinned,
    expiresAt: i.expiresAt ? i.expiresAt.getTime() : null,
    createdAt: i.createdAt.getTime(),
  }
}
