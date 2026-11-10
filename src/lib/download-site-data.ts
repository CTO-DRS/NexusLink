/**
 * Download-site static data — offline snapshot of the latest GitHub release.
 * Snapshot verified live against api.github.com on 2026-11-11 (v3.1.0 — كل
 * الأحجام مأخوذة من المنبع الحي بتاريخ التحقق).
 * The site refreshes these values at runtime via use-release-info.ts which
 * fetches the same-origin proxy /api/releases/latest (تكليف 50 — FA-21);
 * this snapshot guarantees the page renders correctly even fully offline
 * (live=false يُعلن بصدق — لا «مباشر» إلا على بيانات حية فعلًا).
 *
 * تكليف 50: أسماء الأصول مُعاملَة بالإصدار ({{v}}) — كانت مغروسة 1.1.0 حرفيًا
 * فكانت كل مطابقات الأصول الحية تفشل أولًا بأول عند تغيّر الإصدار (الحجم
 * والتنزيلات وشارة التوقيع كلها تختفي) — الآن تُبنى من نسخة الإصدار الحية.
 */

export const REPO_URL = "https://github.com/CTO-DRS/NexusLink"
export const RELEASES_PAGE = `${REPO_URL}/releases`
export const LATEST_RELEASE_PAGE = `${REPO_URL}/releases/latest`
export const RELEASE_BASE = `${REPO_URL}/releases/latest/download`
export const ISSUES_URL = `${REPO_URL}/issues`

/**
 * صفحة النشر المستقلة (HTML أحادي الملف، عربي/إنجليزي) المستضافة على GitHub Pages.
 * تُفتح مباشرة في المتصفح — بخلاف أصول release التي تُنزَّل (octet-stream).
 */
export const RELEASE_PAGE_LIVE = "https://cto-drs.github.io/NexusLink/"

export interface ReleaseAssetInfo {
  name: string
  bytes: number
  downloads?: number
}

export interface ReleaseInfo {
  tag: string
  version: string
  publishedAt: string
  assets: Record<string, ReleaseAssetInfo>
  live: boolean
}

export const STATIC_RELEASE: ReleaseInfo = {
  tag: "v3.1.0",
  version: "3.1.0",
  publishedAt: "2026-10-29T13:07:52Z",
  live: false,
  assets: {
    "NexusLink_3.1.0_x64-setup.exe": { name: "NexusLink_3.1.0_x64-setup.exe", bytes: 47501272 },
    "NexusLink_3.1.0_x64_en-US.msi": { name: "NexusLink_3.1.0_x64_en-US.msi", bytes: 89258409 },
    "NexusLink_3.1.0_x64-portable.zip": { name: "NexusLink_3.1.0_x64-portable.zip", bytes: 108709073 },
    "NexusLink_3.1.0_aarch64.dmg": { name: "NexusLink_3.1.0_aarch64.dmg", bytes: 119553439 },
    "NexusLink.app.tar.gz": { name: "NexusLink.app.tar.gz", bytes: 121735260 },
    "NexusLink_3.1.0_amd64.AppImage": { name: "NexusLink_3.1.0_amd64.AppImage", bytes: 182422008 },
    "NexusLink_3.1.0_amd64.deb": { name: "NexusLink_3.1.0_amd64.deb", bytes: 101567520 },
    "NexusLink-3.1.0-release.apk": { name: "NexusLink-3.1.0-release.apk", bytes: 140472698 },
    "app-release.aab": { name: "app-release.aab", bytes: 67144540 },
    "NexusLink-Release-Page.html": { name: "NexusLink-Release-Page.html", bytes: 60726 },
    "latest.json": { name: "latest.json", bytes: 1949 },
    "SHA256SUMS.txt": { name: "SHA256SUMS.txt", bytes: 1403 },
  },
}

export function releaseVersion(tag: string): string {
  return tag.replace(/^v/, "").replace(/-fix\d+$/, "")
}

/**
 * تكليف 50: قوالب الأسماء بمقطع {{v}} يُستبدل بنسخة الإصدار الحية —
 * الاسم الناتج يطابق أصل الإصدار على GitHub حرفيًا (مُثبت حيًا على v3.1.0).
 */
export function resolveAssetName(template: string, version: string): string {
  return template.replace(/\{\{v\}\}/g, version)
}

export function assetUrl(name: string): string {
  return `${RELEASE_BASE}/${name}`
}

/** قوالب الأصول الحاملة لتوقيع المحدّث (.sig) على صفحة الإصدارات — تعكس أصول v3.1.0 الحية. */
const SIGNED_TEMPLATES = [
  "NexusLink_{{v}}_x64-setup.exe",
  "NexusLink_{{v}}_x64_en-US.msi",
  "NexusLink.app.tar.gz",
  "NexusLink_{{v}}_amd64.AppImage",
  "NexusLink_{{v}}_amd64.deb",
]

/** هل هذا الأصل (باسمه المحسوم من النسخة الحية) يُشحن بتوقيع رقمي؟ */
export function isSignedAsset(name: string, version: string): boolean {
  return SIGNED_TEMPLATES.some((t) => resolveAssetName(t, version) === name)
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export type OsKind = "windows" | "macos" | "linux" | "android" | "other"

export function detectOS(ua: string): OsKind {
  const s = ua.toLowerCase()
  if (s.includes("android")) return "android"
  if (s.includes("windows") || s.includes("win32")) return "windows"
  if (s.includes("mac os") || s.includes("macintosh")) return "macos"
  if (s.includes("linux") || s.includes("x11") || s.includes("cros")) return "linux"
  return "other"
}

/** أصل التنزيل الموصى به لنظام الزائر — محسومًا من نسخة الإصدار الحية لا اسم مغروس قديم. */
export function primaryAssetFor(os: OsKind, version: string): string | null {
  switch (os) {
    case "windows":
      return resolveAssetName("NexusLink_{{v}}_x64-setup.exe", version)
    case "macos":
      return resolveAssetName("NexusLink_{{v}}_aarch64.dmg", version)
    case "linux":
      return resolveAssetName("NexusLink_{{v}}_amd64.AppImage", version)
    case "android":
      return resolveAssetName("NexusLink-{{v}}-release.apk", version)
    default:
      return null
  }
}

export interface PlatformGroup {
  id: Exclude<OsKind, "other">
  /** main downloadable asset name templates, in display order ({{v}} = نسخة الإصدار) */
  assets: { name: string; descKey: string }[]
  requirementsKey: string
}

export const PLATFORMS: PlatformGroup[] = [
  {
    id: "windows",
    assets: [
      { name: "NexusLink_{{v}}_x64-setup.exe", descKey: "المثبّت الرسمي" },
      { name: "NexusLink_{{v}}_x64_en-US.msi", descKey: "حزمة MSI للمؤسسات" },
      { name: "NexusLink_{{v}}_x64-portable.zip", descKey: "نسخة محمولة دون تثبيت" },
    ],
    requirementsKey: "المتطلبات: Windows 10/11 (64-bit)",
  },
  {
    id: "macos",
    assets: [
      { name: "NexusLink_{{v}}_aarch64.dmg", descKey: "صورة قرص Mac (Apple Silicon)" },
      { name: "NexusLink.app.tar.gz", descKey: "تطبيق macOS مضغوط" },
    ],
    requirementsKey: "المتطلبات: macOS 12+ (Apple Silicon)",
  },
  {
    id: "linux",
    assets: [
      { name: "NexusLink_{{v}}_amd64.AppImage", descKey: "تشغيل مباشر بنقرة واحدة" },
      { name: "NexusLink_{{v}}_amd64.deb", descKey: "حزمة Debian/Ubuntu" },
    ],
    requirementsKey: "المتطلبات: Ubuntu 20.04+ / Debian 11+ (64-bit)",
  },
  {
    id: "android",
    assets: [
      { name: "NexusLink-{{v}}-release.apk", descKey: "تثبيت مباشر على هاتفك" },
      { name: "app-release.aab", descKey: "للنشر عبر Google Play أو أدوات MDM" },
    ],
    requirementsKey: "المتطلبات: Android 7+ (يُنصح 10 وما فوق)",
  },
]
