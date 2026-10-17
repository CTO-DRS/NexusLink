"use client"

import { motion } from "framer-motion"
import { Apple, Download, Monitor, Smartphone, Triangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"

/**
 * المنصات — من مصفوفة البناء الفعلية (release.yml يبني الخمس):
 * Windows NSIS/MSI/Portable، macOS dmg/tar.gz، Linux AppImage/deb، Android APK/AAB،
 * وiOS بحدوده الصادقة (قيود Apple على SMS/المكالمات/الخلفية).
 *
 * أيقونات: يستخدم Windows شكل مونيتور عام، وApple/Triangle للأندرويد —
 * بلا شعارات تجارية منسوخة، وبأسماء أنظمة نصية صريحة.
 */
const PLATFORMS = [
  { icon: Monitor, name: "Windows", descKey: "Windows 10/11 (64-bit) — مثبّت وMSI ونسخة محمولة" },
  { icon: Apple, name: "macOS", descKey: "macOS 12+ على Apple Silicon — صورة قرص موقعة" },
  { icon: Triangle, name: "Linux", descKey: "Ubuntu 20.04+ / Debian 11+ — AppImage وdeb" },
  { icon: Smartphone, name: "Android", descKey: "Android 7+ (يُنصح 10 وما فوق) — APK موقّع بالكامل الوظائف" },
]

export function PlatformsStrip() {
  const { t } = useI18n()

  return (
    <section id="platforms" aria-labelledby="platforms-title" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="platforms-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("منصتك… مغطاة")}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t("خط إصدار واحد يبني المنصات الأربع ويوقع أصولها في نفس الجولة الخضراء.")}
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORMS.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="rounded-2xl border bg-card p-6 text-center"
            >
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <p.icon className="size-6" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-lg font-bold">{p.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(p.descKey)}</p>
            </motion.div>
          ))}
        </div>

        {/* honest iOS limit */}
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-muted-foreground">
          {t(
            "حد صادق: يوجد بناء iOS في خط الإصدار، لكن قيود Apple تمنع مرآة SMS والمكالمات والتحكم الكامل — الأندرويد هو التجربة الكاملة."
          )}
        </p>

        <div className="mt-8 text-center">
          <Button size="lg" variant="outline" className="h-12 min-w-52 gap-2 text-base" asChild>
            <a href="/download">
              <Download className="size-5" aria-hidden="true" />
              {t("جميع التحميلات")}
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}
