"use client"

import { useEffect } from "react"
import { initLang } from "@/lib/i18n"
import { SiteHeader } from "@/components/download/site-header"
import { SiteFooter } from "@/components/download/site-footer"
import { HomeHero } from "@/components/site/home-hero"
import { HowItWorks } from "@/components/site/how-it-works"
import { StatsBand } from "@/components/site/stats-band"
import { FeaturesSection } from "@/components/download/features-section"
import { SecuritySection } from "@/components/site/security-section"
import { PlatformsStrip } from "@/components/site/platforms-strip"
import { HomeFaq } from "@/components/site/home-faq"
import { CtaBand } from "@/components/site/cta-band"

/**
 * الموقع الرسمي — الصفحة الرئيسية للمنتج على / (بدون وسوم).
 * واجهة التطبيق نفسها على /?desktop=1 (سطح المكتب) و /?app=1 (المتصفح).
 */
export function SiteHome() {
  useEffect(() => {
    initLang()
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader variant="home" />
      <main className="flex-1">
        <HomeHero />
        <StatsBand />
        <FeaturesSection />
        <HowItWorks />
        <SecuritySection />
        <PlatformsStrip />
        <HomeFaq />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  )
}
