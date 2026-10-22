"use client"

/**
 * Onboarding تفاعلي لأول تشغيل — المرحلة 11 (بند 2)
 * 5 خطوات: ترحيب + لغة ← صلاحيات بلغة واضحة (طلبات حقيقية) ← الاقتران ← جولة الميزات ← اختصارات وأداء
 */
import * as React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useNexus } from "@/lib/store"
import { useI18n, LANGS } from "@/lib/i18n"
import QRCode from "qrcode"
import {
  Link2, Bell, Database, ClipboardCopy, Camera, QrCode, Keyboard, Gauge,
  ShieldCheck, Languages, ChevronLeft, ChevronRight, Sparkles, Smartphone,
  FolderOpen, ArrowLeftRight, MessagesSquare, MousePointer2, Video,
  Zap, Wrench, Settings2, CheckCircle2,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const MODULES: { id: string; icon: LucideIcon }[] = [
  { id: "devices", icon: Smartphone },
  { id: "files", icon: FolderOpen },
  { id: "transfers", icon: ArrowLeftRight },
  { id: "comms", icon: MessagesSquare },
  { id: "remote", icon: MousePointer2 },
  { id: "media", icon: Video },
  { id: "guard", icon: ShieldCheck },
  { id: "prod", icon: Zap },
  { id: "security", icon: ShieldCheck },
  { id: "tools", icon: Wrench },
  { id: "storage", icon: Database },
  { id: "settings", icon: Settings2 },
]
const MODULE_LABELS: Record<string, string> = {
  devices: "الأجهزة والاقتران",
  files: "مستعرض الملفات",
  transfers: "محرك النقل",
  comms: "الإشعارات والرسائل",
  remote: "التحكم عن بُعد",
  media: "الوسائط والكاميرا",
  guard: "حماية الجهاز",
  prod: "الإنتاجية",
  security: "الأمان والتشفير",
  tools: "الأدوات والتشخيص",
  storage: "التخزين",
  settings: "الإعدادات",
}
const MODULE_HINTS: Record<string, string> = {
  devices: "اكتشاف mDNS + اقتران QR + إعادة اتصال ذكية",
  files: "تصفح هاتفك وتابلتك مع معاينات فورية",
  transfers: "قطع 256KB، استئناف تلقائي، نقل متوازٍ",
  comms: "نسخ متطابقة، رد سريع، SMS ومكالمات",
  remote: "لوحة لمس، كيبورد، ماوس هوائي، يد ألعاب",
  media: "هاتفك كويب كام + مراقبة + بث",
  guard: "إيجاد الهاتف، وضع الفقدان، قفل بالقرب",
  prod: "حافظة موحدة، مزامنة، تسليم الروابط",
  security: "E2E حقيقي + سجل تدقيق + مسح آمن",
  tools: "سرعة، تشخيص، طرفية CLI",
  storage: "لوحات الاستخدام والتصنيف",
  settings: "لغة، إتاحة، اختصارات، تحديث",
}

export function Onboarding() {
  const { onboardingOpen, setOnboardingOpen, setOnboarded } = useNexus()
  const { t, lang, setLang } = useI18n()
  const [step, setStep] = useState(0)
  const [notifState, setNotifState] = useState<string>(typeof Notification !== "undefined" ? Notification.permission : "default")
  const [persistState, setPersistState] = useState<string>("—")
  const [qrData, setQrData] = useState<string>("")

  const askNotifications = useCallback(async () => {
    try {
      const p = await Notification.requestPermission()
      setNotifState(p)
      if (p === "granted") {
        new Notification("NexusLink", { body: t("أصبحت الإشعارات مفعلة — سترى إشعارات هاتفك هنا") })
      }
    } catch { /* ignore */ }
  }, [t])

  const askPersist = useCallback(async () => {
    try {
      const ok = await navigator.storage?.persist?.()
      setPersistState(ok ? "persisted" : "best-effort")
    } catch {
      setPersistState("unsupported")
    }
  }, [])

  useEffect(() => {
    if (step !== 2) return
    QRCode.toDataURL("nexus://pair?k=demo-onboarding&v=1", {
      width: 220, margin: 1, color: { dark: "#0f172a", light: "#ffffff" },
    }).then(setQrData).catch(() => setQrData(""))
  }, [step])

  const total = 5
  const finish = () => {
    setOnboarded(true)
    setOnboardingOpen(false)
    setStep(0)
  }
  const next = () => setStep((s) => Math.min(total - 1, s + 1))
  const prev = () => setStep((s) => Math.max(0, s - 1))

  const permCard = (icon: LucideIcon, title: string, why: string, denied: string, action?: React.ReactNode, state?: string) => (
    <div className="rounded-2xl border p-4 space-y-2">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-primary/12 text-primary grid place-items-center shrink-0">
          {React.createElement(icon, { className: "w-4 h-4" })}
        </div>
        <div className="font-semibold text-sm flex-1">{title}</div>
        {state && (
          <Badge variant={state === "granted" || state === "persisted" ? "default" : "outline"} className="text-[10px]" data-no-i18n>
            {state === "granted" ? "✓" : state === "persisted" ? "✓" : state === "denied" ? "✕" : "—"}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-5">{why}</p>
      <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-4">{denied}</p>
      {action && <div>{action}</div>}
    </div>
  )

  const steps = (() => {
    return [
      // 0 — welcome + language
      <div key="w" className="space-y-5 text-center">
        <div className="mx-auto w-16 h-16 rounded-3xl bg-primary text-primary-foreground grid place-items-center shadow-xl shadow-primary/30">
          <Link2 className="w-8 h-8" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{t("مرحباً بك في NexusLink")}</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto leading-6">
            {t("منصة واحدة تربط هاتفك وجهازك الكمبيوتر وتابلتك وتلفازك — كل شيء محلي على شبكتك، بدون سحابة وبدون حسابات")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {LANGS.map((L) => (
            <Button key={L.code} variant={lang === L.code ? "default" : "outline"} size="sm" onClick={() => setLang(L.code)} className="gap-1.5" aria-pressed={lang === L.code}>
              <Languages className="w-4 h-4" />
              <span data-no-i18n>{L.native}{L.dir === "rtl" ? " · RTL" : ""}</span>
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("يمكنك تغيير اللغة لاحقاً من الإعدادات أو اختصار Ctrl+Shift+E")}</p>
      </div>,

      // 1 — permissions explained
      <div key="p" className="space-y-3.5">
        <div className="text-center mb-2">
          <h2 className="text-lg font-extrabold">{t("الصلاحيات — بلغة واضحة")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("كل صلاحية لها سبب واحد فقط، وكلها تبقى على جهازك")}</p>
        </div>
        {permCard(
          Bell,
          t("الإشعارات"),
          t("لأن ترى إشعارات هاتفك على الكمبيوتر وترد عليها فوراً بدون لمس الهاتف"),
          t("إن رفضتها: ستحصل على الإشعارات داخل التطبيق فقط"),
          <Button size="sm" variant="outline" onClick={askNotifications} disabled={notifState === "granted"} className="gap-1.5">
            <Bell className="w-3.5 h-3.5" /> {notifState === "granted" ? t("مفعّلة") : t("تفعيل الإشعارات")}
          </Button>,
          notifState === "granted" ? "granted" : notifState === "denied" ? "denied" : "default",
        )}
        {permCard(
          Database,
          t("تخزين دائم"),
          t("كي لا يحذف المتصفح ملفاتك المنقولة وسجل التدقيق عند امتلاء المساحة"),
          t("إن رفضتها: يعمل التطبيق بوضع التخزين المؤقت العادي"),
          <Button size="sm" variant="outline" onClick={askPersist} disabled={persistState === "persisted"} className="gap-1.5">
            <Database className="w-3.5 h-3.5" /> {persistState === "persisted" ? t("مفعّل") : t("طلب تخزين دائم")}
          </Button>,
          persistState === "persisted" ? "persisted" : "default",
        )}
        {permCard(
          ClipboardCopy,
          t("الحافظة"),
          t("لمزامنة النسخ بين الهاتف والكمبيوتر — التنقل من متصفحك يتطلب موافقة المتصفح نفسه عند أول لصق"),
          t("إن رفضتها: استخدم زر «لصق» داخل التطبيق"),
        )}
        {permCard(
          Camera,
          t("الكاميرا والميكروفون"),
          t("ميزات الوسائط: استخدام الهاتف كويب كام، المراقبة، الميكروفون اللاسلكي"),
          t("لا تُطلب إلا عند أول استخدام لميزة وسائط فعلياً — وليس الآن"),
        )}
      </div>,

      // 2 — pairing
      <div key="q" className="space-y-4">
        <div className="text-center">
          <h2 className="text-lg font-extrabold">{t("اربط أول جهاز")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("مفتاح الاقتران يتبادل عبر QR ثم يبدأ التشفير الطرف-لطرف فوراً")}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-5 justify-center">
          <div className="rounded-2xl border p-3 bg-white shadow-sm">
            {qrData ? (
               
              <img src={qrData} alt={t("رمز اقتران تجريبي")} className="w-44 h-44" />
            ) : (
              <div className="w-44 h-44 grid place-items-center"><QrCode className="w-10 h-10 text-muted-foreground" /></div>
            )}
          </div>
          <div className="space-y-2.5 text-sm max-w-xs">
            <div className="flex items-start gap-2"><QrCode className="w-4 h-4 mt-0.5 text-primary shrink-0" />{t("افتح NexusLink على الهاتف وامسح الرمز")}</div>
            <div className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />{t("المفتاح لا يغادر أجهزتك أبداً")}</div>
            <div className="flex items-start gap-2"><Sparkles className="w-4 h-4 mt-0.5 text-violet-500 shrink-0" />{t("جرّبها الآن: افتح «الهاتف الافتراضي» من الشريط السفلي وتفاعل كأنك تحمل هاتفك")}</div>
          </div>
        </div>
      </div>,

      // 3 — feature tour
      <div key="t" className="space-y-3">
        <div className="text-center">
          <h2 className="text-lg font-extrabold">{t("جولة سريعة — 12 وحدة في منصة واحدة")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("كل شيء من الشريط السفلي — نفس الترتيب في الهاتف والكمبيوتر")}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {MODULES.map((m) => {
            const Icon = m.icon
            return (
              <div key={m.id} className="rounded-xl border px-3 py-2.5 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{t(MODULE_LABELS[m.id])}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{t(MODULE_HINTS[m.id])}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>,

      // 4 — shortcuts + performance + finish
      <div key="s" className="space-y-4">
        <div className="text-center">
          <h2 className="text-lg font-extrabold">{t("كل شيء جاهز")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("أسرع طريقتان للتحكم: لوحة الأوامر والاختصارات")}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold"><Keyboard className="w-4 h-4 text-primary" /> {t("اختصارات أساسية")}</div>
            <div className="text-xs space-y-1.5 text-muted-foreground" data-no-i18n>
              <div className="flex justify-between"><span>لوحة الأوامر</span><kbd className="font-mono">Ctrl+K</kbd></div>
              <div className="flex justify-between"><span>{t("دليل الاختصارات")}</span><kbd className="font-mono">?</kbd></div>
              <div className="flex justify-between"><span>{t("إرسال ملف سريع")}</span><kbd className="font-mono">Ctrl+Shift+F</kbd></div>
              <div className="flex justify-between"><span>{t("تبديل اللغة")}</span><kbd className="font-mono">Ctrl+Shift+E</kbd></div>
            </div>
          </div>
          <div className="rounded-xl border p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold"><Gauge className="w-4 h-4 text-primary" /> {t("أداء مضمون")}</div>
            <ul className="text-xs space-y-1.5 text-muted-foreground leading-5">
              <li>• {t("ذاكرة أقل من 200MB على سطح المكتب")}</li>
              <li>• {t("بطارية شبه معدومة في الخلفية")}</li>
              <li>• {t("يعمل مع النظام (اختياري من الإعدادات)")}</li>
            </ul>
          </div>
        </div>
        <p className="text-[11px] text-center text-muted-foreground">
          {t("كل ما رأيته قابل للتغيير لاحقاً من الإعدادات — وزر إعادة الجولة موجود هناك دائماً")}
        </p>
      </div>,
    ]
  })()

  return (
    <Dialog open={onboardingOpen} onOpenChange={(o) => { if (!o) finish() }}>
      <DialogContent
        className="max-w-lg max-h-[88vh] overflow-y-auto nexus-scroll"
        dir={undefined}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("ترحيب NexusLink")}</DialogTitle>
        <div className="min-h-[380px] flex flex-col">
          <div className="flex items-center justify-center gap-1.5 mb-4" aria-hidden>
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/50" : "w-3 bg-muted"}`}
              />
            ))}
          </div>
          <div className="flex-1 nexus-enter" key={step}>{steps[step]}</div>
          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <Button variant="ghost" size="sm" onClick={prev} disabled={step === 0} className="gap-1">
              <ChevronLeft className="w-4 h-4 rotate-180 rtl:rotate-0 rtl:inline ltr:hidden" />
              <ChevronRight className="w-4 h-4 ltr:inline rtl:hidden" />
              {t("السابق")}
            </Button>
            <span className="text-[11px] text-muted-foreground" data-no-i18n>{step + 1} / {total}</span>
            {step < total - 1 ? (
              <Button size="sm" onClick={next} className="gap-1">
                {t("التالي")}
                <ChevronRight className="w-4 h-4 ltr:inline rtl:hidden" />
                <ChevronLeft className="w-4 h-4 rtl:inline ltr:hidden" />
              </Button>
            ) : (
              <Button size="sm" onClick={finish} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                <CheckCircle2 className="w-4 h-4" /> {t("ابدأ الاستخدام")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
