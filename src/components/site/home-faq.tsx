"use client"

import { useI18n } from "@/lib/i18n"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

/**
 * أسئلة رئيسية مختصرة — التفاصيل الكاملة (التثبيت والتوقيعات والتحقق) في /download#faq.
 */
const FAQS = [
  {
    q: "هل يحتاج NexusLink اتصال إنترنت؟",
    a: "لا. الاقتران والنقل والتحكم والمرايا — كلها تجري على شبكتك المحلية بين أجهزتك. الاتصال الخارجي الوحيد هو فحص التحديثات، ويمكن تعطيله كليًا من الإعدادات فيصبح النظام معزولًا تمامًا.",
  },
  {
    q: "هل تخرج بياناتي إلى أي خادم سحابي؟",
    a: "لا يوجد خادم سحابي أصلًا: الخادم هو جهاز الكمبيوتر عندك، والهاتف وكيل على شبكتك. كل قناة مشفرة من الطرف إلى الطرف بـAES-256-GCM فوق مفاتيح مشتقة من اقتران QR — حتى على شبكتك نفسها تظل الحزم غير مقروءة لأي متطفل.",
  },
  {
    q: "هل يعمل على iPhone؟",
    a: "بصدق: يوجد بناء iOS في خط الإصدار، لكن قيود Apple تغلق مرآة الإشعارات وSMS والمكالمات والتحكم الكامل — لذا تجربة iOS أقل بوظائف معلنة. الأندرويد (7+) هو المنصة الكاملة الوظائف.",
  },
  {
    q: "كيف أحدث التطبيق لاحقًا؟",
    a: "تطبيق سطح المكتب يفحص latest.json المنشور مع كل إصدار ويحدّث نفسه تلقائيًا بعد التحقق من التوقيع الرقمي لمنصتك. أندرويد يحدث بالتثبيت فوق النسخة القديمة من صفحة التحميل، وقاعدة بياناتك وإعداداتك تُحفظ عبر ترقيات مخطط مضمونة.",
  },
]

export function HomeFaq() {
  const { t } = useI18n()

  return (
    <section id="faq" aria-labelledby="home-faq-title" className="scroll-mt-24 border-t border-border/60 bg-accent/40">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
        <div className="text-center">
          <h2 id="home-faq-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("أسئلة يسألها الجميع")}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t("أجوبة صادقة بلا تسويق — وللتفاصيل الكاملة: صفحة التحميل والأسئلة الشائعة هناك.")}
          </p>
        </div>

        <Accordion type="single" collapsible className="mt-8">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`faq-${i}`}>
              <AccordionTrigger className="text-start text-base font-semibold">
                {t(f.q)}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {t(f.a)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
