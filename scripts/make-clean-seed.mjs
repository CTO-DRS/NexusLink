// NexusLink — seed نظيفة للحزم الموزعة (bun:sqlite — تعمل على لينكس/ويندوز/ماك)
// ------------------------------------------------------------------
// المشكلة: build-resources.sh كان ينسخ db/custom.db كما هي (قاعدة التطوير/الاختبار)
// فيحصل كل مستخدم جديد عند أول إقلاع على جهات اتصال ورسائل وسجل مكالمات وحافظة
// وأجهزة «متصلة وموثوقة» وهمية + stealthMode=1 + أجهزة محجوبة.
// الحل: ننسخ المخطط (الجداول/الفهارس) ونفرّغ كل الصفوف، مع إبقاء جدول ترحيلات
// prisma إن وجد. db/custom.db في المستودع لا تُمس (اختبارات E2E تعتمد عليها).
// الاستخدام: bun scripts/make-clean-seed.mjs <src.db> <out.db>
import { Database } from "bun:sqlite"
import { copyFileSync, existsSync, rmSync } from "node:fs"

const [src, out] = process.argv.slice(2)
if (!src || !out) { console.error("usage: bun scripts/make-clean-seed.mjs <src.db> <out.db>"); process.exit(2) }
if (!existsSync(src)) { console.error(`seed source missing: ${src}`); process.exit(1) }
for (const s of ["", "-wal", "-shm", "-journal"]) if (existsSync(out + s)) rmSync(out + s)
copyFileSync(src, out)

const db = new Database(out)
db.exec("PRAGMA foreign_keys = OFF")
const keep = new Set(["_prisma_migrations"])
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name)
let rows = 0
for (const t of tables) {
  if (keep.has(t)) continue
  const n = db.query(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n
  rows += n
  db.exec(`DELETE FROM "${t.replace(/"/g, '""')}"`)
}
try { db.exec("DELETE FROM sqlite_sequence") } catch {}
db.exec("VACUUM")
// حارس: صفر صفوف في كل جدول بيانات وإلا فشل البناء
for (const t of tables) {
  if (keep.has(t)) continue
  const n = db.query(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n
  if (n !== 0) { console.error(`clean-seed guard: ${t} still has ${n} rows`); process.exit(1) }
}
db.close()
console.log(`clean seed → ${out} (${tables.length} tables, ${rows} dev rows removed)`)
