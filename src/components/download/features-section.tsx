"use client"

import { motion } from "framer-motion"
import {
  ClipboardPaste,
  FolderSync,
  MonitorSmartphone,
  RefreshCcwDot,
  ShieldCheck,
  TabletSmartphone,
  BellRing,
  MonitorPlay,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"

const FEATURES = [
  {
    icon: ClipboardPaste,
    titleKey: "حافظة مشتركة فورية",
    bodyKey: "انسخ على هاتفك والصق على الكمبيوتر والعكس — نصوص وصور وروابط، كل ذلك محليًا وبلا سحابة.",
  },
  {
    icon: FolderSync,
    titleKey: "نقل ملفات سريع",
    bodyKey: "اسحب وأفلت بين الأجهزة مع استكمال تلقائي ومهام نقل خلفية واستكشاف تخزين الهاتف.",
  },
  {
    icon: MonitorSmartphone,
    titleKey: "تحكم بالكمبيوتر من هاتفك",
    bodyKey: "شاشة حية ولمسات ولوحة مفاتيح — أطفئ الجهاز أو شغّله وتحكّم بالماوس من غرفة أخرى.",
  },
  {
    icon: TabletSmartphone,
    titleKey: "تحكم بهاتف من هاتف آخر",
    bodyKey: "جديد في 1.1.0: اعرض شاشة هاتفك الثاني وتحكّم بها من هاتفك الأول عبر المركز — بجلسة موثقة وقطع فوري.",
  },
  {
    icon: MonitorPlay,
    titleKey: "مرآة شاشة وNexusLive",
    bodyKey: "بث شاشة الهاتف إلى الكمبيوتر مع لوحة رسم وشاشة ثانية افتراضية للعمل المزدوج.",
  },
  {
    icon: BellRing,
    titleKey: "إشعارات ورسائل ومكالمات",
    bodyKey: "استقبل إشعارات الهاتف على الكمبيوتر، وأرسل SMS، وأجرِ المكالمات من الواجهة نفسها.",
  },
  {
    icon: ShieldCheck,
    titleKey: "تشفير من الطرف إلى الطرف",
    bodyKey: "X25519 + AES-256-GCM على كل قناة — التقاط الحزم لا يُظهر محتوى مقروءًا.",
  },
  {
    icon: RefreshCcwDot,
    titleKey: "تحديث تلقائي آمن",
    bodyKey: "يتحقق التطبيق من latest.json ويحدّث نفسه بتوقيعات رقمية على Windows وmacOS وLinux.",
  },
]

export function FeaturesSection() {
  const { t } = useI18n()

  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-24 bg-accent/40">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 id="features-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("لماذا NexusLink؟")}
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.titleKey}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: (i % 4) * 0.06 }}
            >
              <Card className="h-full gap-3 rounded-2xl border-0 bg-card shadow-sm transition-shadow hover:shadow-md">
                <CardContent className="space-y-2.5 p-5">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <f.icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-semibold">{t(f.titleKey)}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t(f.bodyKey)}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
