"use client"

import { motion } from "framer-motion"
import { FileCheck, KeyRound, Lock, ShieldCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"

/**
 * الأمان — من العقد التشفيري الفعلي للمشروع (docs/protocol-contract.md):
 * X25519 + HKDF + AES-256-GCM بعدّاد تسلسلي وAAD، اقتران QR مع SAS،
 * تحديثات موقعة minisign/Ed25519 مع prehash Blake2b، وربط محلي حصرًا.
 */
const ITEMS = [
  {
    icon: KeyRound,
    titleKey: "اقتران متبادل بمفاتيح حية",
    bodyKey:
      "مسح QR يشتق مفاتيح جلسة X25519 من سر الاقتران، مع مقارنة سلسلة تحقق قصيرة (SAS) تمنع هجوم الوسيط حتى على شبكة غير موثوقة.",
  },
  {
    icon: Lock,
    titleKey: "تشفير كل قناة بايتًا بايتًا",
    bodyKey:
      "AES-256-GCM بعدّاد تسلسلي وبيانات مصادقة إضافية لكل رسالة — التقاط الحزم بـWireshark لا يُظهر محتوى مقروءًا، وهو معيار قبول معلن في المشروع.",
  },
  {
    icon: FileCheck,
    titleKey: "تحديثات موقّعة رقميًا",
    bodyKey:
      "أصول التحديث لسطح المكتب تحمل توقيع minisign/Ed25519 مع prehash Blake2b — التطبيق يرفض أي تحديث لا يطابق المفتاح العام المضمّن فيه.",
  },
  {
    icon: ShieldCheck,
    titleKey: "خصوصية بالتصميم لا بالوعد",
    bodyKey:
      "لا حسابات ولا تتبع ولا تحليلات: الخوادم هي جهازك نفسه، والاقتران محلي عبر QR، وفحص التحديث الوحيد القابل للتعطيل هو كل ما يلمس الإنترنت.",
  },
]

export function SecuritySection() {
  const { t } = useI18n()

  return (
    <section id="security" aria-labelledby="security-title" className="scroll-mt-24 border-y border-border/60 bg-accent/40">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="security-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("الأمان أولًا")}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t(
              "عقد تشفيري موثق بالبايت في المستودع المفتوح — يُراجع ويُختبر آليًا مع كل جولة إصدار."
            )}
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {ITEMS.map((item, i) => (
            <motion.div
              key={item.titleKey}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: (i % 2) * 0.1 }}
            >
              <Card className="h-full border-border/60">
                <CardContent className="flex gap-4 p-6">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <item.icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold">{t(item.titleKey)}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {t(item.bodyKey)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
