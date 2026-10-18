// تنظيف بقايا قواعد/إطلاقات E2E المرسوخة من تشغيلات فاشلة (الخادم متوقف)
const fs = require("fs")
const path = require("path")
const dbUrl = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]
const { PrismaClient } = require("@prisma/client")
const db = new PrismaClient({ datasources: { db: { url: dbUrl } }, log: [] })
;(async () => {
  const pats = ["A1-E2E%", "AH-E2E%", "SS-E2E%", "BA-E2E%", "DA-E2E%", "T-E2E%"]
  const stale = await db.nexusAutomationRule.findMany({ where: { OR: pats.map((p) => ({ name: { startsWith: p.replace("%", "") } })) } })
  console.log("stale rules:", stale.map((r) => r.name).join(", ") || "(none)")
  if (stale.length) {
    const ids = stale.map((r) => r.id)
    const f = await db.nexusAutomationFire.deleteMany({ where: { ruleId: { in: ids } } })
    const d = await db.nexusAutomationRule.deleteMany({ where: { id: { in: ids } } })
    console.log(`deleted rules=${d.count} fires=${f.count}`)
  }
  const left = await db.nexusAutomationRule.count()
  console.log("remaining rules:", left)
  await db.$disconnect()
})()
