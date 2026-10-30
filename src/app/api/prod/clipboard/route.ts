// الحافظة الموحدة — قائمة/إضافة/مسح
// FA-clipboard-sync: السجل التعاقدي = آخر 50 عنصرًا (عقد §11)
// عقد §50 — خزنة الحافظة الذكية: التصنيف عند الدخول + سياسة الانتهاء + العرض
// المخفيّ للحساس (البحث/الكشف/التدبيس في المسار الفرعي /vault حصرًا).
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

export const dynamic = "force-dynamic"

export async function GET() {
  await purgeExpired().catch(() => 0)
  const items = await db.prodClip.findMany({ orderBy: { createdAt: "desc" }, take: 50 })
  return Response.json({
    items: items.map((i) => serClipItem(i)),
    vault: vaultStats(items, Date.now()),
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
  const item = await db.prodClip.create({
    data: {
      deviceId,
      deviceName: d.deviceName || syncDeviceName(deviceId),
      kind: d.kind || "text",
      content: contentStr.slice(0, 4_000_000),
      fileName: d.fileName || null,
      filePath: d.filePath || null,
      size: d.size || (d.content?.length ?? 0),
      mode: d.mode || "manual",
      pinned: false,
      sensitive: cls.sensitive,
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
    },
  })
  // SEC (F6): بث الحافظة بقواعد الهوية — المحتوى الكامل للجهاز المحلي حصرًا،
  // وعملاء الشبكة بيانات وصفية والمحتوى يصلهم مشفرًا عبر قناة 3009
  // §50: وسم الحساسية يرافق البث (المحتوى كما هو — الإخفاء على العرض/القوائم)
  prodEmitClip({ ...item, createdAt: item.createdAt.getTime() })
  // FA-harden (عقد §16) — تدقيق الحافظة (أصل: هاتف/ويب/المراقب الأصلي)
  void writeServerAudit({
    action: "clipboard",
    detail: `مشاركة حافظة (${item.kind}${item.size ? `, ${item.size} بايت` : ""}) — وضع ${item.mode}`,
    actor: item.deviceName || item.deviceId,
    deviceId: item.deviceId,
  }).catch(() => null)
  return Response.json({ ok: true, item: serClipItem(item), tags: cls.tags })
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
    return Response.json({ ok: true, name: path.basename(target), bytes: st.size, item: updated })
  } catch (e) {
    return Response.json({ ok: false, error: "تعذر نسخ الملف: " + String(e) }, { status: 500 })
  }
}
