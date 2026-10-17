"use client"

import { motion } from "framer-motion"
import { MonitorDown, QrCode, Wifi } from "lucide-react"
import { useI18n } from "@/lib/i18n"

/**
 * «كيف يعمل» — ثلاث خطوات فعلية من تجربة المنتج الحقيقية:
 * تثبيت موقّع ← اقتران QR بمفاتيح مشتقة ← استخدام كامل على الشبكة المحلية.
 */
const STEPS = [
  {
    icon: MonitorDown,
    num: "1",
    titleKey: "ثبّت التطبيق",
    bodyKey:
      "مثبّتات رسمية موقّعة لأربع منصات — Windows وmacOS وLinux وAndroid — مع بصمات SHA256 منشورة للتحقق قبل التشغيل.",
  },
  {
    icon: QrCode,
    num: "2",
    titleKey: "اقترن بمسح رمز QR",
    bodyKey:
      "امسح الرمز من واجهة الكمبيوتر بكاميرا هاتفك، فيتبادل الجهازان مفاتيح جلسة مشتقة من سر الاقتران — بلا حسابات ولا تسجيل.",
  },
  {
    icon: Wifi,
    num: "3",
    titleKey: "استخدم — كل شيء محلي",
    bodyKey:
      "حافظة مشتركة، ملفات، تحكم عن بُعد، إشعارات ورسائل — كل البايتات تمر عبر شبكتك المحلية المشفرة ولا يلمس أي منها خادمًا خارجيًا.",
  },
]

export function HowItWorks() {
  const { t } = useI18n()

  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="how-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("كيف يعمل")}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t("ثلاث خطوات بينك وبين منظومة أجهزة موحدة — دقائق معدودة حتى أول نقل ملفات.")}
          </p>
        </div>

        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.li
              key={step.num}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.1 }}
              className="relative rounded-2xl border bg-card p-6"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <step.icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-4xl font-extrabold leading-none text-primary/20" aria-hidden="true">
                  {step.num}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{t(step.titleKey)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(step.bodyKey)}</p>
            </motion.li>
          ))}
        </ol>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-muted-foreground">
          {t(
            "بصدق: الاتصال الخارجي الوحيد الذي يجريه التطبيق هو فحص التحديثات — ويمكنك تعطيله كليًا من الإعدادات فيصبح التطبيق معزولًا على شبكتك تمامًا."
          )}
        </p>
      </div>
    </section>
  )
}
