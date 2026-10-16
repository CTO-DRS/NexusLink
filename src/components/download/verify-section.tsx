"use client"

import { ExternalLink, FileCheck2, RefreshCw, Signature } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n } from "@/lib/i18n"
import { RELEASE_BASE, RELEASES_PAGE } from "@/lib/download-site-data"

const SHA_WIN = 'Get-FileHash .\\NexusLink_1.1.0_x64-setup.exe -Algorithm SHA256'
const SHA_UNIX = 'shasum -a 256 NexusLink_1.1.0_amd64.AppImage'

export function VerifySection() {
  const { t } = useI18n()

  return (
    <section id="updates" aria-labelledby="updates-title" className="scroll-mt-24 bg-accent/40">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 id="updates-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("التحديث والتحقق")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {t("تحقّق قبل التشغيل")}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* SHA256 */}
          <Card className="rounded-2xl">
            <CardHeader className="flex-row items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileCheck2 className="size-5" aria-hidden="true" />
              </span>
              <CardTitle className="text-base">{t("تحقّق قبل التشغيل")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("قارن بصمة SHA256 مع ملف SHA256SUMS.txt المنشور مع الإصدار")}
              </p>
              <Tabs defaultValue="win">
                <TabsList className="h-10 w-full rounded-xl p-1">
                  <TabsTrigger value="win" className="min-h-8 flex-1 rounded-lg text-xs">
                    {t("الأمر على Windows (PowerShell)")}
                  </TabsTrigger>
                  <TabsTrigger value="unix" className="min-h-8 flex-1 rounded-lg text-xs">
                    {t("الأمر على macOS وLinux")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="win" className="mt-3">
                  <pre
                    dir="ltr"
                    className="overflow-x-auto rounded-lg bg-muted p-3 text-left font-mono text-xs leading-relaxed"
                  >
                    {SHA_WIN}
                  </pre>
                </TabsContent>
                <TabsContent value="unix" className="mt-3">
                  <pre
                    dir="ltr"
                    className="overflow-x-auto rounded-lg bg-muted p-3 text-left font-mono text-xs leading-relaxed"
                  >
                    {SHA_UNIX}
                  </pre>
                </TabsContent>
              </Tabs>
              <Button variant="outline" className="min-h-11 gap-2" asChild>
                <a href={`${RELEASE_BASE}/SHA256SUMS.txt`} target="_blank" rel="noopener noreferrer">
                  <FileCheck2 className="size-4 text-primary" aria-hidden="true" />
                  SHA256SUMS.txt
                </a>
              </Button>
            </CardContent>
          </Card>

          {/* auto-update */}
          <Card className="rounded-2xl">
            <CardHeader className="flex-row items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <RefreshCw className="size-5" aria-hidden="true" />
              </span>
              <CardTitle className="text-base">{t("التحديث التلقائي (للمثبّتات الرسمية)")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(
                  "تطبيق الكمبيوتر يفحص ملف latest.json دوريًا، يُنزّل التحديث ويجري توقيعه قبل التثبيت — يمكنك التعطيل من الإعدادات."
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" className="min-h-11 gap-2" asChild>
                  <a href={`${RELEASE_BASE}/latest.json`} target="_blank" rel="noopener noreferrer">
                    <RefreshCw className="size-4 text-primary" aria-hidden="true" />
                    latest.json
                  </a>
                </Button>
                <Button variant="outline" className="min-h-11 gap-2" asChild>
                  <a href={RELEASES_PAGE} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4 text-primary" aria-hidden="true" />
                    {t("إصدارات سابقة وسجل التغييرات")}
                  </a>
                </Button>
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Signature className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  {t("الملفات المصدرية للتوقيع")}: <span dir="ltr">*.exe.sig · *.msi.sig · *.AppImage.sig · *.deb.sig · *.tar.gz.sig</span>
                </span>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
