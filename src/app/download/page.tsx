"use client"

import { useEffect } from "react"
import { initLang } from "@/lib/i18n"
import { SiteHeader } from "@/components/download/site-header"
import { Hero } from "@/components/download/hero"
import { DownloadsSection } from "@/components/download/downloads-section"
import { FeaturesSection } from "@/components/download/features-section"
import { InstallGuides } from "@/components/download/install-guides"
import { VerifySection } from "@/components/download/verify-section"
import { FaqSection } from "@/components/download/faq-section"
import { SiteFooter } from "@/components/download/site-footer"

export default function DownloadPage() {
  useEffect(() => {
    initLang()
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <DownloadsSection />
        <FeaturesSection />
        <InstallGuides />
        <VerifySection />
        <FaqSection />
      </main>
      <SiteFooter />
    </div>
  )
}
