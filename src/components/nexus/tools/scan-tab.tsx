"use client"
// عقد §55 — الماسح الموثق الحي — تبويب الأدوات
// جلسة مسح: الصفحات (JPEG) من الهاتف تُدفع للجلسة على الحاسوب، ترتيب وتدوير
// ومعالجة اختيارية (§61: رمادي محسّن / أبيض وأسود بعتبة)، ثم ختم إلى PDF
// محلي — المعالجة عند الختم حصرًا في الذاكرة (الأصل لا يُمس).
import { useCallback, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n"
import { toast } from "sonner"
import { ScanLine, RotateCw, ArrowUp, ArrowDown, Trash2, FileCheck2, X, Plus, Image as ImageIcon, Wand2 } from "lucide-react"

interface ScanPageView { n: number; name: string; size: number; rotate: number; at: number; filter: string; thr: number | null }
interface SessionView { id: string; title: string; status: string; createdAt: number; pages: ScanPageView[] }

const FILTERS = ["none", "gray", "bw"] as const
const THR_MIN = 1
const THR_MAX = 254

function fmtSize(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

export function ScanTab() {
  const { t } = useI18n()
  const [session, setSession] = useState<SessionView | null>(null)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback((id?: string) => {
    const q = id ? `?id=${encodeURIComponent(id)}` : ""
    fetch(`/api/scan${q}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: SessionView | { session?: SessionView }) => setSession("session" in j ? (j.session ?? null) : null))
      .catch(() => setSession(null))
  }, [])

  const post = async (body: Record<string, unknown>, okMsg?: string) => {
    setBusy(true)
    try {
      const r = await fetch("/api/scan", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j.ok) { if (okMsg) toast.success(t(okMsg)) } else if (j.error) toast.error(`${t("فشل الإجراء")}: ${j.error}`)
      const id = j.session?.id ?? session?.id
      if (id && j.ok !== false) load(id)
      else if (!id) setSession(null)
      return j
    } catch { toast.error(t("فشل الإجراء")); return null } finally { setBusy(false) }
  }

  const uploadPages = async (files: FileList | null) => {
    if (!files?.length || !session) return
    setBusy(true)
    let done = 0
    for (const f of Array.from(files)) {
      try {
        const fd = new FormData()
        fd.append("file", f)
        const r = await fetch(`/api/scan/page?id=${encodeURIComponent(session.id)}`, { method: "POST", body: fd })
        const j = await r.json()
        if (j.ok) done++
        else toast.error(`${f.name}: ${j.error}`)
      } catch { toast.error(`${f.name}: ${t("فشل الإجراء")}`) }
    }
    if (done) toast.success(`${t("أُضيفت")} ${done} ${t("صفحة")}`)
    setBusy(false)
    load(session.id)
  }

  const setFilter = async (n: number, filter: string, thr?: number) => {
    const body: Record<string, unknown> = { action: "filter", id: session?.id, n, filter }
    if (filter === "bw" && thr !== undefined) body.thr = thr
    await post(body)
  }

  const submitThreshold = async (p: ScanPageView, raw: string) => {
    const v = Number(raw)
    if (!Number.isInteger(v) || v < THR_MIN || v > THR_MAX) {
      toast.error(`${t("حد العتبة")}: ${THR_MIN}–${THR_MAX}`)
      return
    }
    await setFilter(p.n, "bw", v)
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <ScanLine className="w-4 h-4 text-teal-500" />
              {t("الماسح الموثق الحي (§55)")}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {t("صفحات JPEG من هاتفك تُدمج في PDF على هذا الحاسوب حصرًا — بلا سحابة، ومعالجة اختيارية تُطبَّق عند الختم فقط (الأصل لا يُمس)")}
            </p>
          </div>
          {session ? (
            <Badge variant="secondary" className="text-[10px] shrink-0">{session.pages.length} {t("صفحة")}</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] shrink-0">{t("لا جلسة مفتوحة")}</Badge>
          )}
        </div>

        {!session ? (
          <div className="flex items-center gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("عنوان المسح (مثلًا: عقد الإيجار)")} className="h-8 text-xs flex-1" data-testid="scan-title" />
            <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void post({ action: "open", title }, "فُتحت جلسة المسح")} data-testid="scan-open">
              <Plus className="w-3 h-3" /> {t("افتح جلسة مسح")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer">
                <input type="file" accept="image/jpeg" multiple className="hidden" onChange={(e) => void uploadPages(e.target.files)} data-testid="scan-upload" />
                <span className="inline-flex items-center gap-1.5 rounded-xl border h-8 px-3 text-xs font-medium hover:bg-muted">
                  <ImageIcon className="w-3 h-3" /> {t("أضف صفحات JPEG")}
                </span>
              </label>
              <Button size="sm" className="h-8 text-xs" disabled={busy || session.pages.length === 0}
                onClick={() => void post({ action: "seal", id: session.id }, "خُتم PDF في مجلد المستندات")} data-testid="scan-seal">
                <FileCheck2 className="w-3 h-3" /> {t("ختم PDF")}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy}
                onClick={() => void post({ action: "cancel", id: session.id }, "أُلغيت الجلسة ونُظّفت الصفحات")}>
                <X className="w-3 h-3" /> {t("إلغاء الجلسة")}
              </Button>
            </div>

            {session.pages.length === 0 ? (
              <p className="text-[11px] text-muted-foreground" data-testid="scan-empty">
                {t("لا صفحات بعد — ادفع صفحات JPEG من هاتفك أو أضفها من هنا")}
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="scan-pages">
                {session.pages.map((p, i) => (
                  <li key={p.n} className="flex flex-col gap-1 rounded-lg border px-2.5 py-1.5" data-testid="scan-page">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-[9px] shrink-0" data-no-i18n>#{i + 1}</Badge>
                        <span className="text-[11px] font-mono truncate" dir="ltr">{p.name}</span>
                        <span className="text-[9px] text-muted-foreground shrink-0">{fmtSize(p.size)}</span>
                        {p.rotate !== 0 && <Badge variant="secondary" className="text-[9px] shrink-0" data-no-i18n>{p.rotate}°</Badge>}
                        {p.filter === "gray" && <Badge variant="secondary" className="text-[9px] shrink-0 gap-0.5" data-testid={`scan-filter-active-${p.n}`}><Wand2 className="w-2.5 h-2.5" />{t("رمادي محسّن")}</Badge>}
                        {p.filter === "bw" && <Badge variant="secondary" className="text-[9px] shrink-0 gap-0.5" data-testid={`scan-filter-active-${p.n}`}><Wand2 className="w-2.5 h-2.5" />{t("أبيض وأسود")} <span data-no-i18n dir="ltr">@{p.thr ?? 160}</span></Badge>}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {[0, 90, 180, 270].map((deg) => (
                          <Button key={deg} size="icon" variant={p.rotate === deg ? "secondary" : "ghost"} className="h-6 w-6 text-[9px]" aria-label={`${t("تدوير")} ${deg}`}
                            onClick={() => void post({ action: "rotate", id: session.id, n: p.n, deg })}>
                            {deg === 0 ? "0°" : <RotateCw className="w-3 h-3" />}
                          </Button>
                        ))}
                        <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={t("للأعلى")} disabled={i === 0}
                          onClick={() => void post({ action: "move", id: session.id, from: i, to: i - 1 })}>
                          <ArrowUp className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={t("للأسفل")} disabled={i === session.pages.length - 1}
                          onClick={() => void post({ action: "move", id: session.id, from: i, to: i + 1 })}>
                          <ArrowDown className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={t("حذف")}
                          onClick={() => void post({ action: "remove", id: session.id, n: p.n })}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 ps-1">
                      <span className="text-[9px] text-muted-foreground shrink-0">{t("المعالجة")}:</span>
                      {FILTERS.map((f) => (
                        <Button key={f} size="sm" variant={p.filter === f ? "secondary" : "ghost"}
                          className="h-5 px-1.5 text-[9px] font-normal rounded-md"
                          disabled={busy}
                          data-testid={`scan-filter-${p.n}-${f}`}
                          onClick={() => void setFilter(p.n, f)}>
                          {f === "none" ? t("بلا معالجة") : f === "gray" ? t("رمادي محسّن") : t("أبيض وأسود")}
                        </Button>
                      ))}
                      {p.filter === "bw" && (
                        <span className="inline-flex items-center gap-1 shrink-0">
                          <span className="text-[9px] text-muted-foreground">{t("حد العتبة")}</span>
                          <Input type="number" min={THR_MIN} max={THR_MAX} defaultValue={p.thr ?? 160}
                            className="h-5 w-14 text-[10px] px-1 h-5" dir="ltr"
                            data-testid={`scan-thr-${p.n}`}
                            onBlur={(e) => { const v = e.target.value; if (v !== String(p.thr ?? 160)) void submitThreshold(p, v) }}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }} />
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="text-[9px] text-muted-foreground">
          {t("المعالجة في الذاكرة عند الختم حصرًا — ملف الصفحة الأصلي على القرص لا يُمس")}
        </p>
        <p className="text-[9px] text-muted-foreground">
          {t("الحدود: 30 صفحة لكل جلسة و12MB للصفحة و3 جلسات مفتوحة — JPEG حصرًا بفحص السحر حرفيًا")}
        </p>
      </CardContent>
    </Card>
  )
}
