"use client"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { useI18n } from "@/lib/i18n"

const FAQ_ITEMS = [
  {
    q: "هل يعمل NexusLink دون إنترنت؟",
    a: "نعم — كل شيء يعمل على شبكتك المحلية مباشرة. الاتصال الخارجي الوحيد هو فحص التحديث، وهو قابل للتعطيل كليًا من الإعدادات.",
  },
  {
    q: "أين تذهب بياناتي؟",
    a: "لا تغادر أجهزتك إطلاقًا: لا سحابة ولا حسابات ولا تحليلات — القنوات مشفرة من الطرف إلى الطرف بين أجهزتك فقط.",
  },
  {
    q: "ما الفرق بين ملفات Windows الثلاثة؟",
    a: "setup.exe للمستخدم العادي (مع تحديث تلقائي)، msi للنشر المؤسسي الصامت، وportable.zip للاستخدام دون تثبيت من USB.",
  },
  {
    q: "لماذا يحتاج تطبيق الهاتف صلاحيات إمكانية الوصول؟",
    a: "لحقن اللمسات في التحكم عن بُعد وقراءة الإشعارات — أندرويد 13+ يحجبها للتطبيقات المثبتة بجانب المتجر، والحل في «مركز رفع القيود» أعلاه.",
  },
  {
    q: "هل يوجد إصدار iPhone؟",
    a: "بصدق: iOS يدعم الحافظة والملفات فقط بقيود Apple — لا إشعارات ولا SMS ولا مكالمات ولا تحكم. أندرويد هو المنصة الكاملة.",
  },
  {
    q: "كيف أُحدّث التطبيق لاحقًا؟",
    a: "تطبيق الكمبيوتر يحدّث نفسه تلقائيًا، وهاتف يُنصح بإعادة تنزيل APK الجديد من هذه الصفحة عند صدوره.",
  },
]

export function FaqSection() {
  const { t } = useI18n()

  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 id="faq-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("الأسئلة الشائعة")}
          </h2>
        </div>

        <Accordion type="single" collapsible className="rounded-2xl border bg-card px-5">
          {FAQ_ITEMS.map((item, i) => (
            <AccordionItem key={item.q} value={`item-${i}`} className="last:border-b-0">
              <AccordionTrigger className="min-h-12 py-4 text-start text-sm font-semibold sm:text-base">
                {t(item.q)}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                {t(item.a)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
