"use client"

import {
  Download,
  FileCheck2,
  FileSignature,
  HardDrive,
  Laptop,
  Monitor,
  PackageOpen,
  RefreshCw,
  Smartphone,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"
import { useReleaseInfo } from "@/hooks/use-release-info"
import { useClientOS } from "@/hooks/use-client-os"
import {
  assetUrl,
  formatMB,
  LATEST_RELEASE_PAGE,
  PLATFORMS,
  RELEASE_BASE,
  RELEASES_PAGE,
  SIGNED_ASSETS,
} from "@/lib/download-site-data"

const OS_ICONS = { windows: Monitor, macos: Laptop, linux: HardDrive, android: Smartphone } as const

const OS_TITLES = { windows: "Windows", macos: "macOS", linux: "Linux", android: "Android" } as const

export function DownloadsSection() {
  const { t } = useI18n()
  const { info } = useReleaseInfo()
  const os = useClientOS()

  return (
    <section id="downloads" aria-labelledby="downloads-title" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 id="downloads-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("التحميلات")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {t("جميع الملفات والتوقيعات في صفحة الإصدارات")} — {t("الإصدار الحالي")} {info.version}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {PLATFORMS.map((group) => {
            const Icon = OS_ICONS[group.id]
            const recommended = os === group.id
            return (
              <Card
                key={group.id}
                className={`relative gap-5 rounded-2xl transition-shadow ${
                  recommended ? "border-primary/50 shadow-lg shadow-primary/10" : "hover:shadow-md"
                }`}
              >
                {recommended && (
                  <Badge className="absolute -top-2.5 end-4 gap-1 bg-primary text-primary-foreground">
                    <FileCheck2 className="size-3.5" aria-hidden="true" />
                    {t("مُوصى به لنظامك")}
                  </Badge>
                )}
                <CardHeader className="flex-row items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-6" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold">{OS_TITLES[group.id]}</h3>
                    <p className="text-xs text-muted-foreground">{t(group.requirementsKey)}</p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.assets.map((asset) => {
                    const meta = info.assets[asset.name]
                    const bytes = meta?.bytes ?? 0
                    return (
                      <div
                        key={asset.name}
                        className="flex flex-col gap-2 rounded-xl border bg-background/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p dir="ltr" className="truncate text-left font-mono text-xs font-medium sm:text-sm">
                            {asset.name}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {t(asset.descKey)}
                            {bytes > 0 && <span dir="ltr"> · {formatMB(bytes)}</span>}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {SIGNED_ASSETS.has(asset.name) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-9"
                              asChild
                              title={t("التوقيع الرقمي")}
                            >
                              <a
                                href={`${RELEASE_BASE}/${asset.name}.sig`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`${t("التوقيع الرقمي")} ${asset.name}`}
                              >
                                <FileSignature className="size-4" aria-hidden="true" />
                              </a>
                            </Button>
                          )}
                          <Button size="sm" className="min-h-11 gap-1.5" asChild>
                            <a
                              href={assetUrl(asset.name)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`${t("تنزيل")} ${asset.name}`}
                            >
                              <Download className="size-4" aria-hidden="true" />
                              {t("تنزيل")}
                            </a>
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* utility links */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" className="min-h-11 gap-2" asChild>
            <a href={`${RELEASE_BASE}/SHA256SUMS.txt`} target="_blank" rel="noopener noreferrer">
              <FileCheck2 className="size-4 text-primary" aria-hidden="true" />
              SHA256SUMS.txt
            </a>
          </Button>
          <Button variant="outline" className="min-h-11 gap-2" asChild>
            <a href={`${RELEASE_BASE}/latest.json`} target="_blank" rel="noopener noreferrer">
              <RefreshCw className="size-4 text-primary" aria-hidden="true" />
              latest.json
            </a>
          </Button>
          <Button variant="outline" className="min-h-11 gap-2" asChild>
            <a href={LATEST_RELEASE_PAGE} target="_blank" rel="noopener noreferrer">
              <PackageOpen className="size-4 text-primary" aria-hidden="true" />
              {t("صفحة الإصدارات")}
            </a>
          </Button>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground" dir="ltr">
          {RELEASES_PAGE}
        </p>
      </div>
    </section>
  )
}
