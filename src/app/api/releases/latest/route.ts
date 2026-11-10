// تكليف 50 (FA-21) — وكيل الإصدارات الحية من نفس الأصل — إغلاق البند المفتوح المعلن بعد تكليف 49
// ==================================================================================================
// الفجوة المغلقة (سبقية مؤكدة في حدود تكليف 49 الصادقة):
//   use-release-info كان يجلب api.github.com من المتصفح مباشرة — وFA-18 جعلت connect-src 'self'
//   صافية فأصبح الطلب **مصدودًا بضمانة على كل تحميل صفحة** (مخالفة CSP في وحدة التحكم + فشل صامت)
//   فظل الموقع يعرض لقطة v1.1.0-fix4 القديمة بينما الإصدار الحي v3.1.0 — شهر كامل من المعلومات الكاذبة.
// الإغلاق (نمط FA-18 نفسه — وكيل /api/phone-media/list + نمط /api/version):
//   1) نفس الأصل حصرًا: المتصفح يجلب /api/releases/latest — connect-src 'self' تمره بلا أي استثناء CSP.
//   2) الوجهة ثابتة حرفيًا في الكود من حالة السيرفر حصرًا — **صفر دخل عميل في العنوان العلوي ⇒ صفر SSRF بنيويًا**
//      (لا معلمة ولا مسار يحدده المستدعي — أي استدعاء يجلب الإصدار الأحدث للمستودع نفسه فقط).
//   3) بلا مفاتيح API إطلاقًا — نقطة عامة للقراءة فقط بمستوى كشف مساوٍ لـ/api/version (بيانات تسويقية عمومية:
//      وسم الإصدار وأحجام الأصول وعدد التنزيلات — صفر بيانات مستخدم).
//   4) كاش ذاكرة داخل العملية: نجاح ‏10 دقائق (حد معدل GitHub غير الموثق 60/ساعة محميًا) وفشل ‏60 ثانية فقط
//      (لا يُخزَّن الفشل طويلًا فتعود الحيوية بعد الشبكة بسرعة).
//   5) فشل المنبع (أوفلاين/معدل/مهلة) → اللقطة المضمّنة بصدق: live=false — الصفحة لا تُظهر «مباشر من GitHub»
//      إلا على بيانات حية فعلًا (عقد العرض نفسه المحفوظ حرفيًا).
//   6) ترويسة x-release-cache: hit|miss|fallback — قابلية ملاحظة صادقة للبوابة الحية.
import { NextResponse } from "next/server"
import { STATIC_RELEASE, releaseVersion, type ReleaseAssetInfo } from "@/lib/download-site-data"

export const dynamic = "force-dynamic"

/** العنوان العلوي ثابت حرفيًا — لا يُبنى من أي دخل مستدعي أبدًا (حرس SSRF البنيوي). */
const UPSTREAM = "https://api.github.com/repos/CTO-DRS/NexusLink/releases/latest"
const TIMEOUT_MS = 5000
const OK_TTL_MS = 10 * 60 * 1000
const FAIL_TTL_MS = 60 * 1000

type ReleasePayload = {
  ok: true
  tag: string
  version: string
  publishedAt: string
  assets: Record<string, ReleaseAssetInfo>
  live: boolean
  fetchedAt: string
}

let cache: { at: number; payload: ReleasePayload } | null = null

function snapshotPayload(now: string): ReleasePayload {
  return {
    ok: true,
    tag: STATIC_RELEASE.tag,
    version: STATIC_RELEASE.version,
    publishedAt: STATIC_RELEASE.publishedAt,
    assets: STATIC_RELEASE.assets,
    live: false,
    fetchedAt: now,
  }
}

async function fetchUpstream(): Promise<ReleasePayload> {
  const r = await fetch(UPSTREAM, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
    headers: { "User-Agent": "NexusLink-Server/3.1.0", Accept: "application/vnd.github+json" },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = (await r.json()) as {
    tag_name?: string
    published_at?: string
    assets?: { name: string; size: number; download_count: number }[]
  }
  const assets: Record<string, ReleaseAssetInfo> = {}
  for (const a of d.assets ?? []) {
    assets[a.name] = { name: a.name, bytes: a.size, downloads: a.download_count }
  }
  if (!d.tag_name || Object.keys(assets).length === 0) throw new Error("bad-release-shape")
  const tag = d.tag_name
  return {
    ok: true,
    tag,
    version: releaseVersion(tag),
    publishedAt: d.published_at ?? STATIC_RELEASE.publishedAt,
    assets,
    live: true,
    fetchedAt: new Date().toISOString(),
  }
}

export async function GET() {
  const now = Date.now()
  if (cache && now - cache.at < (cache.payload.live ? OK_TTL_MS : FAIL_TTL_MS)) {
    return NextResponse.json(cache.payload, { headers: { "x-release-cache": "hit" } })
  }
  try {
    const payload = await fetchUpstream()
    cache = { at: Date.now(), payload }
    return NextResponse.json(payload, { headers: { "x-release-cache": "miss" } })
  } catch {
    // أوفلاين/محدود المعدل — اللقطة المضمّنة بصدق (live:false) وفشل قصير التخزين فقط
    const payload = snapshotPayload(new Date().toISOString())
    cache = { at: Date.now(), payload }
    return NextResponse.json(payload, { headers: { "x-release-cache": "fallback" } })
  }
}
