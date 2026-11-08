// الحافظة الموحدة — قائمة/إضافة/مسح
// FA-clipboard-sync: السجل التعاقدي = آخر 50 عنصرًا (عقد §11)
// عقد §50 — خزنة الحافظة الذكية: التصنيف عند الدخول + سياسة الانتهاء + العرض
// المخفيّ للحساس (البحث/الكشف/التدبيس في المسار الفرعي /vault حصرًا).
// عقد §58 — قفل الخزنة الساكن: المحتوى لا يُكتب في القاعدة نصًّا عاريًا أبدًا —
// الختم قبل ملامسة القاعدة (إن وُجد مفتاح) والقراءة تُفك شفافًا عند حدود
// القرص، والنص العاري القديم يُختم تلقائيًا عند أول قراءة (ترحيل صامت) —
// والقفل للقرص حصرًا: الذاكرة والبث المحلي نص صريح (حد §57 المعلن).
import { promises as fs } from "fs"
import path from "path"
import { db } from "@/lib/db"
import { resolveSafe } from "@/lib/nexus/fs-server"
import { prodEmit, prodEmitClip } from "@/lib/nexus/productivity-bridge"
import { syncDeviceName } from "@/lib/nexus/sync-engine"
import { writeServerAudit } from "@/lib/nexus/desktop-hardening"
import { classifyClip, retentionAt } from "@/lib/nexus/clip-vault-core"
import { purgeExpired, serClipItem } from "@/lib/nexus/clip-vault-server"
import { vaultStats } from "@/lib/nexus/clip-vault-core"
import { CLIP_CONTENT_MAX } from "@/lib/nexus/clip-crypto"
import {
  ensureClipRestKey, loadClipRestKey,
  openClipRows, dropUnopenableClipRows, migratePlainClipRows,
  sealClipContent, openClipContent,
} from "@/lib/nexus/clip-at-rest-server"

export const dynamic = "force-dynamic"

export async function GET() {
  await purgeExpired().catch(() => 0)
  const rows = await db.prodClip.findMany({ orderBy: { createdAt: "desc" }, take: 50 })
  const key = await loadClipRestKey()
  const { rows: opened, dropped } = openClipRows(rows, key)
  if (dropped.length > 0) await dropUnopenableClipRows(dropped, "list")
  // §58 — الترحيل الصامت: النص العاري القديم يُختم عند أول قراءة (نمط §57)
  const migrated = await migratePlainClipRows(opened, key).catch(() => 0)
  return Response.json({
    items: opened.map((i) => serClipItem(i)),
    vault: vaultStats(opened, Date.now()),
    atRest: { active: key !== null, migrated, dropped: dropped.length },
  })
}

export async function POST(req: Request) {
  const d = await req.json().catch(() => null)
  if (!d) return Response.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 })

  const deviceId = d.deviceId || "pc-office"
  // §50 — التصنيف الحتمي للنص عند الدخول (الصور/الملفات لا تُصنَّف — حدود صادقة)
  const contentStr = typeof d.content === "string" ? d.content : ""
  const isClassifiable = (d.kind || "text") === "text" && contentStr.length > 0 && !contentStr.startsWith("data:")
  const cls: ReturnType<typeof classifyClip> = isClassifiable ? classifyClip(contentStr) : { sensitive: null, tags: [] }
  const nowMs = Date.now()
  // §50.و — سياسة الانتهاء: الحساس 15 دقيقة · العادي 7 أيام · «اللصق المؤقت»
  // (expiresAt من العميل) مُثبّت السقف 24 ساعة ولا يطيل أبدًا فوق السقف.
  const expiresAtMs = retentionAt({
    sensitive: cls.sensitive,
    pinned: false,
    createdAtMs: nowMs,
    nowMs,
    expiresAtFrom: typeof d.expiresAt === "number" ? d.expiresAt : null,
  })
  // §58 — الختم قبل ملامسة القاعدة: التصنيف على النص الصريح ثم الختم (نمط §57)
  const key = await ensureClipRestKey()
  const memContent = contentStr.slice(0, CLIP_CONTENT_MAX)
  const storedContent = sealClipContent(memContent, key)
  const item = await db.prodClip.create({
    data: {
      deviceId,
      deviceName: d.deviceName || syncDeviceName(deviceId),
      kind: d.kind || "text",
      content: storedContent,
      fileName: d.fileName || null,
      filePath: d.filePath || null,
      size: d.size || memContent.length,
      mode: d.mode || "manual",
      pinned: false,
      sensitive: cls.sensitive,
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
    },
  })
  // الذاكرة والبث نص صريح — القفل للقرص حصرًا (حد §58 الصادق)
  const memItem = { ...item, content: memContent }
  // SEC (F6): بث الحافظة بقواعد الهوية — المحتوى الكامل للجهاز المحلي حصرًا،
  // وعملاء الشبكة بيانات وصفية والمحتوى يصلهم مشفرًا عبر قناة 3009
  // §50: وسم الحساسية يرافق البث (المحتوى كما هو — الإخفاء على العرض/القوائم)
  prodEmitClip({ ...memItem, createdAt: memItem.createdAt.getTime() })
  // FA-harden (عقد §16) — تدقيق الحافظة (أصل: هاتف/ويب/المراقب الأصلي)
  void writeServerAudit({
    action: "clipboard",
    detail: `مشاركة حافظة (${item.kind}${item.size ? `, ${item.size} بايت` : ""}) — وضع ${item.mode}`,
    actor: item.deviceName || item.deviceId,
    deviceId: item.deviceId,
  }).catch(() => null)
  return Response.json({ ok: true, item: serClipItem(memItem), tags: cls.tags, atRest: { active: key !== null } })
}

export async function DELETE() {
  await db.prodClip.deleteMany({})
  prodEmit("clip:cleared", { at: Date.now() })
  return Response.json({ ok: true })
}

/** استلام ملف فعلي: نسخ بايتات الملف من جهاز المصدر إلى تنزيلات الكمبيوتر */
export async function PUT(req: Request) {
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const item = await db.prodClip.findUnique({ where: { id } })
  if (!item || item.kind !== "file" || !item.filePath) {
    return Response.json({ ok: false, error: "عنصر غير صالح" }, { status: 404 })
  }
  try {
    const src = resolveSafe(item.deviceId, item.filePath)
    const dstDir = resolveSafe("pc-office", "/Downloads")
    let target = path.join(dstDir, item.fileName || path.basename(item.filePath))
    // اسم بديل عند وجود ملف بنفس الاسم
    for (let i = 1; i < 50; i++) {
      try {
        await fs.access(target)
        const dot = (item.fileName || "").lastIndexOf(".")
        const stem = dot > 0 ? (item.fileName || "").slice(0, dot) : item.fileName || "ملف"
        const ext = dot > 0 ? (item.fileName || "").slice(dot) : ""
        target = path.join(dstDir, `${stem} (${i})${ext}`)
      } catch { break }
    }
    await fs.copyFile(src, target)
    const st = await fs.stat(target)
    const updated = await db.prodClip.update({ where: { id }, data: { received: true } })
    prodEmit("clip:received", { id, name: path.basename(target), bytes: st.size, at: Date.now() })
    // §58: العائد شفاف — محتوى مقروء لا مغلف (نمط القراءة الموحد)
    const restKey = await loadClipRestKey()
    const oc = openClipContent(updated.content, restKey)
    const openedItem = { ...updated, content: oc.ok ? oc.content : "" }
    return Response.json({ ok: true, name: path.basename(target), bytes: st.size, item: openedItem })
  } catch (e) {
    return Response.json({ ok: false, error: "تعذر نسخ الملف: " + String(e) }, { status: 500 })
  }
}
