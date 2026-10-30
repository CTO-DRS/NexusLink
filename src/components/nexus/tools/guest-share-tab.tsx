"use client"
// عقد §51 — المشاركة الضيوفة المباشرة — تبويب الأدوات
// الهدف: مشاركة ملفات مع أي جهاز قريب عبر متصفحه حصرًا — بلا تطبيق ولا حساب
// ولا سحابة: رمز مؤقت + QR يُمسح من الهاتف فتفتح صفحة الاستقبال محليًا.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import QRCode from "qrcode"
import { Share2, Plus, RotateCcw, Trash2, Copy, FolderDown, Timer, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useI18n } from "@/lib/i18n"
import { fmtSize } from "@/lib/store"
import { cn } from "@/lib/utils"

const TTL_OPTIONS = [
  { label: "15", value: 15 },
  { label: "30", value: 30 },
  { label: "60", value: 60 },
  { label: "120", value: 120 },
]

interface GuestStatus {
  enabled: boolean
  expired?: boolean
  mode?: "send" | "drop"
  fingerprint?: string
  expiresAt?: number
  label?: string
  files?: Array<{ name: string; size: number }>
  inbox: Array<{ name: string; size: number; at: number }>
}

export function GuestShareTab() {
  const { t } = useI18n()
  const [st, setSt] = useState<GuestStatus | null>(null)
  const [mode, setMode] = useState<"send" | "drop">("drop")
  const [ttl, setTtl] = useState(30)
  const [url, setUrl] = useState("")
  const [qr, setQr] = useState("")
  const [pathsText, setPathsText] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/guest/share", { cache: "no-store" })
      const j = await r.json()
      setSt(j)
    } catch { /* الشبكة سقطت — تبقى الحالة الأخيرة */ }
  }, [])

  useEffect(() => { void load() }, [load])

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    try {
      const r = await fetch("/api/guest/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      })
      const j = await r.json()
      if (!j.ok) {
        toast.error(j.error || t("فشل الإجراء"))
        return null
      }
      if (j.token) {
        const full = `${window.location.origin}/api/guest/xfer?g=${j.token}`
        setUrl(full)
        try { setQr(await QRCode.toDataURL(full, { width: 220, margin: 1 })) } catch { /* بلا QR بلا حاجز */ }
      } else {
        setUrl("")
        setQr("")
      }
      await load()
      return j
    } finally {
      setBusy(false)
    }
  }

  async function enable() {
    const paths = mode === "send"
      ? pathsText.split("\n").map((s) => s.trim()).filter(Boolean)
      : []
    if (mode === "send" && paths.length === 0) {
      toast.error(t("أدخل مسارًا واحدًا على الأقل للمشاركة"))
      return
    }
    const j = await act("enable", { mode, ttlMinutes: ttl, paths })
    if (j) toast.success(t("فُتحت المشاركة الضيوفة"), { description: t("امسح الرمز من الجهاز الآخر — الصلاحية مؤقتة") })
  }

  async function saveToDownloads(name: string) {
    const j = await act("inbox-save", { name })
    if (j) toast.success(t("حُفظ في تنزيلات الكمبيوتر"), { description: name })
  }

  const remaining = st?.expiresAt ? Math.max(0, st.expiresAt - Date.now()) : 0
  const remainText = remaining > 0
    ? `${Math.floor(remaining / 60_000)}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}`
    : ""

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px] items-start">
      <div className="space-y-4 min-w-0">
        {/* بطاقة التحكم */}
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className={cn("w-9 h-9 rounded-xl grid place-items-center", st?.enabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                <Share2 className="w-4.5 h-4.5" />
              </div>
              <div className="leading-tight">
                <div className="text-[13px] font-bold">{t("المشاركة الضيوفة المباشرة")}</div>
                <div className="text-[10.5px] text-muted-foreground">
                  {t("شارك ملفات مع أي جهاز عبر متصفحه — بلا تطبيق ولا حساب ولا سحابة")}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {st?.enabled && (
                <Badge className="rounded-full text-[9.5px] bg-emerald-500 hover:bg-emerald-500 gap-1">
                  <Timer className="w-3 h-3" /> {remainText}
                </Badge>
              )}
              {st?.enabled && (
                <Button size="sm" variant="outline" className="rounded-xl h-8 gap-1.5 text-[11px]" disabled={busy} onClick={() => void act("rotate", { mode: st?.mode ?? mode, ttlMinutes: ttl })}>
                  <RotateCcw className="w-3.5 h-3.5" /> {t("تدوير الرمز")}
                </Button>
              )}
              {st?.enabled ? (
                <Button size="sm" variant="outline" className="rounded-xl h-8 gap-1.5 text-[11px] text-red-500 hover:text-red-600" disabled={busy} onClick={() => void act("disable")}>
                  <Trash2 className="w-3.5 h-3.5" /> {t("إغلاق المشاركة")}
                </Button>
              ) : (
                <Switch checked={false} disabled={busy} onCheckedChange={() => void enable()} aria-label={t("فتح المشاركة الضيوفة")} />
              )}
            </div>
          </div>

          {!st?.enabled && (
            <div className="grid gap-3 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground">{t("الوضع")}:</span>
                <div className="flex rounded-xl border overflow-hidden">
                  <button onClick={() => setMode("drop")} className={cn("px-3 h-8 text-[11px]", mode === "drop" ? "bg-emerald-500 text-white" : "bg-background hover:bg-muted text-muted-foreground")}>
                    {t("استقبال من ضيف")}
                  </button>
                  <button onClick={() => setMode("send")} className={cn("px-3 h-8 text-[11px]", mode === "send" ? "bg-emerald-500 text-white" : "bg-background hover:bg-muted text-muted-foreground")}>
                    {t("إرسال ملفات")}
                  </button>
                </div>
                <span className="text-[11px] text-muted-foreground ms-2">{t("الصلاحية")}:</span>
                <div className="flex rounded-xl border overflow-hidden">
                  {TTL_OPTIONS.map((o) => (
                    <button key={o.value} onClick={() => setTtl(o.value)} className={cn("px-2.5 h-8 text-[10.5px]", ttl === o.value ? "bg-emerald-500 text-white" : "bg-background hover:bg-muted text-muted-foreground")}>
                      {o.label} {t("د")}
                    </button>
                  ))}
                </div>
              </div>
              {mode === "send" && (
                <div className="space-y-1.5">
                  <Input
                    value={pathsText}
                    onChange={(e) => setPathsText(e.target.value)}
                    placeholder="/Downloads/العقد.pdf"
                    className="rounded-xl text-[12px] font-mono dir-ltr text-start"
                    dir="ltr"
                    aria-label={t("مسارات الملفات (مسار لكل سطر)")}
                  />
                  <p className="text-[10px] text-muted-foreground">{t("مسار افتراضي واحد لكل سطر — من ملفات الكمبيوتر في تبويب الملفات")}</p>
                </div>
              )}
              <Button className="rounded-xl h-9 gap-1.5 text-[12px] w-fit" disabled={busy} onClick={() => void enable()}>
                <Plus className="w-4 h-4" /> {t("فتح المشاركة")}
              </Button>
            </div>
          )}

          {st?.enabled && (
            <p className="text-[11px] text-muted-foreground">
              {st.mode === "drop"
                ? t("أرسل الرمز لمن يريد إرسال ملف إليك — يرفع من متصفحه مباشرة إلى صندوق الاستقبال")
                : t("أرسل الرمز لمن تريد مشاركة الملفات معه — ينزّلها من متصفحه مباشرة")}
              {" · "}
              {t("بصمة الرمز")}: <span className="font-mono dir-ltr">{st.fingerprint?.slice(0, 8)}</span>
            </p>
          )}
        </div>

        {/* صندوق الاستقبال */}
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FolderDown className="w-4 h-4 text-muted-foreground" />
              <span className="text-[13px] font-bold">{t("صندوق الاستقبال")}</span>
              <Badge variant="secondary" className="rounded-full text-[9.5px]">{st?.inbox?.length ?? 0}</Badge>
            </div>
            {(st?.inbox?.length ?? 0) > 0 && (
              <Button variant="ghost" size="sm" className="h-7 rounded-lg gap-1 text-[10.5px] text-red-500 hover:text-red-600" onClick={() => void act("inbox-clear")}>
                <Trash2 className="w-3.5 h-3.5" /> {t("تفريغ الصندوق")}
              </Button>
            )}
          </div>
          {(st?.inbox?.length ?? 0) === 0 ? (
            <p className="text-[12px] text-muted-foreground text-center py-6">{t("لا ملفات مستلمة بعد — شارك الرمز مع ضيف وأرسل منه ملفًا")}</p>
          ) : (
            <ScrollArea className="max-h-64 pe-2">
              <div className="space-y-2">
                {(st?.inbox ?? []).map((f) => (
                  <div key={f.name} className="rounded-xl border bg-background/50 p-2.5 flex items-center gap-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate" title={f.name}>{f.name}</p>
                      <p className="text-[10px] text-muted-foreground">{fmtSize(f.size)}</p>
                    </div>
                    <Button size="sm" variant="outline" className="rounded-lg h-7 gap-1 text-[10.5px]" onClick={() => void saveToDownloads(f.name)}>
                      <FolderDown className="w-3.5 h-3.5" /> {t("حفظ في التنزيلات")}
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* العمود الأيسر: الرمز وQR */}
      <aside className="space-y-3">
        <div className="rounded-2xl border bg-card p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-emerald-500" />
            <span className="text-[13px] font-bold">{t("رمز المشاركة")}</span>
          </div>
          {url ? (
            <div className="space-y-2.5">
              <img src={qr} alt={t("رمز QR للمشاركة الضيوفة")} className="rounded-xl border mx-auto" width={220} height={220} />
              <p className="text-[10.5px] text-muted-foreground break-all font-mono dir-ltr text-center">{url}</p>
              <Button
                variant="outline"
                className="w-full rounded-xl h-8 gap-1.5 text-[11px]"
                onClick={() => { void navigator.clipboard.writeText(url).then(() => toast(t("نُسخ رابط المشاركة"))) }}
              >
                <Copy className="w-3.5 h-3.5" /> {t("نسخ الرابط")}
              </Button>
            </div>
          ) : (
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              {t("افتح المشاركة ليظهر رمز QR — يمسحه الطرف الآخر فيفتح صفحة الاستقبال في متصفحه حصرًا على الشبكة المحلية.")}
            </p>
          )}
        </div>
        <div className="rounded-2xl border bg-card p-4 text-[11.5px] leading-relaxed space-y-2">
          <div className="text-[12.5px] font-bold">{t("كيف تعمل المشاركة الضيوفة؟")}</div>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">{t("مقابل LocalSend")}:</span> {t("الطرف الآخر لا يحتاج أي تطبيق — متصفح حصرًا، والنقل محلي بلا وسيط سحابي.")}
          </p>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">{t("أمان مؤقت")}:</span> {t("الرمز يموت بانتهاء الصلاحية أو بإغلاقك المشاركة — ومحاولات الرمز الخاطئ تُقفل المؤقتة.")}
          </p>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">{t("حدود صادقة")}:</span> {t("الشبكة المحلية حصرًا — بلا عبور إنترنت — وحد الاستقبال 200MB للملف الواحد.")}
          </p>
        </div>
      </aside>
    </div>
  )
}
