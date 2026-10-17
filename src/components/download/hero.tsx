"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { CloudOff, Download, Globe, Laptop, MonitorSmartphone, ShieldCheck, Smartphone } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { useReleaseInfo } from "@/hooks/use-release-info"
import { useClientOS } from "@/hooks/use-client-os"
import {
  assetUrl,
  formatMB,
  primaryAssetFor,
  RELEASE_PAGE_LIVE,
  type OsKind,
} from "@/lib/download-site-data"

const OS_LABEL_KEY: Record<Exclude<OsKind, "other">, string> = {
  windows: "تحميل لنظام Windows",
  macos: "تحميل لنظام macOS",
  linux: "تحميل لنظام Linux",
  android: "تحميل لنظام Android",
}

export function Hero() {
  const { lang, t } = useI18n()
  const { info, loading } = useReleaseInfo()
  const os = useClientOS()

  const primary = useMemo(() => primaryAssetFor(os), [os])
  const primaryAsset = primary ? info.assets[primary] : undefined

  const published = useMemo(() => {
    try {
      return new Date(info.publishedAt).toLocaleDateString(lang === "ar" ? "ar" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    } catch {
      return info.publishedAt.slice(0, 10)
    }
  }, [info.publishedAt, lang])

  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden"
    >
      {/* decorative teal glows */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 start-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl rtl:translate-x-1/2" />
        <div className="absolute bottom-0 end-0 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          {/* version badge */}
          <div className="mb-5 flex items-center justify-center">
            <Badge
              variant="outline"
              className="gap-2 border-primary/30 bg-primary/5 px-3 py-1.5 text-sm"
            >
              <span className="relative flex size-2">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    loading ? "bg-muted-foreground" : "animate-ping bg-emerald-500"
                  }`}
                />
                <span
                  className={`relative inline-flex size-2 rounded-full ${
                    loading ? "bg-muted-foreground" : "bg-emerald-500"
                  }`}
                />
              </span>
              <span>
                {t("أحدث إصدار")}: {info.version}
              </span>
              {info.live && <span className="text-xs text-emerald-600 dark:text-emerald-400">· {t("مباشر من GitHub")}</span>}
            </Badge>
          </div>

          <motion.h1
            id="hero-title"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl"
          >
            {t("اربط أجهزتك… بخصوصية كاملة")}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            {t(
              "NexusLink يصل هاتفك بجهاز الكمبيوتر محليًا على شبكتك: حافظة مشتركة، نقل ملفات، تحكم عن بُعد، ومرآة شاشة — بتشفير من الطرف إلى الطرف ودون أي سحابة."
            )}
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            {primary ? (
              <Button size="lg" className="h-12 min-w-56 gap-2 text-base" asChild>
                <a href={assetUrl(primary)} target="_blank" rel="noopener noreferrer">
                  <Download className="size-5" aria-hidden="true" />
                  {t(OS_LABEL_KEY[os as Exclude<OsKind, "other">])}
                </a>
              </Button>
            ) : (
              <Button size="lg" className="h-12 min-w-56 gap-2 text-base" asChild>
                <a href="#downloads">
                  <MonitorSmartphone className="size-5" aria-hidden="true" />
                  {t("جميع التحميلات")}
                </a>
              </Button>
            )}
            <Button size="lg" variant="outline" className="h-12 min-w-40 text-base" asChild>
              <a href="#features">{t("الميزات")}</a>
            </Button>
            <Button size="lg" variant="ghost" className="h-12 min-w-40 gap-2 text-base" asChild>
              <a href={RELEASE_PAGE_LIVE} target="_blank" rel="noopener noreferrer">
                <Globe className="size-5" aria-hidden="true" />
                {t("صفحة النشر")}
              </a>
            </Button>
          </motion.div>

          {/* meta line */}
          <p className="mt-4 text-sm text-muted-foreground">
            {primaryAsset && (
              <span dir="ltr" className="font-mono text-xs">
                {primary} · {formatMB(primaryAsset.bytes)} ·{" "}
              </span>
            )}
            <span>
              {t("منشور في")} {published}
            </span>
          </p>

          {/* trust row */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              {t("تشفير من الطرف إلى الطرف")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CloudOff className="size-4 text-primary" aria-hidden="true" />
              {t("مجاني للاستخدام الشخصي")}
            </span>
          </div>
        </div>

        {/* devices visual */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mx-auto mt-14 max-w-3xl"
          aria-hidden="true"
        >
          <div className="flex items-center justify-center gap-4 sm:gap-8">
            {/* desktop card */}
            <div className="w-40 rounded-2xl border bg-card p-3 shadow-lg sm:w-56">
              <div className="mb-2 flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-rose-400/80" />
                <span className="size-2.5 rounded-full bg-amber-400/80" />
                <span className="size-2.5 rounded-full bg-emerald-400/80" />
              </div>
              <div className="space-y-2">
                <div className="h-2.5 w-3/4 rounded-full bg-primary/25" />
                <div className="h-2.5 w-1/2 rounded-full bg-muted" />
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <div className="h-9 rounded-md bg-primary/15" />
                  <div className="h-9 rounded-md bg-primary/25" />
                  <div className="h-9 rounded-md bg-primary/10" />
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <Laptop className="size-3.5 text-primary" />
                  <div className="h-2 w-2/3 rounded-full bg-muted" />
                </div>
              </div>
            </div>

            {/* animated link */}
            <div className="relative flex-1 max-w-40 sm:max-w-56">
              <svg viewBox="0 0 200 40" className="w-full text-primary/60" fill="none">
                <line
                  x1="4" y1="20" x2="196" y2="20"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="7 7"
                  strokeLinecap="round"
                  className="[animation:dash_1.4s_linear_infinite]"
                />
              </svg>
              <span className="absolute start-[18%] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary motion-safe:animate-pulse" />
              <span className="absolute start-[52%] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary motion-safe:animate-pulse [animation-delay:300ms]" />
              <span className="absolute start-[84%] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary motion-safe:animate-pulse [animation-delay:600ms]" />
            </div>

            {/* phone card */}
            <div className="w-24 rounded-[1.4rem] border bg-card p-2.5 shadow-lg sm:w-28">
              <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted" />
              <div className="space-y-1.5">
                <div className="h-10 rounded-lg bg-primary/20" />
                <div className="h-2 w-4/5 rounded-full bg-muted" />
                <div className="h-2 w-3/5 rounded-full bg-muted" />
                <div className="h-6 rounded-lg bg-primary/30" />
              </div>
              <div className="mt-2 flex justify-center">
                <Smartphone className="size-3.5 text-primary" />
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t("كمبيوتر + هاتف على شبكتك المحلية")}
          </p>
        </motion.div>
      </div>
    </section>
  )
}
