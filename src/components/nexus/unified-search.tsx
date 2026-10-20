"use client"

/**
 * نافذة البحث الموحد (عقد §33.أ — M2.3): استعلام واحد عبر المخازن المحلية
 * الثمانية عبر /api/search — نتائج مجمعة بالمصدر، والاختيار يقفز للعرض
 * المعني (أفضل جهد). تُفتح من زر الشريط أو Ctrl+Shift+F.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Smartphone, Workflow, ClipboardCopy, MessagesSquare, Users, PhoneCall, ArrowLeftRight, FolderOpen } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useNexus, type ViewId } from "@/lib/store"
import { useI18n } from "@/lib/i18n"

interface SearchItem { id: string; title: string; snippet?: string; at?: number; score: number; view?: string }
interface SearchGroup { kind: string; label: string; items: SearchItem[] }
interface SearchPayload { ok: boolean; q: string; total: number; took: number; groups: SearchGroup[] }

const KIND_ICONS: Record<string, LucideIcon> = {
  device: Smartphone, routine: Workflow, clip: ClipboardCopy, message: MessagesSquare,
  contact: Users, call: PhoneCall, handoff: ArrowLeftRight, file: FolderOpen,
}

/** إزالة علامات i18n الحرفية عن التسميات الواردة من الخادم (تُخدَم عربية). */
function groupLabel(g: SearchGroup, t: (s: string) => string): string {
  const known: Record<string, string> = {
    device: t("الأجهزة"), routine: t("الروتينات"), clip: t("الحافظة"), message: t("الرسائل"),
    contact: t("جهات الاتصال"), call: t("النداءات"), handoff: t("التسليم المتصل"), file: t("الملفات المتزامنة"),
  }
  return known[g.kind] || g.label
}

export function UnifiedSearch() {
  const { unifiedSearchOpen, setUnifiedSearchOpen, setView } = useNexus()
  const { t } = useI18n()
  const [q, setQ] = useState("")
  const [payload, setPayload] = useState<SearchPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(async (query: string) => {
    const trimmed = query.trim()
    if (!trimmed) { setPayload(null); setErr(false); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed.slice(0, 80))}`, { cache: "no-store" })
      const j = (await res.json()) as SearchPayload
      setPayload(j)
      setErr(!res.ok && !j.ok)
    } catch {
      setErr(true)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!q.trim()) { setPayload(null); return }
    timer.current = setTimeout(() => void run(q), 220)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [q, run])

  const openItem = (item: SearchItem) => {
    setUnifiedSearchOpen(false)
    if (item.view) setView(item.view as ViewId)
  }

  return (
    <Dialog open={unifiedSearchOpen} onOpenChange={setUnifiedSearchOpen}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden" dir="auto">
        <DialogTitle className="sr-only">{t("بحث موحد")}</DialogTitle>
        <div className="flex items-center gap-2 px-4 h-14 border-b">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("ابحث عبر الأجهزة والملفات والرسائل والروتينات…")}
            aria-label={t("بحث موحد")}
            className="border-0 shadow-none focus-visible:ring-0 px-0 h-auto text-[15px]"
            maxLength={80}
          />
          {busy && <span className="text-[10px] text-muted-foreground shrink-0" aria-live="polite">{t("…بحث")}</span>}
        </div>
        <div className="max-h-[55vh] overflow-y-auto nexus-scroll p-3 space-y-3">
          {err && <div className="text-sm text-destructive px-2 py-3">{t("فشل البحث — أعد المحاولة")}</div>}
          {!err && payload && payload.total === 0 && !busy && (
            <div className="text-sm text-muted-foreground px-2 py-3">{t("لا نتائج في الفهرس المحلي")}</div>
          )}
          {!err && payload?.groups.map((g) => {
            const Icon = KIND_ICONS[g.kind] ?? Search
            return (
              <div key={g.kind} className="space-y-1">
                <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-muted-foreground">
                  <Icon className="w-3 h-3" />
                  {groupLabel(g, t)}
                  <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">{g.items.length}</Badge>
                </div>
                {g.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => openItem(item)}
                    className="w-full text-start rounded-xl px-2.5 py-2 hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring transition-colors"
                  >
                    <div className="text-[13px] font-medium truncate" dir="auto">{item.title}</div>
                    {item.snippet && <div className="text-[11px] text-muted-foreground truncate" dir="auto">{item.snippet}</div>}
                  </button>
                ))}
              </div>
            )
          })}
          {!err && payload && payload.total > 0 && (
            <div className="text-[10px] text-muted-foreground text-center pt-1 pb-0.5">
              {t("نتائج محلية حصريًا")} · {payload.took}ms
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
