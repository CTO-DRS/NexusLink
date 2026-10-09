"use client"

/**
 * الإعدادات — إعادة بناء كاملة للمرحلة 11:
 * المظهر والتباين · اللغة · الإتاحة · الاختصارات (تخصيص كامل) · الأداء · التحديث · حول
 */
import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useNexus, SHORTCUT_META, type ShortcutAction } from "@/lib/store"
import { useI18n, announce } from "@/lib/i18n"
import {
  Moon, Sun, Languages, ShieldCheck, Wifi, Cpu, Info, Radio, Contrast,
  Accessibility, Keyboard, Gauge, HardDriveDownload, Sparkles, RotateCcw,
  Ear, Volume2, CheckCircle2, AlertTriangle, Rocket, Package, Globe,
} from "lucide-react"

const SHORTCUT_ORDER: ShortcutAction[] = [
  "palette", "help", "sendFile", "lock", "theme", "lang", "contrast", "speedtest", "dnd",
  "devices", "files", "transfers", "comms", "security", "tools", "settings",
]

function SectionTitle({ icon: Icon, title, desc }: { icon: typeof Info; title: string; desc?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary grid place-items-center shrink-0">
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <Label className="text-sm font-semibold">{title}</Label>
        {desc && <p className="text-xs text-muted-foreground leading-5">{desc}</p>}
      </div>
    </div>
  )
}

export function SettingsView() {
  const {
    theme, toggleTheme, contrast, setContrast, fontScale, setFontScale,
    motion, setMotion, srMode, setSrMode,
    shortcuts, setShortcut, resetShortcuts,
    autostart, setAutostart, silentUpdates, setSilentUpdates, batterySaver, setBatterySaver,
    setOnboardingOpen, setShortcutsHelpOpen, setView,
  } = useNexus()
  const { t, lang, setLang } = useI18n()
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [conflict, setConflict] = useState<string>("")
  const [verInfo, setVerInfo] = useState<string>("")
  const [checking, setChecking] = useState(false)

  // capture a new combo while recording
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape") {
        setRecording(null)
        setConflict("")
        return
      }
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl")
      if (e.altKey) parts.push("Alt")
      if (e.shiftKey) parts.push("Shift")
      let key = e.key.length === 1 ? e.key.toUpperCase() : e.key
      if (!parts.length && !/^[A-Z0-9]$/.test(key)) {
        // require a modifier for non-alphanumeric
        setConflict(t("استخدم مفتاحاً معدّلاً (Ctrl/Alt/Shift)"))
        return
      }
      parts.push(key)
      const combo = parts.join("+")
      const owner = (Object.entries(shortcuts) as [ShortcutAction, string][]).find(([, c]) => c === combo)
      if (owner && owner[0] !== recording) {
        setConflict(`${t("مستخدم بالفعل لـ")}: ${t(SHORTCUT_META[owner[0]])}`)
        return
      }
      setShortcut(recording, combo)
      setRecording(null)
      setConflict("")
      announce(`${t("تم حفظ اختصار")} ${t(SHORTCUT_META[recording])}`)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [recording, shortcuts, setShortcut, t])

  const checkUpdate = useCallback(async () => {
    setChecking(true)
    try {
      const r = await fetch("/api/version", { cache: "no-store" })
      const j = await r.json()
      setVerInfo(j.latest === j.current ? t("أنت على أحدث إصدار") + ` (v${j.current})` : `${t("يتوفر تحديث")} v${j.latest}`)
    } catch {
      setVerInfo(t("تعذر الفحص"))
    } finally {
      setChecking(false)
    }
  }, [t])

  const devices = useNexus((s) => s.devices)
  const connected = devices.filter((d) => d.state === "connected").length

  const fontBtn = (v: 1 | 1.125 | 1.25, label: string) => (
    <Button
      key={v}
      size="sm"
      variant={fontScale === v ? "default" : "outline"}
      onClick={() => { setFontScale(v); announce(t("حجم الخط تغيّر")) }}
      className="h-8 px-3"
      data-no-i18n
    >
      {label}
    </Button>
  )

  return (
    <div className="space-y-5 max-w-2xl pb-8">
      <div>
        <h1 className="text-xl font-bold">{t("الإعدادات")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("خصّص تجربة NexusLink على هذا الجهاز")}</p>
      </div>

      {/* المظهر */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle
              icon={theme === "dark" ? Moon : Sun}
              title={t("المظهر")}
              desc={t("داكن أو فاتح — يُحفظ تلقائياً")}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{theme === "dark" ? t("داكن") : t("فاتح")}</span>
              <Switch checked={theme === "dark"} onCheckedChange={toggleTheme} aria-label={t("تبديل المظهر")} />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <SectionTitle
              icon={Contrast}
              title={t("التباين العالي")}
              desc={t("ألوان نقية وحدود أقوى — لضعاف البصر وللعرض تحت الشمس")}
            />
            <Switch checked={contrast === "high"} onCheckedChange={(b) => setContrast(b ? "high" : "normal")} aria-label={t("التباين العالي")} />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Languages} title={t("حجم الخط")} desc={t("ثلاثة مستويات تنطبق على الواجهة كلها")} />
            <div className="flex items-center gap-1.5">
              {fontBtn(1, "A")}
              {fontBtn(1.125, "A+")}
              {fontBtn(1.25, "A++")}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* اللغة */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <SectionTitle icon={Globe} title={t("اللغة والاتجاه")} desc={t("عربي RTL كامل + إنجليزي LTR — التبديل فوري لكل الواجهة")} />
          <div className="flex items-center gap-2">
            <Button size="sm" variant={lang === "ar" ? "default" : "outline"} onClick={() => setLang("ar")} className="gap-1.5">
              <Languages className="w-4 h-4" /> العربية · RTL
            </Button>
            <Button size="sm" variant={lang === "en" ? "default" : "outline"} onClick={() => setLang("en")} className="gap-1.5">
              <Languages className="w-4 h-4" /> English · LTR
            </Button>
            <Badge variant="outline" className="ms-auto" data-no-i18n>{lang === "ar" ? "ar · RTL" : "en · LTR"}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("اختصار: Ctrl+Shift+E")}</p>
        </CardContent>
      </Card>

      {/* الإتاحة */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle
              icon={Ear}
              title={t("وضع قارئ الشاشة")}
              desc={t("رابط «تخطّي إلى المحتوى» + حلقات تركيز أوضح + إعلانات صوتية للأحداث")}
            />
            <Switch checked={srMode} onCheckedChange={(b) => { setSrMode(b); announce(b ? t("وضع قارئ الشاشة مفعّل") : t("وضع قارئ الشاشة معطل")) }} aria-label={t("وضع قارئ الشاشة")} />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Accessibility} title={t("تقليل الحركة")} desc={t("إيقاف الوميض والانيميشن — مناسب لالحساسية البصرية للحركة")} />
            <Switch checked={motion === "reduced"} onCheckedChange={(b) => setMotion(b ? "reduced" : "full")} aria-label={t("تقليل الحركة")} />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Volume2} title={t("اختبار الإعلان الصوتي")} desc={t("يجرّب منطقة الإعلان التي يقرأها قارئ الشاشة")} />
            <Button size="sm" variant="outline" onClick={() => announce(t("هذا اختبار للإعلان — قارئ الشاشة سينطق هذه الجملة"))} className="gap-1.5">
              <Volume2 className="w-3.5 h-3.5" /> {t("جرّب")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* الاختصارات */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Keyboard} title={t("اختصارات الكيبورد")} desc={t("اضغط «تغيير» ثم اضغط التركيبة الجديدة — Esc للإلغاء")} />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShortcutsHelpOpen(true)} className="gap-1.5">
                <Keyboard className="w-3.5 h-3.5" /> {t("الدليل (?)")}
              </Button>
              <Button size="sm" variant="outline" onClick={resetShortcuts} className="gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> {t("استعادة الافتراضي")}
              </Button>
            </div>
          </div>
          {conflict && (
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-xl px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {conflict}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-1.5">
            {SHORTCUT_ORDER.map((a) => (
              <div key={a} className="flex items-center justify-between rounded-xl border px-3 py-2 gap-2">
                <span className="text-xs font-medium truncate">{t(SHORTCUT_META[a])}</span>
                {recording === a ? (
                  <Badge className="animate-pulse shrink-0" data-no-i18n>{t("اضغط…")}</Badge>
                ) : (
                  <button
                    onClick={() => { setRecording(a); setConflict("") }}
                    className="shrink-0 inline-flex items-center rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold hover:bg-accent transition-colors"
                    aria-label={`${t("تغيير اختصار")} ${t(SHORTCUT_META[a])}`}
                    data-no-i18n
                  >
                    {shortcuts[a]}
                  </button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* الأداء */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Rocket} title={t("التشغيل مع النظام")} desc={t("يبدأ NexusLink مع إقلاع الجهاز في الخلفية — بدون نافذة")} />
            <Switch checked={autostart} onCheckedChange={setAutostart} aria-label={t("التشغيل مع النظام")} />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Cpu} title={t("وضع توفير البطارية")} desc={t("يخفض نبض الخلفية ويجمّد الاستطلاع الدوري — بطارية شبه معدومة")} />
            <Switch checked={batterySaver} onCheckedChange={setBatterySaver} aria-label={t("وضع توفير البطارية")} />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Gauge} title={t("ميزانية الأداء")} desc={t("سطح المكتب: أقل من 200MB ذاكرة · إطلاق أقل من ثانيتين · صفر استهلاك شبكة عند الخمول")} />
            <Button size="sm" variant="outline" onClick={() => setView("tools")} className="gap-1.5 shrink-0">
              <Gauge className="w-3.5 h-3.5" /> {t("قِس بنفسك")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* التحديث */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={HardDriveDownload} title={t("التحديث التلقائي الصامت")} desc={t("تنزيل بتوقيع رقمي في الخلفية وتثبيت عند إعادة التشغيل — تعطيله يجعل التطبيق offline حصرياً")} />
            <Switch checked={silentUpdates} onCheckedChange={setSilentUpdates} aria-label={t("التحديث الصامت")} />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={CheckCircle2} title={t("فحص الإصدار")} desc={verInfo || t("يتحقق من قناة stable")} />
            <Button size="sm" variant="outline" onClick={checkUpdate} disabled={checking} className="gap-1.5 shrink-0">
              <RotateCcw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} /> {t("فحص الآن")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* الشبكة والبروتوكول */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Wifi} title={t("الاكتشاف التلقائي (mDNS)")} desc={t("ابحث عن الأجهزة على الشبكة المحلية")} />
            <Switch defaultChecked aria-label={t("الاكتشاف التلقائي")} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Radio} title={t("نبض Nexus Protocol")} desc={t("فحص الاتصال كل 5 ثوانٍ (JSON/TCP)")} />
            <Switch defaultChecked aria-label={t("نبض البروتوكول")} />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={ShieldCheck} title={t("تشفير القناة")} desc={t("E2E حقيقي: X25519 + AES-256-GCM — مفعّل دائماً وغير قابل للإيقاف")} />
            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">{t("مفعّل دائماً")}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* حول */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Info className="w-4 h-4 text-primary" /> {t("عن التطبيق")}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground" data-no-i18n>
            <div className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> {t("الإصدار")}: NexusLink 2.4.1</div>
            <div className="flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5" /> {t("أجهزة متصلة")}: {connected}</div>
            <div>{t("البروتوكول")}: Nexus/1.2 (JSON/TCP + Heartbeat)</div>
            <div>{t("النقل")}: Chunked 256KB · Resume · Parallel</div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="gap-1"><Package className="w-3 h-3" /> {t("نسخة Portable متوفرة")}</Badge>
            <Badge variant="outline" className="gap-1"><Globe className="w-3 h-3" /> {t("واجهة ويب خفيفة من أي متصفح")}</Badge>
            <Badge variant="outline" className="gap-1"><Sparkles className="w-3 h-3" /> Windows · macOS · Linux · Android · iOS</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-5">
            {t("يعمل NexusLink محلياً بالكامل على شبكتك المنزلية — لا حاجة لأي خدمة سحابية، ولا تُرسل بياناتك خارج أجهزتك أبداً")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setOnboardingOpen(true)} className="gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> {t("إعادة جولة الترحيب")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setView("tools")} className="gap-1.5">
              <HardDriveDownload className="w-3.5 h-3.5" /> {t("البناء والتوزيع")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
