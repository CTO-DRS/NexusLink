"use client"
// NexusLink — مكونات مشتركة لطبقة الحماية
import type { ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import { fmtDate } from "@/lib/store"
import type { GuardLog } from "@/lib/guard-store"

/** بطاقة قسم بعنوان وأيقونة */
export function GuardCard({ title, icon: Icon, extra, children, className, tone }: {
  title: string
  icon: LucideIcon
  extra?: ReactNode
  children: ReactNode
  className?: string
  tone?: "danger" | "warn" | "ok"
}) {
  return (
    <Card className={cn(
      "border shadow-sm",
      tone === "danger" && "border-red-500/40 bg-red-500/[0.04]",
      tone === "warn" && "border-amber-500/40 bg-amber-500/[0.04]",
      tone === "ok" && "border-emerald-500/40 bg-emerald-500/[0.04]",
      className
    )}>
      <CardContent className="p-4 sm:p-5 space-y-3.5">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-8 h-8 rounded-xl grid place-items-center shrink-0",
            tone === "danger" ? "bg-red-500/15 text-red-500" : tone === "warn" ? "bg-amber-500/15 text-amber-500" : tone === "ok" ? "bg-emerald-500/15 text-emerald-500" : "bg-primary/10 text-primary"
          )}>
            <Icon className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-[14px] me-auto">{title}</h3>
          {extra}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** صف معلومة */
export function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b last:border-0 border-border/60">
      <span className="text-[11.5px] text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-[12px] font-medium text-start truncate", mono && "font-mono text-[11px] dir-ltr")}>{value}</span>
    </div>
  )
}

/** حلقة نسبة SVG (بطارية/ذاكرة) */
export function RatioRing({ value, size = 96, stroke = 9, color, label, sub }: {
  value: number // 0..100
  size?: number
  stroke?: number
  color?: string
  label?: string
  sub?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, value))
  const col = color ?? (pct < 15 ? "#ef4444" : pct < 30 ? "#f59e0b" : "#10b981")
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          stroke={col} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <div>
          <div className="font-black text-[17px]" style={{ color: col }}>{label ?? `${Math.round(pct)}%`}</div>
          {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
        </div>
      </div>
    </div>
  )
}

/** مقياس إشارة المنارة (RSSI) */
export function RssiMeter({ rssi, size = "md" }: { rssi: number | null; size?: "sm" | "md" }) {
  // -30 قوي جداً .. -90 ضعيف جداً
  const bars = rssi == null ? 0 : rssi > -50 ? 4 : rssi > -62 ? 3 : rssi > -74 ? 2 : rssi > -85 ? 1 : 0
  const color = bars >= 3 ? "bg-emerald-500" : bars === 2 ? "bg-amber-500" : "bg-red-500"
  const h = size === "md" ? ["h-2.5", "h-4", "h-5.5", "h-7"] : ["h-1.5", "h-2.5", "h-3.5", "h-4.5"]
  return (
    <div className="flex items-end gap-0.5" title={rssi == null ? "لا منارة" : `${Math.round(rssi)} dBm`}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={cn("w-1.5 rounded-sm transition-colors", h[i], i < bars ? color : "bg-muted")} />
      ))}
      {size === "md" && (
        <span className="text-[10px] font-mono text-muted-foreground ms-1 dir-ltr">
          {rssi == null ? "—" : `${Math.round(rssi)}dBm`}
        </span>
      )}
    </div>
  )
}

/** شارة حالة القرب */
export function ProxStateBadge({ state, leftMs }: { state: string; leftMs: number | null }) {
  if (state === "locked") return <Badge className="bg-red-500 hover:bg-red-500 rounded-full gap-1 text-[10px]">مقفل</Badge>
  if (state === "grace") return (
    <Badge className="bg-amber-500 hover:bg-amber-500 rounded-full gap-1 text-[10px] animate-pulse">
      عد تنازلي {leftMs != null ? `${Math.ceil(leftMs / 1000)}ث` : ""}
    </Badge>
  )
  if (state === "disabled") return <Badge variant="outline" className="rounded-full text-[10px]">متوقف</Badge>
  return <Badge variant="outline" className="rounded-full gap-1 text-[10px] border-emerald-500/50 text-emerald-600 dark:text-emerald-400">قريب</Badge>
}

/** سجل أحداث الحماية */
export function LogList({ logs, max = 40 }: { logs: GuardLog[]; max?: number }) {
  if (logs.length === 0) {
    return <p className="text-[11.5px] text-muted-foreground text-center py-6">لا أحداث بعد — جرّب ميزات الحماية</p>
  }
  return (
    <div className="space-y-1 max-h-72 overflow-y-auto pe-1">
      {logs.slice(0, max).map((l) => (
        <div key={l.id} className="flex items-start gap-2 text-[11.5px] py-1 border-b last:border-0 border-border/40">
          <span className={cn(
            "mt-1 w-1.5 h-1.5 rounded-full shrink-0",
            l.kind === "ok" ? "bg-emerald-500" : l.kind === "warn" ? "bg-red-500" : l.kind === "in" ? "bg-primary" : "bg-muted-foreground/50"
          )} />
          <span className="flex-1 leading-relaxed">{l.text}</span>
          <span className="text-[9px] text-muted-foreground shrink-0 font-mono">{fmtDate(l.at).split("،").pop()}</span>
        </div>
      ))}
    </div>
  )
}

/** مؤقت عد تنازلي بصيغة عربية */
export function fmtCountdown(sec: number | null) {
  if (sec == null) return "—"
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `بعد ${d} يوم و ${h} س`
  if (h > 0) return `بعد ${h} س و ${m} د`
  if (m > 0) return `بعد ${m} دقيقة`
  return "الآن"
}
