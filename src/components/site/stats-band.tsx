"use client"

import { motion } from "framer-motion"
import { useI18n } from "@/lib/i18n"

/**
 * شريط أرقام حقيقية مقاسة داخل بيئة التطوير أثناء بناء NexusLink
 * (اختبارات E2E الآلية + قياسات الأداء الموثقة في سجل العمل) — بلا مبالغة تسويقية.
 */
const STATS = [
  { value: "13ms", labelKey: "زمن استجابة التحكم P95 (مقاس)" },
  { value: "43.8MB/s", labelKey: "سرعة نقل مقاسة عبر الجسور" },
  { value: "~110MB", labelKey: "ذاكرة واجهة سطح المكتب عند التشغيل" },
  { value: "428", labelKey: "فحص E2E آلي أخضر على المشروع" },
]

export function StatsBand() {
  const { t } = useI18n()

  return (
    <section aria-label={t("أرقام من المشروع")} className="border-y border-border/60 bg-accent/40">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <dl className="grid grid-cols-2 gap-6 text-center lg:grid-cols-4">
          {STATS.map((s, i) => (
            <motion.div
              key={s.value}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <dt className="order-2 mt-1 text-sm text-muted-foreground">{t(s.labelKey)}</dt>
              <dd className="order-1 text-3xl font-extrabold tracking-tight text-primary sm:text-4xl" dir="ltr">
                {s.value}
              </dd>
            </motion.div>
          ))}
        </dl>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t("أرقام مقاسة فعليًا داخل بيئة التطوير الموثقة — قد تختلف حسب شبكتك وأجهزتك.")}
        </p>
      </div>
    </section>
  )
}
