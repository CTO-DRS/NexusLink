"use client"
// Cloud Mode: optional hosted link-in-bio page with analytics. OFF by default.
// Enabling requires accepting an explicit disclosure; while off, no cloud request is ever made.
import { useEffect, useState } from "react"
import { Cloud, ShieldAlert, ExternalLink, RefreshCw, KeyRound } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"
import { DEVELOPER } from "@/lib/developer-links"
import { DEVELOPER_BANNERS } from "@/lib/developer-banners"
import { buildCloudPage, cloudDeployed, cloudDelete, cloudPublish, cloudStatsTyped, cloudLeadsCsv, type CloudStats, handleOk, loadCloud, newToken, saveCloud, type CloudState } from "@/lib/cloud-mode"

async function photoDataUrl(): Promise<string> {
  try {
    const img = new Image()
    img.src = DEVELOPER.photo
    await img.decode()
    const c = document.createElement("canvas")
    c.width = c.height = 256
    c.getContext("2d")!.drawImage(img, 0, 0, 256, 256)
    return c.toDataURL("image/jpeg", 0.85)
  } catch { return "" }
}

export function CloudModeCard() {
  const { t, lang } = useI18n()
  const [s, setS] = useState<CloudState>(() => (typeof window === "undefined" ? { enabled: false, handle: "", token: "", capture: false } : loadCloud()))
  const [deployed, setDeployed] = useState<boolean | null>(null)
  const [ask, setAsk] = useState(false)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<CloudStats | null>(null)
  const update = (p: Partial<CloudState>) => setS((cur) => { const n = { ...cur, ...p }; saveCloud(n); return n })

  useEffect(() => {
    // Only the deployment flag of our own local server is read here; it contacts nothing remote.
    if (!s.enabled) return
    let alive = true
    cloudDeployed().then((d) => alive && setDeployed(d))
    return () => { alive = false }
  }, [s.enabled])

  const turnOn = () => { setAgree(false); setAsk(true) }
  const confirm = () => { update({ enabled: true, acceptedAt: Date.now(), token: s.token || newToken() }); setAsk(false) }
  const turnOff = () => update({ enabled: false })

  const [statsBusy, setStatsBusy] = useState(false)
  const [statsErr, setStatsErr] = useState(false)
  const loadStats = (alive: () => boolean = () => true) => {
    setStatsBusy(true)
    cloudStatsTyped(s, 30)
      .then((d) => { if (alive()) { setStats(d); setStatsErr(false) } })
      .catch(() => { if (alive()) setStatsErr(true) })
      .finally(() => { if (alive()) setStatsBusy(false) })
  }
  useEffect(() => {
    if (!s.enabled || !s.publishedUrl) return
    let live = true
    const alive = () => live
    const first = setTimeout(() => loadStats(alive), 0)
    // Refresh once a minute while the tab is visible; requests only happen with Cloud Mode on and a published page.
    const id = setInterval(() => { if (document.visibilityState === "visible") loadStats(alive) }, 60000)
    return () => { live = false; clearTimeout(first); clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.enabled, s.publishedUrl])

  const exportLeads = async () => {
    try {
      const blob = await cloudLeadsCsv(s)
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${s.handle}-leads.csv`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch { toast.error(t("تعذّر الاتصال بالخدمة")) }
  }

  const publish = async () => {
    if (!handleOk(s.handle)) { toast.error(t("معرّف غير صالح (حروف إنجليزية صغيرة وأرقام وشرطة، من 3 إلى 32)")); return }
    setBusy(true)
    try {
      const titles: Record<string, string> = {}
      for (const l of DEVELOPER.links) titles[l.id] = l.id === "github" ? "GitHub" : t(l.label)
      for (const b of DEVELOPER_BANNERS) { titles[b.title] = t(b.title); titles[b.body] = t(b.body); titles[b.cta] = t(b.cta) }
      const theme = (typeof localStorage !== "undefined" && localStorage.getItem("nexus.devcard.theme")) || "violet"
      const page = buildCloudPage({
        theme, animated: typeof localStorage !== "undefined" && localStorage.getItem("nexus.devcard.anim") === "1", capture: s.capture,
        lang: lang === "ar" ? "ar" : "en", photo: await photoDataUrl(),
        texts: { role: t("مطوّر تطبيقات • استشارات تقنية"), label: t("اترك بريدك أو رقمك وسنتواصل معك"), consent: t("أوافق على التواصل معي"), titles },
      })
      const r = await cloudPublish(s, page)
      update({ publishedUrl: r.url, publishedAt: Date.now() })
      toast.success(t("تم نشر الصفحة"))
    } catch (e) {
      const code = (e as { code?: string | number }).code
      toast.error(code === "not_deployed" ? t("الخدمة المستضافة لم تُفعَّل بعد") : code === 403 ? t("هذا المعرّف مأخوذ") : t("تعذّر الاتصال بالخدمة"))
    } finally { setBusy(false) }
  }
  const copyKey = async () => {
    try { await navigator.clipboard.writeText(s.token); toast.success(t("نُسخ مفتاح الصفحة")) } catch { toast.error(t("تعذّر النسخ")) }
  }
  const useKey = () => {
    const v = (window.prompt(t("الصق مفتاح الصفحة الذي نسخته من تطبيق آخر. المفتاح سرّي، لا تشاركه مع أحد.")) || "").trim()
    if (!v) return
    if (v.length < 32 || v.length > 128 || !/^[A-Za-z0-9_-]+$/.test(v)) { toast.error(t("مفتاح غير صالح")); return }
    update({ token: v }); toast.success(t("حُفظ المفتاح"))
  }
  const remove = async () => {
    setBusy(true)
    try { await cloudDelete(s); update({ publishedUrl: undefined, publishedAt: undefined }); toast.success(t("حُذفت الصفحة وبياناتها")) }
    catch { toast.error(t("تعذّر الاتصال بالخدمة")) }
    finally { setBusy(false) }
  }

  return (
    <Card data-testid="cloud-mode-card">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Cloud className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <div className="text-sm font-semibold">{t("الوضع السحابي (اختياري)")}</div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("صفحة روابط مستضافة مع إحصاءات. مُعطَّل افتراضيًا، ولا يُرسل التطبيق أي شيء إلى السحابة ما دام مُعطَّلًا.")}</p>
            </div>
          </div>
          <Switch checked={s.enabled} onCheckedChange={(v) => (v ? turnOn() : turnOff())} aria-label={t("تفعيل الوضع السحابي")} data-testid="cloud-switch" />
        </div>

        {s.enabled && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-2.5 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
              <ShieldAlert className="h-4 w-4 shrink-0" /> {t("الوضع السحابي مُفعَّل: بيانات زيارات صفحتك تُرسَل إلى الخدمة المستضافة.")}
            </div>
            {deployed === false && <p className="text-[11px] text-muted-foreground">{t("الخدمة المستضافة لم تُفعَّل بعد")}</p>}
            <label className="block text-xs text-muted-foreground">
              {t("معرّف الصفحة")}
              <input
                dir="ltr"
                value={s.handle}
                onChange={(e) => update({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) })}
                placeholder="cto-drs"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
                data-testid="cloud-handle"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t("جمع البريد أو الرقم من الزوار")}</span>
              <Switch checked={s.capture} onCheckedChange={(v) => update({ capture: v })} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={publish} disabled={busy} data-testid="cloud-publish">{t("نشر الصفحة")}</Button>
              {s.publishedUrl && <Button size="sm" variant="outline" onClick={remove} disabled={busy}>{t("حذف الصفحة وبياناتها")}</Button>}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={copyKey} data-testid="cloud-copy-key"><KeyRound className="h-3.5 w-3.5" /> {t("نسخ مفتاح الصفحة")}</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={useKey} data-testid="cloud-use-key">{t("استخدام مفتاح موجود")}</Button>
            </div>
            {s.publishedUrl && (
              <a href={s.publishedUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary underline" dir="ltr">
                <ExternalLink className="h-3.5 w-3.5" /> {s.publishedUrl}
              </a>
            )}
            {s.publishedUrl && !stats && (
              <div className="flex items-center justify-between gap-2 border-t pt-4 text-[11px] text-muted-foreground" data-testid="cloud-stats-state">
                <span>{statsErr ? t("تعذّر تحميل الإحصاءات") : t("جارٍ تحميل الإحصاءات…")}</span>
                {statsErr && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => loadStats()} disabled={statsBusy}>{t("تحديث")}</Button>}
              </div>
            )}
            {stats && s.publishedUrl && (
              <div className="space-y-3 border-t pt-4" data-testid="cloud-stats">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold">{t("إحصاءات آخر 30 يومًا")}</div>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => loadStats()} disabled={statsBusy} aria-label={t("تحديث")} data-testid="cloud-stats-refresh">
                    <RefreshCw className={`h-3.5 w-3.5 ${statsBusy ? "animate-spin" : ""}`} /> {t("تحديث")}
                  </Button>
                </div>
                {statsErr && <p className="text-[11px] text-amber-700 dark:text-amber-300">{t("تعذّر تحميل الإحصاءات")}</p>}
                {stats.views === 0 && stats.clicks === 0 && <p className="rounded-lg bg-muted/40 p-2.5 text-[11px] leading-5 text-muted-foreground">{t("لا زيارات بعد. شارك رابط صفحتك لتظهر الإحصاءات هنا.")}</p>}
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-muted/50 p-2.5"><div className="text-lg font-bold">{stats.views}</div><div className="text-[11px] text-muted-foreground">{t("زيارات")}</div></div>
                  <div className="rounded-lg bg-muted/50 p-2.5"><div className="text-lg font-bold">{stats.clicks}</div><div className="text-[11px] text-muted-foreground">{t("نقرات")}</div></div>
                </div>
                {([[t("المصادر"), stats.sources.map((x) => [x.source, x.n] as const)], [t("الدول"), stats.countries.map((x) => [x.country, x.n] as const)]] as const).map(([title, rows]) => rows.length > 0 && (
                  <div key={title}>
                    <div className="mb-1 text-[11px] text-muted-foreground">{title}</div>
                    {rows.slice(0, 5).map(([k, n]) => (
                      <div key={k} className="flex justify-between text-xs" dir="ltr"><span>{k}</span><span className="tabular-nums">{n}</span></div>
                    ))}
                  </div>
                ))}
                {stats.hours.length > 0 && (() => { const top = [...stats.hours].sort((a, b) => b.n - a.n)[0]; return <div className="text-xs text-muted-foreground">{t("ساعة الذروة (UTC)")}: <span dir="ltr" className="font-semibold text-foreground">{String(top.hour).padStart(2, "0")}:00</span></div> })()}
                {s.capture && <Button size="sm" variant="outline" onClick={exportLeads}>{t("تصدير جهات الاتصال (CSV)")}</Button>}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent data-testid="cloud-disclosure">
          <DialogHeader>
            <DialogTitle>{t("قبل تفعيل الوضع السحابي")}</DialogTitle>
            <DialogDescription>{t("اقرأ ما سيُرسَل ويُحفظ على الخدمة المستضافة.")}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-2 ps-5 text-sm leading-6">
            <li>{t("عند التفعيل تُنشر بطاقة المطوّر كصفحة عامة على خدمة مستضافة.")}</li>
            <li>{t("يُرسَل إلى الخدمة ويُحفظ فيها: عدد زيارات الصفحة والنقرات ومصدر الزيارة (اسم الموقع المُحيل فقط) وبلد الزائر التقريبي وساعة الزيارة. لا تُحفظ عناوين IP ولا ملفات تعريف الارتباط.")}</li>
            <li>{t("إن فعّلتَ نموذج جمع البيانات، يُحفظ البريد أو الرقم الذي يرسله الزائر بنفسه على الخدمة، وأنت مسؤول عن إشعار الخصوصية في صفحتك.")}</li>
            <li>{t("يمكنك الإيقاف وحذف الصفحة وكل بياناتها في أي وقت. وبقية التطبيق يبقى محليًا بالكامل.")}</li>
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" data-testid="cloud-agree" />
            <span>{t("أفهم أن بيانات زيارات الصفحة تُرسَل إلى الخدمة المستضافة")}</span>
          </label>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAsk(false)}>{t("إلغاء")}</Button>
            <Button disabled={!agree} onClick={confirm} data-testid="cloud-confirm">{t("تفعيل")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
