// Data-driven banner carousel for the About-the-developer card.
// To announce a new app or offer: add an entry here (title/body/cta are Arabic i18n keys),
// then add the three strings to scripts/add-developer-i18n.mjs and run it. No other code changes.

export type DeveloperBanner = {
  id: string
  title: string
  body: string
  cta: string
  url: string
  /** CSS gradient behind the banner */
  gradient: string
}

export const BANNER_INTERVAL_MS = 5500

export const DEVELOPER_BANNERS: DeveloperBanner[] = [
  {
    id: "nexuslink",
    title: "NexusLink متاح للتحميل الآن",
    body: "اربط أجهزتك عبر شبكتك المحلية — بلا سحابة وبلا حساب",
    cta: "تحميل",
    url: "https://cto-drs.github.io/NexusLink/",
    gradient: "linear-gradient(135deg,#4338CA 0%,#6D3FC9 55%,#0891B2 100%)",
  },
  {
    id: "app-idea",
    title: "عندك فكرة تطبيق؟",
    body: "نصمّم ونطوّر تطبيقك — تواصل مع المطوّر مباشرة",
    cta: "تواصل",
    url: "https://wa.me/message/MVTVWPOPFOVFF1",
    gradient: "linear-gradient(135deg,#0F766E 0%,#2563EB 60%,#7C3AED 100%)",
  },
]

export const APP_SITE_URL = "https://cto-drs.github.io/NexusLink/"
export const RELEASES_PAGE = "https://github.com/CTO-DRS/NexusLink/releases/latest"
