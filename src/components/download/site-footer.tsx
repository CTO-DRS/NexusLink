"use client"

import { Github, Heart, ExternalLink } from "lucide-react"
import Image from "next/image"
import { useI18n } from "@/lib/i18n"
import { useReleaseInfo } from "@/hooks/use-release-info"
import { ISSUES_URL, RELEASES_PAGE, REPO_URL } from "@/lib/download-site-data"

export function SiteFooter() {
  const { t } = useI18n()
  const { info } = useReleaseInfo()

  return (
    <footer className="mt-auto border-t border-border/60 bg-card/50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col items-center justify-between gap-8 md:flex-row md:items-start">
          <div className="max-w-sm space-y-3 text-center md:text-start">
            <div className="flex items-center justify-center gap-2.5 md:justify-start">
              <Image src="/logo.svg" alt="" width={26} height={26} className="dark:invert" />
              <span className="text-base font-bold">NexusLink</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("موقع التنزيل الرسمي لمشروع NexusLink — ربط الأجهزة محليًا بخصوصية كاملة.")}
            </p>
          </div>

          <nav aria-label="footer" className="flex flex-col items-center gap-2.5 md:items-start">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Github className="size-4" aria-hidden="true" />
              GitHub
            </a>
            <a
              href={RELEASES_PAGE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              {t("صفحة الإصدارات")}
            </a>
            <a
              href={ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              {t("التبليغ عن مشكلة")}
            </a>
          </nav>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row">
          <span>
            {t("الإصدار الحالي")}: <span dir="ltr">{info.tag}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            {t("بُني بحب للأجهزة المتصلة")}
            <Heart className="size-3.5 fill-primary text-primary" aria-hidden="true" />
          </span>
        </div>
      </div>
    </footer>
  )
}
