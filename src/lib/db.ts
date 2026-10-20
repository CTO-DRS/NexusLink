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
      // مركز صحة الأجهزة (عقد §27) — جدولان إضافيان بنفس نمط الترقية الآمنة:
      // CREATE TABLE IF NOT EXISTS بلا أي مساس بالبيانات القائمة.
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "NexusHealthSample" (
           "id"        TEXT     NOT NULL PRIMARY KEY,
           "deviceId"  TEXT     NOT NULL,
           "battery"   INTEGER  NOT NULL,
           "rttMs"     INTEGER  NOT NULL,
           "online"    BOOLEAN  NOT NULL,
           "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`,
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "NexusHealthSample_deviceId_createdAt_idx" ON "NexusHealthSample"("deviceId", "createdAt")`,
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "NexusHealthSample_createdAt_idx" ON "NexusHealthSample"("createdAt")`,
      )
      // ترقية إضافية آمنة (§26.ط): عمود storagePct لعينات التخزين — محروس بـ
      // PRAGMA table_info فلا يُنفَّذ إلا مرة واحدة على قواعد قائمة، وADD COLUMN
      // بـ DEFAULT ثابت إضافيّة بحتة: الصفوف القائمة تبقى حرفيًا كما هي (تُقرأ 0
      // = «بلا دليل تخزين» فلا تُطلق مشغلًا تاريخيًا زائفًا أبدًا).
      try {
        const sampleCols = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("NexusHealthSample")`)
        if (Array.isArray(sampleCols) && !sampleCols.some((c) => c.name === "storagePct")) {
          await db.$executeRawUnsafe(`ALTER TABLE "NexusHealthSample" ADD COLUMN "storagePct" INTEGER NOT NULL DEFAULT 0`)
        }
      } catch (e) {
        console.error('[db] storagePct column ensure:', e instanceof Error ? e.message : e)
      }
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "NexusHealthEvent" (
           "id"         TEXT     NOT NULL PRIMARY KEY,
           "deviceId"   TEXT     NOT NULL,
           "deviceName" TEXT     NOT NULL,
           "type"       TEXT     NOT NULL,
           "level"      TEXT     NOT NULL DEFAULT 'info',
           "message"    TEXT     NOT NULL,
           "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`,
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "NexusHealthEvent_createdAt_idx" ON "NexusHealthEvent"("createdAt")`,
      )
      // ترسيخ قواعد الروتينات (عقد §26.ز) — جدول إضافي بنفس النمط الآمن.
      // القاعدة الكاملة JSON في payload — الاستعادة الحرفية عند إقلاع الجسر.
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "NexusAutomationRule" (
           "id"        TEXT     NOT NULL PRIMARY KEY,
           "name"      TEXT     NOT NULL,
           "enabled"   BOOLEAN  NOT NULL DEFAULT 1,
           "payload"   TEXT     NOT NULL,
           "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           "updatedAt" DATETIME NOT NULL
         )`,
      )
      // ترسيخ إطلاقات الروتينات (عقد §26.ح) — كل إطلاق فعلي يُرسَّخ والتنبيهات
      // غير المرئية تبقى بانتظار عودة الواجهة. seenAt nullable = غير مرئية بعد.
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "NexusAutomationFire" (
           "id"       TEXT     NOT NULL PRIMARY KEY,
           "ruleId"   TEXT     NOT NULL,
           "ruleName" TEXT     NOT NULL,
           "at"       DATETIME NOT NULL,
           "ok"       BOOLEAN  NOT NULL DEFAULT 1,
           "detail"   TEXT     NOT NULL DEFAULT '',
           "manual"   BOOLEAN  NOT NULL DEFAULT 0,
           "seenAt"   DATETIME
         )`,
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "NexusAutomationFire_at_idx" ON "NexusAutomationFire"("at")`,
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "NexusAutomationFire_ruleId_at_idx" ON "NexusAutomationFire"("ruleId", "at")`,
      )
      // سجل العمليات القابل للاستئناف (عقد §28 — M1.2 offline-first) — جدول إضافي
      // بنفس النمط الآمن: seq رتيب صاعد (AUTOINCREMENT) + opId وحيد يجعل العمليات
      // idempotent بذاتها (إعادة ترسيخ = تجاهل) + payload JSON كامل.
      // ملاحظة التوافق مع prisma db push: التفرد بفهرس مسمّى «ProdOpLog_opId_key»
      // (نفس توقيع Prisma) لا بـUNIQUE سطريًا — لأن autoindex القيد المجهول
      // لا يستطيع db push إسقاطه/إعادة تعريفه على SQLite.
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "ProdOpLog" (
           "seq"      INTEGER PRIMARY KEY AUTOINCREMENT,
           "opId"     TEXT     NOT NULL,
           "kind"     TEXT     NOT NULL,
           "deviceId" TEXT     NOT NULL,
           "payload"  TEXT     NOT NULL,
           "at"       DATETIME NOT NULL
         )`,
      )
      await db.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "ProdOpLog_opId_key" ON "ProdOpLog"("opId")`,
      )
      // قياس الاقتران الفوري (عقد §30 — M1.1): التسييل QR→pair→أول قيمة
      // بيانات وصفية حصرًا (أرقام/أزمنة/أسماء — لا محتوى، حرس F6 متوافق).
      // بلا فهارس فوق القيود (درس §28) — فهرس زمني عادي للاستعلام الحي فقط.
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "PairMetric" (
           "id"                 INTEGER PRIMARY KEY AUTOINCREMENT,
           "deviceId"           TEXT     NOT NULL,
           "deviceName"         TEXT     NOT NULL,
           "reregister"         BOOLEAN  NOT NULL,
           "qrToPairMs"         INTEGER  NOT NULL,
           "pairToFirstValueMs" INTEGER,
           "totalMs"            INTEGER,
           "firstValueKind"     TEXT,
           "pass"               BOOLEAN,
           "at"                 DATETIME NOT NULL
         )`,
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "PairMetric_at_idx" ON "PairMetric"("at")`,
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
