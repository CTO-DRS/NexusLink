import dynamic from "next/dynamic"

/**
 * فصل مسار الجذر بعقد صريح:
 *  · /?desktop=1 — تطبيق سطح المكتب (procman.rs يفتحه دائمًا — عقد حرفي لم يُمس)
 *  · /?app=1     — واجهة التطبيق في المتصفح دون جسر سطح المكتب (يستخدمها /phone)
 *  · /           — الموقع الرسمي للمنتج (الرئيسية) لأي زائر آخر
 * الفصل يجري في الخادم عبر searchParams — بلا وميض ولا إعادة توجيه.
 *
 * تكليف 49 (M1 PERF): كان الاستيراد الثابت للطرفين يجعل كلا النمطين يدفعان ثمن
 * حزمة الآخر كاملة (~3MB JS أولية على /). الفصل الديناميكي: زائر الموقع لا
 * ينفّذ سطرًا من التطبيق، ومستخدم التطبيق لا ينفّذ سطرًا من الموقع —
 * العقد نصيًا كما هو (نفس searchParams ونفس المكونات) والفصل في التحميل حصرًا.
 */
const NexusApp = dynamic(() => import("@/components/nexus/nexus-app").then((m) => m.NexusApp))
const SiteHome = dynamic(() => import("@/components/site/site-home").then((m) => m.SiteHome))

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const appMode = "desktop" in sp || "app" in sp
  return appMode ? <NexusApp /> : <SiteHome />
}
