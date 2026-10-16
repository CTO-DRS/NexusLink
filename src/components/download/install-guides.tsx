"use client"

import { AlertTriangle, Apple, HardDrive, Monitor, ShieldCheck, Smartphone } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n } from "@/lib/i18n"

interface Step {
  key: string
  code?: string
}

const WINDOWS_INSTALLER: Step[] = [
  { key: "نزّل NexusLink_1.1.0_x64-setup.exe وشغّله" },
  { key: "إن ظهر SmartScreen اختر «مزيد من المعلومات» ثم «تشغيل على أي حال»" },
  { key: "أكمل المعالج ثم افتح NexusLink من قائمة ابدأ" },
]

const WINDOWS_PORTABLE: Step[] = [
  { key: "فك ضغط NexusLink_1.1.0_x64-portable.zip في مجلد من اختيارك وشغّل NexusLink.exe" },
]

const MACOS_STEPS: Step[] = [
  { key: "افتح ملف DMG واسحب NexusLink إلى مجلد التطبيقات" },
  { key: "عند أول تشغيل: كليك يمين على الأيقونة ثم «فتح» لتجاوز Gatekeeper" },
  { key: "أو بديلًا: فك NexusLink.app.tar.gz إلى /Applications" },
]

const LINUX_STEPS: Step[] = [
  { key: "أعطِ صلاحية التنفيذ ثم شغّل الملف مباشرة", code: "chmod +x NexusLink_1.1.0_amd64.AppImage\n./NexusLink_1.1.0_amd64.AppImage" },
  { key: "ثبّت حزمة deb بالأمر", code: "sudo dpkg -i NexusLink_1.1.0_amd64.deb" },
  { key: "قد تحتاج لتثبيت libwebkit2gtk-4.1 وlibayatana-appindicator3" },
]

const ANDROID_STEPS: Step[] = [
  { key: "نزّل NexusLink-1.1.0-release.apk على هاتفك وافتحه" },
  { key: "فعّل «السماح من هذا المصدر» عند طلب النظام" },
  { key: "على أندرويد 13+ إن ظهرت رسالة الإعدادات المحظورة اتبع خطوات مركز رفع القيود أدناه" },
]

const UNBLOCK_STEPS: string[] = [
  "افتح إعدادات النظام ← التطبيقات ← إدارة التطبيقات ← NexusLink",
  "من قائمة ⋮ أعلى اليمين اختر «السماح بالإعدادات المحظورة»",
  "عد إلى تطبيق NexusLink وفعّل خدمة إمكانية الوصول من شاشة التحكم",
]

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.key} className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm leading-relaxed">{s.key}</p>
            {s.code && (
              <pre
                dir="ltr"
                className="overflow-x-auto rounded-lg bg-muted p-3 text-left font-mono text-xs leading-relaxed text-foreground"
              >
                {s.code}
              </pre>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function InstallGuides() {
  const { t } = useI18n()

  return (
    <section id="install" aria-labelledby="install-title" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 id="install-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("دليل التثبيت")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{t("خطوات التثبيت")}</p>
        </div>

        <Tabs defaultValue="windows" className="mx-auto max-w-3xl">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-2xl p-1.5">
            <TabsTrigger value="windows" className="min-h-11 gap-1.5 rounded-xl text-xs sm:text-sm">
              <Monitor className="size-4 shrink-0" aria-hidden="true" />
              <span>Windows</span>
            </TabsTrigger>
            <TabsTrigger value="macos" className="min-h-11 gap-1.5 rounded-xl text-xs sm:text-sm">
              <Apple className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">macOS</span>
            </TabsTrigger>
            <TabsTrigger value="linux" className="min-h-11 gap-1.5 rounded-xl text-xs sm:text-sm">
              <HardDrive className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Linux</span>
            </TabsTrigger>
            <TabsTrigger value="android" className="min-h-11 gap-1.5 rounded-xl text-xs sm:text-sm">
              <Smartphone className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Android</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="windows" className="mt-6 space-y-4">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">{t("Windows — المثبّت")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Steps steps={WINDOWS_INSTALLER} />
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">{t("Windows — نسخة محمولة")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Steps steps={WINDOWS_PORTABLE} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="macos" className="mt-6">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">{t("macOS — Apple Silicon")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Steps steps={MACOS_STEPS} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="linux" className="mt-6">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">{t("Linux — AppImage أو deb")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Steps steps={LINUX_STEPS} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="android" className="mt-6 space-y-4">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">{t("Android — APK")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Steps steps={ANDROID_STEPS} />
              </CardContent>
            </Card>

            <Alert className="rounded-2xl border-amber-500/40 bg-amber-500/5">
              <ShieldCheck className="size-5 !text-amber-600" aria-hidden="true" />
              <AlertTitle className="font-bold">{t("مركز رفع القيود (أندرويد 13+)")}</AlertTitle>
              <AlertDescription>
                <div className="space-y-3">
                  <p className="leading-relaxed">
                    {t(
                      "أندرويد 13+ يحجب خدمات إمكانية الوصول للتطبيقات المثبتة خارج المتجر — الفك يدوي ومقصود من جوجل، وهذه خطواته الرسمية:"
                    )}
                  </p>
                  <Steps steps={UNBLOCK_STEPS.map((key) => ({ key }))} />
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                    <span>
                      {t("تنبيه")}: Settings → Apps → NexusLink → ⋮ → Allow restricted settings
                    </span>
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  )
}
