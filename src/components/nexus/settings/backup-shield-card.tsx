"use client"
// عقد §54 — الدرع الاحتياطي المشفّر — بطاقة الإعدادات
// نسخ مشفّرة AES-256-GCM على الجهاز حصرًا + جدولة بمفتاح محلي (لا يعود أبدًا)
// + تحقق دراي-رن + استعادة بدمج/استبدال + سياسة احتفاظ — بلا أي سحابة.
import { useState, useCallback, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n"
import { toast } from "sonner"
import { ShieldCheck, KeyRound, PlayCircle, RotateCcw, Trash2, CalendarClock, Lock } from "lucide-react"

interface BackupFile { name: string; kind: "manual" | "scheduled"; at: number; size: number }
interface SecState {
  schedule?: { enabled: boolean; hours: number; lastRunAt: number | null; keyAnchored: boolean }
  retention?: { manual: number; scheduled: number }
  files?: BackupFile[]
}

function fmtSize(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

export function BackupShieldCard() {
  const { t } = useI18n()
  const [st, setSt] = useState<SecState | null>(null)
  const [pass, setPass] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch("/api/backup-secure", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: SecState) => setSt(j))
      .catch(() => { /* بطاقة إعدادات — البقاء صامتًا */ setSt(null) })
  }, [])
  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  const post = async (body: Record<string, unknown>, okMsg?: string) => {
    setBusy(true)
    try {
      const r = await fetch("/api/backup-secure", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j.ok) { if (okMsg) toast.success(t(okMsg)) } else {
        toast.error(t("فشل الإجراء") + (j.error ? `: ${j.error}` : ""))
      }
      load()
      return j
    } catch { toast.error(t("فشل الإجراء")); return null } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-teal-500" />
              {t("الدرع الاحتياطي المشفّر (§54)")}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {t("نسخ AES-256-GCM على هذا الجهاز حصرًا — بلا سحابة ولا حساب، وفقدان عبارة المرور يعني فقدان النسخة بصدق")}
            </p>
          </div>
          <Badge variant={st?.schedule?.enabled ? "default" : "outline"} className="text-[10px] shrink-0">
            {st?.schedule?.enabled ? t("الجدولة مفعّلة") : t("يدوي حصرًا")}
          </Badge>
        </div>

        {/* إنشاء يدوي + تحقق/استعادة */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <KeyRound className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password" value={pass} onChange={(e) => setPass(e.target.value)}
              placeholder={t("عبارة مرور النسخة (8 محارف فأكثر)")}
              className="h-8 ps-8 text-xs" data-testid="backup-pass-input"
            />
          </div>
          <Button size="sm" className="h-8 text-xs" disabled={busy || pass.trim().length < 8}
            onClick={() => void post({ action: "create", passphrase: pass, kind: "manual" }, "أُنشئت نسخة مشفّرة")}
            data-testid="backup-create">
            <Lock className="w-3 h-3" /> {t("أنشئ نسخة الآن")}
          </Button>
          {st?.files?.[0] && (
            <>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy || pass.trim().length < 8}
                onClick={() => void post({ action: "verify", file: st.files?.[0]?.name, passphrase: pass }, "المغلف سليم والعدّادات مطابقة")}>
                {t("تحقق")}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy || pass.trim().length < 8}
                onClick={() => void post({ action: "restore", file: st.files?.[0]?.name, passphrase: pass, mode: "merge" }, "استُعيدت النسخة بدمج")}>
                <RotateCcw className="w-3 h-3" /> {t("استعادة (دمج)")}
              </Button>
            </>
          )}
        </div>

        {/* الجدولة */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" />
          {st?.schedule?.enabled ? (
            <>
              <Badge variant="secondary" className="text-[10px]">{t("كل")} {st.schedule.hours} {t("س")}</Badge>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy}
                onClick={() => void post({ action: "schedule-tick" }, "نسخة مجدولة أُنشئت الآن")}>
                <PlayCircle className="w-3 h-3" /> {t("شغّل الآن")}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy}
                onClick={() => void post({ action: "schedule-disable" }, "أُوقفت الجدولة")}>
                {t("أوقف الجدولة")}
              </Button>
            </>
          ) : (
            <>
              <span className="text-muted-foreground">{t("جدولة بمفتاح محلي لا يغادر الجهاز:")}</span>
              {[12, 24, 168].map((h) => (
                <Button key={h} size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy}
                  onClick={() => void post({ action: "schedule-enable", hours: h }, "فُعّلت الجدولة")}>
                  {h === 168 ? t("أسبوعيًا") : `${t("كل")} ${h} ${t("س")}`}
                </Button>
              ))}
            </>
          )}
        </div>

        {/* القائمة */}
        <div className="space-y-1.5">
          {(st?.files ?? []).length === 0 ? (
            <p className="text-[11px] text-muted-foreground" data-testid="backup-empty">
              {t("لا نسخ مشفّرة بعد — أنشئ أول نسخة بعبارة مرور تعرفها وحدك")}
            </p>
          ) : (
            (st?.files ?? []).map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5" data-testid="backup-file">
                <div className="min-w-0">
                  <div className="text-[11px] font-mono truncate" dir="ltr">{f.name}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {fmtSize(f.size)} · {new Date(f.at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className="text-[9px]">{f.kind === "scheduled" ? t("مجدولة") : t("يدوية")}</Badge>
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={t("حذف")}
                    onClick={() => void post({ action: "delete", file: f.name }, "حُذفت النسخة")}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
        <p className="text-[9px] text-muted-foreground">
          {t("الاحتفاظ: آخر 10 يدوية و5 مجدولة — البقية تُطرد حتميًا. التدوير يغلق النسخ المجدولة القديمة بصدق.")}
        </p>
      </CardContent>
    </Card>
  )
}
