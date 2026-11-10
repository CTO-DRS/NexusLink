// عقد §50 — خزنة الحافظة الذكية — مسار الإجراءات (بحث/تدبيس/كشف/حذف)
// عقد §58 — قفل الخزنة الساكن: القراءة تُفك شفافًا عند حدود القرص (البحث
// يعمل على النص الصريح في الذاكرة والقاعدة تبقى مغلفات)، والنص العاري
// القديم يُختم عند أول قراءة (ترحيل صامت — نمط §57)، وفعلان جديدان:
//  - seal-all: ختم السجل كاملًا بإرادة صريحة (كل النص العاري فوق القاعدة).
//  - rotate-key: تدوير قفل §58 وإعادة ختم كل الصفوف — يد محلية حصرًا
//    (حرس loopback نمط §37/§51/§57) والمفتاح لا يُعرض أبدًا.
// ============================================================
// GET  ?q=…  → بحث مرتب في السجل (بادئة > احتواء > تسلسل — دلالات §33.أ)
//              النتائج مخفيّة تلقائيًا إن كانت حساسية (الكشف مسار مقصود).
// POST { action: "pin" | "unpin" | "reveal" | "delete" | "sweep" | "seal-all" | "rotate-key", id? }:
//  - pin/unpin: المثبت لا ينتهي ولا يُنقّى — القرار يدوي صريح.
//  - reveal: الكشف الكامل لعنصر حساس — مُدقَّق حصرًا (سجل §16 بلا محتوى F6).
//  - delete: حذف عنصر واحد بمعرفه.
//  - sweep: تطهير المنتهي (غير المثبت) الآن — idempotent.
//  - seal-all (§58): ختم كل النص العاري في السجل — عدّاد حصرًا.
//  - rotate-key (§58/§59): تدوير شامل — أو جهاز مفرد بdeviceId (§59):
//    يد محلية حصرًا (حرس loopback نمط §37/§51/§57) والمفاتيح لا تُعرض أبدًا.
// صفر مخطط جديد: أعمدة ProdClip الإضافية الثلاثة (نمط الترقية الآمنة §26.ط)
// ومفاتيح §58/§59 في DesktopSetting صفر-مخطط (نمط §34.ب/§54/§57/§59).
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { prodEmit } from "@/lib/nexus/productivity-bridge"
import { writeServerAudit } from "@/lib/nexus/desktop-hardening"
import { searchClips, vaultStats } from "@/lib/nexus/clip-vault-core"
import { purgeExpired, serClipItem } from "@/lib/nexus/clip-vault-server"
import {
  loadClipKeyRing, openClipRows, dropUnopenableClipRows,
  migratePlainClipRows, openClipContent,
  sealAllClipRows, rotateClipRestKey, rotateClipKeyFor,
} from "@/lib/nexus/clip-at-rest-server"
import { ringDevices, ringKeyCount } from "@/lib/nexus/clip-multikey"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  // FA-22 (تكليف 51): قائمة الخزنة بمحتواها المفكوك فعل المالك على الكمبيوتر — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "prod.denied", "vault-list")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  await purgeExpired().catch(() => 0)
  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? ""
  const take = q ? 400 : 50 // البحث يفحص أعمق من عرض «آخر 50» التعاقدي (§11 يبقى كما هو)
  const rows = await db.prodClip.findMany({ orderBy: { createdAt: "desc" }, take })
  // §59 — حلقة الأقفال: كل صف يُفك بمفتاح جهازه (kid مغلفه) وv1 بالمفتاح الموحد
  const ring = await loadClipKeyRing()
  // §58/§59 — الترحيل على الخام المخزن قبل الفك حصرًا (درس ب9.ب: بلا إعادة ختم على القراءة)
  const migrated = await migratePlainClipRows(rows, ring).catch(() => 0)
  const { rows: opened, dropped } = openClipRows(rows, ring.resolver)
  if (dropped.length > 0) await dropUnopenableClipRows(dropped, "vault")
  const restStatus = {
    active: ring.legacy !== null || ring.byKid.size > 0,
    keys: ringKeyCount(ring),
    devices: ringDevices(ring).map((d) => d.device),
    migrated,
    dropped: dropped.length,
  }
  if (q.trim()) {
    const hits = searchClips(opened, q)
    const byId = new Map(opened.map((r) => [r.id, r]))
    const items = hits.map((h) => (byId.get(h.id) ? serClipItem(byId.get(h.id)!) : null)).filter(Boolean)
    return NextResponse.json({ ok: true, q, items, atRest: restStatus })
  }
  return NextResponse.json({
    ok: true,
    items: opened.map((r) => serClipItem(r)),
    vault: vaultStats(opened, Date.now()),
    atRest: restStatus,
  })
}

export async function POST(req: Request) {
  // FA-22 (تكليف 51): أفعال الخزنة (كشف/تدبيس/حذف/ختم/تدوير) يد المالك على الكمبيوتر — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "prod.denied", "vault-action")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? "")
  const id = body?.id ? String(body.id) : null

  if (action === "sweep") {
    const removed = await purgeExpired()
    return NextResponse.json({ ok: true, removed })
  }

  // §58 — ختم السجل كاملًا: كل النص العاري فوق القاعدة يُختم بإرادة صريحة
  if (action === "seal-all") {
    const r = await sealAllClipRows()
    return NextResponse.json(r, { status: r.ok ? 200 : 500 })
  }

  // §58/§59 — تدوير الأقفال: يد محلية حصرًا — FA-22 وحّد الحرس أعلاه (guardPcOnly)
  // بدل الكتلة اليدوية القديمة (نفس الشرط: loopback حصرًا) — والمفاتيح لا تُعرض
  // §59: بdeviceId يُدار قفل الجهاز المفرد (صفوفه حصرًا) — وبدونه الشامل
  if (action === "rotate-key") {
    const devId = body?.deviceId ? String(body.deviceId) : null
    if (devId) return NextResponse.json(await rotateClipKeyFor(devId))
    return NextResponse.json(await rotateClipRestKey())
  }

  if (!id) return NextResponse.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const raw = await db.prodClip.findUnique({ where: { id } })
  if (!raw) return NextResponse.json({ ok: false, error: "عنصر غير موجود" }, { status: 404 })
  // §58 — الصف يُفك عند حدود القرص قبل أي فعل (القاعدة مغلفات والذاكرة نص)
  // §59 — الفك بحلقة الأقفال (kid ← مفتاح جهازه)
  const ring = await loadClipKeyRing()
  const openedRow = openClipContent(raw.content, ring.resolver)
  if (!openedRow.ok) {
    // غير قابل للفك: يُسقط فرديًا بصدق (نمط §57) — لا كشف ولا فعل على قناغة ميتة
    await dropUnopenableClipRows([raw.id], "vault-act")
    return NextResponse.json({ ok: false, error: "unopenable" }, { status: 422 })
  }
  const item = { ...raw, content: openedRow.content }

  if (action === "pin" || action === "unpin") {
    const pinned = action === "pin"
    const updated = await db.prodClip.update({ where: { id }, data: { pinned } })
    prodEmit("clip:pinned", { id, pinned, at: Date.now() })
    void writeServerAudit({ action: "clipboard", detail: `${pinned ? "تدبيس" : "إلغاء تدبيس"} عنصر خزنة الحافظة`, actor: item.deviceName || item.deviceId, deviceId: item.deviceId }).catch(() => null)
    return NextResponse.json({ ok: true, item: serClipItem({ ...updated, content: item.content }) })
  }

  if (action === "reveal") {
    if (!item.sensitive) {
      return NextResponse.json({ ok: false, error: "العنصر غير حساس — لا كشف مطلوب" }, { status: 400 })
    }
    // الكشف مقصود مُدقَّق: بلا محتوى في السجل (F6) — وسم الفعل وحده
    void writeServerAudit({ action: "clipboard", detail: `كشف عنصر حساس (${item.sensitive}) من الخزنة`, actor: item.deviceName || item.deviceId, deviceId: item.deviceId }).catch(() => null)
    return NextResponse.json({ ok: true, item: serClipItem(item, true) })
  }

  if (action === "delete") {
    await db.prodClip.delete({ where: { id } })
    prodEmit("clip:deleted", { id, at: Date.now() })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: "فعل غير معروف" }, { status: 400 })
}
