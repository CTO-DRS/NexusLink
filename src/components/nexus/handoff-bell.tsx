"use client"
// عقد §53 — التسليم اليدوي الذكي — جرس الشريط العلوي (شريط «أكمل من حيث توقفت»)
// استطلاع كل 5 ثوانٍ + عند الفتح · معاينات مقنّعة (حارس §50) · الأفعال الثلاثة
// (فتح/نسخ/إزالة) + تفريغ · شارة عدد غير المستهلك · بلا أي مورد خارجي.
import { useEffect, useState, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n"
import { Forward, Link2, Type, FileSymlink, PlayCircle, X, Trash2, ExternalLink, Copy } from "lucide-react"

interface HandoffView {
  id: string
  kind: "url" | "text" | "file-ref" | "media-position"
  preview: string
  sourceDevice: string
  note: string
  at: number
  hits: number
  expiresAt: number
  fingerprint: string
}

const KIND_ICON = { url: Link2, text: Type, "file-ref": FileSymlink, "media-position": PlayCircle } as const

function relTime(ms: number, t: (s: string) => string): string {
  const d = Date.now() - ms
  if (d < 60_000) return t("الآن")
  if (d < 3600_000) return `${Math.floor(d / 60_000)} ${t("د")}`
  if (d < 86_400_000) return `${Math.floor(d / 3600_000)} ${t("س")}`
  return `${Math.floor(d / 86_400_000)} ${t("ي")}`
}

export function HandoffBell() {
  const { t } = useI18n()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [items, setItems] = useState<HandoffView[]>([])
  const [open, setOpen] = useState(false)

  const refresh = useCallback(() => {
    fetch("/api/handoff", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { items?: HandoffView[] }) => setItems(j.items ?? []))
      .catch(() => { /* الخادم غائب — صمت صادق */ })
  }, [])

  useEffect(() => {
    void refresh()
    const iv = setInterval(() => { void refresh() }, 5000)
    return () => clearInterval(iv)
  }, [refresh])

  const act = async (id: string, action: "open" | "copy" | "dismiss") => {
    try {
      const r = await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      })
      const j = (await r.json()) as { ok?: boolean; directive?: { directive: string; url?: string; text?: string; media?: string; positionMs?: number } }
      if (!j.ok) { toast({ title: t("العنصر استُهلك أو انتهى"), variant: "destructive" }) }
      else if (action === "open" && j.directive) {
        if (j.directive.directive === "open-url" && j.directive.url) window.open(j.directive.url, "_blank", "noopener,noreferrer")
        else if (j.directive.directive === "copy" && j.directive.text) {
          try { await navigator.clipboard.writeText(j.directive.text) } catch { /* رفض المتصفح */ }
          toast({ title: t("نُسخ إلى الحافظة") })
        } else if (j.directive.directive === "resume-media") toast({ title: t("موضع التشغيل جاهز للاستئناف") })
        else toast({ title: t("الملف جاهز للفتح من تبويب الملفات") })
      } else if (action === "copy" && j.directive && "text" in j.directive && j.directive.text) {
        try { await navigator.clipboard.writeText(j.directive.text) } catch { /* رفض المتصفح */ }
        toast({ title: t("نُسخ إلى الحافظة") })
      }
    } catch { toast({ title: t("فشل الإجراء"), variant: "destructive" }) }
    void refresh()
    void qc.invalidateQueries({ queryKey: ["handoff"] })
  }

  const clearAll = async () => {
    try {
      await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      })
      toast({ title: t("فُرّغت قائمة التسليم") })
    } catch { /* صمت صادق */ }
    void refresh()
  }

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) void refresh() }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-xl gap-1.5 px-2.5 relative"
              aria-label={t("التسليم اليدوي — أكمل من حيث توقفت")}
              data-testid="handoff-bell"
            >
              <Forward className="w-3.5 h-3.5 text-teal-500" />
              <span className="hidden md:inline text-[11px] font-medium">{t("التسليم")}</span>
              {items.length > 0 && (
                <span
                  className="absolute -top-1.5 -end-1.5 min-w-4.5 h-4.5 px-1 rounded-full bg-teal-500 text-[9px] font-bold text-white grid place-items-center"
                  data-no-i18n
                  data-testid="handoff-badge"
                >
                  {items.length > 99 ? "99+" : items.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("التسليم اليدوي — أكمل من حيث توقفت")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[340px] p-0" data-testid="handoff-popover">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-xs font-bold flex items-center gap-1.5">
            <Forward className="w-3.5 h-3.5 text-teal-500" />
            {t("أكمل من حيث توقفت")}
          </div>
          {items.length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => void clearAll()} data-testid="handoff-clear">
              <Trash2 className="w-3 h-3" /> {t("تفريغ")}
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[320px]">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground" data-testid="handoff-empty">
              {t("لا عناصر تسليم — ادفع رابطًا أو نصًا من هاتفك ليظهر هنا بفعل بنقرة")}
            </div>
          ) : (
            <ul className="divide-y" data-testid="handoff-list">
              {items.map((it) => {
                const Icon = KIND_ICON[it.kind] ?? Link2
                return (
                  <li key={it.id} className="px-3 py-2 hover:bg-muted/40" data-testid="handoff-item">
                    <div className="flex items-start gap-2">
                      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-mono break-all leading-snug" dir="auto">{it.preview}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{it.sourceDevice}</Badge>
                          <span className="text-[9px] text-muted-foreground">{relTime(it.at, t)}</span>
                          {it.hits > 1 && <span className="text-[9px] text-muted-foreground">×{it.hits}</span>}
                          {it.note && <span className="text-[9px] text-muted-foreground truncate max-w-[110px]">· {it.note}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {(it.kind === "url" || it.kind === "file-ref" || it.kind === "media-position") && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t("فتح")} onClick={() => void act(it.id, "open")} data-testid="handoff-open">
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        )}
                        {(it.kind === "text" || it.kind === "url") && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t("نسخ")} onClick={() => void act(it.id, "copy")} data-testid="handoff-copy">
                            <Copy className="w-3 h-3" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t("إزالة")} onClick={() => void act(it.id, "dismiss")} data-testid="handoff-dismiss">
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>
        <div className="px-3 py-1.5 border-t text-[9px] text-muted-foreground">
          {t("محلي حصرًا — بلا حساب ولا سحابة، والقائمة تنتهي بعد 24 ساعة")}
        </div>
      </PopoverContent>
    </Popover>
  )
}
