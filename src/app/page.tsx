import { NexusApp } from "@/components/nexus/nexus-app"
import { SiteHome } from "@/components/site/site-home"

/**
 * فصل مسار الجذر بعقد صريح:
 *  · /?desktop=1 — تطبيق سطح المكتب (procman.rs يفتحه دائمًا — عقد حرفي لم يُمس)
 *  · /?app=1     — واجهة التطبيق في المتصفح دون جسر سطح المكتب (يستخدمها /phone)
 *  · /           — الموقع الرسمي للمنتج (الرئيسية) لأي زائر آخر
 * الفصل يجري في الخادم عبر searchParams — بلا وميض ولا إعادة توجيه.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const appMode = "desktop" in sp || "app" in sp
  return appMode ? <NexusApp /> : <SiteHome />
}
