// عقد §50 — خزنة الحافظة الذكية — مسار الإجراءات (بحث/تدبيس/كشف/حذف)
// ============================================================
// GET  ?q=…  → بحث مرتب في السجل (بادئة > احتواء > تسلسل — دلالات §33.أ)
//              النتائج مخفيّة تلقائيًا إن كانت حساسية (الكشف مسار مقصود).
// POST { action: "pin" | "unpin" | "reveal" | "delete" | "sweep", id? }:
//  - pin/unpin: المثبت لا ينتهي ولا يُنقّى — القرار يدوي صريح.
//  - reveal: الكشف الكامل لعنصر حساس — مُدقَّق حصرًا (سجل §16 بلا محتوى F6).
//  - delete: حذف عنصر واحد بمعرفه.
//  - sweep: تطهير المنتهي (غير المثبت) الآن — idempotent.
// صفر مخطط جديد: أعمدة ProdClip الإضافية الثلاثة (نمط الترقية الآمنة §26.ط).
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { prodEmit } from "@/lib/nexus/productivity-bridge"
import { writeServerAudit } from "@/lib/nexus/desktop-hardening"
import { searchClips, vaultStats } from "@/lib/nexus/clip-vault-core"
import { purgeExpired, serClipItem } from "@/lib/nexus/clip-vault-server"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  await purgeExpired().catch(() => 0)
  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? ""
  const take = q ? 400 : 50 // البحث يفحص أعمق من عرض «آخر 50» التعاقدي (§11 يبقى كما هو)
  const rows = await db.prodClip.findMany({ orderBy: { createdAt: "desc" }, take })
  if (q.trim()) {
    const hits = searchClips(rows, q)
    const byId = new Map(rows.map((r) => [r.id, r]))
    const items = hits.map((h) => (byId.get(h.id) ? serClipItem(byId.get(h.id)!) : null)).filter(Boolean)
    return NextResponse.json({ ok: true, q, items })
  }
  return NextResponse.json({
    ok: true,
    items: rows.map((r) => serClipItem(r)),
    vault: vaultStats(rows, Date.now()),
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? "")
  const id = body?.id ? String(body.id) : null

  if (action === "sweep") {
    const removed = await purgeExpired()
    return NextResponse.json({ ok: true, removed })
  }

  if (!id) return NextResponse.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const item = await db.prodClip.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ ok: false, error: "عنصر غير موجود" }, { status: 404 })

  if (action === "pin" || action === "unpin") {
    const pinned = action === "pin"
    const updated = await db.prodClip.update({ where: { id }, data: { pinned } })
    prodEmit("clip:pinned", { id, pinned, at: Date.now() })
    void writeServerAudit({ action: "clipboard", detail: `${pinned ? "تدبيس" : "إلغاء تدبيس"} عنصر خزنة الحافظة`, actor: item.deviceName || item.deviceId, deviceId: item.deviceId }).catch(() => null)
    return NextResponse.json({ ok: true, item: serClipItem(updated) })
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
