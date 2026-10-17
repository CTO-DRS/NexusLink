/**
 * Download-site static data — offline snapshot of the latest GitHub release.
 * Snapshot verified live against api.github.com on 2026-10-17 (v1.1.0-fix4).
 * The site refreshes these values at runtime via use-release-info.ts;
 * this snapshot guarantees the page renders correctly even fully offline.
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
  tag: "v1.1.0-fix4",
  version: "1.1.0",
  publishedAt: "2026-10-16T00:34:24Z",
  live: false,
  assets: {
    "NexusLink_1.1.0_x64-setup.exe": { name: "NexusLink_1.1.0_x64-setup.exe", bytes: 46463176 },
    "NexusLink_1.1.0_x64_en-US.msi": { name: "NexusLink_1.1.0_x64_en-US.msi", bytes: 85203228 },
    "NexusLink_1.1.0_x64-portable.zip": { name: "NexusLink_1.1.0_x64-portable.zip", bytes: 104678306 },
    "NexusLink_1.1.0_aarch64.dmg": { name: "NexusLink_1.1.0_aarch64.dmg", bytes: 115542694 },
    "NexusLink.app.tar.gz": { name: "NexusLink.app.tar.gz", bytes: 117682302 },
    "NexusLink_1.1.0_amd64.AppImage": { name: "NexusLink_1.1.0_amd64.AppImage", bytes: 174275064 },
    "NexusLink_1.1.0_amd64.deb": { name: "NexusLink_1.1.0_amd64.deb", bytes: 97522544 },
    "NexusLink-1.1.0-release.apk": { name: "NexusLink-1.1.0-release.apk", bytes: 140264670 },
    "app-release.aab": { name: "app-release.aab", bytes: 67009059 },
    "latest.json": { name: "latest.json", bytes: 1964 },
    "SHA256SUMS.txt": { name: "SHA256SUMS.txt", bytes: 1403 },
  },
}

export function releaseVersion(tag: string): string {
  return tag.replace(/^v/, "").replace(/-fix\d+$/, "")
}

export function assetUrl(name: string): string {
  return `${RELEASE_BASE}/${name}`
}

/** Assets that ship with an updater signature (.sig) on the releases page. */
export const SIGNED_ASSETS = new Set([
  "NexusLink_1.1.0_x64-setup.exe",
  "NexusLink_1.1.0_x64_en-US.msi",
  "NexusLink.app.tar.gz",
  "NexusLink_1.1.0_amd64.AppImage",
  "NexusLink_1.1.0_amd64.deb",
])

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

/** The download asset that best matches a visitor's operating system. */
export function primaryAssetFor(os: OsKind): string | null {
  switch (os) {
    case "windows":
      return "NexusLink_1.1.0_x64-setup.exe"
    case "macos":
      return "NexusLink_1.1.0_aarch64.dmg"
    case "linux":
      return "NexusLink_1.1.0_amd64.AppImage"
    case "android":
      return "NexusLink-1.1.0-release.apk"
    default:
      return null
  }
}

export interface PlatformGroup {
  id: Exclude<OsKind, "other">
  /** main downloadable assets, in display order */
  assets: { name: string; descKey: string }[]
  requirementsKey: string
}

export const PLATFORMS: PlatformGroup[] = [
  {
    id: "windows",
    assets: [
      { name: "NexusLink_1.1.0_x64-setup.exe", descKey: "المثبّت الرسمي" },
      { name: "NexusLink_1.1.0_x64_en-US.msi", descKey: "حزمة MSI للمؤسسات" },
      { name: "NexusLink_1.1.0_x64-portable.zip", descKey: "نسخة محمولة دون تثبيت" },
    ],
    requirementsKey: "المتطلبات: Windows 10/11 (64-bit)",
  },
  {
    id: "macos",
    assets: [
      { name: "NexusLink_1.1.0_aarch64.dmg", descKey: "صورة قرص Mac (Apple Silicon)" },
      { name: "NexusLink.app.tar.gz", descKey: "تطبيق macOS مضغوط" },
    ],
    requirementsKey: "المتطلبات: macOS 12+ (Apple Silicon)",
  },
  {
    id: "linux",
    assets: [
      { name: "NexusLink_1.1.0_amd64.AppImage", descKey: "تشغيل مباشر بنقرة واحدة" },
      { name: "NexusLink_1.1.0_amd64.deb", descKey: "حزمة Debian/Ubuntu" },
    ],
    requirementsKey: "المتطلبات: Ubuntu 20.04+ / Debian 11+ (64-bit)",
  },
  {
    id: "android",
    assets: [
      { name: "NexusLink-1.1.0-release.apk", descKey: "تثبيت مباشر على هاتفك" },
      { name: "app-release.aab", descKey: "للنشر عبر Google Play أو أدوات MDM" },
    ],
    requirementsKey: "المتطلبات: Android 7+ (يُنصح 10 وما فوق)",
  },
]
