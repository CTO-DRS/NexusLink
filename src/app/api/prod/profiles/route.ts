// ملفات تعريف الشبكات — CRUD + تفعيل
import { db } from "@/lib/db"
import { prodEmit } from "@/lib/nexus/productivity-bridge"
import { guardPcOnly } from "@/lib/nexus/http-guard"

export const dynamic = "force-dynamic"

export async function GET() {
  const profiles = await db.netProfile.findMany({ orderBy: { createdAt: "asc" } })
  const state = await db.prodState.findUnique({ where: { id: "main" } })
  return Response.json({ profiles, state })
}

export async function POST(req: Request) {
  // FA-22 (تكليف 51): إنشاء ملف شخصي (بوابة الإشعارات) — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "prod.denied", "profile-create")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  const d = await req.json().catch(() => null)
  if (!d?.name || !d?.networkName) {
    return Response.json({ ok: false, error: "الاسم واسم الشبكة مطلوبان" }, { status: 400 })
  }
  const profile = await db.netProfile.create({
    data: {
      name: String(d.name).slice(0, 40),
      icon: d.icon || "laptop",
      networkName: String(d.networkName).slice(0, 60),
      photoSync: d.photoSync !== false,
      notifs: d.notifs !== false,
      clipboard: d.clipboard !== false,
      folderSync: d.folderSync !== false,
    },
  })
  return Response.json({ ok: true, profile })
}

export async function PATCH(req: Request) {
  // FA-22 (تكليف 51): تعديل ملف شخصي — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "prod.denied", "profile-update")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  const d = await req.json().catch(() => null)
  if (!d?.id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const data: Record<string, unknown> = {}
  for (const k of ["name", "icon", "networkName"] as const) {
    if (typeof d[k] === "string") data[k] = d[k]
  }
  for (const k of ["photoSync", "notifs", "clipboard", "folderSync"] as const) {
    if (typeof d[k] === "boolean") data[k] = d[k]
  }
  const profile = await db.netProfile.update({ where: { id: d.id }, data })

  // إذا كان الملف المعدّل هو النشط → حدّث بوابة الإشعارات فوراً
  const state = await db.prodState.findUnique({ where: { id: "main" } })
  if (state && state.activeProfileId === d.id) {
    await db.prodState.update({ where: { id: "main" }, data: { notifsPaused: !profile.notifs } })
    prodEmit("net:changed", { network: state.network, profile, auto: false, at: Date.now() })
  }
  return Response.json({ ok: true, profile })
}

export async function DELETE(req: Request) {
  // FA-22 (تكليف 51): حذف ملف شخصي — loopback حصرًا (نمط FA-16)
  if (!guardPcOnly(req, "prod.denied", "profile-delete")) {
    return Response.json({ ok: false, error: "pc-only", detail: "via-gateway-non-loopback" }, { status: 403 })
  }
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ ok: false, error: "معرّف مفقود" }, { status: 400 })
  const prof = await db.netProfile.findUnique({ where: { id } })
  if (prof?.builtin) return Response.json({ ok: false, error: "الملفات المدمجة لا تُحذف — عدّلها بدلاً من ذلك" }, { status: 400 })
  await db.netProfile.delete({ where: { id } })
  const state = await db.prodState.findUnique({ where: { id: "main" } })
  if (state?.activeProfileId === id) {
    await db.prodState.update({ where: { id: "main" }, data: { activeProfileId: null, notifsPaused: false } })
  }
  return Response.json({ ok: true })
}
