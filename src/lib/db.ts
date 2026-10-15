import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

// ---------------------------------------------------------------------------
// عقد §23 — سلامة الترقية 1.0.0 → 1.1.0 (بلا تلف أي إعداد)
// ============================================================
// قاعدة المستخدم تُزرع مرة واحدة عند أول إقلاع (procman.rs — G-26) ولا تُستبدل
// عند التحديث. الجدولان المضافان بعد v1.0.0 يجب أن يُنشآ إضافيًا فقط عند أول
// استخدام على قاعدة قديمة — CREATE TABLE IF NOT EXISTS بلا أي مساس بالبيانات
// القائمة (الترقية الإضافية الآمنة: لا DROP ولا ALTER ولا حذف صفوف).
// الجداول القديمة كلها بلا تغيير منذ v1.0.0 (git diff v1.0.0..HEAD -- prisma/
// = إضافات حصرًا) — إعدادات 1.0.0 تبقى كما هي حرفيًا بعد الترقية.
// ---------------------------------------------------------------------------
let schemaEnsured: Promise<void> | null = null

function ensureUpgradeSchema(): Promise<void> {
  schemaEnsured ??= (async () => {
    try {
      // DesktopSetting (عقد §16 بند 2) — إعدادات سطح المكتب المشتركة.
      // التعريف مطابق حرفيًا لمخطط Prisma (key id / value JSON / updatedAt).
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "DesktopSetting" (
           "key"       TEXT     NOT NULL PRIMARY KEY,
           "value"     TEXT     NOT NULL,
           "updatedAt" DATETIME NOT NULL
         )`,
      )
    } catch (e) {
      // بلا هلع: القاعدة الجاهزة (seed 1.1.0) تحوي الجدول مسبقًا؛ فشل ضمان
      // المخطط (قاعدة للقراءة فقط مثلًا) يظهر في مسارات الكتابة بصدق لاحقًا.
      console.error('[db] ensureUpgradeSchema:', e instanceof Error ? e.message : e)
      schemaEnsured = null
    }
  })()
  return schemaEnsured
}

// الويب يفتح المسارات عند الطلب — الضمان قبل أول قراءة/كتابة إعدادات.
export const dbReady = ensureUpgradeSchema()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
