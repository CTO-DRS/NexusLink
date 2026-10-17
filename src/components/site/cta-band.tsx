"use client"

import { motion } from "framer-motion"
import { Download, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { REPO_URL } from "@/lib/download-site-data"

/** نداء الختام: تنزيل أو استعراض المستودع المفتوح. */
export function CtaBand() {
  const { t } = useI18n()

  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute start-1/2 top-0 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl rtl:translate-x-1/2" />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5 }}
        className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:py-20"
      >
        <h2 id="cta-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {t("جاهز تربط أجهزتك؟")}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          {t(
            "حمّل النسخة الموقعة لمنصتك، امسح رمز الاقتران، ودع الباقي على شبكتك — حرفيًا في دقائق."
          )}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="h-12 min-w-52 gap-2 text-base" asChild>
            <a href="/download">
              <Download className="size-5" aria-hidden="true" />
              {t("تنزيل الآن")}
            </a>
          </Button>
          <Button size="lg" variant="outline" className="h-12 min-w-52 gap-2 text-base" asChild>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-5" aria-hidden="true" />
              {t("المستودع المفتوح على GitHub")}
            </a>
          </Button>
        </div>
      </motion.div>
    </section>
  )
}
