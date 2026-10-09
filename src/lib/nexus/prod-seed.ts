// NexusLink — بذور طبقة الإنتاجية (idempotent)
import { db } from "@/lib/db"

const SEED_VERSION = 1

export async function ensureProdSeed() {
  let state = await db.prodState.findUnique({ where: { id: "main" } })
  if (state && state.seedVer >= SEED_VERSION) return state

  if (!state) {
    state = await db.prodState.create({ data: { id: "main" } })
  }

  // ملفات تعريف الشبكات المدمجة
  const existing = await db.netProfile.count()
  if (existing === 0) {
    const home = await db.netProfile.create({
      data: { name: "البيت", icon: "home", networkName: "منزل-5GHz", photoSync: true, notifs: true, clipboard: true, folderSync: true, builtin: true },
    })
    await db.netProfile.create({
      data: { name: "العمل", icon: "briefcase", networkName: "Office-Net", photoSync: false, notifs: true, clipboard: true, folderSync: false, builtin: true },
    })
    if (!state.activeProfileId) {
      await db.prodState.update({ where: { id: "main" }, data: { activeProfileId: home.id } })
    }
  }

  // زوج مزامنة افتراضي: مستندات الهاتف ↔ مجلد Sync على الكمبيوتر
  const pairs = await db.syncPair.count()
  if (pairs === 0) {
    await db.syncPair.create({
      data: {
        deviceA: "galaxy-s24", folderA: "/Documents",
        deviceB: "pc-office", folderB: "/Documents/Sync",
        active: true, autoSync: true,
      },
    })
  }

  // عناصر مفتوحة على الهاتف (أكمل من حيث توقفت)
  const hands = await db.handoffItem.count()
  if (hands === 0) {
    await db.handoffItem.createMany({
      data: [
        {
          deviceId: "galaxy-s24", deviceName: "Galaxy-S24", kind: "video",
          title: "شاهدت 3:42 من: كيف يعمل بروتوكول Nexus؟",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", position: 222,
        },
        {
          deviceId: "galaxy-s24", deviceName: "Galaxy-S24", kind: "article",
          title: "مقال: أفضل ممارسات توفير بطارية الأندرويد",
          url: "https://ar.wikipedia.org/wiki/بطارية_هاتف",
        },
        {
          deviceId: "ipad-pro", deviceName: "iPad-Pro", kind: "link",
          title: "متابعة القراءة: توثيق Next.js",
          url: "https://nextjs.org/docs",
        },
      ],
    })
  }

  const out = await db.prodState.update({ where: { id: "main" }, data: { seedVer: SEED_VERSION } })
  return out
}
