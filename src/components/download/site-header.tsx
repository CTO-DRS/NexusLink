"use client"

import Image from "next/image"
import { Download, Github, Languages } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { REPO_URL } from "@/lib/download-site-data"

const NAV_ITEMS = [
  { href: "#downloads", key: "التحميلات" },
  { href: "#features", key: "الميزات" },
  { href: "#install", key: "دليل التثبيت" },
  { href: "#updates", key: "التحديث والتحقق" },
  { href: "#faq", key: "الأسئلة الشائعة" },
]

export function SiteHeader() {
  const { lang, t, setLang } = useI18n()

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <a
          href="/download"
          className="flex min-h-11 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="NexusLink"
        >
          <Image src="/logo.svg" alt="" width={30} height={30} className="dark:invert" />
          <span className="text-lg font-bold tracking-tight">NexusLink</span>
          <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary sm:inline-block">
            {t("التحميلات")}
          </span>
        </a>

        <nav aria-label="NexusLink" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(item.key)}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1.5 px-3"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            aria-label={t("تبديل اللغة")}
          >
            <Languages className="size-4" aria-hidden="true" />
            <span className="text-sm font-semibold">{lang === "ar" ? "EN" : "عربي"}</span>
          </Button>
          <Button variant="ghost" size="sm" className="min-h-11 gap-1.5 px-3" asChild>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("المستودع على GitHub")}
            >
              <Github className="size-4" aria-hidden="true" />
              <span className="sr-only">{t("المستودع على GitHub")}</span>
            </a>
          </Button>
          <Button size="sm" className="min-h-11 gap-1.5 px-3" asChild>
            <a href="#downloads">
              <Download className="size-4" aria-hidden="true" />
              <span>{t("تنزيل")}</span>
            </a>
          </Button>
        </div>
      </div>
    </header>
  )
}
