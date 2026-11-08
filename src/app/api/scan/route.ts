// عقد §55 — الماسح الموثق الحي — المسار العام (إدارة الجلسة)
// ============================================================
// GET  ?id=… → حالة الجلسة (بلا بايتات صور)
// GET        → الجلسات المفتوحة
// POST { action: "open" | "rotate" | "move" | "remove" | "seal" | "cancel" }
//  - open: { title? } — جلسة جديدة (سقف 3 مفتوحة)
//  - rotate: { id, n, deg ∈ 0|90|180|270 } · move: { id, from, to } · remove: { id, n }
//  - seal: { id, targetFolder? } — يبني PDF ويكتبه في مجلد الكمبيوتر الافتراضي
//  - cancel: { id } — حذف الجلسة وصفحاتها
// رفع الصفحات: POST /api/scan/page (multipart حقل file) + ?id=…
import { NextResponse } from "next/server"
import {
  openScanSession, getScanSession, addScanPage, actScanPage, cancelScanSession, sealScanSession, openSessions,
} from "@/lib/nexus/scan-server"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  if (id) {
    const r = getScanSession(id)
    return NextResponse.json(r, { status: r.ok ? 200 : 404 })
  }
  return NextResponse.json({ ok: true, sessions: openSessions().map((s) => ({ id: s.id, title: s.title, pages: s.pages.length, createdAt: s.createdAt })) })
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* بلا جسم */ }
  const action = String(body.action ?? "")
  const id = String(body.id ?? "")

  if (action === "open") return NextResponse.json(await openScanSession(body))
  if (action === "rotate" || action === "move" || action === "remove") {
    const r = await actScanPage(id, action, body)
    return NextResponse.json(r, { status: r.ok ? 200 : r.error === "not-found" ? 404 : 400 })
  }
  if (action === "seal") {
    const r = await sealScanSession(id, typeof body.targetFolder === "string" ? body.targetFolder : undefined)
    return NextResponse.json(r, { status: r.ok ? 200 : r.error === "not-found" ? 404 : 400 })
  }
  if (action === "cancel") {
    const r = await cancelScanSession(id)
    return NextResponse.json(r, { status: r.ok ? 200 : 404 })
  }
  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 })
}
