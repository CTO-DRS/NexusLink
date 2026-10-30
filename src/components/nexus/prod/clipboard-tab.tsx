"use client"
// الحافظة الموحدة — نسخ في أي جهاز ← لصق في الآخر (تلقائي/يدوي)
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ClipboardCheck, Monitor, Smartphone, Tablet, Tv, Copy, Trash2, FileDown,
  Pilcrow, Image as ImageIcon, FileText, Keyboard, Wand2, CircleCheck,
  ArrowLeftRight, Send, Pin, PinOff, Eye, Search, ShieldAlert, TimerReset,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useProd, type ProdClipItem } from "@/lib/prod-store"
import { setClipMode, setClipMax, lastPhoneText } from "@/hooks/use-prod-bridge"
import { tauriInvoke } from "@/lib/tauri"
import { fmtSize } from "@/lib/store"
import { cn } from "@/lib/utils"

function DeviceIcon({ id, className }: { id: string; className?: string }) {
  if (id === "pc-office") return <Monitor className={className} />
  if (id === "ipad-pro") return <Tablet className={className} />
  if (id === "nexus-tv") return <Tv className={className} />
  return <Smartphone className={className} />
}

const KIND_LABEL: Record<string, string> = { text: "نص", image: "صورة", file: "ملف" }

/** FA-clipboard-sync — وضع سطح المكتب: الطبقة الأصلية تملك حافظة النظام */
const isDesktop = () =>
  typeof window !== "undefined" &&
  !!(window as unknown as { __NEXUS_DESKTOP__?: boolean }).__NEXUS_DESKTOP__

/** خيارات حد الإرسال التلقائي (عقد §11) */
const MAX_OPTIONS = [
  { label: "128KB", value: 131_072 },
  { label: "512KB", value: 524_288 },
  { label: "1MB", value: 1_048_576 },
  { label: "4MB", value: 4_194_304 },
]

/** قراءة الحد المحفوظ من مخزن سطح المكتب عند التركيب */
async function loadClipMax(): Promise<number | null> {
  try {
    const r = await fetch("/api/desktop/shortcuts")
    const j = await r.json()
    return typeof j?.clip?.maxAutoBytes === "number" ? j.clip.maxAutoBytes as number : null
  } catch { return null }
}

export function ClipboardTab() {
  const { clips, state, sysClipboardArmed, pasteZoneText, setPasteZoneText, checks, setCheck, setClips } = useProd()
  const [compose, setCompose] = useState("")
  const [clipMax, setClipMaxLocal] = useState(1_048_576)
  const pasteRef = useRef<HTMLTextAreaElement>(null)
  // §50 — خزنة الحافظة: بحث + كشف مقصود + تدبيس
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ProdClipItem[] | null>(null)

  useEffect(() => {
    void loadClipMax().then((v) => { if (v) setClipMaxLocal(v) })
  }, [])

  // §50 — بحث الخزنة المُؤجّل: نتائج مرتبة من المسار الفرعي حصرًا
  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults(null); return }
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/prod/clipboard/vault?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        const j = await r.json()
        setResults(Array.isArray(j.items) ? j.items : [])
      } catch { setResults(null) }
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  /** §50 — إعادة تحميل القائمة بعد إجراء خزنة */
  async function reloadClips() {
    try {
      const r = await fetch("/api/prod/clipboard", { cache: "no-store" })
      const j = await r.json()
      if (Array.isArray(j.items)) setClips(j.items)
    } catch { /* بلا هلع */ }
  }

  /** §50 — تدبيس/إلغاء: المثبت لا ينتهي ولا يُنقّى */
  async function togglePin(id: string, pinned: boolean) {
    const r = await fetch("/api/prod/clipboard/vault", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: pinned ? "pin" : "unpin", id }),
    })
    const j = await r.json()
    if (j.ok) {
      toast.success(pinned ? "دُبّس — لن ينتهي ولا يُنقّى" : "فُكّ التدبيس")
      await reloadClips()
    }
  }

  /** §50 — الكشف المقصود المُدقَّق لعنصر حساس */
  async function reveal(id: string) {
    const r = await fetch("/api/prod/clipboard/vault", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal", id }),
    })
    const j = await r.json()
    if (j.ok) {
      const patch = (list: ProdClipItem[]) => list.map((c) => (c.id === id ? { ...c, content: j.item.content, masked: false } : c))
      setClips(patch(useProd.getState().clips))
      if (results) setResults(patch(results))
    }
  }

  const phoneText = lastPhoneText()

  /** زر اللصق الموحد — يحاكي Ctrl+V عندما تكتب المتصفح الحافظة مباشرة */
  function universalPaste() {
    if (!phoneText) {
      toast.error("لا يوجد نص من جهاز آخر بعد", { description: "انسخ نصًا من هاتفك أولاً عبر /phone" })
      return
    }
    setPasteZoneText(pasteZoneText ? pasteZoneText + "\n" + phoneText : phoneText)
    setCheck("paste")
    toast.success("لُصق نص الهاتف مباشرة — الحافظة الموحدة تعمل")
  }

  /** لصق طبيعي داخل المنطقة — نتحقق إن كان النص من الهاتف ونُدخله يدوياً (سلوك متطابق في كل البيئات) */
  function onPasteZone(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault()
    const text = e.clipboardData.getData("text")
    if (!text) return
    if (phoneText && (text === phoneText || (phoneText.length > 3 && text.includes(phoneText)))) {
      setCheck("paste")
      toast.success("نجح الاختبار! لُصق نص هاتفك بـ Ctrl+V مباشرة")
    }
    setPasteZoneText(pasteZoneText ? pasteZoneText + "\n" + text : text)
  }

  /** نسخ نص من الكمبيوتر → يصل للهاتف والأجهزة الأخرى */
  async function copyFromPc() {
    if (!compose.trim()) return
    await fetch("/api/prod/clipboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "pc-office", kind: "text", content: compose, mode: state.clipMode }),
    })
    try {
      await navigator.clipboard.writeText(compose)
    } catch { /* ignore */ }
    setCompose("")
    toast.success("نُسخ من الكمبيوتر إلى الحافظة الموحدة", { description: "افتح /phone على هاتفك ستجده جاهزاً للنسخ" })
  }

  /** استلام ملف فعلي من الهاتف — نسخ بايتات حقيقي إلى تنزيلات الكمبيوتر */
  async function receiveFile(item: ProdClipItem) {
    const r = await fetch("/api/prod/clipboard", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    })
    const j = await r.json()
    if (j.ok) toast.success(`استُلم: ${j.name}`, { description: `حُفظ في /Downloads (${fmtSize(j.bytes)})` })
    else toast.error(j.error || "فشل الاستلام")
  }

  async function clearAll() {
    await fetch("/api/prod/clipboard", { method: "DELETE" })
  }

  /** FA-clipboard-sync — زر «إرسال الحافظة الحالية»: يقرأ حافظة النظام الآن ويرسل
   *  (سطح المكتب: عبر الطبقة الأصلية بلا حد الحجم · المتصفح: عبر clipboard API) */
  async function sendCurrent() {
    if (isDesktop()) {
      try {
        const r = await tauriInvoke<string>("clip_send_now")
        if (r.startsWith("text:")) {
          toast.success("أُرسلت حافظة النظام إلى الهاتف", { description: `${r.slice(5)} حرفًا — افتح الهاتف والصق` })
        }
      } catch (e) {
        toast.error("لم أقرأ نصًا من حافظة النظام", { description: "الصورة تُرسل خلفيًا كملف إن وُجدت · " + String(e).slice(0, 60) })
      }
      return
    }
    try {
      const text = await navigator.clipboard.readText()
      if (!text?.trim()) {
        toast.error("الحافظة فارغة")
        return
      }
      await fetch("/api/prod/clipboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "pc-office", deviceName: "هذا الكمبيوتر", kind: "text", content: text, mode: state.clipMode }),
      })
      toast.success("أُرسلت حافظة النظام إلى الهاتف", { description: `${text.length} حرفًا` })
    } catch {
      toast.error("المتصفح رفض قراءة الحافظة", { description: "استعمل صندوق النسخ بجانبك داخل نافذة سطح المكتب" })
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
      {/* العمود الأيمن: منطقة اللصق + العناصر */}
      <div className="space-y-4 min-w-0">
        {/* الوضع */}
        <div className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className={cn("w-9 h-9 rounded-xl grid place-items-center", state.clipMode === "auto" ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : "bg-muted text-muted-foreground")}>
              <Wand2 className="w-4.5 h-4.5" />
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-bold">الوضع التلقائي</div>
              <div className="text-[10.5px] text-muted-foreground">
                أي نسخة من الهاتف تدخل حافظة النظام فوراً — Ctrl+V يعمل في أي مكان
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{state.clipMode === "auto" ? "تلقائي" : "يدوي"}</span>
            <Switch
              checked={state.clipMode === "auto"}
              onCheckedChange={(v) => void setClipMode(v ? "auto" : "manual")}
              aria-label="تبديل الوضع التلقائي للحافظة"
            />
          </div>
        </div>

        {/* FA-clipboard-sync — حد الإرسال التلقائي + إرسال الحافظة الحالية */}
        <div className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl grid place-items-center bg-muted text-muted-foreground">
              <ArrowLeftRight className="w-4.5 h-4.5" />
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-bold">مراقب حافظة النظام</div>
              <div className="text-[10.5px] text-muted-foreground">
                يراقب النسخ في أي مكان على الكمبيوتر — نص/صور/ملفات — ويرسل للهاتف فورًا في الوضع التلقائي
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10.5px] text-muted-foreground">حد الإرسال التلقائي</span>
            <div className="flex rounded-xl border overflow-hidden">
              {MAX_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => { setClipMaxLocal(o.value); void setClipMax(o.value) }}
                  className={cn(
                    "px-2.5 h-7 text-[10.5px] transition-colors",
                    clipMax === o.value ? "bg-violet-500 text-white" : "bg-background hover:bg-muted text-muted-foreground"
                  )}
                  aria-pressed={clipMax === o.value}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="rounded-xl h-8 gap-1.5 text-[11px]" onClick={() => void sendCurrent()}>
              <Send className="w-3.5 h-3.5" /> إرسال الحافظة الحالية
            </Button>
          </div>
        </div>

        {/* منطقة اللصق — اختبار النجاح */}
        <div className={cn("rounded-2xl border-2 border-dashed bg-card p-4 transition-colors", checks.paste ? "border-emerald-500/60 bg-emerald-500/5" : "border-violet-500/40")}>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Keyboard className="w-4 h-4 text-violet-500" />
            <span className="text-[13px] font-bold">منطقة اللصق — جرّب Ctrl+V هنا الآن</span>
            {sysClipboardArmed && (
              <Badge className="rounded-full text-[9.5px] bg-emerald-500 hover:bg-emerald-500 gap-1">
                <CircleCheck className="w-3 h-3" /> النص في حافظة النظام
              </Badge>
            )}
          </div>
          <Textarea
            ref={pasteRef}
            value={pasteZoneText}
            onChange={(e) => setPasteZoneText(e.target.value)}
            onPaste={onPasteZone}
            placeholder="اضغط داخل هذا المربع ثم Ctrl+V — إن نسخت من هاتفك سيظهر النص فوراً. يعمل أيضاً في أي تطبيق آخر على الكمبيوتر."
            className="min-h-24 rounded-xl text-[13px] bg-background/60"
            aria-label="منطقة لصق الحافظة الموحدة"
          />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Button size="sm" className="rounded-xl h-8 gap-1.5 text-[11px]" onClick={universalPaste}>
              <ClipboardCheck className="w-3.5 h-3.5" /> لصق الحافظة الموحدة (Ctrl+V)
            </Button>
            {phoneText && (
              <span className="text-[10.5px] text-muted-foreground truncate max-w-56" title={phoneText}>
                بانتظار اللصق: «{phoneText.slice(0, 36)}{phoneText.length > 36 ? "…" : ""}»
              </span>
            )}
          </div>
        </div>

        {/* تدفق العناصر */}
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Pilcrow className="w-4 h-4 text-muted-foreground" />
              <span className="text-[13px] font-bold">{query.trim() ? "نتائج بحث الخزنة" : "سجل الحافظة — آخر 50"}</span>
              <Badge variant="secondary" className="rounded-full text-[9.5px]">{(query.trim() && results ? results : clips).length}</Badge>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-40 max-w-xs">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث في الخزنة…"
                  className="w-full h-8 rounded-xl border bg-background/60 ps-8 pe-2 text-[11.5px] outline-none focus:ring-1 focus:ring-violet-500/40"
                  aria-label="بحث في خزنة الحافظة"
                />
              </div>
            </div>
            {clips.length > 0 && !query.trim() && (
              <Button variant="ghost" size="sm" className="h-7 rounded-lg gap-1 text-[10.5px] text-red-500 hover:text-red-600" onClick={() => void clearAll()}>
                <Trash2 className="w-3.5 h-3.5" /> مسح الكل
              </Button>
            )}
          </div>

          {(query.trim() && results ? results : clips).length === 0 ? (
            <p className="text-[12px] text-muted-foreground text-center py-8">
              {query.trim() ? "لا نتائج في الخزنة" : "الحافظة فارغة — انسخ نصًا من هاتفك عبر"} <span className="font-mono dir-ltr">/phone</span>
            </p>
          ) : (
            <ScrollArea className="max-h-96 pe-2">
              <div className="space-y-2">
                {(query.trim() && results ? results : clips).map((c) => (
                  <div key={c.id} className={cn("rounded-xl border bg-background/50 p-2.5 flex items-start gap-2.5", c.sensitive ? "border-amber-500/40" : "")}>
                    <div className="w-8 h-8 rounded-lg bg-muted grid place-items-center shrink-0">
                      {c.kind === "text" ? <FileText className="w-4 h-4 text-violet-500" /> : c.kind === "image" ? <ImageIcon className="w-4 h-4 text-violet-500" /> : <FileText className="w-4 h-4 text-violet-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground mb-1">
                        <span className="inline-flex items-center gap-1 font-semibold text-foreground/80">
                          <DeviceIcon id={c.deviceId} className="w-3 h-3" /> {c.deviceName}
                        </span>
                        <span>·</span>
                        <span>{KIND_LABEL[c.kind] ?? c.kind}</span>
                        <span>·</span>
                        <span>{fmtSize(c.size)}</span>
                        <span>·</span>
                        <span>{c.mode === "auto" ? "تلقائي" : "يدوي"}</span>
                        {c.received && <Badge className="rounded-full text-[8.5px] bg-emerald-500 hover:bg-emerald-500">استُلم</Badge>}
                        {c.pinned && <Badge variant="secondary" className="rounded-full text-[8.5px] gap-0.5"><Pin className="w-2.5 h-2.5" /> مثبّت</Badge>}
                        {c.sensitive && <Badge className="rounded-full text-[8.5px] bg-amber-500 hover:bg-amber-500 gap-0.5"><ShieldAlert className="w-2.5 h-2.5" /> حساس</Badge>}
                        {!c.pinned && typeof c.expiresAt === "number" && c.expiresAt - Date.now() < 86_400_000 && (
                          <Badge variant="secondary" className="rounded-full text-[8.5px] gap-0.5"><TimerReset className="w-2.5 h-2.5" /> ينتهي قريبًا</Badge>
                        )}
                      </div>
                      {c.kind === "text" && (
                        <p className="text-[12px] leading-relaxed line-clamp-3 dir-auto">
                          {c.masked ? <span className="text-amber-600 dark:text-amber-400 font-mono tracking-widest">{c.content}</span> : c.content}
                        </p>
                      )}
                      {c.kind === "image" && c.content.startsWith("data:") && (
                        <img src={c.content} alt="صورة من الحافظة الموحدة" className="rounded-lg max-h-32 border" />
                      )}
                      {c.kind === "file" && (
                        <p className="text-[12px] font-mono dir-ltr text-start">{c.fileName}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {c.kind === "text" && c.masked && (
                        <Button variant="ghost" size="icon" className="w-7 h-7 rounded-lg text-amber-600" aria-label="كشف العنصر الحساس (مُدقَّق)" onClick={() => void reveal(c.id)}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {c.kind === "text" && (
                        <Button variant="ghost" size="icon" className="w-7 h-7 rounded-lg" aria-label={c.pinned ? "إلغاء التدبيس" : "تدبيس العنصر"} onClick={() => void togglePin(c.id, !c.pinned)}>
                          {c.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </Button>
                      )}
                      {c.kind === "text" && !c.masked && (
                        <Button
                          variant="ghost" size="icon" className="w-7 h-7 rounded-lg"
                          aria-label="نسخ إلى حافظة النظام"
                          onClick={() => {
                            if (isDesktop()) {
                              // عبر الطبقة الأصلية — يعمل مع حرس الحلقة (لا يعيد المراقب إرساله)
                              void tauriInvoke("clip_apply", { kind: "text", content: c.content })
                                .then(() => toast("نُسخ إلى حافظة النظام (أصلي)"))
                                .catch(() => toast.error("تعذّر الكتابة للحافظة"))
                            } else {
                              void navigator.clipboard.writeText(c.content).then(() => toast("نُسخ إلى حافظة النظام"))
                            }
                          }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {c.kind === "file" && !c.received && (
                        <Button variant="ghost" size="icon" className="w-7 h-7 rounded-lg text-emerald-600" aria-label="استلام الملف فعلياً" onClick={() => void receiveFile(c)}>
                          <FileDown className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* العمود الأيسر: نسخ من الكمبيوتر + تفسير */}
      <aside className="space-y-3">
        <div className="rounded-2xl border bg-card p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-violet-500" />
            <span className="text-[13px] font-bold">نسخ من الكمبيوتر</span>
          </div>
          <Textarea
            value={compose}
            onChange={(e) => setCompose(e.target.value)}
            placeholder="اكتب أو الصق نصًا هنا ثم انسخه إلى الحافظة الموحدة — ستصلك نسخة جاهزة على هاتفك في /phone"
            className="min-h-20 rounded-xl text-[12.5px]"
            aria-label="نص للنسخ من الكمبيوتر"
          />
          <Button className="w-full rounded-xl h-9 gap-1.5 text-[12px]" disabled={!compose.trim()} onClick={() => void copyFromPc()}>
            <Copy className="w-4 h-4" /> نسخ إلى الحافظة الموحدة
          </Button>
        </div>

        <div className="rounded-2xl border bg-card p-4 text-[11.5px] leading-relaxed space-y-2">
          <div className="text-[12.5px] font-bold">كيف تعمل الحافظة الموحدة؟</div>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">تلقائي:</span> كل نسخة على أي جهاز تُبث لحظياً عبر Nexus Protocol وتدخل حافظة النظام على بقية الأجهزة — الصق بـ Ctrl+V مباشرة.
          </p>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">يدوي:</span> الوصول للنسخ ينتظر موافقتك من قائمة التدفق — مفيد أثناء العمل الحساس.
          </p>
          <p className="text-muted-foreground">
            يدعم <span className="font-semibold text-foreground">النص والصور والملفات</span> — الملفات تُنسخ بايتات فعلية إلى تنزيلات الكمبيوتر.
          </p>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">خزنة الحافظة (§50):</span> الحساس (رمز دخول/كلمة سر/بطاقة) يُقنَّع تلقائيًا وينتهي بعد 15 دقيقة — الكشف المقصود مُدقَّق، والتدبيس يحفظ ما لا تريد فقدانه، واللصق المؤقت يختفي بذاته.
          </p>
        </div>
      </aside>
    </div>
  )
}
