"use client"
// تبويب سجل التدقيق — كل عملية موثقة وقابلة للمراجعة والتصدير
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  ScrollText, Download, Trash2, KeyRound, ArrowLeftRight, Lock, Flame,
  ShieldAlert, Settings2, Search, EyeOff, Info,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useSec } from "@/lib/sec-store"
import { getSecSocket } from "@/lib/sec-socket"
import { fmtDate } from "@/lib/store"
import type { LucideIcon } from "lucide-react"

const ACTION_META: Record<string, { label: string; icon: LucideIcon }> = {
  kex: { label: "تشفير/اتصال", icon: KeyRound },
  transfer: { label: "نقل", icon: ArrowLeftRight },
  lock: { label: "قفل", icon: Lock },
  unlock: { label: "فتح", icon: Lock },
  wipe: { label: "حذف آمن", icon: Flame },
  alert: { label: "تنبيه", icon: ShieldAlert },
  trust: { label: "توثيق/حظر", icon: ShieldAlert },
  settings: { label: "إعدادات", icon: Settings2 },
  "perm-denied": { label: "رفض صلاحية", icon: ShieldAlert },
  replay: { label: "حماية إعادة", icon: ShieldAlert },
}

export function AuditTab() {
  const { audit, setCheck, setTab, stealth } = useSec()
  const [filter, setFilter] = useState("all")
  const [q, setQ] = useState("")
  const [clearOpen, setClearOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")

  useEffect(() => {
    const socket = getSecSocket()
    socket.emit("audit:get", { limit: 250 })
  }, [])

  const filtered = useMemo(() => audit.filter((a) => {
    if (filter !== "all" && a.severity !== filter) return false
    if (q && !(a.detail + a.actor + a.action).includes(q)) return false
    return true
  }), [audit, filter, q])

  function exportJson() {
    const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `nexuslink-audit-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    setCheck("audit", true)
    toast.success("صُدّر السجل كاملاً بصيغة JSON")
  }

  return (
    <div className="space-y-3">
      {/* شريط التحكم */}
      <div className="rounded-2xl border bg-card p-3 flex flex-wrap items-center gap-2">
        <div className="font-bold text-sm flex items-center gap-2 me-auto">
          <ScrollText className="w-4 h-4 text-teal-600" /> سجل التدقيق
          <Badge variant="outline">{audit.length} حدث</Badge>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-[12px]" aria-label="تصفية بالخطورة">
          <option value="all">كل الخطورة</option>
          <option value="info">معلومات</option>
          <option value="warn">تحذير</option>
          <option value="critical">حرج</option>
        </select>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute start-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في السجل…" className="h-8 rounded-lg border bg-background ps-7 pe-2 text-[12px] w-40" aria-label="بحث في السجل" />
        </div>
        <Button size="sm" variant="outline" className="h-8 rounded-lg gap-1 text-[11px]" onClick={exportJson}>
          <Download className="w-3 h-3" /> تصدير JSON
        </Button>
        <Button size="sm" variant="destructive" className="h-8 rounded-lg gap-1 text-[11px]" onClick={() => setClearOpen(true)}>
          <Trash2 className="w-3 h-3" /> تفريغ
        </Button>
      </div>

      {/* ملاحظة التخفي */}
      {stealth && (
        <div className="rounded-xl border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-[11px] flex items-center gap-1.5">
          <EyeOff className="w-3.5 h-3.5" /> وضع التخفي مفعّل: عمليات النقل التخفيّة <b>لا تُكتب هنا أصلاً</b> — هذا سلوك مقصود وليس ثغرة.
        </div>
      )}

      {/* القائمة */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="max-h-[440px] overflow-y-auto divide-y">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-muted-foreground">لا أحداث مطابقة — نفّذ عمليات (نقل/قفل/حذف/تنبيه) وشاهدها تُوثق هنا فوراً</div>
          ) : filtered.map((a) => {
            const meta = ACTION_META[a.action] ?? { label: a.action, icon: Info }
            const Icon = meta.icon
            return (
              <div key={a.id} className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-muted/30">
                <div className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ${
                  a.severity === "critical" ? "bg-red-500/15 text-red-600" : a.severity === "warn" ? "bg-amber-500/15 text-amber-600" : "bg-teal-500/15 text-teal-600"
                }`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <b>{meta.label}</b>
                    <span className="text-muted-foreground">· {a.actor}</span>
                    {a.stealth && <Badge variant="outline" className="text-slate-500">تخفي</Badge>}
                    <span className="text-muted-foreground ms-auto" dir="ltr">{fmtDate(a.at)}</span>
                  </div>
                  <div className="text-[12px] mt-0.5">{a.detail}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* تأكيد التفريغ */}
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>تفريغ سجل التدقيق</DialogTitle>
            <DialogDescription>
              إجراء حساس — اكتب <b className="font-mono">مسح</b> للتأكيد. التفريغ نفسه سيُسجل كحدث جديد.
            </DialogDescription>
          </DialogHeader>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="اكتب: مسح" className="h-9 rounded-xl border bg-background px-3 text-[13px]" aria-label="تأكيد التفريغ" />
          <Button
            variant="destructive" className="rounded-xl" disabled={confirmText !== "مسح"}
            onClick={() => {
              getSecSocket().emit("audit:clear")
              setClearOpen(false)
              setConfirmText("")
              toast.success("فُرّغ السجل — وسُجل التفريغ نفسه")
            }}
          >
            تفريغ نهائي
          </Button>
        </DialogContent>
      </Dialog>

      <button className="text-[11px] underline text-teal-600" onClick={() => setTab("stealth")}>لماذا لا أرى عمليات التخفي؟ ← فهم وضع التخفي</button>
    </div>
  )
}
